package app.seefar.assistant

import android.app.AppOpsManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.Color as AColor
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.work.Worker
import androidx.work.WorkerParameters
import kotlinx.coroutines.delay
import java.time.LocalTime

// ---------------------------------------------------------------- rules

object Guard {
    /** Counted together against one daily budget. */
    val limited = setOf(
        "com.instagram.android", "com.instagram.lite", "com.facebook.katana", "com.facebook.lite",
        "com.twitter.android", "com.zhiliaoapp.musically", "com.ss.android.ugc.trill", "com.reddit.frontpage",
        "com.pinterest",
    )
    val limitedNames = listOf("Instagram", "Facebook", "X / Twitter", "TikTok", "Reddit", "Pinterest")

    /** Never usable: opened = covered and sent home, installed = nagged to uninstall. */
    private val bannedPkgs = setOf(
        "com.snapchat.android", "com.opera.browser", "com.opera.browser.beta", "com.opera.mini.native",
        "com.opera.mini.native.beta", "com.opera.gx", "com.opera.touch", "com.tinder", "com.bumble.app",
        "co.hinge.app", "com.badoo.mobile", "com.azarlive.android",
    )
    private val bannedRe = Regex("\\b(opera|snapchat|omegle|ometv|azar|tinder|bumble|badoo|hinge|chatib|wizz|holla|chatrandom|chatroulette|bigo|yubo|tango|chatous)\\b")
    val bannedNames = "Snapchat, Opera (all versions), Tinder, Bumble, Hinge, Badoo, Azar, OmeTV, Omegle-style random chat, Wizz, Holla, Bigo, Yubo, Tango"

    /** Browsers only work while a filtering Private DNS is set. */
    val browsers = setOf(
        "com.android.chrome", "com.chrome.beta", "com.chrome.dev", "org.mozilla.firefox", "org.mozilla.fenix", "org.mozilla.firefox_beta",
        "com.brave.browser", "com.microsoft.emmx", "com.sec.android.app.sbrowser", "com.mi.globalbrowser", "com.android.browser",
        "com.duckduckgo.mobile.android", "com.kiwibrowser.browser", "com.vivaldi.browser", "com.UCMobile.intl", "com.uc.browser.en",
        "org.torproject.torbrowser", "com.yandex.browser", "mark.via.gp",
    )

    /** Extra things shut at night, on top of social + browsers. */
    private val nightExtra = setOf("com.google.android.youtube", "com.android.vending", "org.telegram.messenger", "com.android.settings")

    private val labels = HashMap<String, String>()

    private fun label(ctx: Context, pkg: String): String = labels.getOrPut(pkg) {
        try {
            val pm = ctx.packageManager
            pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString().lowercase()
        } catch (e: Exception) { "" }
    }

    fun forget(pkg: String) { labels.remove(pkg) }

    fun isBanned(ctx: Context, pkg: String): Boolean {
        if (pkg == ctx.packageName) return false
        return pkg in bannedPkgs || pkg.startsWith("com.opera.") || bannedRe.containsMatchIn(label(ctx, pkg))
    }

    fun isLimited(pkg: String) = pkg in limited
    fun isBrowser(pkg: String) = pkg in browsers
    fun isNightBlocked(pkg: String) = pkg in limited || pkg in browsers || pkg in nightExtra

    fun installedBanned(ctx: Context): List<Pair<String, String>> = try {
        val pm = ctx.packageManager
        pm.getInstalledApplications(0)
            .filter { isBanned(ctx, it.packageName) }
            .map { it.packageName to pm.getApplicationLabel(it).toString() }
    } catch (e: Exception) { emptyList() }

    /** Night lock window: 23:00 to 05:00. */
    fun isNight(now: LocalTime = LocalTime.now()) = now.hour >= 23 || now.hour < 5

