package app.seefar.assistant

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

fun openLink(ctx: Context, url: String) {
    try { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) {}
}

fun hearFr(brain: Brain, text: String, slow: Boolean = true) =
    brain.speaker.speak(text, if (slow) "frslow" else "natural", "fr", forceAi = true)

@Composable
fun AccentRow(onInsert: (String) -> Unit) {
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        for (c in listOf("é", "è", "ê", "à", "â", "ç", "ô", "î", "ï", "û", "ù", "œ", "'")) Pill(c) { onInsert(c) }
    }
}

private fun itemOf(d: Drill) = d.prompt.ifBlank { d.target.ifBlank { d.audio } }
private fun modelOf(d: Drill) = d.answer.ifBlank { d.target }
private fun speakTextOf(d: Drill) = when (d.type) {
    "translate_fr_en" -> d.prompt
    "say_it" -> d.target
    else -> d.answer
}

/** Runs a list of drills one by one with instant grading and Madame Roast feedback. */
@Composable
fun DrillRunner(day: Day, drills: List<Drill>, store: CoachStore, brain: Brain, onDone: () -> Unit) {
    val list = remember(drills) {
        drills.flatMap { d ->
            if (d.type == "review_set") store.reviewItems(d.reviewCount.coerceAtLeast(5)).mapIndexed { i, it -> Drill("rv$i", "translate_en_fr", prompt = it.first, answer = it.second) }
            else listOf(d)
        }
    }
    var idx by remember { mutableStateOf(0) }
    var input by remember { mutableStateOf("") }
    var phase by remember { mutableStateOf(0) } // 0 answering, 1 wrong (repeat), 2 finished item
    var feedback by remember { mutableStateOf("") }
    var good by remember { mutableStateOf(true) }
    var correctCount by remember { mutableStateOf(0) }
    var heard by remember { mutableStateOf("") }
    var listening by remember { mutableStateOf(false) }
    val chosen = remember { mutableStateListOf<String>() }
    val fails = remember { HashMap<String, Int>() }

    if (list.isEmpty()) {
        Text("Nothing to drill here yet.", color = C.dim)
        BigButton("Continue", C.blue, Modifier.fillMaxWidth()) { onDone() }
        return
    }
    if (idx >= list.size) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp), horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
            Text("$correctCount / ${list.size}", color = C.text, fontSize = 52.sp, fontWeight = FontWeight.ExtraBold)
            Text(if (correctCount * 10 >= list.size * 8) "Strong. Moving on." else "Not great. The mistakes are in your cards and will come back.", color = C.dim, fontSize = 17.sp, textAlign = TextAlign.Center)
            BigButton("Continue", C.green, Modifier.fillMaxWidth()) { onDone() }
        }
        return
    }
    val d = list[idx]

    fun reset() { input = ""; phase = 0; feedback = ""; heard = ""; chosen.clear(); listening = false }

    fun submit(given: String, repeat: Boolean) {
        val r = Grade.check(d, given)
        if (repeat) {
            good = r.correct
            feedback = if (r.correct) "Better. That is how it is said." else "Still off. It is: ${modelOf(d)}. It goes into your cards; moving on."
            phase = 2
            return
        }
        store.drillResult(day.n, r.correct)
        if (r.correct) correctCount++
        if (!r.correct || r.minorAccent) {
            val cat = r.category ?: "other"
            store.logError(day.n, cat, itemOf(d), given, modelOf(d))
            if (!r.correct) store.errorCard(itemOf(d), modelOf(d), "d${day.n}")
        }
        if (r.correct && !r.minorAccent) {
            good = true
            feedback = Grade.praise()
            phase = 2
        } else if (r.correct) {
            good = true
            feedback = "Right, but watch the accent: ${d.answer}."
            phase = 2
        } else {
            good = false
            val n = (fails[d.id] ?: 0) + 1
            fails[d.id] = n
            val calm = store.serious || n >= 3
            feedback = (if (calm) "" else Grade.roast(r.category) + " ") + "Answer: ${modelOf(d)}."
            phase = if (d.type == "mcq") 2 else 1
        }
        if (!r.correct) {
            val say = speakTextOf(d)
            if (say.isNotBlank()) hearFr(brain, say)
        }
    }

    Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("${idx + 1} / ${list.size}", color = C.dim, fontSize = 14.sp)
        when (d.type) {
            "say_it" -> {
                Text("Say it", color = C.dim, fontSize = 14.sp)
                Text(d.target, color = C.text, fontSize = 28.sp, fontWeight = FontWeight.ExtraBold)
                if (d.hint.isNotBlank()) Text("💡 " + d.hint, color = C.gold, fontSize = 15.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                    BigButton("🔊 Hear", C.blue, Modifier.weight(1f)) { hearFr(brain, d.target) }
                    BigButton(if (listening) "Listening…" else "🎤 Say it", C.red, Modifier.weight(1f)) {
                        if (!listening && phase != 2) {
                            brain.speaker.stop()
                            listening = true
                            brain.listener.start("fr", { heard = it }, { h ->
                                listening = false
                                if (h.isBlank()) feedback = "I heard nothing. Louder." else { heard = h; submit(h, phase == 1) }
                            }, { listening = false; feedback = it })
                        }
                    }
                }
                if (heard.isNotBlank()) Text("I heard: \"$heard\"", color = C.dim, fontSize = 15.sp)
                Text("The recogniser can't truly judge your accent. Compare with the model by ear.", color = C.dim, fontSize = 12.sp)
            }
            "mcq" -> {
                Text(d.prompt, color = C.text, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                for (o in d.options) {
                    val col = if (phase == 2 || phase == 1) (if (o == d.answer) C.green else C.card) else C.card2
                    BigButton(o, col, Modifier.fillMaxWidth()) { if (phase == 0) { input = o; submit(o, false) } }
                }
            }
            "order" -> {
                Text("Build the sentence", color = C.dim, fontSize = 14.sp)
                Text(chosen.joinToString(" ").ifBlank { "…" }, color = C.text, fontSize = 24.sp, fontWeight = FontWeight.Bold, modifier = Modifier.fillMaxWidth().background(C.card, RoundedCornerShape(14.dp)).padding(14.dp))
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for ((i, w) in d.words.withIndex()) if (chosen.size <= i || d.words.count { it == w } > chosen.count { it == w }) Pill(w) { if (phase == 0) chosen.add(w) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Pill("⌫ Undo") { if (chosen.isNotEmpty()) chosen.removeAt(chosen.size - 1) }
                    Pill("Check ✓", true) { if (phase == 0 && chosen.isNotEmpty()) submit(chosen.joinToString(" ").replace("' ", "'"), false) }
                }
            }
            else -> { // fill, translate_en_fr, translate_fr_en, dictation
                if (d.type == "dictation") {
                    Text(d.prompt.ifBlank { "Listen and type what you hear" }, color = C.dim, fontSize = 15.sp)
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                        BigButton("🐢 Slow", C.blue, Modifier.weight(1f)) { hearFr(brain, d.audio, true) }
                        BigButton("🔊 Normal", C.blue, Modifier.weight(1f)) { hearFr(brain, d.audio, false) }
                    }
                } else {
                    Text(when (d.type) { "translate_en_fr" -> "In French:"; "translate_fr_en" -> "In English:"; else -> "Fill the blank:" }, color = C.dim, fontSize = 14.sp)
                    Text(d.prompt, color = C.text, fontSize = 26.sp, fontWeight = FontWeight.ExtraBold)
                    if (d.type == "translate_fr_en") BigButton("🔊 Hear it", C.card2, Modifier.fillMaxWidth()) { hearFr(brain, d.prompt) }
                }
                if (phase != 2) {
                    OutlinedTextField(input, { input = it }, modifier = Modifier.fillMaxWidth(), singleLine = true, placeholder = { Text(if (phase == 1) "Type it once more" else "Your answer") })
                    if (d.type != "translate_fr_en") AccentRow { input += it }
                    BigButton(if (phase == 1) "Check again" else "Check", C.blue, Modifier.fillMaxWidth()) { if (input.isNotBlank()) submit(input, phase == 1) }
                }
            }
        }
        if (feedback.isNotBlank()) {
            Text(feedback, color = if (good) C.green else C.text, fontSize = 18.sp, modifier = Modifier.fillMaxWidth().background(C.card, RoundedCornerShape(14.dp)).padding(14.dp))
        }
        if (phase == 1 && d.type == "say_it") Text("Say it once more, or skip.", color = C.dim, fontSize = 14.sp)
        if (phase >= 1) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                if (phase == 1) BigButton("🔊 Model", C.card2, Modifier.weight(1f)) { hearFr(brain, speakTextOf(d)) }
                BigButton(if (phase == 1) "Skip" else "Next", C.blue, Modifier.weight(1f)) { brain.stopAll(); idx++; reset() }
            }
        }
        Spacer(Modifier.height(20.dp))
    }
}

