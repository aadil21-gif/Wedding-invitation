package app.seefar.assistant

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.util.concurrent.TimeUnit

// ---------------------------------------------------------------- content (verified Quran text bundled offline)

data class Ayah(val ref: String, val surah: String, val theme: String, val ar: String, val en: String, val tafsir: String, val reflection: String, val link: String)
data class Tip(val title: String, val body: String, val tryIt: String)

object Content {
    private var ayat: List<Ayah>? = null
    private var tips: List<Tip>? = null

    fun ayat(ctx: Context): List<Ayah> = ayat ?: try {
        val a = JSONArray(ctx.assets.open("ayat.json").bufferedReader().use { it.readText() })
        (0 until a.length()).map { i ->
            val o = a.getJSONObject(i)
            Ayah(o.optString("ref"), o.optString("surah"), o.optString("theme"), o.optString("ar"), o.optString("en"), o.optString("tafsir"), o.optString("reflection"), o.optString("link"))
        }
    } catch (e: Exception) { emptyList() }.also { ayat = it }

    fun tips(ctx: Context): List<Tip> = tips ?: try {
        val a = JSONArray(ctx.assets.open("cards.json").bufferedReader().use { it.readText() })
        (0 until a.length()).map { i -> a.getJSONObject(i).let { Tip(it.optString("title"), it.optString("body"), it.optString("tryIt")) } }
    } catch (e: Exception) { emptyList() }.also { tips = it }

    fun ayahOfDay(ctx: Context, shift: Int = 0): Ayah? {
        val l = ayat(ctx)
        return if (l.isEmpty()) null else l[Math.floorMod(LocalDate.now().toEpochDay().toInt() + shift, l.size)]
    }

    fun tipOfDay(ctx: Context, shift: Int = 0): Tip? {
        val l = tips(ctx)
        return if (l.isEmpty()) null else l[Math.floorMod(LocalDate.now().toEpochDay().toInt() * 3 + shift, l.size)]
    }

    private val SOS = setOf("7:201", "79:40", "12:23", "94:6", "13:28", "65:2", "2:153", "17:32", "24:30", "57:4", "96:14", "3:139", "4:28", "40:60")

    fun sosAyah(ctx: Context): Ayah? = ayat(ctx).filter { it.ref in SOS }.ifEmpty { ayat(ctx) }.randomOrNull()
}

// ---------------------------------------------------------------- store (on this phone only, never sent anywhere)