    fun usageOn(ctx: Context): Boolean = try {
        val ao = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= 29) ao.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), ctx.packageName)
        else @Suppress("DEPRECATION") ao.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), ctx.packageName)
        mode == AppOpsManager.MODE_ALLOWED
    } catch (e: Exception) { false }

    fun overlayOn(ctx: Context): Boolean = try { Settings.canDrawOverlays(ctx) } catch (e: Exception) { false }

    fun batteryOk(ctx: Context): Boolean = try {
        (ctx.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(ctx.packageName)
    } catch (e: Exception) { false }

    /** Hostname set as Private DNS, or "" when Private DNS is off/automatic. */
    fun privateDns(ctx: Context): String = try {
        val mode = Settings.Global.getString(ctx.contentResolver, "private_dns_mode")
        if (mode == "hostname") Settings.Global.getString(ctx.contentResolver, "private_dns_specifier").orEmpty() else ""
    } catch (e: Exception) { "" }

    /** A real family/adult filter, not just any Private DNS provider. */
    fun filterOk(ctx: Context): Boolean {
        val h = privateDns(ctx).lowercase()
        if (h.isBlank()) return false
        return ("cleanbrowsing" in h && ("family" in h || "adult" in h)) || ("adguard" in h && "family" in h)
    }

    fun adminOn(ctx: Context): Boolean = try {
        (ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager).isAdminActive(ComponentName(ctx, SeeFarAdmin::class.java))
    } catch (e: Exception) { false }

    /** Is the service actually alive (heartbeat in the last 2 minutes)? */
    fun alive(ctx: Context) = System.currentTimeMillis() - GuardStore.heartbeat(ctx) < 120_000L

    val LIMIT_LINES = listOf(
        "Your social time is spent. Go outside. Or read something with paragraphs.",
        "Thirty minutes. Gone. The feed will still be there tomorrow, sadly.",
        "Budget exhausted. The algorithm will have to miss you.",
    )
    val BAN_LINES = listOf(
        "That app is banned. You asked me to do this. Respect past you.",
        "Nope. Past you saw this coming and left me in charge.",
        "Blocked. Go do something your future self will thank you for.",
    )
    val BROWSER_LINES = listOf(
        "Browser is closed while the web filter is off. Turn Private DNS back on, then try again.",
        "No filter, no browser. Switch Private DNS back on.",
    )
    val NIGHT_LINES = listOf(
        "Night lock. The phone's job now is to be asleep. Go to bed.",
        "It's late. Nothing here will be better than sleep. Put the phone down.",
    )
}

object GuardStore {
    private fun p(ctx: Context) = ctx.getSharedPreferences("seefar_guard", 0)
    private fun today() = java.time.LocalDate.now().toString()

    fun usedSec(ctx: Context): Int {
        val s = p(ctx)
        return if (s.getString("day", "") == today()) s.getInt("used", 0) else 0
    }

    fun addUsed(ctx: Context, sec: Int) {
        val s = p(ctx)
        val d = today()
        val cur = if (s.getString("day", "") == d) s.getInt("used", 0) else 0
        s.edit().putString("day", d).putInt("used", cur + sec).apply()
    }

    /** Effective daily limit in minutes. A looser limit only applies 24 h after you ask. */
    fun limitMin(ctx: Context): Int {
        val s = p(ctx)
        val pend = s.getInt("pend", 0)
        if (pend > 0 && System.currentTimeMillis() >= s.getLong("pendAt", 0L)) {
            s.edit().putInt("limit", pend).remove("pend").remove("pendAt").apply()
        }
        return s.getInt("limit", 30)
    }

    fun requestLimit(ctx: Context, min: Int) {
        val cur = limitMin(ctx)
        val e = p(ctx).edit()
        if (min <= cur) e.putInt("limit", min).remove("pend").remove("pendAt")
        else e.putInt("pend", min).putLong("pendAt", System.currentTimeMillis() + 24L * 3600_000L)
        e.apply()
    }

    fun pending(ctx: Context): Pair<Int, Long>? {
        limitMin(ctx)
        val s = p(ctx)
        val pend = s.getInt("pend", 0)
        return if (pend > 0) pend to s.getLong("pendAt", 0L) else null
    }

    fun armed(ctx: Context) = p(ctx).getBoolean("armed", false)
    fun setArmed(ctx: Context) = p(ctx).edit().putBoolean("armed", true).apply()
    fun dnsSeen(ctx: Context) = p(ctx).getBoolean("dnsSeen", false)
    fun setDnsSeen(ctx: Context) = p(ctx).edit().putBoolean("dnsSeen", true).apply()
    fun heartbeat(ctx: Context) = p(ctx).getLong("hb", 0L)
    fun beat(ctx: Context) = p(ctx).edit().putLong("hb", System.currentTimeMillis()).apply()
    fun blocksToday(ctx: Context): Int { val s = p(ctx); return if (s.getString("bday", "") == today()) s.getInt("blocks", 0) else 0 }
    fun addBlock(ctx: Context) {
        val s = p(ctx)
        val n = if (s.getString("bday", "") == today()) s.getInt("blocks", 0) else 0
        s.edit().putString("bday", today()).putInt("blocks", n + 1).apply()
    }
}