// ---------------- anki ----------------

@Composable
fun AnkiBlock(day: Day, store: CoachStore, brain: Brain, done: () -> Unit) {
    val scope = rememberCoroutineScope()
    val queue = remember { store.ankiQueue(day.n) }
    var i by remember { mutableStateOf(0) }
    var shown by remember { mutableStateOf(false) }
    var leech by remember { mutableStateOf("") }
    if (queue.isEmpty()) {
        Text("No cards due. Reviews come back as you learn more words.", color = C.dim, fontSize = 17.sp)
        BigButton("Mark done", C.green, Modifier.fillMaxWidth()) { done() }
        return
    }
    if (i >= queue.size) {
        val (r, c) = store.ankiToday()
        Text("Cards done: $r reviewed, $c right.", color = C.text, fontSize = 20.sp)
        BigButton("Done ✓", C.green, Modifier.fillMaxWidth()) { done() }
        return
    }
    val card = queue[i]
    Column(verticalArrangement = Arrangement.spacedBy(12.dp), horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
        Text("${i + 1} / ${queue.size}  ·  " + (if (card.seen) "review" else "new"), color = C.dim)
        Text(card.front, color = C.text, fontSize = 36.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().background(C.card, RoundedCornerShape(22.dp)).padding(30.dp))
        BigButton("🔊 Hear it", C.card2, Modifier.fillMaxWidth()) { hearFr(brain, card.front) }
        if (!shown) {
            BigButton("Show meaning", C.blue, Modifier.fillMaxWidth()) { shown = true }
        } else {
            Text(card.back, color = C.gold, fontSize = 26.sp, textAlign = TextAlign.Center)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                listOf("Again" to C.red, "Hard" to C.card2, "Good" to C.blue, "Easy" to C.green).forEachIndexed { g, (label, col) ->
                    BigButton(label, col, Modifier.weight(1f)) {
                        val isLeech = store.gradeCard(card.front, g)
                        if (isLeech) scope.launch {
                            try {
                                val o = JSONObject().put("op", "leech").put("front", card.front).put("back", card.back)
                                val r = Api.coach(o)
                                leech = "Leech: ${card.front}. ${r.optString("mnemonic")} Example: ${r.optString("example_fr")} (${r.optString("example_en")})"
                            } catch (_: Exception) { leech = "${card.front} keeps failing. It is paused; we'll bring it back later." }
                        }
                        shown = false; i++
                    }
                }
            }
        }
        if (leech.isNotBlank()) Text(leech, color = C.dim, fontSize = 15.sp)
    }
}

