package app.seefar.assistant

import android.content.Context
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.text.Normalizer

// ---------- course data (same lessons as the website, fetched from the server) ----------

data class FCard(val id: String, val fr: String, val en: String, val emoji: String, val say: String, val tip: String)
data class FEx(val fr: String, val en: String, val say: String)
data class FStep(val title: String, val body: String, val ex: List<FEx>)
data class FGoal(val id: String, val label: String, val model: String)
data class FUnit(
    val id: String, val title: String, val titleEn: String, val emoji: String, val can: String,
    val lesson: List<FStep>, val cards: List<FCard>, val role: String, val setting: String, val opener: String, val goals: List<FGoal>,
)

private fun JSONArray.objs() = (0 until length()).map { getJSONObject(it) }

fun parseCourse(a: JSONArray): List<FUnit> = a.objs().map { u ->
    val m = u.getJSONObject("mission")
    FUnit(
        u.getString("id"), u.getString("title"), u.getString("titleEn"), u.getString("emoji"), u.getString("can"),
        u.getJSONArray("lesson").objs().map { s ->
            FStep(s.getString("title"), s.getString("body"), s.getJSONArray("examples").objs().map { FEx(it.getString("fr"), it.getString("en"), it.optString("say")) })
        },
        u.getJSONArray("cards").objs().map { FCard(it.getString("id"), it.getString("fr"), it.getString("en"), it.optString("emoji"), it.optString("say"), it.optString("tip")) },
        m.getString("role"), m.getString("setting"), m.getString("opener"),
        m.getJSONArray("goals").objs().map { FGoal(it.getString("id"), it.getString("label"), it.optString("model")) }
    )
}

// ---------- scoring and roasts ----------

private fun plain(s: String): String =
    Normalizer.normalize(s.lowercase(), Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "")
        .replace(Regex("[’']"), " ").replace(Regex("[^a-z0-9 ]+"), " ").replace(Regex("\\s+"), " ").trim()

private fun lev(a: String, b: String): Int {
    var prev = IntArray(b.length + 1) { it }
    for (i in 1..a.length) {
        val cur = IntArray(b.length + 1)
        cur[0] = i
        for (j in 1..b.length) cur[j] = minOf(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + if (a[i - 1] == b[j - 1]) 0 else 1)
        prev = cur
    }
    return prev[b.length]
}

fun similarity(heard: String, target: String): Double {
    val a = plain(heard); val b = plain(target)
    if (a.isEmpty() || b.isEmpty()) return 0.0
    return 1.0 - lev(a, b).toDouble() / maxOf(a.length, b.length)
}

private val ROASTS = mapOf(
    "gentle" to listOf(
        listOf("Très bien! That was actually good.", "Parfait. I almost have nothing to say."),
        listOf("Close! Your accent just needs a little polish.", "Nearly there. Say it once more for me."),
        listOf("Hmm. That was brave. Try {t} again.", "Good effort. The word is {t}. Slower this time."),
        listOf("That was creative, but it was not French. It's {t}.", "Let's reset. Listen, then say {t}.")
    ),
    "spicy" to listOf(
        listOf("Wait, that was correct? Who helped you?", "Okay, okay. Don't let it go to your head. Très bien.", "Parfait. Screenshot it, it won't happen often."),
        listOf("Almost. You said it like a tourist who read the menu twice.", "Close, but your R is still hiding in your pocket. {t}.", "Seventy percent of a croissant is still a crumb."),
        listOf("That was a bold choice. Wrong, but bold. It's {t}.", "I have heard pigeons in Paris with better pronunciation. {t}. Again.", "You butchered it, and I say that with love. {t}."),
        listOf("Mon Dieu. Was that French or a sneeze? It's {t}.", "I've seen baguettes with better grammar. {t}. Again.", "That sound will haunt me. Try {t}, and breathe first.")
    ),
    "brutal" to listOf(
        listOf("...Fine. Correct. Do not expect a medal.", "Correct. Suspicious. Who is feeding you answers?"),
        listOf("Almost is how people describe a collapsed soufflé. {t}.", "Your accent is a crime scene, but the victim survived. {t}."),
        listOf("That was an assault on the French language. The word is {t}. Again.", "My ears filed a complaint. {t}. Again, and with feeling."),
        listOf("Honestly, a vending machine speaks better French. {t}. Again.", "Zero. A glorious, perfectly round zero. {t}. Again.")
    )
)

