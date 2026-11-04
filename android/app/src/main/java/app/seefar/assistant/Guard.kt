package app.seefar.assistant

import android.accessibilityservice.AccessibilityService
import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.work.Worker
import androidx.work.WorkerParameters
import kotlinx.coroutines.delay

// ---------------------------------------------------------------- rules + storage

object Guard {
    /** Counted together against one daily budget. */
    val limited = setOf(
        "com.instagram.android", "com.instagram.lite", "com.facebook.katana", "com.facebook.lite",
        "com.twitter.android", "com.zhiliaoapp.musically", "com.ss.android.ugc.trill", "com.reddit.frontpage",
        "com.pinterest",
    )
    val limitedNames = listOf("Instagram", "Facebook", "X / Twitter", "TikTok", "Reddit", "Pinterest")

    /** Never usable: opened = thrown to the home screen, installed = nagged to uninstall. */
    private val bannedPkgs = setOf(
        "com.snapchat.android", "com.opera.browser", "com.opera.browser.beta", "com.opera.mini.native",
        "com.opera.mini.native.beta", "com.opera.gx", "com.opera.touch", "com.tinder", "com.bumble.app",
        "co.hinge.app", "com.badoo.mobile", "com.azarlive.android",
    )
    private val bannedRe = Regex("\\b(opera|snapchat|omegle|ometv|azar|tinder|bumble|badoo|hinge|chatib|wizz|holla|chatrandom|chatroulette|bigo|yubo|tango|chatous)\\b")
    val bannedNames = "Snapchat, Opera (all versions), Tinder, Bumble, Hinge, Badoo, Azar, OmeTV, Omegle-style random chat, Wizz, Holla, Bigo, Yubo, Tango"

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

    fun installedBanned(ctx: Context): List<Pair<String, String>> = try {
        val pm = ctx.packageManager
        pm.getInstalledApplications(0)
            .filter { isBanned(ctx, it.packageName) }
            .map { it.packageName to pm.getApplicationLabel(it).toString() }
    } catch (e: Exception) { emptyList() }

    fun accessibilityOn(ctx: Context): Boolean {
        val s = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
        return s.contains(ctx.packageName) && s.contains("SeeFarGuardService")
    }

    /** Hostname set as Private DNS, or "" when Private DNS is off/automatic. */
    fun privateDns(ctx: Context): String = try {
        val mode = Settings.Global.getString(ctx.contentResolver, "private_dns_mode")
        if (mode == "hostname") Settings.Global.getString(ctx.contentResolver, "private_dns_specifier").orEmpty() else ""
    } catch (e: Exception) { "" }

    fun adminOn(ctx: Context): Boolean = try {
        (ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager).isAdminActive(ComponentName(ctx, SeeFarAdmin::class.java))
    } catch (e: Exception) { false }

    val LIMIT_LINES = listOf(
        "Your social time is spent, monsieur. Go outside. Or read something with paragraphs.",
        "Thirty minutes. Gone. Tomorrow, the feed will still be there, sadly.",
        "Budget exhausted. The algorithm will have to miss you.",
    )
    val BAN_LINES = listOf(
        "That app is banned. You asked me to do this. Respect past you.",
        "Nope. Past you saw this coming and left me in charge.",
        "Blocked. Go do something your future self will thank you for.",
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
}

// ---------------------------------------------------------------- enforcement

/**
 * Sees only which app is on screen (no screen content, no typing). Enforces the daily social
 * budget and throws banned apps back to the home screen.
 */
class SeeFarGuardService : AccessibilityService() {
    private val h = Handler(Looper.getMainLooper())
    private var cur: String? = null
    private var last = 0L
    private var lastKick = 0L
    private var imePkg = ""
    private var registered = false

    private val tick = object : Runnable {
        override fun run() { onTick(); h.postDelayed(this, 3000) }
    }

    private val installs = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            val pkg = i.data?.schemeSpecificPart ?: return
            if (pkg == packageName) return
            Guard.forget(pkg)
            if (Guard.isBanned(this@SeeFarGuardService, pkg)) {
                Toast.makeText(this@SeeFarGuardService, "A banned app was installed. Uninstall it. Now.", Toast.LENGTH_LONG).show()
                Notifs.post(this@SeeFarGuardService, "Banned app installed", "Uninstall it from the Guard screen. I'll throw you out of it anyway.", 7004)
                try {
                    startActivity(Intent(Intent.ACTION_DELETE, Uri.parse("package:$pkg")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                } catch (e: Exception) { /* notification above still stands */ }
            }
        }
    }

