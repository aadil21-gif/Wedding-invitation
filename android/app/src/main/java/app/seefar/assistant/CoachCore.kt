package app.seefar.assistant

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.text.Normalizer
import java.time.LocalDate

// ---------------- curriculum ----------------

data class Drill(
    val id: String, val type: String, val prompt: String = "", val answer: String = "",
    val accept: List<String> = emptyList(), val options: List<String> = emptyList(), val words: List<String> = emptyList(),
    val target: String = "", val hint: String = "", val audio: String = "", val reviewCount: Int = 0,
)

data class Day(
    val n: Int, val week: Int, val theme: String, val grammar: String, val review: Boolean, val checkpoint: Boolean,
    val needsGen: Boolean, val steps: List<String>, val vocab: List<Pair<String, String>>, val drills: List<Drill>,
    val dictation: List<Drill>, val links: List<String>, val listenLinks: List<String>, val listenPlan: String, val speaking: List<String>, val writing: String,
)

private fun JSONArray?.strs(): List<String> = if (this == null) emptyList() else (0 until length()).mapNotNull { optString(it).takeIf { s -> s.isNotBlank() } }
private fun JSONArray?.objs(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }

fun parseDrill(o: JSONObject, fallbackId: String): Drill = Drill(
    id = o.optString("id", fallbackId), type = o.optString("type"), prompt = o.optString("prompt"),
    answer = o.optString("answer"), accept = o.optJSONArray("accept").strs().ifEmpty { o.optJSONArray("accepted").strs() },
    options = o.optJSONArray("options").strs(), words = o.optJSONArray("words").strs(), target = o.optString("target"),
    hint = o.optString("hint"), audio = o.optString("audio_text"), reviewCount = o.optInt("count", 0),
)

private fun dictations(day: Int, a: JSONArray?): List<Drill> = a.objs().mapIndexed { i, d ->
    val audio = d.optString("audio_text").ifBlank { d.optString("spelled") }
    Drill("dict$day-$i", "dictation", prompt = "Listen and type what you hear", answer = d.optString("answer"), audio = audio)
}

private val URL = Regex("https?://[^\\s)]+")

fun parseDays(json: String): List<Day> {
    val root = JSONObject(json)
    return root.getJSONArray("days").objs().map { d ->
        val n = d.getInt("day")
        val gen = d.optString("content_status") == "generate_at_runtime"
        val lesson = d.optJSONObject("lesson")
        val listening = d.optJSONObject("listening")
        val lext = lesson?.optJSONArray("external").strs()
        val lisext = listening?.optJSONArray("external").strs()
        val ext = lext + lisext
        Day(
            n = n, week = d.optInt("week", 1), theme = d.optString("theme"), grammar = d.optString("grammar").takeIf { it != "null" } ?: "",
            review = d.optBoolean("review_day"), checkpoint = d.optBoolean("checkpoint"), needsGen = gen,
            steps = lesson?.optJSONArray("steps").strs(),
            vocab = d.optJSONArray("vocab").objs().map { it.optString("fr") to it.optString("en") },
            drills = d.optJSONArray("drills").objs().mapIndexed { i, o -> parseDrill(o, "d$n-$i") },
            dictation = dictations(n, listening?.optJSONArray("in_app_dictation")),
            links = lext.flatMap { s -> URL.findAll(s).map { it.value.trimEnd('.', ',') }.toList() }.distinct(),
            listenLinks = lisext.flatMap { s -> URL.findAll(s).map { it.value.trimEnd('.', ',') }.toList() }.distinct(),
            listenPlan = listening?.optString("plan").orEmpty().ifBlank { lisext.firstOrNull { it.contains("  (") || !it.startsWith("http") }.orEmpty() },
            speaking = d.optJSONArray("speaking").objs().map { it.optString("prompt") },
            writing = d.optJSONObject("writing")?.optString("prompt").orEmpty(),
        )
    }
}