object Rec {
    private fun p(ctx: Context) = ctx.getSharedPreferences("seefar_rec", 0)
    private fun arr(ctx: Context, k: String) = try { JSONArray(p(ctx).getString(k, "[]")) } catch (e: Exception) { JSONArray() }
    private fun day(ms: Long): LocalDate = java.time.Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()).toLocalDate()

    private fun startMs(ctx: Context): Long {
        val s = p(ctx)
        var v = s.getLong("start", 0L)
        if (v == 0L) { v = System.currentTimeMillis(); s.edit().putLong("start", v).apply() }
        return v
    }

    fun streak(ctx: Context): Int = ChronoUnit.DAYS.between(day(startMs(ctx)), LocalDate.now()).toInt().coerceAtLeast(0)
    fun best(ctx: Context): Int = maxOf(p(ctx).getInt("best", 0), streak(ctx))
    fun totalClean(ctx: Context): Int = p(ctx).getInt("totalClean", 0) + streak(ctx)
    fun xp(ctx: Context): Int = p(ctx).getInt("xp", 0)
    fun addXp(ctx: Context, n: Int) = p(ctx).edit().putInt("xp", xp(ctx) + n).apply()

    fun slip(ctx: Context) {
        val s = p(ctx)
        val st = streak(ctx)
        val l = arr(ctx, "slips").put(System.currentTimeMillis())
        s.edit().putInt("best", maxOf(s.getInt("best", 0), st)).putInt("totalClean", s.getInt("totalClean", 0) + st)
            .putLong("start", System.currentTimeMillis()).putString("slips", l.toString()).apply()
    }

    fun logUrge(ctx: Context, before: Int, after: Int, tags: List<String>, outcome: String) {
        val l = arr(ctx, "urges")
        l.put(JSONObject().put("t", System.currentTimeMillis()).put("b", before).put("a", after).put("g", JSONArray(tags)).put("o", outcome))
        val keep = JSONArray()
        for (i in maxOf(0, l.length() - 300) until l.length()) keep.put(l.get(i))
        p(ctx).edit().putString("urges", keep.toString()).apply()
    }

    fun logCheckin(ctx: Context, mood: Int, urges: Int, slipped: Boolean, win: String) {
        val l = arr(ctx, "checkins").put(JSONObject().put("t", System.currentTimeMillis()).put("m", mood).put("u", urges).put("s", slipped).put("w", win.take(200)))
        p(ctx).edit().putString("checkins", l.toString()).putString("checkDate", LocalDate.now().toString()).apply()
        addXp(ctx, 5)
    }

    fun checkedToday(ctx: Context) = p(ctx).getString("checkDate", "") == LocalDate.now().toString()

    fun markDaily(ctx: Context) {
        if (p(ctx).getString("dailyDate", "") != LocalDate.now().toString()) {
            p(ctx).edit().putString("dailyDate", LocalDate.now().toString()).apply()
            addXp(ctx, 2)
        }
    }

    /** Plain-language pattern summary from your own log. */
    fun insights(ctx: Context): List<String> {
        val urges = arr(ctx, "urges")
        val slips = arr(ctx, "slips")
        val cutoff = System.currentTimeMillis() - 7L * 86_400_000L
        var n7 = 0
        var res7 = 0
        val tags = HashMap<String, Int>()
        val hours = IntArray(24)
        var total = 0
        for (i in 0 until urges.length()) {
            val o = urges.optJSONObject(i) ?: continue
            val t = o.optLong("t")
            total++
            hours[java.time.Instant.ofEpochMilli(t).atZone(ZoneId.systemDefault()).hour]++
            val g = o.optJSONArray("g")
            if (g != null) for (j in 0 until g.length()) tags[g.optString(j)] = (tags[g.optString(j)] ?: 0) + 1
            if (t >= cutoff) { n7++; if (o.optString("o") == "resisted") res7++ }
        }
        for (i in 0 until slips.length()) hours[java.time.Instant.ofEpochMilli(slips.optLong(i)).atZone(ZoneId.systemDefault()).hour]++
        val out = ArrayList<String>()
        if (total + slips.length() < 3) return listOf("Log a few urges and I'll show you when and why they hit.")
        out += "Last 7 days: $n7 urges logged, $res7 ridden out."
        tags.maxByOrNull { it.value }?.let { out += "Most common trigger: ${it.key} (${it.value}x)." }
        var bestStart = 0
        var bestSum = -1
        for (h in 0 until 24) {
            val s = hours[h] + hours[(h + 1) % 24] + hours[(h + 2) % 24]
            if (s > bestSum) { bestSum = s; bestStart = h }
        }
        if (bestSum > 0) out += "Riskiest window: %02d:00 to %02d:00.".format(bestStart, (bestStart + 3) % 24)
        return out
    }

    fun schedule(ctx: Context) {
        val wm = WorkManager.getInstance(ctx)
        fun at(kind: String, hour: Int, minute: Int) {
            val now = java.time.LocalDateTime.now()
            var next = now.toLocalDate().atTime(hour, minute)
            if (!next.isAfter(now)) next = next.plusDays(1)
            wm.enqueueUniquePeriodicWork(
                "daily-$kind", ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<DailyWorker>(24, TimeUnit.HOURS)
                    .setInitialDelay(java.time.Duration.between(now, next).toMillis(), TimeUnit.MILLISECONDS)
                    .setInputData(workDataOf("kind" to kind)).build()
            )
        }
        at("ayah", 7, 30)
        at("card", 13, 30)
        at("checkin", 21, 30)
        at("night", 23, 0)
    }
}

