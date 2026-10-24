package app.seefar.assistant

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.Uri
import android.os.Process
import android.provider.AlarmClock
import android.provider.ContactsContract
import android.provider.MediaStore
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.Calendar
import java.util.concurrent.TimeUnit

/** Facts, notes and lists the assistant keeps for you. Stays on the phone, sent to the AI only as context. */
class Store(ctx: Context) {
    private val p = ctx.getSharedPreferences("seefar_store", Context.MODE_PRIVATE)

    private fun arr(key: String) = try { JSONArray(p.getString(key, "[]")) } catch (e: Exception) { JSONArray() }
    private fun list(key: String): List<String> = arr(key).let { a -> (0 until a.length()).map { a.getString(it) } }

    val facts get() = list("facts")
    val notes get() = list("notes")

    fun addFact(f: String) = push("facts", f, 40)
    fun addNote(n: String) = push("notes", n, 40)

    private fun push(key: String, v: String, max: Int) {
        val l = list(key).toMutableList()
        if (v.isNotBlank() && v !in l) l.add(v.take(200))
        p.edit().putString(key, JSONArray(l.takeLast(max)).toString()).apply()
    }

    fun lists(): Map<String, List<String>> {
        val o = try { JSONObject(p.getString("lists", "{}")) } catch (e: Exception) { JSONObject() }
        return o.keys().asSequence().associateWith { k -> o.getJSONArray(k).let { a -> (0 until a.length()).map { a.getString(it) } } }
    }

    fun addToList(name: String, item: String) {
        val o = try { JSONObject(p.getString("lists", "{}")) } catch (e: Exception) { JSONObject() }
        val a = o.optJSONArray(name.take(40)) ?: JSONArray()
        a.put(item.take(80))
        o.put(name.take(40), a)
        p.edit().putString("lists", o.toString()).apply()
    }

    fun forget() = p.edit().clear().apply()
}

object Device {
    fun has(ctx: Context, perm: String) = ContextCompat.checkSelfPermission(ctx, perm) == PackageManager.PERMISSION_GRANTED

    fun hasUsageAccess(ctx: Context): Boolean {
        val ops = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        @Suppress("DEPRECATION")
        val mode = ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
        return mode == AppOpsManager.MODE_ALLOWED
    }

