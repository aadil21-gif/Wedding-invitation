package app.seefar.assistant

import android.content.Context
import android.content.Intent
import android.net.Uri
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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject

fun openUrl(ctx: Context, url: String) {
    try { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) {}
}

/** Counts only time the app is actually on screen. */
@Composable
fun ActiveTimer(store: CoachStore, day: Int, block: String) {
    val owner = LocalLifecycleOwner.current
    LaunchedEffect(day, block) {
        while (true) {
            delay(5000)
            if (owner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) store.addSeconds(day, block, 5)
        }
    }
}

private fun joinWords(w: List<String>): String {
    val sb = StringBuilder()
    for ((i, x) in w.withIndex()) { if (i > 0 && !w[i - 1].endsWith("'") && !w[i - 1].endsWith("’")) sb.append(' '); sb.append(x) }
    return sb.toString()
}

/** Turns "review_set" placeholders into drills built from what you got wrong. */
fun buildDrills(day: DayData, store: CoachStore): List<Drill> {
    fun fromErrors(n: Int): List<Drill> = store.errors().takeLast(n).distinctBy { it.optString("item") + it.optString("model") }.mapIndexed { i, e ->
        Drill("r$i", "translate_en_fr", prompt = e.optString("item"), answer = e.optString("model"))
    }
    val out = ArrayList<Drill>()
    var hadReview = false
    for (d in day.drills) {
        if (d.type == "review_set") { hadReview = true; out.addAll(fromErrors(if (d.count > 0) minOf(d.count, 20) else 15)) } else out.add(d)
    }
    if (day.reviewDay && !hadReview) out.addAll(0, fromErrors(15))
    return out
}

private val PEOPLE_TYPES = setOf("fill", "translate_en_fr", "translate_fr_en", "say_it", "dictation")