fun roast(score: Double, intensity: String, target: String): String {
    val b = if (score >= 0.92) 0 else if (score >= 0.75) 1 else if (score >= 0.5) 2 else 3
    return (ROASTS[intensity] ?: ROASTS["spicy"]!!)[b].random().replace("{t}", target)
}

// ---------- progress ----------

private class Prog(ctx: Context) {
    private val p = ctx.getSharedPreferences("seefar_fr", Context.MODE_PRIVATE)
    var xp: Int get() = p.getInt("xp", 0); set(v) = p.edit().putInt("xp", v).apply()
    var intensity: String get() = p.getString("intensity", "spicy") ?: "spicy"; set(v) = p.edit().putString("intensity", v).apply()
    fun mission(id: String) = p.getFloat("m_$id", 0f)
    fun setMission(id: String, v: Float) { if (v > mission(id)) p.edit().putFloat("m_$id", v).apply() }
    fun done(id: String) = p.getBoolean("d_$id", false)
    fun setDone(id: String) = p.edit().putBoolean("d_$id", true).apply()
}

private sealed class View {
    object Path : View()
    class Menu(val u: FUnit) : View()
    class Lesson(val u: FUnit) : View()
    class Words(val u: FUnit) : View()
    class Quiz(val u: FUnit) : View()
    class Call(val u: FUnit) : View()
}

@Composable
fun FrenchScreen(brain: Brain, onExit: () -> Unit) {
    val ctx = LocalContext.current
    val prog = remember { Prog(ctx) }
    var course by remember { mutableStateOf<List<FUnit>?>(null) }
    var err by remember { mutableStateOf("") }
    var view by remember { mutableStateOf<View>(View.Path) }
    var xp by remember { mutableStateOf(prog.xp) }
    var intensity by remember { mutableStateOf(prog.intensity) }
    var tick by remember { mutableStateOf(0) }

    LaunchedEffect(Unit) {
        try { course = parseCourse(Api.course()) } catch (e: Exception) { err = "Could not load the course. Check your internet." }
    }
    fun back() {
        brain.stopAll()
        view = when (val v = view) {
            is View.Path -> { onExit(); View.Path }
            is View.Menu -> View.Path
            is View.Lesson -> View.Menu(v.u)
            is View.Words -> View.Menu(v.u)
            is View.Quiz -> View.Menu(v.u)
            is View.Call -> View.Menu(v.u)
        }
    }
    fun addXp(n: Int) { prog.xp += n; xp = prog.xp }

    Column(Modifier.fillMaxSize().background(C.bg).padding(horizontal = 16.dp)) {
        TopBar(
            title = when (val v = view) { is View.Path -> "🇫🇷 French with Pierre"; is View.Menu -> v.u.emoji + " " + v.u.title; is View.Lesson -> "Class"; is View.Words -> "Words"; is View.Quiz -> "Practice"; is View.Call -> "📞 Call" },
            onBack = { back() },
            right = { Text("⭐ $xp", color = C.gold, fontWeight = FontWeight.Bold, fontSize = 18.sp) }
        )
        val units = course
        if (units == null) {
            Text(if (err.isEmpty()) "Loading your lessons…" else err, color = C.dim, fontSize = 16.sp, modifier = Modifier.padding(16.dp))
        } else when (val v = view) {
            is View.Path -> PathView(units, prog, intensity, tick, { intensity = it; prog.intensity = it }) { view = View.Menu(it) }
            is View.Menu -> MenuView(v.u, prog, tick) { view = it }
            is View.Lesson -> LessonView(v.u, brain) { prog.setDone("l_" + v.u.id); addXp(10); tick++; back() }
            is View.Words -> WordsView(v.u, brain, intensity, { addXp(it) }) { prog.setDone("w_" + v.u.id); tick++; back() }
            is View.Quiz -> QuizView(v.u, units, brain, intensity, { addXp(it) }) { prog.setDone("q_" + v.u.id); tick++; back() }
            is View.Call -> CallView(v.u, brain, prog, intensity, { addXp(it) }) { tick++; back() }
        }
    }
}