/** Four short notifications a day: an ayah, a reminder card, a check-in, and the phone-out-of-the-bedroom nudge. */
class DailyWorker(ctx: Context, p: WorkerParameters) : Worker(ctx, p) {
    override fun doWork(): Result {
        val c = applicationContext
        when (inputData.getString("kind")) {
            "ayah" -> Content.ayahOfDay(c)?.let { Notifs.post(c, "Ayah of the day · ${it.surah} ${it.ref}", it.en + "\n\n" + it.reflection, 7011, go = "daily") }
            "card" -> Content.tipOfDay(c)?.let { Notifs.post(c, it.title, it.body + "\nTry: " + it.tryIt, 7012, go = "daily") }
            "checkin" -> if (!Rec.checkedToday(c)) Notifs.post(c, "Evening check-in", "Two minutes: how was today? Urges, wins, anything.", 7013, go = "checkin")
            "night" -> Notifs.post(c, "Phone out of the bedroom", "Night lock starts soon. Charge the phone in another room. Future you says thanks.", 7014)
        }
        return Result.success()
    }
}

// ---------------------------------------------------------------- screens

private val TRIGGERS = listOf("Alone", "Late night", "In bed", "Bored", "Stressed", "Tired", "Scrolling", "Was blocked", "Other")
private val ACTIONS = listOf(
    "Stand up. Leave the room. Phone stays on a table." to "🚪",
    "Wudu, then two rakat." to "🤲",
    "Walk outside for 10 minutes." to "🚶",
    "20 push-ups, then 20 more." to "💪",
    "Message or call someone you trust." to "📞",
    "Shower." to "🚿",
)