@Composable
fun DrillRunner(
    drills: List<Drill>, start: Int, dayNo: Int, week: Int, store: CoachStore, brain: Brain, block: String,
    onIndex: (Int) -> Unit, onFinish: () -> Unit,
) {
    val profile = store.profile
    val scope = rememberCoroutineScope()
    var i by remember { mutableStateOf(start.coerceIn(0, drills.size)) }
    val failures = remember { HashMap<String, Int>() }
    var okCount by remember { mutableStateOf(0) }

    if (drills.isEmpty() || i >= drills.size) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Drills done ✓", color = C.text, fontSize = 26.sp, fontWeight = FontWeight.ExtraBold)
            if (drills.isNotEmpty()) Text("$okCount of ${drills.size} right this time", color = C.gold, fontSize = 18.sp)
            BigButton("Finish block", C.green, Modifier.fillMaxWidth()) { onFinish() }
        }
        return
    }

    val d = drills[i]
    var phase by remember(i) { mutableStateOf("answer") } // answer, right, wrong
    var input by remember(i) { mutableStateOf("") }
    var feedback by remember(i) { mutableStateOf("") }
    var model by remember(i) { mutableStateOf("") }
    var checking by remember(i) { mutableStateOf(false) }
    var listening by remember(i) { mutableStateOf(false) }
    var chosen by remember(i) { mutableStateOf<String?>(null) }
    var repeated by remember(i) { mutableStateOf(false) }
    var mnemonic by remember(i) { mutableStateOf("") }
    val picked = remember(i) { mutableStateListOf<Int>() }
    val shuffled = remember(i) { d.words.shuffled() }

    val prompt = Grader.fill(d.prompt, profile)
    val answer = Grader.fill(if (d.type == "say_it") d.target else if (d.type == "dictation") d.answer.ifBlank { d.audio } else d.answer, profile)
    val accept = d.accept.map { Grader.fill(it, profile) }
    val french = when (d.type) {
        "translate_fr_en" -> prompt
        "mcq" -> ""
        "translate_en_fr", "fill", "say_it", "dictation", "order" -> answer
        else -> ""
    }.replace("___", "").trim()

    fun cardFront() = when (d.type) {
        "dictation" -> "Dictation: " + (d.audio.ifBlank { answer })
        "order" -> "Order: " + d.words.joinToString(" / ")
        "say_it" -> "Say: $answer"
        else -> prompt
    }

    fun recordWrong(text: String, cat: String) {
        store.addError(dayNo, cat, cardFront(), text, answer)
        store.ensureCard(cardFront(), answer, french.ifBlank { answer })
        store.addStat(dayNo, "total"); 
    }

    fun gotWrong(text: String, accentOnly: Boolean) {
        val n = (failures[d.id] ?: 0) + 1
        failures[d.id] = n
        val cat = Roasts.categoryFor(d, accentOnly)
        val roast = if (store.serious || n >= 3) "" else Roasts.forCategory(cat)
        feedback = roast
        model = answer
        phase = "wrong"
        recordWrong(text, cat)
        if (french.isNotBlank()) brain.speaker.speakFrench(french, true)
        if (n >= 3) scope.launch {
            try {
                val r = Api.tutor(JSONObject().put("kind", "leech").put("front", cardFront()).put("back", answer).put("lapses", n))
                mnemonic = r.optString("mnemonic") + (r.optString("example_fr").takeIf { it.isNotBlank() }?.let { "\n$it — ${r.optString("example_en")}" } ?: "")
            } catch (_: Exception) {}
        }
    }

    fun gotRight(res: Grader.Result?) {
        okCount++
        store.addStat(dayNo, "total"); store.addStat(dayNo, "ok"); store.xp += 5
        feedback = Roasts.praise(Roasts.categoryFor(d, false)) + (if (res?.accentOnly == true) " (Minor: check the accent.)" else "")
        phase = "right"
        if (french.isNotBlank() && d.type != "translate_fr_en") brain.speaker.speakFrench(french, false)
    }

    fun submit(textRaw: String) {
        if (phase == "right" || checking) return
        val text = if (d.type == "say_it") Grader.spokenNumbers(textRaw) else textRaw
        if (text.isBlank()) return
        if (phase == "wrong") { // the one repeat after a miss
            repeated = true
            val r = Grader.check(d.type, text, answer, accept, null)
            feedback = if (r.ok) "Good. That's the one." else "Still not it. Move on, it is saved to your cards."
            return
        }
        val res = if (d.type == "mcq") Grader.Result(Grader.norm(text) == Grader.norm(answer), false, 0.0)
        else Grader.check(d.type, text, answer, accept, null)
        if (res.ok) { gotRight(res); return }
        if (d.type == "translate_en_fr" || d.type == "translate_fr_en") {
            checking = true
            scope.launch {
                var ok = false
                var why = ""
                withTimeoutOrNull(7000) {
                    try {
                        val r = Api.tutor(JSONObject().put("kind", "grade").put("week", week).put("serious_mode", store.serious)
                            .put("drill", JSONObject().put("type", d.type).put("prompt", prompt).put("answer", answer).put("accepted", JSONArray(accept)))
                            .put("user_input", text).put("failures", failures[d.id] ?: 0))
                        ok = r.optBoolean("correct"); why = r.optString("feedback_en")
                    } catch (_: Exception) {}
                }
                checking = false
                if (ok) { gotRight(null); if (why.isNotBlank()) feedback = "Also valid. $why" } else gotWrong(text, false)
            }
        } else gotWrong(text, res.accentOnly)
    }

    fun mic() {
        if (listening) return
        brain.speaker.stop()
        listening = true
        brain.listener.start("fr", { input = it }, { heard ->
            listening = false
            if (heard.isBlank()) feedback = "I heard nothing. Try again, closer to the mic."
            else { input = heard; if (d.type == "say_it") submit(heard) }
        }, { listening = false; feedback = it })
    }

    fun next() {
        brain.stopAll()
        store.setDrillIndex(dayNo, block, i + 1)
        onIndex(i + 1)
        i++
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("${i + 1} / ${drills.size}", color = C.dim, fontSize = 14.sp)
        when (d.type) {
            "say_it" -> {
                Text("Say it out loud", color = C.dim, fontSize = 15.sp)
                Text(answer, color = C.text, fontSize = 26.sp, fontWeight = FontWeight.ExtraBold)
                if (d.hint.isNotBlank()) Text(Grader.fill(d.hint, profile), color = C.gold, fontSize = 15.sp)
            }
            "fill" -> { Text("Fill the blank", color = C.dim, fontSize = 15.sp); Text(prompt, color = C.text, fontSize = 26.sp, fontWeight = FontWeight.ExtraBold) }
            "translate_en_fr" -> { Text("Say or type it in French", color = C.dim, fontSize = 15.sp); Text(prompt, color = C.text, fontSize = 26.sp, fontWeight = FontWeight.ExtraBold) }
            "translate_fr_en" -> { Text("What does it mean in English?", color = C.dim, fontSize = 15.sp); Text(prompt, color = C.text, fontSize = 26.sp, fontWeight = FontWeight.ExtraBold) }
            "mcq" -> { Text(prompt, color = C.text, fontSize = 22.sp, fontWeight = FontWeight.Bold) }
            "order" -> Text("Put the words in order", color = C.dim, fontSize = 15.sp)
            "dictation" -> Text("Listen, then type what you hear (accents count)", color = C.dim, fontSize = 15.sp)
        }

        if (phase == "answer") {
            when (d.type) {
                "mcq" -> for (o in d.options) BigButton(o, C.card2, Modifier.fillMaxWidth()) { chosen = o; submit(o) }
                "order" -> {
                    Row(Modifier.fillMaxWidth().background(C.card, RoundedCornerShape(14.dp)).padding(12.dp)) {
                        Text(if (picked.isEmpty()) "tap the words below" else joinWords(picked.map { shuffled[it] }), color = C.text, fontSize = 20.sp)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        for ((k, w) in shuffled.withIndex()) if (k !in picked) Pill(w) { picked.add(k) }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Pill("Reset") { picked.clear() }
                        if (picked.size == shuffled.size) Pill("Check ✓", true) { submit(joinWords(picked.map { shuffled[it] })) }
                    }
                }
                else -> {
                    if (d.type == "dictation") Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        BigButton("🔊 Play", C.blue, Modifier.weight(1f)) { brain.speaker.speakFrench(d.audio.ifBlank { answer }, false) }
                        BigButton("🐢 Slow", C.card2, Modifier.weight(1f)) { brain.speaker.speakFrench(d.audio.ifBlank { answer }, true) }
                    }
                    if (d.type == "say_it") BigButton("🔊 Hear the model", C.card2, Modifier.fillMaxWidth()) { brain.speaker.speakFrench(answer, true) }
                    OutlinedTextField(input, { input = it }, modifier = Modifier.fillMaxWidth(), singleLine = false, placeholder = { Text(if (d.type == "say_it") "or type it" else "your answer") })
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (d.type in setOf("say_it", "translate_en_fr", "fill")) BigButton(if (listening) "Listening…" else "🎤 Speak", C.red, Modifier.weight(1f)) { mic() }
                        BigButton(if (checking) "Checking…" else "Check ✓", C.green, Modifier.weight(1f)) { submit(input) }
                    }
                    if (d.type == "say_it") Text("The phone recogniser can't truly judge your accent. If it passes, still compare with the model.", color = C.dim, fontSize = 13.sp)
                }
            }
        }

        if (feedback.isNotBlank() || phase != "answer") {
            Column(Modifier.fillMaxWidth().background(if (phase == "right") Color0(C.green) else C.card, RoundedCornerShape(16.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (phase == "wrong") {
                    Text("✗ Answer: $model", color = C.text, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    if (french.isNotBlank() && d.type == "translate_fr_en") Text("($french)", color = C.dim)
                }
                if (feedback.isNotBlank()) Text(feedback, color = C.text, fontSize = 17.sp)
                if (mnemonic.isNotBlank()) Text("💡 " + mnemonic, color = C.gold, fontSize = 16.sp)
            }
        }

        if (phase == "wrong" && d.type in PEOPLE_TYPES && !repeated) {
            Text("Now repeat it once:", color = C.dim)
            OutlinedTextField(input, { input = it }, modifier = Modifier.fillMaxWidth(), singleLine = true, placeholder = { Text("type or speak it again") })
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (d.type != "translate_fr_en") BigButton(if (listening) "Listening…" else "🎤 Speak", C.red, Modifier.weight(1f)) { mic() }
                BigButton("Check", C.green, Modifier.weight(1f)) { submit(input) }
            }
        }
        if (phase != "answer") BigButton(if (i == drills.size - 1) "Finish" else "Next →", C.blue, Modifier.fillMaxWidth()) { next() }
        Spacer(Modifier.height(24.dp))
    }
}