/** Fills a runtime day with what the model generated (already validated). */
fun mergeGenerated(d: Day, g: JSONObject): Day {
    val types = setOf("fill", "translate_en_fr", "translate_fr_en", "mcq", "order", "say_it")
    val vocab = g.optJSONArray("vocab").objs().map { it.optString("fr") to it.optString("en") }.filter { it.first.isNotBlank() && it.second.isNotBlank() }
    val drills = g.optJSONArray("drills").objs().mapIndexed { i, o -> parseDrill(o, "g${d.n}-$i") }
        .filter { it.type in types && (it.answer.isNotBlank() || it.type == "say_it" && it.target.isNotBlank()) }
        .filter { it.type != "mcq" || (it.options.size >= 2 && it.options.any { o -> o == it.answer }) }
        .filter { it.type != "order" || it.words.size >= 2 }
    val steps = g.optJSONObject("lesson")?.optJSONArray("steps").strs()
    return d.copy(steps = steps, vocab = vocab, drills = drills, dictation = dictations(d.n, g.optJSONArray("dictation")).filter { it.answer.isNotBlank() && it.audio.isNotBlank() })
}

// ---------------- grading (instant, offline) ----------------

object Grade {
    private fun base(s: String) = Normalizer.normalize(s.lowercase(), Normalizer.Form.NFC)
        .replace('’', '\'').replace(Regex("\\s+"), " ").replace(Regex("\\s+([?!:;,.])"), "$1").trim().trimEnd('.', '?', '!', ' ')

    fun plain(s: String) = Normalizer.normalize(base(s), Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "").replace("œ", "oe")

    private fun lev(a: String, b: String): Int {
        var prev = IntArray(b.length + 1) { it }
        for (i in 1..a.length) {
            val cur = IntArray(b.length + 1); cur[0] = i
            for (j in 1..b.length) cur[j] = minOf(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + if (a[i - 1] == b[j - 1]) 0 else 1)
            prev = cur
        }
        return prev[b.length]
    }

    fun sim(a: String, b: String): Double {
        val x = plain(a).replace(Regex("[^a-z0-9 ]"), " ").replace(Regex("\\s+"), " ").trim()
        val y = plain(b).replace(Regex("[^a-z0-9 ]"), " ").replace(Regex("\\s+"), " ").trim()
        if (x.isEmpty() || y.isEmpty()) return 0.0
        return 1.0 - lev(x, y).toDouble() / maxOf(x.length, y.length)
    }

    class Result(val correct: Boolean, val minorAccent: Boolean, val category: String?)

    private val ARTICLES = setOf("le", "la", "l'", "les", "un", "une", "des")

    fun check(d: Drill, input: String, strictAccents: Boolean = false): Result {
        val answers = (listOf(d.answer) + d.accept).filter { it.isNotBlank() }
        if (d.type == "say_it") {
            val ok = sim(input, d.target) >= 0.85
            return Result(ok, false, if (ok) null else "pronunciation")
        }
        val given = base(input)
        if (given.isEmpty()) return Result(false, false, "other")
        if (answers.any { base(it) == given }) return Result(true, false, null)
        if (d.type == "translate_fr_en") {
            if (answers.any { sim(it, input) >= 0.85 }) return Result(true, false, null)
            return Result(false, false, "vocabulary")
        }
        if (answers.any { plain(it) == plain(input) }) {
            return if (strictAccents || d.type == "dictation") Result(false, true, "accent") else Result(true, true, "accent")
        }
        val cat = when (d.type) {
            "fill" -> if (base(d.answer) in ARTICLES) "article" else "conjugation"
            "order" -> "word_order"
            "dictation" -> "spelling"
            "translate_en_fr" -> if (answers.any { it.firstOrNull()?.isDigit() == true || plain(it).split(" ").size == 1 }) "vocabulary" else "other"
            else -> "other"
        }
        return Result(false, false, cat)
    }