// ---------------- lesson ----------------

@Composable
fun LessonBlock(day: Day, store: CoachStore, brain: Brain, done: () -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var phase by remember { mutableStateOf(0) } // 0 steps, 1 vocab, 2 drills
    var step by remember { mutableStateOf(0) }
    when (phase) {
        0 -> {
            val steps = day.steps.ifEmpty { listOf("Today's theme: ${day.theme}.") }
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Step ${step + 1} of ${steps.size}", color = C.dim)
                Text(steps[step], color = C.text, fontSize = 20.sp, lineHeight = 28.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                    BigButton("🔊 Hear examples", C.card2, Modifier.weight(1f)) {
                        val french = Regex("[A-Za-zÀ-ÿ’'.,?! -]{3,}").findAll(steps[step]).map { it.value.trim() }.filter { it.any { c -> c in "éèêàçôîûùœ" } || it.contains(' ') }.take(3).joinToString(". ")
                        if (french.isNotBlank()) hearFr(brain, french)
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                    if (step > 0) BigButton("Back", C.card2, Modifier.weight(1f)) { step-- }
                    if (step < steps.size - 1) BigButton("Next", C.blue, Modifier.weight(1f)) { step++ } else BigButton("Words →", C.green, Modifier.weight(1f)) { phase = 1 }
                }
                if (day.links.isNotEmpty() || true) {
                    Text("Watch / read (opens in your browser):", color = C.dim, fontSize = 14.sp)
                    val q = java.net.URLEncoder.encode("learn French beginner " + day.theme, "UTF-8")
                    Pill("▶ YouTube: ${day.theme}") { openLink(ctx, "https://www.youtube.com/results?search_query=$q") }
                    for (l in day.links) Pill("🔗 " + l.removePrefix("https://").take(40)) { openLink(ctx, l) }
                }
            }
        }
        1 -> {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Today's words. Tap to hear.", color = C.dim)
                for ((fr, en) in day.vocab) {
                    Row(Modifier.fillMaxWidth().background(C.card, RoundedCornerShape(14.dp)).clickable { hearFr(brain, fr) }.padding(12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                        Column(Modifier.weight(1f)) { Text(fr, color = C.text, fontSize = 20.sp, fontWeight = FontWeight.Bold); Text(en, color = C.dim, fontSize = 15.sp) }
                        Text("🔊", fontSize = 22.sp)
                    }
                }
                BigButton("Start drills →", C.green, Modifier.fillMaxWidth()) { brain.stopAll(); phase = 2 }
                Spacer(Modifier.height(20.dp))
            }
        }
        else -> DrillRunner(day, day.drills, store, brain) { done() }
    }
}