private fun Color0(c: androidx.compose.ui.graphics.Color) = c.copy(alpha = 0.25f)

// ---------- cards (spaced repetition) ----------

private class Entry(val key: String, val card: Card, val isNew: Boolean, var requeued: Boolean = false)

@Composable
fun AnkiBlock(cur: Curriculum, dayNo: Int, store: CoachStore, brain: Brain, onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    ActiveTimer(store, dayNo, "anki")
    val queue = remember {
        val cards = store.cards()
        val now = System.currentTimeMillis()
        val q = ArrayList<Entry>()
        cards.entries.filter { !it.value.suspended && it.value.due <= now }.sortedBy { it.value.due }.forEach { q.add(Entry(it.key, it.value, false)) }
        var cap = 15 - store.newToday()
        for (d in 1..dayNo) {
            if (cap <= 0) break
            for (v in cur.build(d, store.generated(d)).vocab) {
                if (cap <= 0) break
                val key = Grader.norm(v.fr + "|" + v.en)
                if (key !in cards) { q.add(Entry(key, Card(v.fr, v.en, v.fr), true)); cap-- }
            }
        }
        mutableStateListOf<Entry>().also { it.addAll(q) }
    }
    var idx by remember { mutableStateOf(0) }
    var revealed by remember { mutableStateOf(false) }
    var reviews by remember { mutableStateOf(0) }
    var good by remember { mutableStateOf(0) }
    var newSeen by remember { mutableStateOf(0) }
    var leechText by remember { mutableStateOf("") }

    if (idx >= queue.size) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(if (reviews == 0) "No cards due right now 🎉" else "Session done", color = C.text, fontSize = 26.sp, fontWeight = FontWeight.ExtraBold)
            if (reviews > 0) Text("$reviews cards · $newSeen new · ${if (reviews > 0) good * 100 / reviews else 0}% remembered", color = C.gold, fontSize = 18.sp)
            Text("Cards come back when they are due, so open this block every day.", color = C.dim, fontSize = 14.sp, textAlign = TextAlign.Center)
            BigButton("Mark block done", C.green, Modifier.fillMaxWidth()) { onDone() }
        }
        return
    }
    val e = queue[idx]
    LaunchedEffect(idx) { revealed = false; if (e.card.fr.isNotBlank()) brain.speaker.speakFrench(e.card.fr, false) }

    fun grade(g: Int) {
        val m = store.cards()
        val c = m[e.key] ?: e.card
        val leech = Srs.apply(c, g)
        m[e.key] = c
        store.saveCards(m)
        reviews++
        if (g >= 2) good++
        if (e.isNew) { newSeen++; store.addNewToday(1) }
        store.addStat(dayNo, "cards")
        if (g == 0 && !e.requeued) { e.requeued = true; queue.add(Entry(e.key, c, false, true)) }
        if (leech) scope.launch {
            try {
                val r = Api.tutor(JSONObject().put("kind", "leech").put("front", c.front).put("back", c.back).put("lapses", c.lapses))
                leechText = "Leech: ${c.front} = ${c.back}\n💡 ${r.optString("mnemonic")}\n${r.optString("example_fr")} — ${r.optString("example_en")}"
            } catch (_: Exception) { leechText = "Leech: ${c.front} = ${c.back}. You keep missing it; I paused it. Make your own mnemonic." }
        }
        idx++
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("${idx + 1} / ${queue.size}" + if (e.isNew) "  ·  NEW" else "", color = C.dim, fontSize = 14.sp)
        Column(Modifier.fillMaxWidth().background(C.card, RoundedCornerShape(22.dp)).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(e.card.front, color = C.text, fontSize = 32.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center)
            if (revealed) Text(e.card.back, color = C.gold, fontSize = 24.sp, textAlign = TextAlign.Center)
        }
        if (e.card.fr.isNotBlank()) Pill("🔊 Hear it") { brain.speaker.speakFrench(e.card.fr, true) }
        if (!revealed) BigButton("Show answer", C.blue, Modifier.fillMaxWidth()) { revealed = true; if (e.card.fr.isNotBlank()) brain.speaker.speakFrench(e.card.fr, false) }
        else Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            BigButton("Again", C.red, Modifier.weight(1f)) { grade(0) }
            BigButton("Hard", C.card2, Modifier.weight(1f)) { grade(1) }
            BigButton("Good", C.green, Modifier.weight(1f)) { grade(2) }
            BigButton("Easy", C.blue, Modifier.weight(1f)) { grade(3) }
        }
        if (leechText.isNotBlank()) Text(leechText, color = C.gold, fontSize = 15.sp, modifier = Modifier.background(C.card, RoundedCornerShape(14.dp)).padding(12.dp))
    }
}