    fun hasNotificationAccess(ctx: Context) =
        NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.packageName)

    fun openUsageSettings(ctx: Context) =
        ctx.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))

    fun openNotificationSettings(ctx: Context) =
        ctx.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))

    /** Top apps by foreground time today, like "Instagram 48 min". */
    fun usageToday(ctx: Context): List<String> {
        if (!hasUsageAccess(ctx)) return emptyList()
        val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val start = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        val stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, start, System.currentTimeMillis()) ?: return emptyList()
        val pm = ctx.packageManager
        return stats.filter { it.totalTimeInForeground >= 5 * 60_000 && it.packageName != ctx.packageName }
            .sortedByDescending { it.totalTimeInForeground }
            .take(6)
            .mapNotNull { s ->
                val label = try { pm.getApplicationLabel(pm.getApplicationInfo(s.packageName, 0)).toString() } catch (e: Exception) { null }
                if (label == null || pm.getLaunchIntentForPackage(s.packageName) == null) null
                else "$label ${s.totalTimeInForeground / 60_000} min"
            }
    }

    @Suppress("MissingPermission")
    fun lastLocation(ctx: Context): Pair<Double, Double>? {
        if (!has(ctx, android.Manifest.permission.ACCESS_COARSE_LOCATION)) return null
        val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        return try {
            lm.getProviders(true).mapNotNull { lm.getLastKnownLocation(it) }.maxByOrNull { it.time }?.let { it.latitude to it.longitude }
        } catch (e: Exception) { null }
    }

    /** What the server is told about the phone every turn. */
    fun context(ctx: Context, store: Store): JSONObject {
        val o = JSONObject()
            .put("nowIso", ZonedDateTime.now().toOffsetDateTime().toString())
            .put("timeZone", ZoneId.systemDefault().id)
            .put("facts", JSONArray(store.facts.takeLast(20)))
            .put("notes", JSONArray(store.notes.takeLast(8)))
            .put("lists", JSONObject(store.lists().mapValues { JSONArray(it.value.takeLast(20)) }))
            .put("timers", JSONArray())
            .put("reminders", JSONArray())
        lastLocation(ctx)?.let { o.put("lat", it.first).put("lon", it.second) }
        val n = Notifs.recent(ctx)
        if (n.isNotEmpty()) o.put("notifications", JSONArray(n.take(12)))
        val u = usageToday(ctx)
        if (u.isNotEmpty()) o.put("usage", JSONArray(u))
        return o
    }

    private fun digits(raw: String): String {
        var d = raw.filter { it.isDigit() || it == '+' }
        d = if (d.startsWith("+")) d.drop(1) else if (d.startsWith("00")) d.drop(2) else if (d.startsWith("0")) "92" + d.drop(1) else d
        return d
    }

    /** Finds a phone number for a name in your contacts (best match). */
    fun findNumber(ctx: Context, name: String): Pair<String, String>? {
        if (!has(ctx, android.Manifest.permission.READ_CONTACTS)) return null
        val q = name.trim().lowercase()
        if (q.isEmpty()) return null
        ctx.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER),
            null, null, null
        )?.use { c ->
            var best: Pair<String, String>? = null
            var bestScore = 0
            while (c.moveToNext()) {
                val n = c.getString(0) ?: continue
                val num = c.getString(1) ?: continue
                val ln = n.lowercase()
                val score = when {
                    ln == q -> 4
                    ln.startsWith(q) -> 3
                    ln.split(" ").any { it == q } -> 2
                    ln.contains(q) -> 1
                    else -> 0
                }
                if (score > bestScore) { bestScore = score; best = n to num }
            }
            return best
        }
        return null
    }

    private fun launch(ctx: Context, i: Intent): Boolean = try {
        ctx.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true
    } catch (e: Exception) { false }

    private fun parseTime(s: String): Long? = try {
        Instant.parse(s).toEpochMilli()
    } catch (e: Exception) {
        try { OffsetDateTime.parse(s).toInstant().toEpochMilli() } catch (e2: Exception) {
            try { LocalDateTime.parse(s).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli() } catch (e3: Exception) { null }
        }
    }

    /**
     * Runs what the assistant asked for. Returns short result lines to show on screen.
     * `wantCamera` is set when the assistant asked to look.
     */
    fun run(ctx: Context, store: Store, actions: List<JSONObject>, onCamera: () -> Unit): List<String> {
        val out = ArrayList<String>()
        for (a in actions) {
            when (a.optString("type")) {
                "timer" -> {
                    val secs = a.optInt("seconds", 60).coerceIn(1, 86_400)
                    val i = Intent(AlarmClock.ACTION_SET_TIMER).putExtra(AlarmClock.EXTRA_LENGTH, secs)
                        .putExtra(AlarmClock.EXTRA_MESSAGE, a.optString("label", "SeeFar")).putExtra(AlarmClock.EXTRA_SKIP_UI, true)
                    out += if (launch(ctx, i)) "⏱ Timer set: ${a.optString("label")}" else "Could not set a timer."
                }
                "reminder" -> {
                    val text = a.optString("text")
                    val delayMs = if (a.has("inSeconds")) a.optLong("inSeconds") * 1000 else (parseTime(a.optString("at")) ?: 0L) - System.currentTimeMillis()
                    if (text.isBlank() || delayMs < 1000) out += "I could not work out when to remind you."
                    else {
                        val req = OneTimeWorkRequestBuilder<ReminderWorker>()
                            .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
                            .setInputData(workDataOf("text" to text)).build()
                        WorkManager.getInstance(ctx).enqueue(req)
                        out += "⏰ I will remind you: $text"
                    }
                }
                "navigate" -> {
                    val dest = a.optString("destination")
                    val mode = when (a.optString("mode")) { "walking" -> "w"; "bicycling" -> "b"; else -> "d" }
                    val uri = if (a.optString("mode") == "transit")
                        Uri.parse("https://www.google.com/maps/dir/?api=1&travelmode=transit&destination=" + URLEncoder.encode(dest, "UTF-8"))
                    else Uri.parse("google.navigation:q=" + Uri.encode(dest) + "&mode=" + mode)
                    out += if (launch(ctx, Intent(Intent.ACTION_VIEW, uri))) "🧭 Navigating to $dest" else "No maps app found."
                }
                "call" -> {
                    var number = a.optString("number")
                    var who = a.optString("name")
                    if (number.isBlank() && who.isNotBlank()) {
                        val hit = findNumber(ctx, who)
                        if (hit == null) { out += "I could not find \"$who\" in your contacts."; continue }
                        who = hit.first; number = hit.second
                    }
                    if (number.isBlank()) { out += "Who should I call?"; continue }
                    val uri = Uri.parse("tel:" + Uri.encode(number))
                    val i = if (has(ctx, android.Manifest.permission.CALL_PHONE)) Intent(Intent.ACTION_CALL, uri) else Intent(Intent.ACTION_DIAL, uri)
                    out += if (launch(ctx, i)) "📞 Calling ${who.ifBlank { number }}" else "Could not start the call."
                }
                "whatsapp" -> {
                    var number = a.optString("number")
                    var who = a.optString("name")
                    if (number.isBlank() && who.isNotBlank()) {
                        val hit = findNumber(ctx, who)
                        if (hit == null) { out += "I could not find \"$who\" in your contacts."; continue }
                        who = hit.first; number = hit.second
                    }
                    val text = a.optString("text")
                    val url = "https://wa.me/" + (if (number.isBlank()) "" else digits(number)) + "?text=" + URLEncoder.encode(text, "UTF-8")
                    out += if (launch(ctx, Intent(Intent.ACTION_VIEW, Uri.parse(url)))) "💬 WhatsApp is ready for ${who.ifBlank { "you" }}: tap send" else "WhatsApp is not installed."
                }
                "music" -> {
                    val q = a.optString("query")
                    val i = Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH).putExtra(android.app.SearchManager.QUERY, q)
                    val ok = launch(ctx, i) || launch(ctx, Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/results?search_query=" + URLEncoder.encode(q, "UTF-8"))))
                    out += if (ok) "🎵 Playing: $q" else "No music app found."
                }
                "note" -> { store.addNote(a.optString("text")); out += "📝 Noted." }
                "list_add" -> { store.addToList(a.optString("list"), a.optString("item")); out += "✅ Added to ${a.optString("list")}: ${a.optString("item")}" }
                "remember" -> { store.addFact(a.optString("fact")); out += "🧠 I will remember that." }
                "camera" -> onCamera()
                "open" -> {
                    val url = a.optString("url")
                    if (url.startsWith("https://")) { launch(ctx, Intent(Intent.ACTION_VIEW, Uri.parse(url))); out += "🌐 Opened a page" }
                }
                "robot" -> out += "The robot works in the web app, not here yet."
            }
        }
        return out
    }
}