// ---------------------------------------------------------------- enforcement (no Accessibility, so banking apps keep working)

/**
 * Foreground service. Reads which app is in front from Usage Access (app name only, never screen
 * content), then covers and exits banned / over-budget / unfiltered-browser / night-locked apps.
 */
class GuardService : Service() {
    private val h = Handler(Looper.getMainLooper())
    private var fg: String? = null
    private var lastQ = 0L
    private var lastTick = 0L
    private var imePkg = ""
    private var overlay: View? = null
    private var registered = false
    private var lastBan = 0L

    private val loop = object : Runnable {
        override fun run() {
            try { tick() } catch (e: Exception) { /* keep running */ }
            h.postDelayed(this, 1500)
        }
    }

    private val installs = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            val pkg = i.data?.schemeSpecificPart ?: return
            if (pkg == packageName) return
            Guard.forget(pkg)
            if (Guard.isBanned(this@GuardService, pkg)) {
                Notifs.post(this@GuardService, "Banned app installed", "Uninstall it from the Guard screen. It will not open anyway.", 7004, go = "guard")
                try { startActivity(Intent(Intent.ACTION_DELETE, Uri.parse("package:$pkg")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (e: Exception) { }
            }
        }
    }

    override fun onBind(i: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startFg()
        if (Guard.usageOn(this)) GuardStore.setArmed(this)
        if (!registered) {
            ContextCompat.registerReceiver(this, installs, IntentFilter(Intent.ACTION_PACKAGE_ADDED).apply { addDataScheme("package") }, ContextCompat.RECEIVER_NOT_EXPORTED)
            registered = true
        }
        h.removeCallbacks(loop)
        h.post(loop)
        return START_STICKY
    }

    private fun startFg() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel("seefar_guard", "SeeFar Guard", NotificationManager.IMPORTANCE_MIN))
        val open = android.app.PendingIntent.getActivity(
            this, 1, Intent(this, MainActivity::class.java).putExtra("go", "guard"),
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
        )
        val n: Notification = NotificationCompat.Builder(this, "seefar_guard")
            .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
            .setContentTitle("SeeFar Guard is on")
            .setContentText("Keeping you on track.")
            .setContentIntent(open).setOngoing(true).setPriority(NotificationCompat.PRIORITY_MIN).build()
        if (Build.VERSION.SDK_INT >= 34) startForeground(7100, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(7100, n)
    }

    private fun refreshIme() {
        imePkg = try { Settings.Secure.getString(contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD)?.substringBefore('/').orEmpty() } catch (e: Exception) { "" }
    }

    private fun poll() {
        val usm = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val now = System.currentTimeMillis()
        val from = if (lastQ == 0L) now - 2 * 3600_000L else lastQ - 1500
        val ev = usm.queryEvents(from, now)
        val e = UsageEvents.Event()
        while (ev.hasNextEvent()) {
            ev.getNextEvent(e)
            when (e.eventType) {
                UsageEvents.Event.ACTIVITY_RESUMED -> fg = e.packageName
                UsageEvents.Event.ACTIVITY_PAUSED -> if (e.packageName == fg) fg = null
            }
        }
        lastQ = now
    }

    private fun tick() {
        GuardStore.beat(this)
        if (!Guard.usageOn(this)) { fg = null; return }
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        val now = System.currentTimeMillis()
        if (!pm.isInteractive) { lastTick = now; return }
        poll()
        if (imePkg.isEmpty()) refreshIme()
        val pkg = fg
        val dt = if (lastTick == 0L) 0 else ((now - lastTick) / 1000L).toInt().coerceIn(0, 5)
        lastTick = now
        if (pkg == null || pkg == packageName || pkg == imePkg || pkg == "com.android.systemui") return

        if (Guard.isBanned(this, pkg)) return kick(Guard.BAN_LINES.random())
        if (Guard.isNight() && Guard.isNightBlocked(pkg)) return kick(Guard.NIGHT_LINES.random())
        if (Guard.isBrowser(pkg) && !Guard.filterOk(this)) return kick(Guard.BROWSER_LINES.random())
        if (Guard.isLimited(pkg)) {
            if (dt > 0) GuardStore.addUsed(this, dt)
            if (GuardStore.usedSec(this) >= GuardStore.limitMin(this) * 60) kick(Guard.LIMIT_LINES.random())
        }
    }