// ---------- lesson ----------

@Composable
fun LessonBlock(day: DayData, dayNo: Int, store: CoachStore, brain: Brain, onDone: () -> Unit) {
    val ctx = LocalContext.current
    ActiveTimer(store, dayNo, "lesson")
    var phase by remember { mutableStateOf(if (store.drillIndex(dayNo, "lesson") > 0) "drills" else "steps") }
    var s by remember { mutableStateOf(0) }
    val drills = remember(day) { buildDrills(day, store) }

    if (phase == "drills") {
        DrillRunner(drills, store.drillIndex(dayNo, "lesson"), dayNo, day.week, store, brain, "lesson", {}, onDone)
        return
    }
    val steps = day.steps.ifEmpty { listOf("No lesson text for this day. Go straight to the drills.") }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Lesson ${s + 1} of ${steps.size}", color = C.dim, fontSize = 14.sp)
        Text(day.theme, color = C.text, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold)
        if (day.grammar.isNotBlank()) Text("Grammar: " + day.grammar, color = C.gold, fontSize = 15.sp)
        Text(steps[s], color = C.text, fontSize = 19.sp, lineHeight = 27.sp)
        if (s == steps.size - 1) {
            Text("Words for today (tap to hear):", color = C.dim, fontSize = 14.sp)
            for (v in day.vocab) {
                Row(Modifier.fillMaxWidth().background(C.card, RoundedCornerShape(14.dp)).padding(12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    Column(Modifier.weight(1f)) {
                        Text(v.fr, color = C.text, fontSize = 19.sp, fontWeight = FontWeight.Bold)
                        Text(v.en + (if (v.note.isNotBlank()) " · " + v.note else ""), color = C.dim, fontSize = 14.sp)
                    }
                    Text("🔊", fontSize = 22.sp, modifier = Modifier.padding(4.dp).clickableNoRipple { brain.speaker.speakFrench(v.fr.substringBefore(" / "), true) })
                }
            }
            for ((label, url) in videosFor(day)) Pill(label) { openUrl(ctx, url) }
            for (u in day.links.flatMap { urlsIn(it) }) Pill("🔗 " + u.removePrefix("https://").substringBefore("/")) { openUrl(ctx, u) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (s > 0) BigButton("Back", C.card2, Modifier.weight(1f)) { s-- }
            if (s < steps.size - 1) BigButton("Next", C.blue, Modifier.weight(1f)) { s++ } else BigButton("Start drills →", C.red, Modifier.weight(1f)) { phase = "drills" }
        }
        Spacer(Modifier.height(24.dp))
    }
}

private fun Modifier.clickableNoRipple(onClick: () -> Unit): Modifier = this.then(Modifier.clickable(onClick = onClick))

// ---------- listening ----------

@Composable
fun ListeningBlock(day: DayData, dayNo: Int, store: CoachStore, brain: Brain, onDone: () -> Unit) {
    val ctx = LocalContext.current
    ActiveTimer(store, dayNo, "listening")
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val obs = LifecycleEventObserver { _, ev ->
            if (ev == Lifecycle.Event.ON_RESUME) {
                val at = store.linkOpenedAt
                if (at > 0) {
                    val secs = ((System.currentTimeMillis() - at) / 1000).toInt().coerceIn(0, 3600)
                    store.addSeconds(dayNo, "listening", secs)
                    store.linkOpenedAt = 0
                }
            }
        }
        owner.lifecycle.addObserver(obs)
        onDispose { owner.lifecycle.removeObserver(obs) }
    }
    fun open(url: String) { store.linkOpenedAt = System.currentTimeMillis(); openUrl(ctx, url) }
    var dictating by remember { mutableStateOf(false) }
    val dictation = remember(day) { day.dictation.mapIndexed { i, p -> Drill("dict$i", "dictation", audio = p.first, answer = p.second) } }

    if (dictating) { DrillRunner(dictation, 0, dayNo, day.week, store, brain, "listening", {}, onDone); return }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Listening, 45 min", color = C.text, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold)
        Text("Open a source, listen, come back. The time you spend away is logged as listening.", color = C.dim, fontSize = 14.sp)
        for (t in day.listenText) {
            Text(t, color = C.text, fontSize = 16.sp)
            for (u in urlsIn(t)) Pill("▶ Open: " + u.removePrefix("https://").substringBefore("/")) { open(u) }
            for ((label, url) in planLinks(t)) Pill("▶ $label") { open(url) }
        }
        Text("Videos for today:", color = C.dim, fontSize = 14.sp)
        for ((label, url) in videosFor(day)) Pill(label) { open(url) }
        Text("These are YouTube searches and public sites. Links were not click-tested; tell me if one is dead.", color = C.dim, fontSize = 12.sp)
        Spacer(Modifier.height(8.dp))
        if (dictation.isNotEmpty()) BigButton("✍️ Dictation drills (${dictation.size})", C.red, Modifier.fillMaxWidth()) { dictating = true }
        BigButton("Mark block done", C.green, Modifier.fillMaxWidth()) { onDone() }
        Spacer(Modifier.height(24.dp))
    }
}