@Composable
fun RecoveryHome(brain: Brain) {
    val ctx = LocalContext.current
    var tick by remember { mutableStateOf(0) }
    when (brain.recSub) {
        "urge" -> UrgeFlow(brain) { brain.recSub = "home"; tick++ }
        "slip" -> SlipScreen { brain.recSub = "home"; tick++ }
        "checkin" -> CheckInScreen { brain.recSub = "home"; tick++ }
        "daily" -> DailyScreen { brain.recSub = "home" }
        else -> {
            val streak = remember(tick) { Rec.streak(ctx) }
            val best = remember(tick) { Rec.best(ctx) }
            val total = remember(tick) { Rec.totalClean(ctx) }
            val xp = remember(tick) { Rec.xp(ctx) }
            val insights = remember(tick) { Rec.insights(ctx) }
            Column(Modifier.padding(horizontal = 16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                TopBar("Help", null)
                BigButton("🆘  I HAVE AN URGE", C.red, Modifier.fillMaxWidth()) { brain.recSub = "urge" }
                Card {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Column {
                            Text("🔥 $streak", color = C.text, fontSize = 40.sp, fontWeight = FontWeight.ExtraBold)
                            Text(if (streak == 1) "day in a row" else "days in a row", color = C.dim, fontSize = 14.sp)
                        }
                        Column(horizontalAlignment = Alignment.End) {
                            Text("Best: $best", color = C.text, fontWeight = FontWeight.Bold)
                            Text("Total clean days: $total", color = C.dim, fontSize = 13.sp)
                            Text("⭐ $xp XP", color = C.gold, fontWeight = FontWeight.Bold)
                        }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    BigButton("Evening check-in", C.blue, Modifier.weight(1f)) { brain.recSub = "checkin" }
                    BigButton("Today's ayah", C.green, Modifier.weight(1f)) { brain.recSub = "daily" }
                }
                Card {
                    Text("Your pattern", color = C.text, fontWeight = FontWeight.ExtraBold, fontSize = 17.sp)
                    for (l in insights) Text(l, color = C.dim, fontSize = 14.sp)
                }
                Card {
                    Text("Support, not treatment", color = C.text, fontWeight = FontWeight.ExtraBold, fontSize = 17.sp)
                    Text("Compulsive sexual behaviour is a recognised condition and it responds to treatment. A psychiatrist or clinical psychologist who uses CBT or ACT will do more than any app. Everything here stays on this phone.", color = C.dim, fontSize = 14.sp)
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) { Pill("I slipped") { brain.recSub = "slip" } }
                Spacer(Modifier.height(16.dp))
            }
        }
    }
}

@Composable
fun UrgeFlow(brain: Brain, close: () -> Unit) {
    val ctx = LocalContext.current
    var step by remember { mutableStateOf(0) }
    var before by remember { mutableStateOf(-1) }
    var after by remember { mutableStateOf(-1) }
    var remaining by remember { mutableStateOf(15 * 60) }
    var picked by remember { mutableStateOf(-1) }
    val tags = remember { mutableStateListOf<String>() }
    val ayahs = remember { Content.ayat(ctx).filter { it.ref in setOf("7:201", "79:40", "12:23", "94:6", "13:28", "65:2", "2:153", "17:32", "57:4", "3:139") } }
    val view = LocalView.current
    DisposableEffect(Unit) { view.keepScreenOn = true; onDispose { view.keepScreenOn = false } }
    LaunchedEffect(Unit) { brain.stopAll() }
    LaunchedEffect(step) {
        if (step == 2) {
            while (remaining > 0) { delay(1000); remaining-- }
            step = 3
        }
    }

    Column(Modifier.padding(horizontal = 16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        TopBar("Urge SOS", if (step == 0 || step >= 4) close else null)
        when (step) {
            0 -> {
                Text("You're not in trouble. You're in a wave. Let's ride it.", color = C.text, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
                Text("How strong is it right now? (0 to 10)", color = C.dim, fontSize = 15.sp)
                for (row in (0..10).chunked(6)) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { for (n in row) Pill("$n", before == n) { before = n } }
                Text("What set it off? (optional)", color = C.dim, fontSize = 15.sp)
                for (row in TRIGGERS.chunked(3)) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (t in row) Pill(t, t in tags) { if (t in tags) tags.remove(t) else tags.add(t) }
                }
                BigButton("Next", if (before >= 0) C.green else C.card2, Modifier.fillMaxWidth()) { if (before >= 0) step = 1 }
            }
            1 -> {
                Text("Do one of these now.", color = C.text, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
                Text("Body first, thoughts second. No screens during the timer except this one.", color = C.dim, fontSize = 14.sp)
                for ((i, a) in ACTIONS.withIndex()) {
                    Row(
                        Modifier.fillMaxWidth().background(if (picked == i) C.green.copy(alpha = 0.15f) else Color.White, androidx.compose.foundation.shape.RoundedCornerShape(16.dp))
                            .border(2.dp, if (picked == i) C.green else C.line, androidx.compose.foundation.shape.RoundedCornerShape(16.dp))
                            .clickable { picked = i }.padding(14.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically
                    ) { Text(a.second, fontSize = 26.sp); Text(a.first, color = C.text, fontSize = 16.sp, fontWeight = FontWeight.Bold) }
                }
                BigButton("Start the 15-minute timer", if (picked >= 0) C.green else C.card2, Modifier.fillMaxWidth()) { if (picked >= 0) step = 2 }
            }
            2 -> {
                val t = rememberInfiniteTransition(label = "breath")
                val s by t.animateFloat(0.75f, 1.25f, infiniteRepeatable(tween(4500, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "s")
                val elapsed = 15 * 60 - remaining
                val phase = if (elapsed % 9 < 4) "Breathe in" else "Breathe out slowly"
                val a = if (ayahs.isEmpty()) null else ayahs[(elapsed / 45) % ayahs.size]
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Text("%d:%02d".format(remaining / 60, remaining % 60), color = C.text, fontSize = 44.sp, fontWeight = FontWeight.ExtraBold)
                    Box(Modifier.size(150.dp).scale(s).background(C.blue.copy(alpha = 0.25f), CircleShape), contentAlignment = Alignment.Center) { Text(phase, color = C.blue.deep(), fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center) }
                    Text("${ACTIONS[picked.coerceAtLeast(0)].first}", color = C.dim, fontSize = 14.sp, textAlign = TextAlign.Center)
                    if (a != null) Card {
                        Text(a.en, color = C.text, fontSize = 16.sp)
                        Text("${a.surah} ${a.ref}", color = C.dim, fontSize = 13.sp)
                        Text(a.reflection, color = C.green.deep(), fontSize = 14.sp, fontWeight = FontWeight.Bold)
                    }
                    Text("It peaks and it falls. You only have to outlast the peak.", color = C.dim, fontSize = 13.sp, textAlign = TextAlign.Center)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Pill("+10 min") { remaining += 600 }
                        Pill("I'm done") { step = 3 }
                    }
                }
            }
            3 -> {
                Text("How strong is it now? (0 to 10)", color = C.text, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
                for (row in (0..10).chunked(6)) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { for (n in row) Pill("$n", after == n) { after = n } }
                if (after >= 0) {
                    BigButton("I rode it out ✓", C.green, Modifier.fillMaxWidth()) {
                        Rec.logUrge(ctx, before, after, tags.toList(), "resisted"); Rec.addXp(ctx, 15); step = 5
                    }
                    BigButton("I slipped", C.card2, Modifier.fillMaxWidth()) {
                        Rec.logUrge(ctx, before, after, tags.toList(), "slipped"); Rec.slip(ctx); step = 4
                    }
                }
            }
            4 -> SlipAdvice(close)
            else -> {
                Text("+15 XP", color = C.gold, fontSize = 32.sp, fontWeight = FontWeight.ExtraBold)
                Text("You took it from $before to $after and didn't act on it. That is the skill, and you just trained it.", color = C.text, fontSize = 17.sp)
                BigButton("Done", C.green, Modifier.fillMaxWidth()) { close() }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun SlipAdvice(done: () -> Unit) {
    val ctx = LocalContext.current
    val a = remember { Content.ayat(ctx).firstOrNull { it.ref == "39:53" } }
    Text("A slip is data, not a verdict.", color = C.text, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
    Text("The next hour matters more than the last one. The damage comes from continuing, so stop here:", color = C.dim, fontSize = 15.sp)
    Card {
        Text("1. Phone goes in another room.", color = C.text, fontWeight = FontWeight.Bold)
        Text("2. Wudu or a shower.", color = C.text, fontWeight = FontWeight.Bold)
        Text("3. Sleep, or go be around people.", color = C.text, fontWeight = FontWeight.Bold)
        Text("Tomorrow: open Help and log what led here.", color = C.dim)
    }
    if (a != null) Card { Text(a.en, color = C.text, fontSize = 15.sp); Text("${a.surah} ${a.ref}", color = C.dim, fontSize = 13.sp); Text(a.reflection, color = C.green.deep(), fontWeight = FontWeight.Bold, fontSize = 14.sp) }
    BigButton("OK", C.green, Modifier.fillMaxWidth()) { done() }
}

@Composable
fun SlipScreen(close: () -> Unit) {
    val ctx = LocalContext.current
    var logged by remember { mutableStateOf(false) }
    Column(Modifier.padding(horizontal = 16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        TopBar("I slipped", close)
        if (!logged) {
            Text("Log it honestly. Your best streak and total clean days are kept. Only the current run restarts.", color = C.dim, fontSize = 15.sp)
            BigButton("Log it and restart the streak", C.red, Modifier.fillMaxWidth()) { Rec.slip(ctx); logged = true }
            BigButton("Cancel", C.card2, Modifier.fillMaxWidth()) { close() }
        } else SlipAdvice(close)
    }
}

@Composable
fun CheckInScreen(close: () -> Unit) {
    val ctx = LocalContext.current
    var mood by remember { mutableStateOf(0) }
    var urges by remember { mutableStateOf(-1) }
    var slipped by remember { mutableStateOf(-1) }
    var win by remember { mutableStateOf("") }
    var saved by remember { mutableStateOf(false) }
    Column(Modifier.padding(horizontal = 16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        TopBar("Evening check-in", close)
        if (saved) {
            Text("+5 XP. Logged.", color = C.green.deep(), fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
            if (slipped == 1) SlipAdvice(close) else BigButton("Done", C.green, Modifier.fillMaxWidth()) { close() }
        } else {
            Text("How was today?", color = C.text, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { for ((i, e) in listOf("😞", "😕", "😐", "🙂", "😄").withIndex()) Pill(e, mood == i + 1) { mood = i + 1 } }
            Text("Urges today", color = C.dim)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) { for (n in 0..8) Pill("$n", urges == n) { urges = n } }
            Text("Did you slip today?", color = C.dim)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { Pill("No", slipped == 0) { slipped = 0 }; Pill("Yes", slipped == 1) { slipped = 1 } }
            Text("One win from today", color = C.dim)
            OutlinedTextField(win, { win = it }, modifier = Modifier.fillMaxWidth(), singleLine = true, placeholder = { Text("anything, even small") })
            val ready = mood > 0 && urges >= 0 && slipped >= 0
            BigButton("Save", if (ready) C.green else C.card2, Modifier.fillMaxWidth()) {
                if (ready) {
                    Rec.logCheckin(ctx, mood, urges, slipped == 1, win)
                    if (slipped == 1) Rec.slip(ctx)
                    saved = true
                }
            }
        }
    }
}

@Composable
fun DailyScreen(close: () -> Unit) {
    val ctx = LocalContext.current
    var shift by remember { mutableStateOf(0) }
    var showTafsir by remember { mutableStateOf(false) }
    val a = remember(shift) { Content.ayahOfDay(ctx, shift) }
    val tip = remember(shift) { Content.tipOfDay(ctx, shift) }
    LaunchedEffect(Unit) { Rec.markDaily(ctx) }
    Column(Modifier.padding(horizontal = 16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        TopBar("Today", close)
        if (a != null) Card {
            Text(a.ar, color = C.text, fontSize = 26.sp, lineHeight = 46.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            Text(a.en, color = C.text, fontSize = 17.sp)
            Text("${a.surah} ${a.ref}  ·  Sahih International", color = C.dim, fontSize = 12.sp)
            Text("Reflection: " + a.reflection, color = C.green.deep(), fontSize = 15.sp, fontWeight = FontWeight.Bold)
            if (a.tafsir.isNotBlank()) {
                if (showTafsir) {
                    Text("Tafsir Ibn Kathir (abridged, excerpt):", color = C.dim, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    Text(a.tafsir, color = C.text, fontSize = 14.sp)
                } else Pill("Read tafsir excerpt") { showTafsir = true }
            }
            Pill("Full tafsir online") { try { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(a.link)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) { } }
        }
        if (tip != null) Card {
            Text(tip.title, color = C.text, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold)
            Text(tip.body, color = C.text, fontSize = 15.sp)
            Text("Try: " + tip.tryIt, color = C.blue.deep(), fontSize = 14.sp, fontWeight = FontWeight.Bold)
        }
        BigButton("Another one", C.blue, Modifier.fillMaxWidth()) { shift++; showTafsir = false }
        Text("Arabic and English text come from the Quran, Sahih International translation. Reflections and cards are my own short notes, not scholarly rulings.", color = C.dim, fontSize = 11.sp)
        Spacer(Modifier.height(16.dp))
    }
}