    private val ROAST = mapOf(
        "article" to listOf("Le pharmacien who forgot the article. Even the aspirin has a l'.", "A noun without its article is a prescription without a signature.", "Articles are small, mandatory and apparently optional in your world."),
        "conjugation" to listOf("That verb was not conjugated, it was just standing there.", "The verb changes with the person. It is not copy-paste.", "You gave the verb a day off. It still has to work."),
        "accent" to listOf("The accent did not fall off, you forgot it.", "One little mark, and the word changes. Details, pharmacist."),
        "spelling" to listOf("Creative spelling. The dictionary has filed a complaint.", "I heard it. You wrote something else entirely."),
        "pronunciation" to listOf("The recogniser heard a different word. Slower, and open your mouth.", "That was not the sound. Listen, then copy."),
        "vocabulary" to listOf("That word exists, just not in French.", "Wrong word. Flashcard incoming."),
        "word_order" to listOf("French has an order. You rearranged it into modern art.", "The words are right. Their seating plan is not."),
        "number" to listOf("Numbers are the one place French stays strict.", "Count again. Slowly."),
        "other" to listOf("Close in spirit, wrong in fact.", "Not quite. Look at the answer."),
    )
    private val PRAISE = listOf("Correct.", "Nice, that is right.", "Exactement.", "Yes. Keep that.", "Good. Next.")

    fun praise() = PRAISE.random()
    fun roast(cat: String?) = (ROAST[cat ?: "other"] ?: ROAST["other"]!!).random()
}

// ---------------- progress store ----------------

data class CardS(val front: String, val back: String, var ease: Double, var interval: Double, var due: Long, var lapses: Int, var suspended: Boolean, var seen: Boolean, val tag: String)

class CoachStore(ctx: Context) {
    private val p = ctx.getSharedPreferences("seefar_coach", Context.MODE_PRIVATE)
    private val DAY = 86_400_000L

    var serious: Boolean get() = p.getBoolean("serious", false); set(v) = p.edit().putBoolean("serious", v).apply()
    var current: Int get() = p.getInt("cur", 1); set(v) = p.edit().putInt("cur", v.coerceIn(1, 28)).apply()

    fun blocksDone(day: Int): Set<String> = p.getString("done_$day", "")!!.split(",").filter { it.isNotBlank() }.toSet()
    fun markDone(day: Int, block: String) = p.edit().putString("done_$day", (blocksDone(day) + block).joinToString(",")).apply()
    fun minutes(day: Int, block: String) = p.getInt("sec_${day}_$block", 0) / 60
    fun addSeconds(day: Int, block: String, s: Int) = p.edit().putInt("sec_${day}_$block", p.getInt("sec_${day}_$block", 0) + s).apply()
    fun totalMinutes(day: Int) = listOf("anki", "lesson", "listening", "speaking", "writing").sumOf { p.getInt("sec_${day}_$it", 0) } / 60

    fun generated(day: Int): JSONObject? = p.getString("gen_$day", null)?.let { try { JSONObject(it) } catch (e: Exception) { null } }
    fun saveGenerated(day: Int, o: JSONObject) = p.edit().putString("gen_$day", o.toString()).apply()
    fun clearGenerated(day: Int) = p.edit().remove("gen_$day").apply()

    // drill stats
    fun drillResult(day: Int, ok: Boolean) = p.edit().putInt("dt_$day", p.getInt("dt_$day", 0) + 1).putInt("dc_$day", p.getInt("dc_$day", 0) + if (ok) 1 else 0).apply()
    fun drillStats(day: Int) = p.getInt("dc_$day", 0) to p.getInt("dt_$day", 0)

    // errors
    fun errors(): List<JSONObject> = try { JSONArray(p.getString("errors", "[]")).objs() } catch (e: Exception) { emptyList() }
    fun logError(day: Int, cat: String, item: String, said: String, model: String) {
        val l = errors().takeLast(150).toMutableList()
        l.add(JSONObject().put("ts", System.currentTimeMillis()).put("day", day).put("cat", cat).put("item", item).put("said", said).put("model", model))
        p.edit().putString("errors", JSONArray(l).toString()).apply()
    }
    fun topErrors(n: Int = 3, sinceDays: Int = 7): List<Pair<String, Int>> {
        val since = System.currentTimeMillis() - sinceDays * DAY
        return errors().filter { it.optLong("ts") > since }.groupingBy { it.optString("cat") }.eachCount().entries.sortedByDescending { it.value }.take(n).map { it.key to it.value }
    }
    fun errorsOfDay(day: Int) = errors().filter { it.optInt("day") == day }