    private fun kick(msg: String) {
        val now = System.currentTimeMillis()
        if (now - lastBan < 1200) return
        lastBan = now
        GuardStore.addBlock(this)
        fg = null
        showOverlay(msg)
        try {
            startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) { }
    }

    private fun showOverlay(msg: String) {
        if (!Guard.overlayOn(this)) { nag(msg); return }
        hideOverlay()
        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(AColor.WHITE)
            setPadding(64, 64, 64, 64)
        }
        box.addView(TextView(this).apply { text = "🛡"; textSize = 56f; gravity = Gravity.CENTER })
        box.addView(TextView(this).apply { text = msg; textSize = 20f; setTextColor(AColor.parseColor("#3C3C3C")); gravity = Gravity.CENTER; setPadding(0, 24, 0, 24) })
        box.addView(TextView(this).apply {
            text = "OK"; textSize = 18f; setTextColor(AColor.WHITE); setBackgroundColor(AColor.parseColor("#58CC02")); gravity = Gravity.CENTER
            setPadding(96, 28, 96, 28); setOnClickListener { hideOverlay() }
        })
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.OPAQUE
        )
        try { wm.addView(box, lp); overlay = box; h.postDelayed({ hideOverlay() }, 4000) } catch (e: Exception) { }
    }

    /** No overlay permission on this phone: a loud heads-up notification whose tap sends you home. */
    private fun nag(msg: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel("seefar_block", "SeeFar blocks", NotificationManager.IMPORTANCE_HIGH))
        val home = android.app.PendingIntent.getActivity(
            this, 2, Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
        )
        val n = NotificationCompat.Builder(this, "seefar_block")
            .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
            .setContentTitle("🛡 Blocked").setContentText(msg)
            .setStyle(NotificationCompat.BigTextStyle().bigText(msg))
            .setPriority(NotificationCompat.PRIORITY_HIGH).setCategory(NotificationCompat.CATEGORY_ALARM)
            .setContentIntent(home).setFullScreenIntent(home, true).setAutoCancel(true).build()
        try { nm.notify(7201, n) } catch (e: Exception) { }
    }

    private fun hideOverlay() {
        overlay?.let { try { (getSystemService(Context.WINDOW_SERVICE) as WindowManager).removeView(it) } catch (e: Exception) { } }
        overlay = null
    }

    override fun onDestroy() {
        h.removeCallbacks(loop)
        hideOverlay()
        if (registered) { try { unregisterReceiver(installs) } catch (e: Exception) { }; registered = false }
        super.onDestroy()
    }

    companion object {
        fun start(ctx: Context) {
            try { ContextCompat.startForegroundService(ctx, Intent(ctx, GuardService::class.java)) } catch (e: Exception) { /* background start refused; opening the app restarts it */ }
        }
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        if (i.action == Intent.ACTION_BOOT_COMPLETED || i.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            if (GuardStore.armed(c)) GuardService.start(c)
            Rec.schedule(c)
        }
    }
}

/** Declared with no powers. Its only job: Android refuses to uninstall SeeFar until this is switched off first. */
class SeeFarAdmin : DeviceAdminReceiver()

/** Every 15 min: if you switched the guard or the web filter off after setting them up, say so, and try to bring it back. */
class GuardWatchWorker(ctx: Context, p: WorkerParameters) : Worker(ctx, p) {
    override fun doWork(): Result {
        val c = applicationContext
        if (GuardStore.armed(c)) {
            if (!Guard.usageOn(c)) Notifs.post(c, "Guard is off", "Usage access was switched off. Turn it back on: tap here.", 7002, go = "guard")
            else if (!Guard.alive(c)) {
                GuardService.start(c)
                Notifs.post(c, "Guard stopped", "Android stopped the guard. Open SeeFar to restart it, and set battery to No restrictions.", 7002, go = "guard")
            }
        }
        if (Guard.filterOk(c)) GuardStore.setDnsSeen(c)
        else if (GuardStore.dnsSeen(c)) Notifs.post(c, "Web filter is off", "Private DNS changed. Browsers stay closed until it is back.", 7003, go = "guard")
        val bad = Guard.installedBanned(c)
        if (bad.isNotEmpty()) Notifs.post(c, "Banned app still installed", bad.joinToString { it.second } + ". Uninstall it.", 7004, go = "guard")
        return Result.success()
    }
}

