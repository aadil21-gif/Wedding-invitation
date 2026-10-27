package app.seefar.assistant

import android.content.Context
import android.content.Intent
import android.speech.tts.TextToSpeech
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
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
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDateTime
import java.util.concurrent.TimeUnit

private val BLOCKS = listOf(
    Triple("anki", "🃏 Cards", 30),
    Triple("lesson", "📖 Lesson + drills", 60),
    Triple("listening", "🎧 Listening", 45),
    Triple("speaking", "🗣 Speaking", 30),
    Triple("writing", "✍️ Writing", 15),
)

class CoachReminderWorker(ctx: Context, p: WorkerParameters) : CoroutineWorker(ctx, p) {
    override suspend fun doWork(): Result {
        Notifs.post(applicationContext, "🇫🇷 Madame Roast is waiting", "Your 3 hours of French are not going to study themselves. Open the app.", 7002)
        return Result.success()
    }
}

fun scheduleReminder(ctx: Context, hour: Int) {
    val wm = WorkManager.getInstance(ctx)
    if (hour < 0) { wm.cancelUniqueWork("fr_reminder"); return }
    var at = LocalDateTime.now().withHour(hour).withMinute(0).withSecond(0)
    if (!at.isAfter(LocalDateTime.now())) at = at.plusDays(1)
    val delay = java.time.Duration.between(LocalDateTime.now(), at).toMinutes()
    wm.enqueueUniquePeriodicWork("fr_reminder", ExistingPeriodicWorkPolicy.UPDATE,
        PeriodicWorkRequestBuilder<CoachReminderWorker>(24, TimeUnit.HOURS).setInitialDelay(delay, TimeUnit.MINUTES).build())
}

suspend fun generateDay(cur: Curriculum, store: CoachStore, n: Int): String? {
    val d = cur.raw(n)
    val taught = JSONArray()
    for (i in 1 until n) {
        val b = cur.build(i, store.generated(i))
        taught.put(JSONObject().put("day", i).put("theme", b.theme).put("grammar", b.grammar).put("vocab", JSONArray(b.vocab.take(12).map { it.fr })))
    }
    val errs = JSONArray(store.errors().takeLast(10).map { it.optString("item") + " → " + it.optString("model") })
    val body = JSONObject().put("kind", "generate").put("taught", taught).put("errors", errs)
        .put("day", JSONObject().put("day", n).put("week", d.optInt("week")).put("theme", d.optString("theme")).put("grammar", d.optString("grammar"))
            .put("review_day", d.optBoolean("review_day")).put("generate", d.optJSONObject("generate")))
    return try { store.saveGenerated(n, Api.tutor(body)); null } catch (e: Exception) { e.message ?: "Could not generate this day." }
}

@Composable
fun CoachScreen(brain: Brain, onExit: () -> Unit) {
    val ctx = LocalContext.current
    val store = remember { CoachStore(ctx) }
    val cur = remember { Curriculum.load(ctx) }
    val today = remember { cur.dayNumberToday() }
    var dayNo by remember { mutableStateOf(today) }
    var view by remember { mutableStateOf(if (store.profileSaved) "home" else "profile") }
    var rev by remember { mutableStateOf(0) }
    var genError by remember { mutableStateOf("") }
    var generating by remember { mutableStateOf(false) }
    var frOk by remember { mutableStateOf(true) }

    val day = remember(dayNo, rev) { cur.build(dayNo, store.generated(dayNo)) }

    LaunchedEffect(Unit) { frOk = brain.speaker.frenchAvailable() }
    LaunchedEffect(dayNo, rev) {
        if (!day.full && !generating) {
            generating = true; genError = ""
            val err = generateDay(cur, store, dayNo)
            generating = false
            if (err == null) rev++ else genError = err
        }
    }

    fun back() {
        brain.stopAll()
        when (view) {
            "home" -> onExit()
            else -> { view = "home"; rev++ }
        }
    }
    fun finish(block: String) { store.setDone(dayNo, block); store.xp += 20; back() }

    val title = when (view) {
        "anki" -> "🃏 Cards"; "lesson" -> "📖 Lesson"; "listening" -> "🎧 Listening"; "speaking" -> "🗣 Speaking"
        "writing" -> "✍️ Writing"; "checkin" -> "Check-in"; "roadmap" -> "Roadmap"; "profile" -> "Your details"
        else -> "🇫🇷 Madame Roast"
    }

    Column(Modifier.fillMaxSize().background(C.bg).padding(horizontal = 16.dp)) {
        TopBar(title, { back() }) { Text("⭐ ${store.xp}", color = C.gold, fontWeight = FontWeight.Bold, fontSize = 18.sp) }
        when (view) {
            "profile" -> ProfileView(store) { view = "home" }
            "roadmap" -> RoadmapView(cur, store, today) { dayNo = it; view = "home"; rev++ }
            "checkin" -> CheckinView(day, cur, store)
            "anki" -> AnkiBlock(cur, dayNo, store, brain) { finish("anki") }
            "lesson" -> LessonBlock(day, dayNo, store, brain) { finish("lesson") }
            "listening" -> ListeningBlock(day, dayNo, store, brain) { finish("listening") }
            "speaking" -> SpeakingBlock(day, dayNo, cur, store, brain) { finish("speaking") }
            "writing" -> WritingBlock(day, dayNo, store) { finish("writing") }
            else -> HomeView(day, dayNo, today, cur, store, brain, frOk, generating, genError, { rev++; genError = "" }, { dayNo = it }) { view = it }
        }
    }
}

