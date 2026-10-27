package app.seefar.assistant

import android.content.Intent
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
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject

private val BLOCKS = listOf(
    Triple("anki", "🃏 Cards", 30),
    Triple("lesson", "📖 Lesson", 60),
    Triple("listening", "🎧 Listening", 45),
    Triple("speaking", "🗣 Speaking", 30),
    Triple("writing", "✍️ Writing", 15),
    Triple("checkin", "✅ Check-in", 0),
)

@Composable
fun CoachScreen(brain: Brain, onExit: () -> Unit) {
    val ctx = LocalContext.current
    val store = remember { CoachStore(ctx) }
    val base = remember { parseDays(ctx.assets.open("french_curriculum.json").bufferedReader().use { it.readText() }) }
    var dayNo by remember { mutableStateOf(store.current) }
    var block by remember { mutableStateOf<String?>(null) }
    var tick by remember { mutableStateOf(0) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }

    fun full(n: Int): Day {
        val d = base[n - 1]
        val g = if (d.needsGen) store.generated(n) else null
        return if (g != null) mergeGenerated(d, g) else d
    }
    val day = remember(dayNo, tick) { full(dayNo) }
    val needsBuild = day.needsGen && day.drills.isEmpty()

    fun taught(): List<String> = (1 until dayNo).flatMap { n -> full(n).vocab.map { it.first } }

    LaunchedEffect(dayNo, needsBuild) {
        if (needsBuild && !loading) {
            loading = true; error = ""
            try {
                val o = JSONObject().put("op", "generate").put("day", dayNo).put("theme", day.theme).put("grammar", day.grammar).put("week", day.week)
                    .put("serious", store.serious).put("taught", JSONArray(taught())).put("review", JSONArray(store.reviewItems(12).map { it.first }))
                    .put("errors", JSONArray(store.topErrors().map { it.first }))
                val g = Api.coach(o)
                val merged = mergeGenerated(base[dayNo - 1], g)
                if (merged.drills.size < 6 || merged.vocab.size < 5) error = "The lesson came back too thin. Tap Retry."
                else { store.saveGenerated(dayNo, g); tick++ }
            } catch (e: ApiException) { error = e.message ?: "Could not build the lesson." }
            catch (e: Exception) { error = "No connection." }
            loading = false
        }
    }
    LaunchedEffect(day.n, tick) { if (day.vocab.isNotEmpty()) store.addCards(day.vocab, "d${day.n}") }

    fun finishBlock(b: String) { store.markDone(dayNo, b); brain.stopAll(); block = null; tick++ }

    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        val b = block
        TopBar(
            title = if (b == null) "🇫🇷 Madame Roast" else BLOCKS.first { it.first == b }.second,
            onBack = { brain.stopAll(); if (b == null) onExit() else { block = null; tick++ } },
            right = { if (b == null) Text("Day $dayNo/28", color = C.gold, fontWeight = FontWeight.Bold) }
        )
        if (b == null) {
            Home(day, store, base, loading, needsBuild, error, tick,
                onDay = { n -> dayNo = n.coerceIn(1, 28); store.current = dayNo },
                onBlock = { block = it },
                onRetry = { error = ""; store.clearGenerated(dayNo); tick++ },
                onSerious = { store.serious = it; tick++ })
        } else {
            BlockFrame(dayNo, b, store) {
                when (b) {
                    "anki" -> AnkiBlock(day, store, brain) { finishBlock("anki") }
                    "lesson" -> LessonBlock(day, store, brain) { finishBlock("lesson") }
                    "listening" -> ListeningBlock(day, store, brain) { finishBlock("listening") }
                    "speaking" -> SpeakingBlock(day, store, brain, taught() + day.vocab.map { it.first }) { finishBlock("speaking") }
                    "writing" -> WritingBlock(day, store) { finishBlock("writing") }
                    else -> CheckIn(day, store, base) { if (store.blocksDone(dayNo).size >= 5 && dayNo < 28) { dayNo++; store.current = dayNo }; finishBlock("checkin") }
                }
            }
        }
    }
}

/** Counts active seconds spent in a block (only while this screen is open). */
@Composable
private fun BlockFrame(day: Int, block: String, store: CoachStore, content: @Composable () -> Unit) {
    var secs by remember { mutableStateOf(0) }
    LaunchedEffect(Unit) { while (true) { delay(1000); secs++ } }
    DisposableEffect(Unit) { onDispose { store.addSeconds(day, block, secs) } }
    val target = BLOCKS.first { it.first == block }.third
    if (target > 0) Text("⏱ ${secs / 60}:${"%02d".format(secs % 60)}  /  $target min", color = C.dim, fontSize = 13.sp)
    Spacer(Modifier.height(6.dp))
    content()
}