@Composable
private fun PathView(units: List<FUnit>, prog: Prog, intensity: String, tick: Int, setIntensity: (String) -> Unit, open: (FUnit) -> Unit) {
    Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Starting from zero. Each level: class → words → practice → a phone call with Pierre.", color = C.dim, fontSize = 15.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Pierre is:", color = C.dim, modifier = Modifier.padding(top = 10.dp))
            for (i in listOf("gentle", "spicy", "brutal")) Pill(i.replaceFirstChar { it.uppercase() }, i == intensity) { setIntensity(i) }
        }
        for ((n, u) in units.withIndex()) {
            val steps = listOf("l_", "w_", "q_").count { prog.done(it + u.id) } + (if (prog.mission(u.id) >= 0.75f) 1 else 0)
            Row(
                Modifier.fillMaxWidth().background(C.card, RoundedCornerShape(20.dp)).clickable { open(u) }.padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Text(u.emoji, fontSize = 34.sp)
                Column(Modifier.weight(1f)) {
                    Text("${n + 1}. ${u.title}", color = C.text, fontSize = 19.sp, fontWeight = FontWeight.Bold)
                    Text(u.titleEn, color = C.dim, fontSize = 14.sp)
                    Text("You will: " + u.can, color = C.dim, fontSize = 13.sp)
                }
                Text(if (steps == 4) "✅" else "$steps/4", color = if (steps == 4) C.green else C.gold, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 6.dp))
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun MenuView(u: FUnit, prog: Prog, tick: Int, go: (View) -> Unit) {
    Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(u.titleEn, color = C.text, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        Text("After this level you can: " + u.can, color = C.dim, fontSize = 15.sp)
        fun mark(k: String) = if (prog.done(k + u.id)) "  ✅" else ""
        BigButton("1  📖 Class (learn the rule)${mark("l_")}", C.blue, Modifier.fillMaxWidth()) { go(View.Lesson(u)) }
        BigButton("2  🗣 Words (hear it, say it)${mark("w_")}", C.blue, Modifier.fillMaxWidth()) { go(View.Words(u)) }
        BigButton("3  🎯 Practice (quiz)${mark("q_")}", C.blue, Modifier.fillMaxWidth()) { go(View.Quiz(u)) }
        BigButton("4  📞 Call Pierre: " + u.role + (if (prog.mission(u.id) >= 0.75f) "  ✅" else ""), C.red, Modifier.fillMaxWidth()) { go(View.Call(u)) }
        Text("Mission: " + u.setting, color = C.dim, fontSize = 14.sp)
    }
}

@Composable
private fun LessonView(u: FUnit, brain: Brain, finish: () -> Unit) {
    var i by remember { mutableStateOf(0) }
    val s = u.lesson[i]
    Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Step ${i + 1} of ${u.lesson.size}", color = C.dim, fontSize = 14.sp)
        Text(s.title, color = C.text, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold)
        Text(s.body, color = C.text, fontSize = 18.sp, lineHeight = 26.sp)
        for (e in s.ex) {
            Row(
                Modifier.fillMaxWidth().background(C.card, RoundedCornerShape(16.dp))
                    .clickable { brain.speaker.speak(e.fr, "frslow", "fr") }.padding(14.dp),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column(Modifier.weight(1f)) {
                    Text(e.fr, color = C.text, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                    Text(e.en, color = C.dim, fontSize = 15.sp)
                    if (e.say.isNotBlank()) Text("say: " + e.say, color = C.gold, fontSize = 15.sp)
                }
                Text("🔊", fontSize = 26.sp)
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (i > 0) BigButton("Back", C.card2, Modifier.weight(1f)) { i-- }
            if (i < u.lesson.size - 1) BigButton("Next", C.blue, Modifier.weight(1f)) { i++ } else BigButton("Done ✓ +10", C.green, Modifier.weight(1f)) { finish() }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun WordsView(u: FUnit, brain: Brain, intensity: String, addXp: (Int) -> Unit, finish: () -> Unit) {
    var i by remember { mutableStateOf(0) }
    var feedback by remember { mutableStateOf("") }
    var heardText by remember { mutableStateOf("") }
    var listening by remember { mutableStateOf(false) }
    val c = u.cards[i]
    fun hear() = brain.speaker.speak(c.fr, "frslow", "fr")
    LaunchedEffect(i) { feedback = ""; heardText = "" }
    Column(Modifier.verticalScroll(rememberScrollState()), horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("${i + 1} / ${u.cards.size}", color = C.dim, fontSize = 14.sp)
        Text(c.emoji, fontSize = 96.sp)
        Text(c.fr, color = C.text, fontSize = 38.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center)
        Text(c.en, color = C.dim, fontSize = 20.sp)
        Text("say: " + c.say, color = C.gold, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
        if (c.tip.isNotBlank()) Text("💡 " + c.tip, color = C.dim, fontSize = 15.sp, textAlign = TextAlign.Center)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
            BigButton("🔊 Hear it", C.blue, Modifier.weight(1f)) { hear() }
            BigButton(if (listening) "Listening…" else "🎤 Say it", C.red, Modifier.weight(1f)) {
                if (!listening) {
                    brain.speaker.stop()
                    listening = true
                    feedback = ""
                    brain.listener.start("fr", { heardText = it }, { heard ->
                        listening = false
                        if (heard.isBlank()) feedback = "I heard nothing. Louder, s'il vous plaît."
                        else {
                            heardText = heard
                            val score = similarity(heard, c.fr)
                            feedback = roast(score, intensity, c.fr)
                            if (score >= 0.75) addXp(5)
                            brain.speaker.speak(feedback, "pierre", "en")
                        }
                    }, { listening = false; feedback = it })
                }
            }
        }
        if (heardText.isNotBlank()) Text("I heard: \"$heardText\"", color = C.dim, fontSize = 15.sp)
        if (feedback.isNotBlank()) Text(feedback, color = C.text, fontSize = 18.sp, textAlign = TextAlign.Center, modifier = Modifier.background(C.card, RoundedCornerShape(16.dp)).padding(14.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
            if (i > 0) BigButton("Back", C.card2, Modifier.weight(1f)) { brain.stopAll(); i-- }
            if (i < u.cards.size - 1) BigButton("Next", C.blue, Modifier.weight(1f)) { brain.stopAll(); i++ } else BigButton("Done ✓", C.green, Modifier.weight(1f)) { brain.stopAll(); addXp(10); finish() }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun QuizView(u: FUnit, all: List<FUnit>, brain: Brain, intensity: String, addXp: (Int) -> Unit, finish: () -> Unit) {
    val deck = remember { all.flatMap { it.cards } }
    val questions = remember { u.cards.shuffled().take(8).map { q -> q to (deck.filter { it.id != q.id && it.fr != q.fr }.shuffled().take(3) + q).shuffled() } }
    var i by remember { mutableStateOf(0) }
    var picked by remember { mutableStateOf<String?>(null) }
    var right by remember { mutableStateOf(0) }
    if (i >= questions.size) {
        val score = right.toDouble() / questions.size
        Column(verticalArrangement = Arrangement.spacedBy(14.dp), horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
            Text("$right / ${questions.size}", color = C.text, fontSize = 56.sp, fontWeight = FontWeight.ExtraBold)
            val r = remember { roast(score, intensity, "the answers") }
            Text(r, color = C.text, fontSize = 20.sp, textAlign = TextAlign.Center)
            BigButton("Finish ✓", C.green, Modifier.fillMaxWidth()) { addXp(right * 5); finish() }
        }
        return
    }
    val (q, opts) = questions[i]
    Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.verticalScroll(rememberScrollState())) {
        Text("Question ${i + 1} of ${questions.size}", color = C.dim)
        Text(q.emoji, fontSize = 72.sp, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
        Text("How do you say \"${q.en}\" in French?", color = C.text, fontSize = 22.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        for (o in opts) {
            val state = picked
            val col = when {
                state == null -> C.card2
                o.id == q.id -> C.green
                o.id == state -> C.red
                else -> C.card
            }
            BigButton(o.fr, col, Modifier.fillMaxWidth()) {
                if (picked == null) {
                    picked = o.id
                    if (o.id == q.id) right++
                    brain.speaker.speak(q.fr, "frslow", "fr")
                }
            }
        }
        if (picked != null) {
            val ok = picked == q.id
            Text(if (ok) "✓ Yes! ${q.fr} (${q.say})" else "✗ It's ${q.fr} (${q.say}). " + roast(0.3, intensity, q.fr), color = C.text, fontSize = 17.sp)
            BigButton("Next", C.blue, Modifier.fillMaxWidth()) { brain.stopAll(); picked = null; i++ }
        }
        Spacer(Modifier.height(24.dp))
    }
}

private class Turn(val who: String, val text: String, val en: String = "")

@Composable
private fun CallView(u: FUnit, brain: Brain, prog: Prog, intensity: String, addXp: (Int) -> Unit, finish: () -> Unit) {
    val scope = rememberCoroutineScope()
    val turns = remember { mutableStateListOf<Turn>() }
    val done = remember { mutableStateListOf<String>() }
    val fixes = remember { mutableStateListOf<String>() }
    var state by remember { mutableStateOf("idle") } // idle, thinking, speaking, listening, over
    var error by remember { mutableStateOf("") }
    var hint by remember { mutableStateOf(false) }
    var showEn by remember { mutableStateOf(true) }
    var typed by remember { mutableStateOf("") }
    val help = prog.mission(u.id) < 0.75f

    fun finishCall() {
        brain.stopAll()
        prog.setMission(u.id, done.size.toFloat() / u.goals.size)
        addXp(20 * done.size)
        state = "over"
    }

    fun turn(msg: String) {
        brain.stopAll()
        state = "thinking"
        error = ""
        scope.launch {
            try {
                val ctxJson = JSONObject().put("nowIso", java.time.ZonedDateTime.now().toOffsetDateTime().toString()).put("timeZone", java.time.ZoneId.systemDefault().id)
                val extra = JSONObject().put("tutor", "call").put("unit", u.id).put("help", help).put("intensity", intensity).put("mode", "general").put("kid", false).put("lang", "en")
                val hist = turns.map { (if (it.who == "pierre") "assistant" else "user") to it.text }
                val reply = Api.chat(msg, null, ctxJson, hist, extra)
                val c = reply.call
                if (c == null) { error = "Pierre hung up. Try again."; state = "idle"; return@launch }
                val valid = u.goals.map { it.id }.toSet()
                c.goalsDone.filter { it in valid && it !in done }.forEach { done.add(it) }
                val finished = c.finished || done.size == u.goals.size || turns.size >= 24
                var shownFlag = false
                fun show() {
                    if (shownFlag) return
                    shownFlag = true
                    turns.add(Turn("pierre", c.fr, c.en))
                    if (c.fixBetter.isNotBlank()) fixes.add("${c.fixSaid} → ${c.fixBetter} (${c.fixWhy})")
                    state = "speaking"
                }
                fun afterSpeech() {
                    if (finished) { finishCall(); return }
                    state = "listening"
                    brain.listener.start("fr", {}, { heard ->
                        if (heard.isBlank()) state = "idle"
                        else { turns.add(Turn("you", heard)); hint = false; turn(heard) }
                    }, { state = "idle"; error = it })
                }
                brain.speaker.speak(c.fr, "pierre", "fr", onStart = { show() }, onDone = {
                    if (c.fixBetter.isNotBlank()) brain.speaker.speak("${c.fixWhy}. Say: ${c.fixBetter}", "pierre", "en", onDone = { afterSpeech() })
                    else afterSpeech()
                })
            } catch (e: ApiException) {
                error = e.message ?: "Pierre hung up."; state = "idle"
            } catch (e: Exception) {
                error = "No connection. Even Pierre cannot call you offline."; state = "idle"
            }
        }
    }

    if (state == "over") {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(if (done.size == u.goals.size) "Mission complete! 🎉" else "Call ended", color = C.text, fontSize = 28.sp, fontWeight = FontWeight.ExtraBold)
            Text("${done.size} of ${u.goals.size} goals · +${20 * done.size} ⭐", color = C.gold, fontSize = 18.sp)
            for (g in u.goals) Text((if (g.id in done) "✅ " else "⬜ ") + g.label, color = C.text, fontSize = 17.sp)
            if (fixes.isNotEmpty()) {
                Text("What to fix:", color = C.text, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                for (f in fixes) Text("• $f", color = C.dim, fontSize = 15.sp)
            }
            BigButton("Back to menu", C.blue, Modifier.fillMaxWidth()) { finish() }
        }
        return
    }

    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Card {
            Text(u.setting, color = C.dim, fontSize = 14.sp)
            for (g in u.goals) Text((if (g.id in done) "✅ " else "⬜ ") + g.label, color = if (g.id in done) C.green else C.text, fontSize = 16.sp)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState(), reverseScrolling = true), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (t in turns) {
                val mine = t.who == "you"
                Column(
                    Modifier.fillMaxWidth().padding(start = if (mine) 40.dp else 0.dp, end = if (mine) 0.dp else 40.dp)
                        .background(if (mine) C.blue else C.card, RoundedCornerShape(16.dp)).padding(12.dp)
                ) {
                    Text(t.text, color = C.text, fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
                    if (!mine && showEn && t.en.isNotBlank()) Text(t.en, color = C.dim, fontSize = 15.sp)
                }
            }
            if (state == "thinking") Text("Pierre is thinking…", color = C.dim)
            if (state == "listening") Text("🎤 Your turn, parle en français…", color = C.gold, fontSize = 17.sp)
        }
        if (error.isNotBlank()) Text(error, color = C.red, fontSize = 15.sp)
        if (hint) {
            val g = u.goals.firstOrNull { it.id !in done }
            if (g != null) Text("💡 Try: " + g.model, color = C.gold, fontSize = 16.sp)
        }
        if (turns.isEmpty() && state == "idle") {
            BigButton("📞 START CALL", C.red, Modifier.fillMaxWidth()) { turn("[START]") }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                Pill("💡 Hint") { hint = !hint }
                Pill(if (showEn) "EN on" else "EN off", showEn) { showEn = !showEn }
                Pill("🎤 Speak") {
                    if (state == "idle") {
                        state = "listening"
                        brain.listener.start("fr", {}, { heard ->
                            if (heard.isBlank()) state = "idle" else { turns.add(Turn("you", heard)); hint = false; turn(heard) }
                        }, { state = "idle"; error = it })
                    }
                }
                Pill("Hang up") { finishCall() }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                OutlinedTextField(typed, { typed = it }, modifier = Modifier.weight(1f), singleLine = true, placeholder = { Text("or type in French") })
                Pill("Send") { if (typed.isNotBlank() && state != "thinking") { val t = typed; typed = ""; turns.add(Turn("you", t)); hint = false; turn(t) } }
            }
        }
        Spacer(Modifier.height(8.dp))
    }
}