    // cards (SM-2 lite)
    private fun cards(): MutableList<CardS> = try {
        JSONArray(p.getString("cards", "[]")).objs().map { CardS(it.getString("f"), it.getString("b"), it.optDouble("e", 2.5), it.optDouble("i", 0.0), it.optLong("d"), it.optInt("l"), it.optBoolean("s"), it.optBoolean("n"), it.optString("t")) }.toMutableList()
    } catch (e: Exception) { mutableListOf() }

    private fun saveCards(l: List<CardS>) = p.edit().putString("cards", JSONArray(l.map {
        JSONObject().put("f", it.front).put("b", it.back).put("e", it.ease).put("i", it.interval).put("d", it.due).put("l", it.lapses).put("s", it.suspended).put("n", it.seen).put("t", it.tag)
    }).toString()).apply()

    fun addCards(items: List<Pair<String, String>>, tag: String, seen: Boolean = false) {
        val l = cards()
        for ((f, b) in items) if (l.none { it.front == f }) l.add(CardS(f, b, 2.5, 0.0, 0, 0, false, seen, tag))
        saveCards(l)
    }

    fun errorCard(front: String, back: String, tag: String) {
        val l = cards()
        val c = l.firstOrNull { it.front == front }
        if (c == null) l.add(CardS(front, back, 2.5, 0.0, System.currentTimeMillis(), 0, false, true, tag))
        else { c.due = minOf(c.due, System.currentTimeMillis()) }
        saveCards(l)
    }

    private fun newToday(): Int = if (p.getString("nt_day", "") == LocalDate.now().toString()) p.getInt("nt", 0) else 0

    /** Due reviews first, then up to 15 new cards a day. */
    fun ankiQueue(maxDay: Int): List<CardS> {
        val now = System.currentTimeMillis()
        val l = cards().filter { !it.suspended }
        val due = l.filter { it.seen && it.due <= now }.sortedBy { it.due }
        val room = (15 - newToday()).coerceAtLeast(0)
        val fresh = l.filter { !it.seen && (it.tag.removePrefix("d").toIntOrNull() ?: 0) <= maxDay }.take(room)
        return due + fresh
    }

    /** grade: 0 Again, 1 Hard, 2 Good, 3 Easy. Returns true if the card became a leech. */
    fun gradeCard(front: String, grade: Int): Boolean {
        val l = cards()
        val c = l.firstOrNull { it.front == front } ?: return false
        val wasNew = !c.seen
        if (wasNew) p.edit().putString("nt_day", LocalDate.now().toString()).putInt("nt", newToday() + 1).apply()
        c.seen = true
        when (grade) {
            0 -> { c.interval = 1.0; c.lapses++; c.ease = (c.ease - 0.2).coerceAtLeast(1.3) }
            1 -> c.interval = maxOf(1.0, c.interval * 1.2)
            2 -> c.interval = if (c.interval < 1) 1.0 else c.interval * c.ease
            else -> { c.interval = (if (c.interval < 1) 2.0 else c.interval * c.ease * 1.3); c.ease += 0.15 }
        }
        c.due = System.currentTimeMillis() + (if (grade == 0) 10 * 60_000L else (c.interval * DAY).toLong())
        val leech = c.lapses >= 4
        if (leech) c.suspended = true
        saveCards(l)
        val ymd = LocalDate.now().toString()
        p.edit().putInt("ar_$ymd", p.getInt("ar_$ymd", 0) + 1).putInt("ac_$ymd", p.getInt("ac_$ymd", 0) + if (grade >= 2) 1 else 0).apply()
        return leech
    }

    fun ankiToday(): Pair<Int, Int> { val y = LocalDate.now().toString(); return p.getInt("ar_$y", 0) to p.getInt("ac_$y", 0) }
    fun dueCount() = cards().count { it.seen && !it.suspended && it.due <= System.currentTimeMillis() }
    fun totalCards() = cards().size
    fun reviewItems(max: Int): List<Pair<String, String>> = errors().takeLast(max * 2).map { it.optString("item") to it.optString("model") }.filter { it.first.isNotBlank() }.distinct().takeLast(max)
}
