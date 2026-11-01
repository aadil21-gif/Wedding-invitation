package app.seefar.assistant

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.selects.select
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONArray
import org.json.JSONObject
import kotlin.coroutines.resume

// ---------------------------------------------------------------- character

/** Madame Roast: an original cartoon teacher. Mouth moves while she talks, brows lift while she listens. */
@Composable
fun Madame(talking: Boolean, listening: Boolean, modifier: Modifier = Modifier) {
    val t = rememberInfiniteTransition(label = "madame")
    val mouth by t.animateFloat(0f, 1f, infiniteRepeatable(tween(210, easing = LinearEasing), RepeatMode.Reverse), label = "mouth")
    val blink by t.animateFloat(0f, 1f, infiniteRepeatable(tween(3400, easing = LinearEasing), RepeatMode.Restart), label = "blink")
    val bob by t.animateFloat(-1f, 1f, infiniteRepeatable(tween(1900, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "bob")

    val skin = Color(0xFFF1C7A2)
    val hair = Color(0xFF3B2A25)
    val ink = Color(0xFF241A1A)
    val beret = Color(0xFFD7263D)
    val blazer = Color(0xFF2B3A67)

    Canvas(modifier) {
        val w = size.width
        val h = size.height
        val cx = w / 2f
        val dy = bob * h * 0.01f

        // body + blazer
        drawRoundRect(color = blazer, topLeft = Offset(cx - w * 0.30f, h * 0.80f + dy), size = Size(w * 0.60f, h * 0.30f), cornerRadius = CornerRadius(w * 0.08f, w * 0.08f))
        // neck
        drawRoundRect(color = skin, topLeft = Offset(cx - w * 0.05f, h * 0.68f + dy), size = Size(w * 0.10f, h * 0.14f), cornerRadius = CornerRadius(8f, 8f))
        // scarf
        drawRoundRect(color = Color(0xFFF2F2F2), topLeft = Offset(cx - w * 0.13f, h * 0.76f + dy), size = Size(w * 0.26f, h * 0.07f), cornerRadius = CornerRadius(20f, 20f))
        drawRoundRect(color = beret, topLeft = Offset(cx + w * 0.02f, h * 0.78f + dy), size = Size(w * 0.07f, h * 0.17f), cornerRadius = CornerRadius(14f, 14f))
        // hair back + bun
        drawOval(color = hair, topLeft = Offset(cx - w * 0.235f, h * 0.17f + dy), size = Size(w * 0.47f, h * 0.55f))
        drawCircle(color = hair, radius = w * 0.075f, center = Offset(cx + w * 0.16f, h * 0.12f + dy))
        // head
        drawOval(color = skin, topLeft = Offset(cx - w * 0.20f, h * 0.20f + dy), size = Size(w * 0.40f, h * 0.48f))
        // fringe
        drawArc(color = hair, startAngle = 195f, sweepAngle = 150f, useCenter = true, topLeft = Offset(cx - w * 0.20f, h * 0.20f + dy), size = Size(w * 0.40f, h * 0.20f))
        // beret
        drawOval(color = beret, topLeft = Offset(cx - w * 0.26f, h * 0.11f + dy), size = Size(w * 0.50f, h * 0.13f))
        drawCircle(color = beret, radius = w * 0.018f, center = Offset(cx - w * 0.01f, h * 0.105f + dy))
        // cheeks
        drawCircle(color = Color(0xFFFF8A8A), radius = w * 0.03f, center = Offset(cx - w * 0.14f, h * 0.53f + dy), alpha = 0.35f)
        drawCircle(color = Color(0xFFFF8A8A), radius = w * 0.03f, center = Offset(cx + w * 0.14f, h * 0.53f + dy), alpha = 0.35f)
        // glasses
        val gy = h * 0.43f + dy
        val gr = w * 0.07f
        drawCircle(color = ink, radius = gr, center = Offset(cx - w * 0.095f, gy), style = Stroke(width = w * 0.013f))
        drawCircle(color = ink, radius = gr, center = Offset(cx + w * 0.095f, gy), style = Stroke(width = w * 0.013f))
        drawLine(color = ink, start = Offset(cx - w * 0.025f, gy), end = Offset(cx + w * 0.025f, gy), strokeWidth = w * 0.011f)
        // eyes
        if (blink > 0.965f) {
            drawLine(color = ink, start = Offset(cx - w * 0.115f, gy), end = Offset(cx - w * 0.075f, gy), strokeWidth = w * 0.01f)
            drawLine(color = ink, start = Offset(cx + w * 0.075f, gy), end = Offset(cx + w * 0.115f, gy), strokeWidth = w * 0.01f)
        } else {
            drawCircle(color = ink, radius = w * 0.016f, center = Offset(cx - w * 0.095f, gy))
            drawCircle(color = ink, radius = w * 0.016f, center = Offset(cx + w * 0.095f, gy))
        }
        // brows: one lifts while listening (the "go on, I'm waiting" look)
        val lift = if (listening) h * 0.025f else 0f
        drawLine(color = hair, start = Offset(cx - w * 0.14f, gy - gr - h * 0.015f), end = Offset(cx - w * 0.05f, gy - gr - h * 0.02f), strokeWidth = w * 0.014f)
        drawLine(color = hair, start = Offset(cx + w * 0.05f, gy - gr - h * 0.02f - lift), end = Offset(cx + w * 0.14f, gy - gr - h * 0.015f - lift), strokeWidth = w * 0.014f)
        // nose
        drawLine(color = Color(0xFFD9A47F), start = Offset(cx, gy + h * 0.02f), end = Offset(cx - w * 0.012f, gy + h * 0.075f), strokeWidth = w * 0.01f)
        // mouth
        val my = h * 0.58f + dy
        if (talking) {
            val open = w * 0.012f + w * 0.05f * mouth
            drawOval(color = Color(0xFF8C1C2B), topLeft = Offset(cx - w * 0.045f, my), size = Size(w * 0.09f, open))
        } else {
            drawArc(color = Color(0xFF8C1C2B), startAngle = 15f, sweepAngle = 150f, useCenter = false, topLeft = Offset(cx - w * 0.05f, my - h * 0.02f), size = Size(w * 0.10f, h * 0.05f), style = Stroke(width = w * 0.011f))
        }
    }
}

// ---------------------------------------------------------------- helpers

private const val SKIP = "\u0001skip"
private const val AGAIN = "\u0001again"

private fun norm(s: String): String =
    java.text.Normalizer.normalize(s.lowercase(), java.text.Normalizer.Form.NFD)
        .replace(Regex("\\p{Mn}+"), "").replace(Regex("[^a-z0-9 ]"), " ").replace(Regex("\\s+"), " ").trim()

private fun lev(a: String, b: String): Int {
    val dp = IntArray(b.length + 1) { it }
    for (i in 1..a.length) {
        var prev = dp[0]
        dp[0] = i
        for (j in 1..b.length) {
            val tmp = dp[j]
            dp[j] = minOf(dp[j] + 1, dp[j - 1] + 1, prev + if (a[i - 1] == b[j - 1]) 0 else 1)
            prev = tmp
        }
    }
    return dp[b.length]
}

/** Possible spoken forms of a vocab entry like "Bonjour / Salut" or "le chat (the cat)". */
private fun forms(fr: String): List<String> =
    fr.split('/', ';').map { it.replace(Regex("\\(.*?\\)"), "").trim() }.filter { it.isNotBlank() }.ifEmpty { listOf(fr) }

private fun frSimilarity(heard: String, fr: String): Double {
    val x = norm(heard)
    if (x.isBlank()) return 0.0
    return forms(fr).maxOf { f ->
        val y = norm(f)
        if (y.isEmpty()) 0.0 else if (x == y || x.contains(y)) 1.0 else 1.0 - lev(x, y).toDouble() / maxOf(x.length, y.length)
    }
}

private fun chop(word: String): String {
    val v = "aeiouyéèêàâîïôûù"
    val m = Regex("[^$v ]*[$v]+(?:[^$v ]+(?![$v]))?").findAll(forms(word).first().lowercase()).map { it.value }.toList()
    return if (m.size > 1) m.joinToString(" – ") else forms(word).first()
}

private class Cut { var d: CompletableDeferred<Unit>? = null }

/** Speaks and waits until finished or cut by the Skip button. */
private suspend fun say(brain: Brain, cut: Cut, text: String, lang: String, slow: Boolean = false, onStart: () -> Unit = {}) {
    val d = CompletableDeferred<Unit>()
    cut.d = d
    brain.speaker.speak(text, if (lang == "fr" && slow) "frslow" else "natural", lang, onStart = onStart, onDone = { d.complete(Unit) })
    try { d.await() } finally {
        if (!d.isCompleted) brain.speaker.stop()
        if (cut.d === d) cut.d = null
    }
}

/** null = recogniser error, "" = heard nothing. */
private suspend fun hear(brain: Brain, onPartial: (String) -> Unit): String? = suspendCancellableCoroutine { cont ->
    brain.listener.start("fr", onPartial, { h -> if (cont.isActive) cont.resume(h) }, { _ -> if (cont.isActive) cont.resume(null) })
    cont.invokeOnCancellation { brain.listener.stop() }
}

/** Voice or typed/tapped input, whichever comes first. */
private suspend fun answer(brain: Brain, typed: Channel<String>, onPartial: (String) -> Unit): String? = coroutineScope {
    while (typed.tryReceive().isSuccess) { /* drop stale taps */ }
    val h = async { hear(brain, onPartial) }
    select<String?> {
        h.onAwait { it }
        typed.onReceive { v -> h.cancel(); brain.listener.stop(); v }
    }
}

private val PRAISE = listOf("Parfait!", "Yes! That's it.", "Magnifique. Don't let it go to your head.", "Nice. Even the wall learned something.", "Boom. Correct.")
private val ROAST = listOf(
    "Brave attempt. Wrong, but brave.",
    "Close. Your tongue and that word are not on speaking terms.",
    "Almost. The vowels filed a complaint.",
    "Interesting. Wrong, but interesting.",
    "That was French the way a microwave is a chef.",
)

// ---------------------------------------------------------------- screen

@Composable
fun TutorScreen(brain: Brain, onExit: () -> Unit, onLessons: () -> Unit) {
    val ctx = LocalContext.current
    val store = remember { CoachStore(ctx) }
    val prefs = remember { ctx.getSharedPreferences("seefar_tutor", 0) }
    val base = remember { parseDays(ctx.assets.open("french_curriculum.json").bufferedReader().use { it.readText() }) }
    var dayNo by remember { mutableStateOf(store.current.coerceIn(1, 28)) }
    var tick by remember { mutableStateOf(0) }
    var buildError by remember { mutableStateOf("") }
    var building by remember { mutableStateOf(false) }

    fun full(n: Int): Day {
        val d = base[n - 1]
        val g = if (d.needsGen) store.generated(n) else null
        return if (g != null) mergeGenerated(d, g) else d
    }
    val day = remember(dayNo, tick) { full(dayNo) }
    val needsBuild = day.needsGen && day.drills.isEmpty()
    fun taught(): List<String> = (1 until dayNo).flatMap { n -> full(n).vocab.map { it.first } }

    // UI state driven by the lesson script
    var line by remember { mutableStateOf("") }
    var boardFr by remember { mutableStateOf("") }
    var boardEn by remember { mutableStateOf("") }
    var boardNote by remember { mutableStateOf("") }
    var talking by remember { mutableStateOf(false) }
    var listening by remember { mutableStateOf(false) }
    var partial by remember { mutableStateOf("") }
    var finished by remember { mutableStateOf(false) }
    var typedOpen by remember { mutableStateOf(false) }
    var typedText by remember { mutableStateOf("") }
    var progress by remember { mutableStateOf("") }

    val typed = remember { Channel<String>(Channel.UNLIMITED) }
    val cut = remember { Cut() }

    DisposableEffect(Unit) { onDispose { brain.stopAll() } }

    // Build days 8-28 on first open (same generator the lesson list uses).
    LaunchedEffect(dayNo, needsBuild, tick) {
        if (needsBuild && !building) {
            building = true; buildError = ""
            line = "One second. I'm writing today's board."
            try {
                val o = JSONObject().put("op", "generate").put("day", dayNo).put("theme", day.theme).put("grammar", day.grammar).put("week", day.week)
                    .put("serious", store.serious).put("taught", JSONArray(taught())).put("review", JSONArray(store.reviewItems(12).map { it.first }))
                    .put("errors", JSONArray(store.topErrors().map { it.first }))
                val g = Api.coach(o)
                val merged = mergeGenerated(base[dayNo - 1], g)
                if (merged.vocab.size < 5) buildError = "The board came out too thin. Tap Retry."
                else { store.saveGenerated(dayNo, g); tick++ }
            } catch (e: ApiException) { buildError = e.message ?: "Could not build the lesson." }
            catch (e: Exception) { buildError = "No connection." }
            building = false
        }
    }

    // The lesson itself: she talks, you repeat, she judges.
    LaunchedEffect(dayNo, tick, needsBuild) {
        if (needsBuild) return@LaunchedEffect
        finished = false
        val started = System.currentTimeMillis()
        val serious = store.serious
        suspend fun talk(en: String) {
            line = en; talking = true
            try { say(brain, cut, en, "en") } finally { talking = false }
        }
        suspend fun frSay(fr: String) {
            talking = true
            try { say(brain, cut, forms(fr).first(), "fr", slow = true) } finally { talking = false }
        }
        suspend fun listenFor(): String? {
            delay(200)
            listening = true; partial = ""
            try { return answer(brain, typed) { partial = it } } finally { listening = false; partial = "" }
        }

        val vocab = day.vocab
        val chunks = vocab.chunked(3)
        var startChunk = prefs.getInt("chunk_$dayNo", 0).coerceIn(0, chunks.size)
        if (startChunk >= chunks.size) startChunk = 0

        boardFr = day.theme; boardEn = day.grammar; boardNote = ""
        if (startChunk == 0) {
            talk("Salut Aadil! Today's topic: ${day.theme}.")
            if (day.grammar.isNotBlank()) talk("Today's trick: ${day.grammar}. Don't panic. You'll see it in action.")
            talk("I'll show a word on the board, say it, then you say it back. Easy. Like you're thirteen and I'm the cool teacher.")
        } else {
            talk("Welcome back. We continue where you left off.")
        }

        for (ci in startChunk until chunks.size) {
            val chunk = chunks[ci]
            progress = "Round ${ci + 1} of ${chunks.size}"
            for ((fr, en) in chunk) {
                boardFr = fr; boardEn = en; boardNote = ""
                talk(listOf("Look at the board.", "Next word.", "New word on the board.").random())
                frSay(fr)
                talk("It means: $en. Now you. Say it.")
                var tries = 0
                var ok = false
                var silent = 0
                while (!ok && tries < 3) {
                    val h = listenFor()
                    when {
                        h == SKIP -> { ok = true; tries = 99 }
                        h == AGAIN -> { frSay(fr) }
                        h == null -> { silent += 2; talk("The mic had a problem. Tap the keyboard and type it, or skip."); if (silent >= 4) tries = 3 }
                        h.isBlank() -> { silent++; if (silent >= 3) tries = 3 else talk("I heard nothing. Louder, please. Nobody's judging. Except me.") }
                        frSimilarity(h, fr) >= 0.72 -> {
                            ok = true
                            store.drillResult(dayNo, true)
                            talk(PRAISE.random())
                        }
                        else -> {
                            tries++
                            store.drillResult(dayNo, false)
                            if (tries < 3) {
                                talk(if (serious) "I heard \"$h\". Listen again." else "I heard \"$h\". ${ROAST.random()} Listen again.")
                                frSay(fr)
                            }
                        }
                    }
                }
                if (!ok && tries != 99) {
                    boardNote = chop(fr)
                    talk("Let's chop it up: ${boardNote.replace("–", ",")}. Slowly.")
                    frSay(fr)
                    store.logError(dayNo, "pronunciation", en, "", fr)
                    store.errorCard(en, fr, "d$dayNo")
                    talk("We'll see this one again. It's in your cards now.")
                }
            }

            // quick check on the three words just taught
            progress = "Quick check"
            boardFr = ""; boardEn = ""; boardNote = ""
            talk("Quick check. No peeking.")
            for ((fr, en) in chunk.shuffled()) {
                boardFr = "?"; boardEn = en
                talk("How do you say: $en?")
                val h = listenFor()
                if (h == SKIP) continue
                val good = h != null && frSimilarity(h, fr) >= 0.72
                store.drillResult(dayNo, good)
                if (good) talk(PRAISE.random())
                else {
                    boardFr = fr; boardNote = "Answer"
                    store.logError(dayNo, "recall", en, h.orEmpty(), fr)
                    store.errorCard(en, fr, "d$dayNo")
                    talk(if (serious) "It's: ${forms(fr).first()}." else "${ROAST.random()} It's:")
                    frSay(fr)
                }
            }
            prefs.edit().putInt("chunk_$dayNo", ci + 1).apply()
        }

        // free talk with the AI teacher
        progress = "Talk to me"
        boardFr = "💬"; boardEn = ""; boardNote = ""
        val task = day.speaking.firstOrNull().orEmpty().ifBlank { "Introduce yourself in French." }
        talk("Last part. Just talk to me. Your task: $task. French, even if it's ugly.")
        val log = ArrayList<String>()
        var nextFr = ""
        var turns = 0
        while (turns < 3) {
            val h = listenFor()
            if (h == SKIP) break
            if (h.isNullOrBlank()) { talk("I heard nothing. Try again, or tap skip."); turns++; continue }
            log.add("You: $h")
            line = "…"
            try {
                val o = JSONObject().put("op", "talk").put("week", day.week).put("serious", serious)
                    .put("prompt", task + if (nextFr.isNotBlank()) " (Current line to answer: $nextFr)" else "")
                    .put("input", h).put("history", JSONArray(log.takeLast(8))).put("taught", JSONArray((taught() + vocab.map { it.first }).takeLast(150)))
                    .put("errors", JSONArray(store.topErrors().map { it.first }))
                val r = Api.coach(o)
                val fix = r.optJSONObject("fix")
                val sb = StringBuilder(r.optString("feedback_en"))
                val roast = r.optString("roast")
                if (!serious && roast.isNotBlank()) sb.append(" ").append(roast)
                if (sb.isNotBlank()) talk(sb.toString())
                if (fix != null && fix.optString("better").isNotBlank()) {
                    boardFr = fix.optString("better"); boardEn = "Say it like this"; boardNote = ""
                    store.logError(dayNo, "other", fix.optString("said"), fix.optString("said"), fix.optString("better"))
                    store.errorCard(fix.optString("said").ifBlank { fix.optString("better") }, fix.optString("better"), "d$dayNo")
                    frSay(fix.optString("better"))
                }
                nextFr = r.optString("next_fr")
                if (nextFr.isNotBlank()) {
                    boardFr = nextFr; boardEn = r.optString("next_en"); boardNote = ""
                    log.add("Madame: $nextFr")
                    frSay(nextFr)
                }
                turns++
            } catch (e: Exception) {
                talk("My brain wandered off. We'll chat again later.")
                break
            }
        }

        val mins = ((System.currentTimeMillis() - started) / 1000L).toInt()
        store.addSeconds(dayNo, "lesson", mins * 2 / 3)
        store.addSeconds(dayNo, "speaking", mins / 3)
        store.markDone(dayNo, "lesson"); store.markDone(dayNo, "speaking")
        prefs.edit().putInt("chunk_$dayNo", 0).apply()
        boardFr = "✓"; boardEn = "Board cleaned"; boardNote = ""; progress = ""
        talk(if (serious) "That's the lesson done. Your cards are next." else "Class dismissed. Go do your cards. I'll be here, judging.")
        finished = true
    }

    fun sendInput(v: String) { typed.trySend(v) }

    Column(Modifier.fillMaxSize().padding(horizontal = 14.dp).verticalScroll(rememberScrollState())) {
        TopBar(
            title = "Madame Roast",
            onBack = { brain.stopAll(); onExit() },
            right = { Pill("Lessons") { brain.stopAll(); onLessons() } }
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Day $dayNo · ${day.theme}", color = C.dim, fontSize = 13.sp)
            Text(progress, color = C.gold, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        }
        Madame(talking, listening, Modifier.fillMaxWidth().height(190.dp))

        // her speech bubble
        Box(Modifier.fillMaxWidth().background(Color(0xFFF7F3EA), RoundedCornerShape(18.dp)).padding(14.dp)) {
            Text(line.ifBlank { "…" }, color = Color(0xFF1F1B16), fontSize = 17.sp, fontWeight = FontWeight.Medium)
        }
        Spacer(Modifier.height(10.dp))

        // the chalkboard
        Column(
            Modifier.fillMaxWidth().background(Color(0xFF1F3D33), RoundedCornerShape(14.dp))
                .border(5.dp, Color(0xFF8A5A2B), RoundedCornerShape(14.dp)).padding(18.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(boardFr.ifBlank { " " }, color = Color(0xFFF5F5F0), fontSize = 36.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            if (boardEn.isNotBlank()) Text(boardEn, color = Color(0xFFFFE08A), fontSize = 20.sp, textAlign = TextAlign.Center)
            if (boardNote.isNotBlank()) Text(boardNote, color = Color(0xFF9AD7C0), fontSize = 18.sp, textAlign = TextAlign.Center)
        }
        Spacer(Modifier.height(12.dp))

        if (needsBuild) {
            if (buildError.isNotBlank()) {
                Text(buildError, color = C.red, fontSize = 15.sp)
                BigButton("Retry", C.blue, Modifier.fillMaxWidth()) { buildError = ""; store.clearGenerated(dayNo); tick++ }
            }
        } else if (finished) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                BigButton("Cards & more", C.blue, Modifier.weight(1f)) { onLessons() }
                if (dayNo < 28) BigButton("Next day ▶", C.green, Modifier.weight(1f)) {
                    brain.stopAll(); dayNo++; store.current = dayNo; tick++
                }
            }
        } else {
            if (listening) {
                Box(Modifier.fillMaxWidth().background(C.red, RoundedCornerShape(18.dp)).padding(16.dp), contentAlignment = Alignment.Center) {
                    Text(if (partial.isBlank()) "🎤 Your turn… speak" else "🎤 $partial", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                }
                Spacer(Modifier.height(8.dp))
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Pill("🔊 Again") { if (listening) sendInput(AGAIN) }
                Pill("⌨ Type") { typedOpen = !typedOpen }
                Pill("Skip ▶") {
                    val c = cut.d
                    if (c != null) { brain.speaker.stop(); c.complete(Unit) } else sendInput(SKIP)
                }
            }
            if (typedOpen) {
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    OutlinedTextField(typedText, { typedText = it }, modifier = Modifier.weight(1f), singleLine = true, placeholder = { Text("type in French") })
                    Pill("Send") { val t = typedText.trim(); typedText = ""; if (t.isNotBlank()) sendInput(t) }
                }
                AccentRow { typedText += it }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}