// ---------------------------------------------------------------- screen

const val DNS_HOST = "family-filter-dns.cleanbrowsing.org"

fun openSettings(ctx: Context, i: Intent) {
    try { ctx.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (e: Exception) {
        Toast.makeText(ctx, "Could not open that screen on this phone.", Toast.LENGTH_LONG).show()
    }
}

@Composable
fun SetupStep(ok: Boolean, title: String, why: String, action: String, go: () -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(if (ok) "✅" else "⬜", fontSize = 22.sp)
        Column(Modifier.weight(1f)) {
            Text(title, color = C.text, fontWeight = FontWeight.ExtraBold, fontSize = 15.sp)
            Text(why, color = C.dim, fontSize = 12.sp)
        }
        if (!ok) Pill(action) { go() }
    }
}

@Composable
fun GuardScreen(brain: Brain, close: () -> Unit) {
    val ctx = LocalContext.current
    var tick by remember { mutableStateOf(0) }
    var scan by remember { mutableStateOf(0) }
    LaunchedEffect(Unit) { GuardService.start(ctx); while (true) { delay(2000); tick++ } }

    val used = remember(tick) { GuardStore.usedSec(ctx) }
    val limit = remember(tick) { GuardStore.limitMin(ctx) }
    val pending = remember(tick) { GuardStore.pending(ctx) }
    val usage = remember(tick) { Guard.usageOn(ctx) }
    val overlay = remember(tick) { Guard.overlayOn(ctx) }
    val battery = remember(tick) { Guard.batteryOk(ctx) }
    val alive = remember(tick) { Guard.alive(ctx) }
    val dns = remember(tick) { Guard.privateDns(ctx) }
    val filter = remember(tick) { Guard.filterOk(ctx) }
    val admin = remember(tick) { Guard.adminOn(ctx) }
    val blocks = remember(tick) { GuardStore.blocksToday(ctx) }
    val banned = remember(scan) { Guard.installedBanned(ctx) }
    val running = usage && alive

    Column(Modifier.padding(horizontal = 16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        TopBar("🛡 Guard", close)

        Card {
            Text(if (running) "Guard is ON" else "Guard is NOT running", color = if (running) C.green.deep() else C.red, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
            Text(if (running) "Blocked $blocks time${if (blocks == 1) "" else "s"} today." else "Finish the steps below. Each is a one-time switch.", color = C.dim, fontSize = 13.sp)
            SetupStep(usage, "Usage access", "Lets me see which app is open. Not your screen, not your typing.", "Turn on") {
                openSettings(ctx, Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
            }
            SetupStep(overlay, "Display over other apps (optional)", "If your phone has no such switch, skip it. Blocks then arrive as a loud notification.", "Turn on") {
                openSettings(ctx, Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${ctx.packageName}")))
            }
            SetupStep(battery, "Battery: no restrictions", "Xiaomi kills background apps. Set SeeFar to No restrictions.", "Open") {
                openSettings(ctx, Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            }
            Text("This does NOT use Accessibility, so your bank app works normally.", color = C.green.deep(), fontSize = 12.sp, fontWeight = FontWeight.Bold)
            if (usage && !alive) Pill("Start guard") { GuardService.start(ctx); tick++ }
            Pill("App info (Autostart, restricted settings)") { openSettings(ctx, Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}"))) }
        }

        Card {
            Text("Social time today", color = C.dim, fontSize = 14.sp)
            Text("${used / 60}:${"%02d".format(used % 60)} of $limit min", color = if (used >= limit * 60) C.red else C.text, fontSize = 28.sp, fontWeight = FontWeight.ExtraBold)
            val frac = (used.toFloat() / (limit * 60f)).coerceIn(0f, 1f)
            Box(Modifier.fillMaxWidth().height(10.dp).background(C.card2, RoundedCornerShape(5.dp))) {
                Box(Modifier.fillMaxWidth(frac).height(10.dp).background(if (frac >= 1f) C.red else C.green, RoundedCornerShape(5.dp)))
            }
            Text("One shared budget for: ${Guard.limitedNames.joinToString(", ")}.", color = C.dim, fontSize = 13.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (m in listOf(15, 30, 45, 60)) Pill("$m min", selected = m == limit) { GuardStore.requestLimit(ctx, m); tick++ }
            }
            Text("Lower takes effect now. Higher waits 24 hours, so you can't loosen it in a weak moment.", color = C.dim, fontSize = 12.sp)
            if (pending != null) Text("Pending: ${pending.first} min, starts in ${((pending.second - System.currentTimeMillis()) / 3600_000L).coerceAtLeast(0)} h.", color = C.gold, fontSize = 13.sp)
        }

        Card {
            Text("Hard limits that need no permission", color = C.dim, fontSize = 14.sp)
            Text("Without the overlay switch I can only nag, not force an app shut. Your phone's own tools can force it. Look in Settings for 'Digital Wellbeing' or 'App timers' and set Instagram, Facebook, TikTok to 15 to 30 minutes. For the part you can't undo, have someone you trust set it up and keep the passcode.", color = C.text, fontSize = 13.sp)
            Pill("Search Settings") { openSettings(ctx, Intent(Settings.ACTION_SETTINGS)) }
        }

        Card {
            Text("Night lock · 23:00 to 05:00", color = C.dim, fontSize = 14.sp)
            Text("Social, browsers, YouTube, Play Store, Telegram and Settings are shut. Calls, alarm, WhatsApp and your bank stay open.", color = C.text, fontSize = 14.sp)
            Text(if (Guard.isNight()) "Active right now." else "Not active right now.", color = C.dim, fontSize = 12.sp)
        }

        Card {
            Text("Web filter (adult and chat sites)", color = C.dim, fontSize = 14.sp)
            Text(
                if (filter) "ON via $dns" else if (dns.isNotBlank()) "Private DNS is $dns, which is not a family filter. Browsers are closed." else "OFF. Browsers are closed until it is on.",
                color = if (filter) C.green.deep() else C.red, fontSize = 17.sp, fontWeight = FontWeight.Bold
            )
            if (!filter) {
                Text(
                    "Settings → Connection & sharing → Private DNS → 'Private DNS provider hostname' → paste the hostname below → Save.\n" +
                        "In Chrome: Settings → Privacy and security → Use secure DNS → 'With your current service provider', otherwise Chrome skips the filter.",
                    color = C.text, fontSize = 14.sp
                )
                Text(DNS_HOST, color = C.gold, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Pill("Copy hostname") {
                        (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("dns", DNS_HOST))
                        Toast.makeText(ctx, "Copied", Toast.LENGTH_SHORT).show()
                    }
                    Pill("Open settings") { openSettings(ctx, Intent(Settings.ACTION_WIRELESS_SETTINGS)) }
                }
            }
            Text("Browsers close whenever this is off, so turning it off to browse freely no longer works. Apps that don't use the system DNS can still bypass it.", color = C.dim, fontSize = 12.sp)
        }

        Card {
            Text("Banned apps", color = C.dim, fontSize = 14.sp)
            Text(Guard.bannedNames, color = C.text, fontSize = 14.sp)
            Text("Opened = covered and sent home. Installed = I nag you to uninstall. I can't stop a download itself.", color = C.dim, fontSize = 12.sp)
            if (banned.isEmpty()) Text("None installed right now. Good.", color = C.green.deep(), fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            for ((pkg, name) in banned) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text("❌ $name", color = C.red, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                    Pill("Uninstall") { openSettings(ctx, Intent(Intent.ACTION_DELETE, Uri.parse("package:$pkg"))) }
                }
            }
            Pill("Rescan") { scan++ }
        }

        Card {
            Text("Make it hard to undo", color = C.dim, fontSize = 14.sp)
            Text(if (admin) "Uninstall lock: ON. Removing SeeFar means switching this off in Settings first." else "Uninstall lock: OFF", color = if (admin) C.green.deep() else C.gold, fontSize = 16.sp, fontWeight = FontWeight.Bold)
            if (!admin) BigButton("Turn on uninstall lock", C.blue, Modifier.fillMaxWidth()) {
                openSettings(
                    ctx,
                    Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
                        .putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, ComponentName(ctx, SeeFarAdmin::class.java))
                        .putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, "Stops SeeFar from being uninstalled in a weak moment. It gets no other powers.")
                )
            }
            Text("Honest limit: anything you can switch on in Settings you can switch off in Settings. If you do, I notify you within 15 minutes. The real lock is a person: use Xiaomi Settings → Apps → App lock on Settings and the Play Store, with a passcode someone you trust keeps.", color = C.dim, fontSize = 12.sp)
        }
        Spacer(Modifier.height(24.dp))
    }
}