// ---------------- listening ----------------

@Composable
fun ListeningBlock(day: Day, store: CoachStore, brain: Brain, done: () -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var dictating by remember { mutableStateOf(false) }
    if (dictating) { DrillRunner(day, day.dictation, store, brain) { done() }; return }
    val q = java.net.URLEncoder.encode("French beginner listening " + day.theme, "UTF-8")
    Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("45 min of real French audio, then dictation.", color = C.text, fontSize = 18.sp, fontWeight = FontWeight.Bold)
        if (day.listenPlan.isNotBlank()) Text("Plan: " + day.listenPlan, color = C.dim, fontSize = 15.sp)
        Text("Tap a link, listen, come back. The timer keeps counting while you are away from the app only if you stay on this screen, so come back when you finish.", color = C.dim, fontSize = 13.sp)
        for (l in day.listenLinks) Pill("🎧 " + l.removePrefix("https://").take(44)) { openLink(ctx, l) }
        Pill("▶ YouTube: ${day.theme}") { openLink(ctx, "https://www.youtube.com/results?search_query=$q") }
        Pill("▶ Easy French (street interviews)") { openLink(ctx, "https://www.youtube.com/@EasyFrench") }
        Pill("▶ TV5Monde A1 exercises") { openLink(ctx, "https://apprendre.tv5monde.com/fr/exercices/a1-debutant") }
        Pill("▶ Comme une Française (pronunciation)") { openLink(ctx, "https://www.youtube.com/results?search_query=Comme+une+Fran%C3%A7aise+prononciation") }
        Text("Links were not click-tested by me. If one is dead, use the YouTube search above.", color = C.dim, fontSize = 12.sp)
        BigButton("I listened. Dictation →", C.green, Modifier.fillMaxWidth()) { if (day.dictation.isEmpty()) done() else dictating = true }
    }
}

// ---------------- speaking ----------------

@Composable
fun SpeakingBlock(day: Day, store: CoachStore, brain: Brain, taught: List<String>, done: () -> Unit) {
    val scope = rememberCoroutineScope()
    val prompts = day.speaking.ifEmpty { listOf("Introduce yourself in French.") }
    var pi by remember { mutableStateOf(0) }
    val log = remember { mutableStateListOf<String>() }
    var nextFr by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var listening by remember { mutableStateOf(false) }
    var typed by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var turns by remember { mutableStateOf(0) }

    fun send(text: String) {
        if (text.isBlank() || busy) return
        busy = true; error = ""
        log.add("You: $text")
        scope.launch {
            try {
                val o = JSONObject().put("op", "talk").put("week", day.week).put("serious", store.serious)
                    .put("prompt", prompts[pi] + if (nextFr.isNotBlank()) " (Current line to answer: $nextFr)" else "")
                    .put("input", text).put("history", JSONArray(log.takeLast(8))).put("taught", JSONArray(taught.takeLast(150)))
                    .put("errors", JSONArray(store.topErrors().map { it.first }))
                val r = Api.coach(o)
                val fix = r.optJSONObject("fix")
                val sb = StringBuilder(r.optString("feedback_en"))
                val roast = r.optString("roast")
                if (!store.serious && roast.isNotBlank()) sb.append(" ").append(roast)
                if (fix != null && fix.optString("better").isNotBlank()) {
                    sb.append("\nSay: ").append(fix.optString("better"))
                    store.logError(day.n, "other", fix.optString("said"), fix.optString("said"), fix.optString("better"))
                    store.errorCard(fix.optString("said").ifBlank { fix.optString("better") }, fix.optString("better"), "d${day.n}")
                }
                nextFr = r.optString("next_fr")
                if (nextFr.isNotBlank()) sb.append("\n→ ").append(nextFr).append("  (").append(r.optString("next_en")).append(")")
                log.add("Madame: $sb")
                turns++
                if (nextFr.isNotBlank()) hearFr(brain, nextFr)
            } catch (e: ApiException) { error = e.message ?: "Madame Roast lost the line." }
            catch (e: Exception) { error = "No connection." }
            busy = false
        }
    }

    Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Task ${pi + 1} of ${prompts.size}", color = C.dim)
        Text(prompts[pi], color = C.text, fontSize = 21.sp, fontWeight = FontWeight.Bold)
        if (turns == 0) Text("Say it in French (or try). I'll coach each answer.", color = C.dim, fontSize = 14.sp)
        for (l in log) Text(l, color = if (l.startsWith("You")) C.gold else C.text, fontSize = 16.sp, modifier = Modifier.fillMaxWidth().background(C.card, RoundedCornerShape(12.dp)).padding(12.dp))
        if (busy) Text("Madame Roast is thinking…", color = C.dim)
        if (error.isNotBlank()) Text(error, color = C.red)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
            BigButton(if (listening) "Listening…" else "🎤 Speak", C.red, Modifier.weight(1f)) {
                if (!listening && !busy) {
                    brain.speaker.stop(); listening = true
                    brain.listener.start("fr", {}, { h -> listening = false; if (h.isNotBlank()) send(h) else error = "I heard nothing." }, { listening = false; error = it })
                }
            }
            if (nextFr.isNotBlank()) BigButton("🔊 Line", C.card2, Modifier.weight(1f)) { hearFr(brain, nextFr) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            OutlinedTextField(typed, { typed = it }, modifier = Modifier.weight(1f), singleLine = true, placeholder = { Text("or type in French") })
            Pill("Send") { val t = typed; typed = ""; send(t) }
        }
        AccentRow { typed += it }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
            if (pi < prompts.size - 1) BigButton("Next task", C.blue, Modifier.weight(1f)) { pi++; log.clear(); nextFr = ""; turns = 0 }
            BigButton("Done ✓", C.green, Modifier.weight(1f)) { brain.stopAll(); done() }
        }
        Spacer(Modifier.height(20.dp))
    }
}