// ---------- speaking ----------

private class Msg(val who: String, val text: String, val en: String = "")

@Composable
fun SpeakingBlock(day: DayData, dayNo: Int, cur: Curriculum, store: CoachStore, brain: Brain, onDone: () -> Unit) {
    ActiveTimer(store, dayNo, "speaking")
    var mode by remember { mutableStateOf("menu") }
    val shadow = remember(day) {
        day.vocab.map { it.fr.substringBefore(" / ").replace("(f)", "").replace("(m)", "").trim() }.filter { it.isNotBlank() && !it.contains("...") }
            .take(10).mapIndexed { i, w -> Drill("sh$i", "say_it", target = w) }
    }
    when (mode) {
        "shadow" -> DrillRunner(shadow, 0, dayNo, day.week, store, brain, "speaking", {}, onDone)
        "roleplay" -> Roleplay(day, dayNo, cur, store, brain, onDone)
        else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Speaking, 30 min", color = C.text, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold)
            for (p in day.speaking) Text("• " + p, color = C.text, fontSize = 16.sp)
            Spacer(Modifier.height(6.dp))
            if (shadow.isNotEmpty()) BigButton("🗣 Shadow today's words", C.blue, Modifier.fillMaxWidth()) { mode = "shadow" }
            if (dayNo >= 3) BigButton("🎭 Roleplay with Madame Roast", C.red, Modifier.fillMaxWidth()) { mode = "roleplay" }
            else Text("Roleplay unlocks on Day 3, once you have words to play with.", color = C.dim, fontSize = 14.sp)
            Text("Audio recordings for comparing Day 1 with Day 7 are not in this version yet.", color = C.dim, fontSize = 12.sp)
            BigButton("Mark block done", C.green, Modifier.fillMaxWidth()) { onDone() }
        }
    }
}