@Composable
private fun Home(
    day: Day, store: CoachStore, base: List<Day>, loading: Boolean, needsBuild: Boolean, error: String, tick: Int,
    onDay: (Int) -> Unit, onBlock: (String) -> Unit, onRetry: () -> Unit, onSerious: (Boolean) -> Unit,
) {
    val done = store.blocksDone(day.n)
    val total = store.totalMinutes(day.n)
    val next = BLOCKS.firstOrNull { it.first !in done }?.first
    Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Pill("◀") { onDay(day.n - 1) }
            Text("Week ${day.week}", color = C.dim, modifier = Modifier.padding(top = 10.dp))
            Pill("▶") { onDay(day.n + 1) }
        }
        Card {
            Text(day.theme, color = C.text, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold)
            if (day.grammar.isNotBlank()) Text(day.grammar, color = C.dim, fontSize = 15.sp)
            Text("⏱ $total / 180 min today" + if (day.review) "  ·  review day" else "", color = C.gold, fontSize = 15.sp)
            if (day.checkpoint) Text("📌 Checkpoint day: do the timed test.", color = C.gold, fontSize = 14.sp)
        }
        if (loading) Text("Madame Roast is building today's lesson…", color = C.dim, fontSize = 16.sp)
        if (error.isNotBlank()) { Text(error, color = C.red, fontSize = 15.sp); BigButton("Retry", C.blue, Modifier.fillMaxWidth()) { onRetry() } }
        if (!needsBuild) {
            if (next != null && next != "checkin") BigButton("▶ Start: " + BLOCKS.first { it.first == next }.second, C.red, Modifier.fillMaxWidth()) { onBlock(next) }
            for ((id, label, mins) in BLOCKS) {
                val ok = id in done
                Row(
                    Modifier.fillMaxWidth().background(if (ok) C.card else C.card2, RoundedCornerShape(16.dp)).clickable { onBlock(id) }.padding(16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(label, color = C.text, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                    Text(if (ok) "✓ ${store.minutes(day.n, id)} min" else if (mins > 0) "$mins min" else "", color = if (ok) C.green else C.dim, fontSize = 15.sp)
                }
            }
        }
        Card {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Column(Modifier.weight(1f)) {
                    Text("Serious mode", color = C.text, fontWeight = FontWeight.Bold)
                    Text("No jokes or roasts.", color = C.dim, fontSize = 13.sp)
                }
                Switch(store.serious, { onSerious(it) })
            }
            val due = store.dueCount()
            Text("Cards due: $due · total ${store.totalCards()}", color = C.dim, fontSize = 13.sp)
        }
        Text("Goal: TCF Canada NCLC 7, Jul–Aug 2027. Next checkpoint: A1 mini-test (2026-11-17).", color = C.dim, fontSize = 12.sp)
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun CheckIn(day: Day, store: CoachStore, base: List<Day>, finish: () -> Unit) {
    val ctx = LocalContext.current
    val done = store.blocksDone(day.n)
    val mins = store.totalMinutes(day.n)
    val (dc, dt) = store.drillStats(day.n)
    val (ar, ac) = store.ankiToday()
    val tops = store.topErrors().joinToString(", ") { "${it.first} (${it.second})" }.ifBlank { "none yet" }
    val weak = store.errorsOfDay(day.n).takeLast(5).joinToString("; ") { it.optString("item") + " → " + it.optString("model") }.ifBlank { "none" }
    val tomorrow = if (day.n < 28) base[day.n].theme else "Month 1 review done"
    val fix = store.topErrors(1).firstOrNull()?.first ?: "keep the pace"
    val line = BLOCKS.dropLast(1).joinToString(" / ") { it.first + (if (it.first in done) " ✓" else " ✗") }
    val text = buildString {
        appendLine("Day ${day.n} check-in")
        appendLine("Blocks done: $line")
        appendLine("Minutes logged: $mins / 180")
        appendLine("Anki: reviews $ar, accuracy ${if (ar > 0) ac * 100 / ar else 0}%")
        appendLine("Drills: correct $dc / $dt")
        appendLine("Top error categories: $tops")
        appendLine("Weakest items: $weak")
        appendLine("Tomorrow: $tomorrow")
        append("One thing to fix: $fix")
        if (mins < 120) append("\nOnly $mins minutes logged. Smallest fix for tomorrow: start with the cards block before anything else.")
    }
    Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(text, color = C.text, fontSize = 16.sp, lineHeight = 24.sp, modifier = Modifier.fillMaxWidth().background(C.card, RoundedCornerShape(16.dp)).padding(16.dp))
        BigButton("Share this check-in", C.card2, Modifier.fillMaxWidth()) {
            ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), "Share").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        BigButton(if (done.size >= 5) "Finish day ✓ → next day" else "Back", C.green, Modifier.fillMaxWidth()) { finish() }
    }
}