@Composable
private fun HomeView(
    day: DayData, dayNo: Int, today: Int, cur: Curriculum, store: CoachStore, brain: Brain, frOk: Boolean,
    generating: Boolean, genError: String, retry: () -> Unit, setDay: (Int) -> Unit, go: (String) -> Unit,
) {
    val ctx = LocalContext.current
    var serious by remember { mutableStateOf(store.serious) }
    var remind by remember { mutableStateOf(store.reminderHour) }
    val target = if (store.lightUntil >= today) 120 else 180
    val minutes = store.minutesTotal(dayNo)
    val missed = today > 2 && store.minutesTotal(today - 1) == 0 && store.minutesTotal(today - 2) == 0 && store.lightUntil < today && dayNo == today

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Column(Modifier.fillMaxWidth().background(C.card, RoundedCornerShape(22.dp)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Day $dayNo of ${cur.days.size} · Week ${day.week}" + if (day.checkpoint) " · CHECKPOINT" else "", color = C.dim, fontSize = 14.sp)
            Text(day.theme, color = C.text, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold)
            if (day.grammar.isNotBlank()) Text(day.grammar, color = C.gold, fontSize = 14.sp)
            Text("$minutes / $target min today" + if (target == 120) " (lighter plan)" else "", color = C.dim, fontSize = 14.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (dayNo > 1) Pill("◀ Day ${dayNo - 1}") { setDay(dayNo - 1) }
                if (dayNo < today) Pill("Day ${dayNo + 1} ▶") { setDay(dayNo + 1) }
                Pill("🗺 Roadmap") { go("roadmap") }
            }
        }
        if (!frOk) Column(Modifier.fillMaxWidth().background(C.card2, RoundedCornerShape(14.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Your phone has no French voice installed, so pronunciation audio won't work.", color = C.text, fontSize = 14.sp)
            Pill("Install French voice") { try { ctx.startActivity(Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) {} }
        }
        if (missed) Column(Modifier.fillMaxWidth().background(C.card2, RoundedCornerShape(14.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("You missed 2 days. Want a lighter plan for the next 3 days (about 120 min a day) instead of stacking a backlog?", color = C.text, fontSize = 15.sp)
            Pill("Yes, lighter plan") { store.lightUntil = today + 2; retry() }
        }
        if (generating) Text("Preparing Day $dayNo with Madame Roast… (first open only, then it's saved)", color = C.gold, fontSize = 15.sp)
        if (genError.isNotBlank()) Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Could not prepare this day: $genError", color = C.red, fontSize = 14.sp)
            Pill("Try again") { retry() }
        }

        for ((id, label, mins) in BLOCKS) {
            val done = store.isDone(dayNo, id)
            val ready = id != "lesson" && id != "anki" || day.full || id == "anki"
            val spent = store.seconds(dayNo, id) / 60
            Row(
                Modifier.fillMaxWidth().background(if (done) C.green.copy(alpha = 0.2f) else C.card, RoundedCornerShape(18.dp))
                    .clickable(enabled = ready) { go(id) }.padding(16.dp),
                horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(label, color = C.text, fontSize = 19.sp, fontWeight = FontWeight.Bold)
                    Text(if (ready) "$mins min · logged $spent" else "waiting for the day to be prepared", color = C.dim, fontSize = 13.sp)
                }
                Text(if (done) "✅" else "›", color = C.text, fontSize = 22.sp)
            }
        }
        BigButton("📋 End-of-day check-in", C.card2, Modifier.fillMaxWidth()) { go("checkin") }

        Text("Watch & practise", color = C.dim, fontSize = 14.sp, modifier = Modifier.padding(top = 6.dp))
        for ((label, url) in videosFor(day)) Pill(label) { openUrl(ctx, url) }

        Column(Modifier.fillMaxWidth().background(C.card, RoundedCornerShape(18.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Serious mode", color = C.text, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    Text("No roasts. Just teaching.", color = C.dim, fontSize = 13.sp)
                }
                Switch(serious, { serious = it; store.serious = it })
            }
            Text("Daily reminder", color = C.text, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for ((h, l) in listOf(-1 to "Off", 7 to "7am", 12 to "12pm", 18 to "6pm", 21 to "9pm")) Pill(l, remind == h) { remind = h; store.reminderHour = h; scheduleReminder(ctx, h) }
            }
            Pill("Edit my details") { go("profile") }
        }
        Text("Speech recognition can't truly judge your accent; it only tells you whether it understood you. Exam levels (NCLC) and fees: verify on the official IRCC and exam-centre pages.", color = C.dim, fontSize = 12.sp)
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun ProfileView(store: CoachStore, done: () -> Unit) {
    val p = store.profile
    var name by remember { mutableStateOf(p.name) }
    var city by remember { mutableStateOf(p.city) }
    var age by remember { mutableStateOf(p.age) }
    var prof by remember { mutableStateOf(p.profession) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Madame Roast uses these in your drills (\"Je m'appelle …\"). Fix anything that's wrong.", color = C.dim, fontSize = 15.sp)
        OutlinedTextField(name, { name = it }, label = { Text("First name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(city, { city = it }, label = { Text("City") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(age, { age = it.filter { c -> c.isDigit() }.take(2) }, label = { Text("Age") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(prof, { prof = it }, label = { Text("Profession in French (pharmacien / pharmacienne)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        BigButton("Save", C.green, Modifier.fillMaxWidth()) {
            store.profile = Profile(name.trim(), city.trim(), age, prof.trim())
            store.profileSaved = true
            done()
        }
    }
}

@Composable
private fun RoadmapView(cur: Curriculum, store: CoachStore, today: Int, pick: (Int) -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Goal: ${"TCF Canada, NCLC 7 in all four skills, exam window Jul–Aug 2027"}", color = C.gold, fontSize = 15.sp)
        for (n in 1..cur.days.size) {
            val d = cur.raw(n)
            val unlocked = n <= today
            val blocksDone = BLOCKS.count { store.isDone(n, it.first) }
            Row(
                Modifier.fillMaxWidth().background(C.card, RoundedCornerShape(14.dp)).clickable(enabled = unlocked) { pick(n) }.padding(12.dp),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column(Modifier.weight(1f)) {
                    Text("Day $n · ${d.optString("date")}" + if (d.optBoolean("checkpoint")) " · checkpoint" else "", color = if (unlocked) C.text else C.dim, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                    Text(d.optString("theme"), color = C.dim, fontSize = 14.sp)
                }
                Text(if (!unlocked) "🔒" else "$blocksDone/5", color = C.gold)
            }
        }
        Text("Later phases", color = C.text, fontWeight = FontWeight.Bold, fontSize = 17.sp, modifier = Modifier.padding(top = 10.dp))
        for (p in cur.phases.objs()) Text("Phase ${p.optInt("phase")} · ${p.optString("level")} · ${p.optJSONArray("dates")?.strings()?.joinToString(" → ")}", color = C.dim, fontSize = 14.sp)
        Text("Checkpoints", color = C.text, fontWeight = FontWeight.Bold, fontSize = 17.sp, modifier = Modifier.padding(top = 10.dp))
        for (c in cur.checkpoints.objs()) Text("${c.optString("date")}: ${c.optString("name")}", color = C.dim, fontSize = 14.sp)
        Text("Months 2 to 9 are a roadmap only; drills for those get built when you reach them. NCLC thresholds and exam logistics are unverified: check the IRCC and exam-centre sites.", color = C.dim, fontSize = 12.sp)
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun CheckinView(day: DayData, cur: Curriculum, store: CoachStore) {
    val ctx = LocalContext.current
    val n = day.day
    val blocks = BLOCKS.joinToString(" / ") { it.first + (if (store.isDone(n, it.first)) " ✓" else " ✗") }
    val total = store.stat(n, "total"); val ok = store.stat(n, "ok"); val cards = store.stat(n, "cards")
    val mins = store.minutesTotal(n)
    val top = store.topErrors(n).take(3).joinToString(", ") { "${it.first} (${it.second})" }.ifBlank { "none" }
    val weak = store.errors().filter { it.optInt("day") == n }.takeLast(3).joinToString("; ") { it.optString("item") + " = " + it.optString("model") }.ifBlank { "none" }
    val next = if (n < cur.days.size) "Day ${n + 1}: ${cur.raw(n + 1).optString("theme")}" else "Month 2 planning"
    val fix = if (mins < 120) "Only $mins min logged. Smallest fix for tomorrow: do the Cards block first, before anything else, and set a reminder." else if (total > 0 && ok * 100 / total < 70) "Drill accuracy is under 70%. Repeat today's lesson drills before new material." else "Keep the cards block daily; it is what makes the rest stick."
    val text = "Day $n check-in (${day.date})\nBlocks done: $blocks\nMinutes logged: $mins / 180\nCards reviewed: $cards\nDrills: correct $ok / total $total\nTop error categories: $top\nWeakest items: $weak\nTomorrow: $next\nOne thing to fix: $fix"
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(text, color = C.text, fontSize = 16.sp, lineHeight = 24.sp, modifier = Modifier.fillMaxWidth().background(C.card, RoundedCornerShape(16.dp)).padding(14.dp))
        BigButton("Share", C.blue, Modifier.fillMaxWidth()) {
            ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), "Share check-in").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}