@Composable
fun Roleplay(day: DayData, dayNo: Int, cur: Curriculum, store: CoachStore, brain: Brain, onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    val turns = remember { mutableStateListOf<Msg>() }
    var state by remember { mutableStateOf("idle") }
    var error by remember { mutableStateOf("") }
    var showEn by remember { mutableStateOf(day.week <= 2) }
    var typed by remember { mutableStateOf("") }
    var finished by remember { mutableStateOf(false) }
    val scenario = remember { "Theme: ${day.theme}. Task: ${day.speaking.firstOrNull() ?: ""}. A short, realistic scene (introductions, a pharmacy counter, a shop...) that only needs words taught so far." }
    val taught = remember {
        (1..dayNo).flatMap { d -> cur.build(d, store.generated(d)).vocab.map { it.fr } }.take(150)
    }

    fun turn(msg: String) {
        brain.stopAll()
        state = "thinking"; error = ""
        scope.launch {
            try {
                val hist = JSONArray(); turns.takeLast(10).forEach { hist.put(JSONObject().put("role", if (it.who == "madame") "assistant" else "user").put("content", it.text)) }
                val r = Api.tutor(JSONObject().put("kind", "roleplay").put("week", day.week).put("serious_mode", store.serious)
                    .put("scenario", scenario).put("taught", JSONArray(taught)).put("history", hist).put("user_input", msg))
                val fr = r.optString("fr")
                if (fr.isBlank()) { error = "No reply. Try again."; state = "idle"; return@launch }
                val fix = r.optJSONObject("fix")
                val roast = if (store.serious) "" else r.optString("roast")
                turns.add(Msg("madame", fr, r.optString("en")))
                if (fix != null && fix.optString("better").isNotBlank()) {
                    val line = "✎ ${fix.optString("said")} → ${fix.optString("better")} (${fix.optString("why")})" + if (roast.isNotBlank()) "\n$roast" else ""
                    turns.add(Msg("fix", line))
                    store.addError(dayNo, "other", fix.optString("said"), fix.optString("said"), fix.optString("better"))
                    store.ensureCard("Fix: " + fix.optString("said"), fix.optString("better"), fix.optString("better"))
                }
                if (r.optBoolean("finished")) finished = true
                state = "speaking"
                brain.speaker.speakFrench(fr, false) { state = "idle" }
            } catch (e: Exception) {
                error = e.message ?: "Madame Roast lost the line."; state = "idle"
            }
        }
    }

    fun listen() {
        if (state != "idle") return
        state = "listening"
        brain.listener.start("fr", {}, { heard -> if (heard.isBlank()) state = "idle" else { turns.add(Msg("you", heard)); turn(heard) } }, { state = "idle"; error = it })
    }

    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("🎭 " + day.theme, color = C.text, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState(), reverseScrolling = true), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (turns.isEmpty() && state == "idle") Text("Madame Roast plays the other person. Speak French, even badly. She fixes one thing at a time.", color = C.dim)
            for (t in turns) {
                val mine = t.who == "you"
                Column(Modifier.fillMaxWidth().padding(start = if (mine) 40.dp else 0.dp, end = if (mine) 0.dp else 40.dp)
                    .background(if (mine) C.blue else if (t.who == "fix") C.card2 else C.card, RoundedCornerShape(16.dp)).padding(12.dp)) {
                    Text(t.text, color = C.text, fontSize = if (t.who == "fix") 15.sp else 19.sp, fontWeight = if (t.who == "fix") FontWeight.Normal else FontWeight.SemiBold)
                    if (t.who == "madame" && showEn && t.en.isNotBlank()) Text(t.en, color = C.dim, fontSize = 15.sp)
                }
            }
            if (state == "thinking") Text("Madame Roast is thinking…", color = C.dim)
            if (state == "listening") Text("🎤 Parle…", color = C.gold, fontSize = 17.sp)
        }
        if (error.isNotBlank()) Text(error, color = C.red, fontSize = 14.sp)
        if (turns.isEmpty() && state == "idle") BigButton("Start the scene", C.red, Modifier.fillMaxWidth()) { turn("[START]") }
        else if (finished) BigButton("Scene over — finish block", C.green, Modifier.fillMaxWidth()) { onDone() }
        else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                Pill(if (showEn) "EN on" else "EN off", showEn) { showEn = !showEn }
                Pill("🎤 Speak") { listen() }
                Pill("End") { onDone() }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                OutlinedTextField(typed, { typed = it }, modifier = Modifier.weight(1f), singleLine = true, placeholder = { Text("or type in French") })
                Pill("Send") { if (typed.isNotBlank() && state == "idle") { val t = typed; typed = ""; turns.add(Msg("you", t)); turn(t) } }
            }
        }
    }
}