// ---------------- writing ----------------

@Composable
fun WritingBlock(day: Day, store: CoachStore, done: () -> Unit) {
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<JSONObject?>(null) }
    val prompt = day.writing.ifBlank { "Write 4 sentences about yourself." }
    Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(prompt, color = C.text, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        if (result == null) {
            OutlinedTextField(text, { text = it }, modifier = Modifier.fillMaxWidth().height(180.dp), placeholder = { Text("Write in French…") })
            AccentRow { text += it }
            if (error.isNotBlank()) Text(error, color = C.red)
            BigButton(if (busy) "Checking…" else "Check my writing", C.blue, Modifier.fillMaxWidth()) {
                if (!busy && text.isNotBlank()) {
                    busy = true; error = ""
                    scope.launch {
                        try {
                            val o = JSONObject().put("op", "write").put("week", day.week).put("serious", store.serious).put("prompt", prompt).put("text", text)
                                .put("errors", JSONArray(store.topErrors().map { it.first }))
                            val r = Api.coach(o)
                            val cs = r.optJSONArray("corrections")
                            if (cs != null) for (k in 0 until cs.length()) cs.optJSONObject(k)?.let { c ->
                                store.logError(day.n, c.optString("category", "other"), c.optString("original"), c.optString("original"), c.optString("fix"))
                                store.errorCard(c.optString("original"), c.optString("fix"), "d${day.n}")
                            }
                            result = r
                        } catch (e: ApiException) { error = e.message ?: "Could not check right now." }
                        catch (e: Exception) { error = "No connection." }
                        busy = false
                    }
                }
            }
        } else {
            val r = result!!
            Text("Yours: $text", color = C.dim, fontSize = 15.sp)
            val cs = r.optJSONArray("corrections")
            if (cs == null || cs.length() == 0) Text("No real errors. Good.", color = C.green, fontSize = 18.sp)
            else for (k in 0 until cs.length()) cs.optJSONObject(k)?.let { c ->
                Text("✗ ${c.optString("original")}\n✓ ${c.optString("fix")}\n${c.optString("reason")}", color = C.text, fontSize = 16.sp, modifier = Modifier.fillMaxWidth().background(C.card, RoundedCornerShape(12.dp)).padding(12.dp))
            }
            if (r.optString("corrected_text").isNotBlank()) Text("Corrected: " + r.optString("corrected_text"), color = C.gold, fontSize = 16.sp)
            Text(r.optString("summary_en"), color = C.dim, fontSize = 15.sp)
            if (!store.serious && r.optString("roast").isNotBlank()) Text(r.optString("roast"), color = C.text, fontSize = 16.sp)
            if (r.optString("praise").isNotBlank()) Text(r.optString("praise"), color = C.green, fontSize = 15.sp)
            BigButton("Done ✓", C.green, Modifier.fillMaxWidth()) { done() }
        }
        Spacer(Modifier.height(20.dp))
    }
}