    override fun onServiceConnected() {
        GuardStore.setArmed(this)
        refreshIme()
        if (!registered) {
            ContextCompat.registerReceiver(this, installs, IntentFilter(Intent.ACTION_PACKAGE_ADDED).apply { addDataScheme("package") }, ContextCompat.RECEIVER_NOT_EXPORTED)
            registered = true
        }
        h.removeCallbacks(tick)
        h.postDelayed(tick, 3000)
    }

    private fun refreshIme() {
        imePkg = try { Settings.Secure.getString(contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD)?.substringBefore('/').orEmpty() } catch (e: Exception) { "" }
    }

    override fun onAccessibilityEvent(e: AccessibilityEvent?) {
        if (e == null || e.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = e.packageName?.toString() ?: return
        if (pkg == "com.android.systemui" || pkg == "android" || pkg == imePkg || pkg == "com.lbe.security.miui") return
        if (Guard.isBanned(this, pkg)) {
            cur = null
            kick(Guard.BAN_LINES.random())
            return
        }
        if (Guard.isLimited(pkg)) {
            if (cur != pkg) { cur = pkg; last = System.currentTimeMillis() }
            if (over()) kick(Guard.LIMIT_LINES.random())
        } else {
            cur = null
        }
    }

    private fun over() = GuardStore.usedSec(this) >= GuardStore.limitMin(this) * 60

    private fun onTick() {
        val now = System.currentTimeMillis()
        if (cur != null) {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            if (pm.isInteractive) {
                val dt = ((now - last) / 1000L).toInt().coerceIn(0, 6)
                if (dt > 0) GuardStore.addUsed(this, dt)
                if (over()) kick(Guard.LIMIT_LINES.random())
            }
        } else refreshIme()
        last = now
    }

    private fun kick(msg: String) {
        performGlobalAction(GLOBAL_ACTION_HOME)
        val now = System.currentTimeMillis()
        if (now - lastKick > 2500) Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
        lastKick = now
        cur = null
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        h.removeCallbacks(tick)
        if (registered) { try { unregisterReceiver(installs) } catch (e: Exception) { } ; registered = false }
        super.onDestroy()
    }
}

/** Declared with no powers. Its only job: Android refuses to uninstall SeeFar until this is switched off first. */
class SeeFarAdmin : DeviceAdminReceiver()

/** Every 15 min: if you switched the guard or the web filter off after setting them up, say so. */
class GuardWatchWorker(ctx: Context, p: WorkerParameters) : Worker(ctx, p) {
    override fun doWork(): Result {
        val c = applicationContext
        if (GuardStore.armed(c) && !Guard.accessibilityOn(c)) {
            Notifs.post(c, "Guard is off", "You switched the guard off. Bold. Turn it back on: Settings > Accessibility > SeeFar.", 7002)
        } else if (Guard.privateDns(c).isNotBlank()) {
            GuardStore.setDnsSeen(c)
        } else if (GuardStore.dnsSeen(c)) {
            Notifs.post(c, "Web filter is off", "Private DNS is off, so the blocked sites are open again. Turn it back on.", 7003)
        }
        return Result.success()
    }
}

// ---------------------------------------------------------------- screen

private const val DNS_HOST = "family-filter-dns.cleanbrowsing.org"

@Composable
fun GuardScreen(brain: Brain, close: () -> Unit) {
    val ctx = LocalContext.current
    var tick by remember { mutableStateOf(0) }
    var scan by remember { mutableStateOf(0) }
    LaunchedEffect(Unit) { while (true) { delay(2000); tick++ } }

    val used = remember(tick) { GuardStore.usedSec(ctx) }
    val limit = remember(tick) { GuardStore.limitMin(ctx) }
    val pending = remember(tick) { GuardStore.pending(ctx) }
    val accOn = remember(tick) { Guard.accessibilityOn(ctx) }
    val dns = remember(tick) { Guard.privateDns(ctx) }
    val admin = remember(tick) { Guard.adminOn(ctx) }
    val banned = remember(scan) { Guard.installedBanned(ctx) }

    fun open(i: Intent) { try { ctx.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (e: Exception) { Toast.makeText(ctx, "Could not open that screen on this phone.", Toast.LENGTH_LONG).show() } }

    Column(Modifier.padding(horizontal = 16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        TopBar("🛡 Guard", close)

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
            Text("Enforcement", color = C.dim, fontSize = 14.sp)
            Text(if (accOn) "ON. The limit and bans are being enforced." else "OFF. Nothing is enforced yet.", color = if (accOn) C.green else C.red, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            if (!accOn) {
                Text(
                    "1. Tap 'App info' → ⋮ (top right) → 'Allow restricted settings'. Android blocks sideloaded apps from this until you do.\n" +
                        "2. Tap 'Turn on' → SeeFar → switch on.\n" +
                        "It only sees which app is on screen. It cannot read your screens, messages or passwords.",
                    color = C.text, fontSize = 14.sp
                )
                BigButton("1 · App info", C.card2, Modifier.fillMaxWidth()) { open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}"))) }
                BigButton("2 · Turn on", C.blue, Modifier.fillMaxWidth()) { open(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
            }
        }

        Card {
            Text("Banned apps", color = C.dim, fontSize = 14.sp)
            Text(Guard.bannedNames, color = C.text, fontSize = 14.sp)
            Text("Opened = thrown to the home screen. Installed = I nag you to uninstall. I can't stop a download itself.", color = C.dim, fontSize = 12.sp)
            if (banned.isEmpty()) Text("None installed right now. Good.", color = C.green, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            for ((pkg, name) in banned) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    Text("❌ $name", color = C.red, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                    Pill("Uninstall") { open(Intent(Intent.ACTION_DELETE, Uri.parse("package:$pkg"))) }
                }
            }
            Pill("Rescan") { scan++ }
        }

        Card {
            Text("Web filter (chat and adult sites)", color = C.dim, fontSize = 14.sp)
            Text(if (dns.isNotBlank()) "ON via $dns" else "OFF. Chat sites open in any browser.", color = if (dns.isNotBlank()) C.green else C.red, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            if (dns.isBlank()) {
                Text(
                    "Settings → Connection & sharing → Private DNS → 'Private DNS provider hostname' → paste the hostname below → Save.\n" +
                        "In Chrome: Settings → Privacy and security → Use secure DNS → set to 'With your current service provider' or off, otherwise Chrome skips the filter.",
                    color = C.text, fontSize = 14.sp
                )
                Text(DNS_HOST, color = C.gold, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Pill("Copy hostname") {
                        (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("dns", DNS_HOST))
                        Toast.makeText(ctx, "Copied", Toast.LENGTH_SHORT).show()
                    }
                    Pill("Open settings") { open(Intent(Settings.ACTION_WIRELESS_SETTINGS)) }
                }
            }
            Text("This list blocks adult sites plus proxy/VPN sites. I couldn't confirm Chatib is on it. After setup, try opening it. If it loads, tell me and we add a custom block list.", color = C.dim, fontSize = 12.sp)
        }

        Card {
            Text("Make it hard to remove", color = C.dim, fontSize = 14.sp)
            Text(if (admin) "Uninstall lock: ON. To remove SeeFar you must first switch this off in Settings." else "Uninstall lock: OFF", color = if (admin) C.green else C.gold, fontSize = 16.sp, fontWeight = FontWeight.Bold)
            if (!admin) BigButton("Turn on uninstall lock", C.blue, Modifier.fillMaxWidth()) {
                open(
                    Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
                        .putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, ComponentName(ctx, SeeFarAdmin::class.java))
                        .putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, "Stops SeeFar from being uninstalled in a weak moment. It gets no other powers.")
                )
            }
            Text("The strongest lock is not in any app: Settings → Apps → App lock. Lock the Play Store and Settings with a passcode someone you trust keeps. Without that, you can undo anything here when you want to.", color = C.dim, fontSize = 12.sp)
        }
        Spacer(Modifier.height(24.dp))
    }
}