// ---------- writing ----------

@Composable
fun WritingBlock(day: DayData, dayNo: Int, store: CoachStore, onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    ActiveTimer(store, dayNo, "writing")
    var text by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<JSONObject?>(null) }
    val must = remember(day) { day.raw.optJSONObject("writing")?.optJSONArray("must_use") ?: JSONArray() }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Writing, 15 min", color = C.text, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold)
        Text(day.writingPrompt, color = C.text, fontSize = 18.sp)
        if (must.length() > 0) Text("Must use: " + must.strings().joinToString(", "), color = C.gold, fontSize = 14.sp)
        Text("At least ${day.writingMin} sentences. Accents count.", color = C.dim, fontSize = 14.sp)
        OutlinedTextField(text, { text = it }, modifier = Modifier.fillMaxWidth().height(180.dp), placeholder = { Text("écris ici…") })
        if (error.isNotBlank()) Text(error, color = C.red)
        BigButton(if (busy) "Madame is reading…" else "Get corrections", C.red, Modifier.fillMaxWidth()) {
            if (!busy && text.isNotBlank()) {
                busy = true; error = ""
                scope.launch {
                    try {
                        val r = Api.tutor(JSONObject().put("kind", "writing").put("week", day.week).put("serious_mode", store.serious)
                            .put("prompt", day.writingPrompt).put("must_use", must).put("text", text))
                        result = r
                        r.optJSONArray("corrections")?.objs()?.forEach { c ->
                            val fix = c.optString("fix"); val orig = c.optString("original")
                            if (fix.isNotBlank() && orig.isNotBlank() && fix.length < 120) {
                                store.addError(dayNo, c.optString("category").ifBlank { "other" }, orig, orig, fix)
                                store.ensureCard("Fix: $orig", fix, fix)
                            }
                        }
                    } catch (e: Exception) { error = e.message ?: "Could not reach the tutor." }
                    busy = false
                }
            }
        }
        result?.let { r ->
            val cs = r.optJSONArray("corrections")?.objs() ?: emptyList()
            if (cs.isEmpty()) Text("No errors found. Suspicious, but fine.", color = C.green, fontSize = 17.sp)
            for (c in cs) Column(Modifier.fillMaxWidth().background(C.card, RoundedCornerShape(14.dp)).padding(12.dp)) {
                Text(c.optString("original"), color = C.red, fontSize = 16.sp)
                Text("→ " + c.optString("fix"), color = C.green, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                Text(c.optString("reason"), color = C.dim, fontSize = 14.sp)
            }
            r.optString("corrected_text").takeIf { it.isNotBlank() }?.let { Text("Corrected:\n$it", color = C.text, fontSize = 16.sp) }
            val roast = if (store.serious) "" else r.optString("roast")
            if (roast.isNotBlank()) Text(roast, color = C.gold, fontSize = 16.sp)
            r.optString("praise_en").takeIf { it.isNotBlank() }?.let { Text(it, color = C.dim, fontSize = 15.sp) }
            Text("Every error became a card in your cards block.", color = C.dim, fontSize = 13.sp)
            BigButton("Mark block done", C.green, Modifier.fillMaxWidth()) { onDone() }
        }
        Spacer(Modifier.height(24.dp))
    }
}
