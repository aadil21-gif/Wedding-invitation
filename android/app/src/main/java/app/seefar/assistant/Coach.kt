package app.seefar.assistant

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.text.Normalizer
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit

// ---------- curriculum ----------

data class Drill(
    val id: String, val type: String, val prompt: String = "", val answer: String = "", val accept: List<String> = emptyList(),
    val options: List<String> = emptyList(), val words: List<String> = emptyList(), val audio: String = "",
    val target: String = "", val hint: String = "", val count: Int = 0,
)

data class Vocab(val fr: String, val en: String, val note: String = "")

data class DayData(
    val day: Int, val week: Int, val theme: String, val grammar: String, val reviewDay: Boolean, val checkpoint: Boolean,
    val date: String, val full: Boolean, val steps: List<String>, val links: List<String>, val vocab: List<Vocab>,
    val drills: List<Drill>, val listenText: List<String>, val dictation: List<Pair<String, String>>,
    val speaking: List<String>, val writingPrompt: String, val writingMin: Int, val raw: JSONObject,
)

class Curriculum(val days: List<JSONObject>, val phases: JSONArray, val checkpoints: JSONArray, val start: LocalDate) {
    fun dayNumberToday(): Int {
        val n = ChronoUnit.DAYS.between(start, LocalDate.now(ZoneId.systemDefault())).toInt() + 1
        return n.coerceIn(1, days.size)
    }

    fun raw(day: Int): JSONObject = days[day - 1]

    /** Builds a day from the authored curriculum, or from the cached generated content. */
    fun build(day: Int, generated: JSONObject?): DayData {
        val d = raw(day)
        val full = d.optString("content_status") == "full"
        val g = if (full) null else generated
        val lessonObj = if (full) d.optJSONObject("lesson") else g?.optJSONObject("lesson")
        val steps = lessonObj?.optJSONArray("steps")?.strings() ?: emptyList()
        val links = (if (full) lessonObj?.optJSONArray("external")?.strings() else null) ?: emptyList()
        val vocab = (if (full) d.optJSONArray("vocab") else g?.optJSONArray("vocab"))?.objs()?.map {
            Vocab(it.optString("fr"), it.optString("en"), it.optString("note"))
        } ?: emptyList()
        val drills = (if (full) d.optJSONArray("drills") else g?.optJSONArray("drills"))?.objs()?.map { parseDrill(it) } ?: emptyList()
        val listening = d.optJSONObject("listening")
        val listenText = ArrayList<String>()
        listening?.optJSONArray("external")?.strings()?.let { listenText.addAll(it) }
        listening?.optString("plan")?.takeIf { it.isNotBlank() }?.let { listenText.add(it) }
        val dict = ArrayList<Pair<String, String>>()
        val dsrc = if (full) listening?.optJSONArray("in_app_dictation") else g?.optJSONArray("in_app_dictation")
        dsrc?.objs()?.forEach {
            val audio = it.optString("audio_text").ifBlank { it.optString("spelled") }
            if (audio.isNotBlank()) dict.add(audio to it.optString("answer"))
        }
        val writing = d.optJSONObject("writing")
        return DayData(
            day, d.optInt("week"), d.optString("theme"), d.optString("grammar").let { if (it == "null") "" else it },
            d.optBoolean("review_day"), d.optBoolean("checkpoint"), d.optString("date"), full || g != null,
            steps, links, vocab, drills, listenText, dict,
            d.optJSONArray("speaking")?.objs()?.map { it.optString("prompt") } ?: emptyList(),
            writing?.optString("prompt") ?: "", writing?.optInt("min_sentences", 4) ?: 4, d
        )
    }

    private fun parseDrill(o: JSONObject) = Drill(
        id = o.optString("id"), type = o.optString("type"), prompt = o.optString("prompt"), answer = o.optString("answer"),
        accept = o.optJSONArray("accept")?.strings() ?: o.optJSONArray("accepted")?.strings() ?: emptyList(),
        options = o.optJSONArray("options")?.strings() ?: emptyList(), words = o.optJSONArray("words")?.strings() ?: emptyList(),
        audio = o.optString("audio_text"), target = o.optString("target"), hint = o.optString("hint"), count = o.optInt("count"),
    )

    companion object {
        fun load(ctx: Context): Curriculum {
            val o = JSONObject(ctx.assets.open("french_curriculum.json").bufferedReader().use { it.readText() })
            return Curriculum(o.getJSONArray("days").objs(), o.getJSONArray("phases"), o.getJSONArray("checkpoints"), LocalDate.parse(o.getString("start_date")))
        }
    }
}

fun JSONArray.objs(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
fun JSONArray.strings(): List<String> = (0 until length()).mapNotNull { optString(it).takeIf { s -> s.isNotBlank() } }

/** Links to open: real URLs found in the text, plus a YouTube search for the topic (search links never go dead). */
fun urlsIn(text: String): List<String> = Regex("https?://[^\\s)]+").findAll(text).map { it.value }.toList()

fun yt(q: String) = "https://www.youtube.com/results?search_query=" + java.net.URLEncoder.encode(q, "UTF-8")

val DAY_VIDEOS = mapOf(
    1 to listOf("French alphabet pronunciation for beginners", "French accents é è ê à ç explained"),
    2 to listOf("French nasal vowels on an in en pronunciation", "French liaison explained for beginners"),
    3 to listOf("se présenter en français A1 beginner", "Comment allez-vous formal vs informal French"),
    4 to listOf("être et avoir présent débutant French", "French subject pronouns je tu il elle nous vous ils"),
    5 to listOf("French numbers 1 to 100 explained", "French numbers 70 80 90 quatre-vingt soixante-dix"),
    6 to listOf("French noun gender le la un une beginner", "French articles le la l' les un une des"),
    7 to listOf("French beginner review A1 week 1"),
)

fun videosFor(day: DayData): List<Pair<String, String>> {
    val qs = DAY_VIDEOS[day.day] ?: listOf("${day.theme} français A1 débutant", "French lesson ${day.theme} beginner")
    return qs.map { "▶ " + it.replaceFirstChar { c -> c.uppercase() } to yt(it) }
}

fun planLinks(text: String): List<Pair<String, String>> {
    val out = ArrayList<Pair<String, String>>()
    val t = text
    if (t.contains("TV5")) out += "TV5Monde A1 exercises" to "https://apprendre.tv5monde.com/fr/exercices/a1-debutant"
    if (Regex("\\bEF\\b").containsMatchIn(t) || t.contains("Easy French")) out += "Easy French (YouTube)" to "https://www.youtube.com/@EasyFrench"
    if (t.contains("RFI")) out += "RFI Journal en français facile" to "https://francaisfacile.rfi.fr/"
    return out
}

// ---------- grading ----------

object Grader {
    fun accentless(s: String): String = Normalizer.normalize(s, Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "")

    fun norm(s: String): String = s.lowercase().replace('’', '\'').replace(Regex("\\s*([?!.,;:])\\s*"), " ")
        .replace(Regex("\\s+"), " ").trim()

    fun plain(s: String): String = accentless(norm(s)).replace(Regex("[^a-z0-9 ']+"), " ").replace(Regex("\\s+"), " ").trim()

    fun lev(a: String, b: String): Int {
        var prev = IntArray(b.length + 1) { it }
        for (i in 1..a.length) {
            val cur = IntArray(b.length + 1); cur[0] = i
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

    data class Result(val ok: Boolean, val accentOnly: Boolean, val score: Double)

    /** Exact match first. A missing accent is "minor": still correct, except in dictation and writing. */
    fun check(type: String, input: String, answer: String, accept: List<String>, p: Profile? = null): Result {
        val cands = (listOf(answer) + accept).map { fill(it, p) }
        val x = norm(input)
        if (x.isEmpty()) return Result(false, false, 0.0)
        if (cands.any { norm(it) == x }) return Result(true, false, 1.0)
        if (cands.any { plain(it) == plain(input) }) return Result(type != "dictation", true, 0.9)
        val best = cands.maxOf { similarity(input, it) }
        if (type == "say_it") return Result(best >= 0.85, false, best)
        return Result(false, false, best)
    }

    /** The app speaks digits as French words for spoken answers ("28" -> "vingt-huit"). */
    fun spokenNumbers(s: String): String = s.split(" ").joinToString(" ") { t -> t.toIntOrNull()?.takeIf { it in 0..100 }?.let { frenchNumber(it) } ?: t }

    fun fill(s: String, p: Profile?): String {
        if (p == null) return s
        var r = s
        if (p.name.isNotBlank()) r = r.replace("Aadil", p.name)
        if (p.city.isNotBlank()) r = r.replace("Islamabad", p.city)
        p.age.toIntOrNull()?.let { r = r.replace("vingt-huit", frenchNumber(it)) }
        if (p.profession.isNotBlank()) r = r.replace("pharmacien", p.profession)
        return r
    }
}

fun frenchNumber(n: Int): String {
    val u = listOf("zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf")
    return when {
        n < 20 -> u[n]
        n == 100 -> "cent"
        n < 70 -> {
            val t = listOf("", "", "vingt", "trente", "quarante", "cinquante", "soixante")[n / 10]
            val r = n % 10
            if (r == 0) t else if (r == 1) "$t et un" else "$t-${u[r]}"
        }
        n < 80 -> "soixante" + (if (n == 71) " et " else "-") + u[n - 60]
        n == 80 -> "quatre-vingts"
        else -> "quatre-vingt-" + u[n - 80]
    }
}

// ---------- roasts (local, instant; mistakes only, never the person) ----------

object Roasts {
    private val article = listOf(
        "Le pharmacien who forgot the article. Even the aspirin has a l'.",
        "A noun without its article is a prescription without a signature.",
        "Gender is not optional in French. The noun does not care about your feelings.",
        "Le, la, l'... three options, and you found a fourth. Impressive, and wrong."
    )
    private val conjugation = listOf(
        "That verb form is not in any dictionary, and I checked.",
        "The verb changed with the person and you did not send it the memo.",
        "'I am go' is not English either. Conjugate."
    )
    private val accent = listOf(
        "The accent is not decoration. é and e are different letters.",
        "Missing accent. The word went outside without a coat."
    )
    private val vocabulary = listOf(
        "That word exists, just not in French.",
        "Confident, fast and wrong. Pick two next time.",
        "Close in the way a calculator is close to a doctor: not at all."
    )
    private val pronunciation = listOf(
        "The recogniser heard something. I am not convinced it was French.",
        "Your R is hiding somewhere. Go and find it.",
        "That was a sound. Not a French one, but a sound."
    )
    private val order = listOf(
        "Right words, wrong order. A crime scene with good ingredients.",
        "French has word order rules. English is not one of them."
    )
    private val spelling = listOf(
        "Spelling: French punishes the eyes and the ears at once.",
        "The sentence is nearly right and entirely misspelled."
    )
    private val generic = listOf(
        "Wrong, but you showed up. Again.",
        "Not yet. The correct answer is under this line."
    )

    fun forCategory(c: String): String = when (c) {
        "article", "gender" -> article
        "conjugation" -> conjugation
        "accent" -> accent
        "vocabulary" -> vocabulary
        "pronunciation", "liaison" -> pronunciation
        "word_order" -> order
        "spelling" -> spelling
        else -> generic
    }.random()

    fun praise(c: String): String = when (c) {
        "article", "gender" -> listOf("Nice. Article and gender both right.", "Correct. The noun and its article agree.")
        "conjugation" -> listOf("Nice. Right verb form.", "Correct conjugation, no hesitation.")
        "pronunciation" -> listOf("Nice. The recogniser understood you first time.", "Clear. That one was understood.")
        "word_order" -> listOf("Nice. The order is right.")
        "spelling" -> listOf("Nice. Spelled right, accents included.")
        else -> listOf("Correct.", "Right.", "Good. Next.")
    }.random()

    fun categoryFor(d: Drill, accentOnly: Boolean): String = when {
        accentOnly -> "accent"
        d.type == "say_it" -> "pronunciation"
        d.type == "order" -> "word_order"
        d.type == "dictation" -> "spelling"
        d.type == "fill" && Regex("^(le|la|l'|les|un|une|des|du|de la)$", RegexOption.IGNORE_CASE).matches(d.answer.trim()) -> "article"
        d.type == "fill" -> "conjugation"
        else -> "vocabulary"
    }
}

// ---------- store ----------

data class Profile(val name: String, val city: String, val age: String, val profession: String)

data class Card(val front: String, val back: String, val fr: String, var ease: Double = 2.5, var interval: Int = 0, var due: Long = 0, var lapses: Int = 0, var suspended: Boolean = false, var reviews: Int = 0)

class CoachStore(ctx: Context) {
    private val p = ctx.getSharedPreferences("seefar_coach", Context.MODE_PRIVATE)
    private fun obj(key: String) = try { JSONObject(p.getString(key, "{}")!!) } catch (e: Exception) { JSONObject() }

    var serious: Boolean get() = p.getBoolean("serious", false); set(v) = p.edit().putBoolean("serious", v).apply()
    var reminderHour: Int get() = p.getInt("remind", -1); set(v) = p.edit().putInt("remind", v).apply()
    var xp: Int get() = p.getInt("xp", 0); set(v) = p.edit().putInt("xp", v).apply()
    var lightUntil: Int get() = p.getInt("light_until", 0); set(v) = p.edit().putInt("light_until", v).apply()
    var linkOpenedAt: Long get() = p.getLong("link_at", 0); set(v) = p.edit().putLong("link_at", v).apply()
    var profileSaved: Boolean get() = p.getBoolean("profile_saved", false); set(v) = p.edit().putBoolean("profile_saved", v).apply()

    var profile: Profile
        get() = Profile(p.getString("p_name", "Aadil")!!, p.getString("p_city", "Islamabad")!!, p.getString("p_age", "28")!!, p.getString("p_prof", "pharmacien")!!)
        set(v) = p.edit().putString("p_name", v.name).putString("p_city", v.city).putString("p_age", v.age).putString("p_prof", v.profession).apply()

    // generated days
    fun generated(day: Int): JSONObject? = p.getString("gen_$day", null)?.let { try { JSONObject(it) } catch (e: Exception) { null } }
    fun saveGenerated(day: Int, o: JSONObject) = p.edit().putString("gen_$day", o.toString()).apply()
    fun dropGenerated(day: Int) = p.edit().remove("gen_$day").apply()

    // day log: seconds per block, done flags, drill progress
    private fun log(day: Int): JSONObject = obj("log").optJSONObject("$day") ?: JSONObject()
    private fun saveLog(day: Int, l: JSONObject) { val all = obj("log"); all.put("$day", l); p.edit().putString("log", all.toString()).apply() }
    fun seconds(day: Int, block: String) = log(day).optInt("s_$block")
    fun addSeconds(day: Int, block: String, n: Int) { val l = log(day); l.put("s_$block", l.optInt("s_$block") + n); saveLog(day, l) }
    fun minutesTotal(day: Int) = listOf("anki", "lesson", "listening", "speaking", "writing").sumOf { seconds(day, it) } / 60
    fun isDone(day: Int, block: String) = log(day).optBoolean("done_$block")
    fun setDone(day: Int, block: String, v: Boolean = true) { val l = log(day); l.put("done_$block", v); saveLog(day, l) }
    fun drillIndex(day: Int, block: String) = log(day).optInt("i_$block")
    fun setDrillIndex(day: Int, block: String, i: Int) { val l = log(day); l.put("i_$block", i); saveLog(day, l) }
    fun stat(day: Int, k: String) = log(day).optInt("st_$k")
    fun addStat(day: Int, k: String, n: Int = 1) { val l = log(day); l.put("st_$k", l.optInt("st_$k") + n); saveLog(day, l) }

    // errors
    fun errors(): List<JSONObject> = try { JSONArray(p.getString("errors", "[]")).objs() } catch (e: Exception) { emptyList() }
    fun addError(day: Int, category: String, item: String, user: String, model: String) {
        val a = JSONArray(p.getString("errors", "[]"))
        a.put(JSONObject().put("ts", System.currentTimeMillis()).put("day", day).put("category", category).put("item", item.take(120)).put("user", user.take(120)).put("model", model.take(160)))
        val keep = JSONArray(); val from = maxOf(0, a.length() - 200)
        for (i in from until a.length()) keep.put(a.get(i))
        p.edit().putString("errors", keep.toString()).apply()
    }

    fun topErrors(day: Int): List<Pair<String, Int>> =
        errors().filter { it.optInt("day") == day }.groupingBy { it.optString("category") }.eachCount().toList().sortedByDescending { it.second }

    // cards
    private fun cardsObj() = obj("cards")
    fun cards(): MutableMap<String, Card> {
        val o = cardsObj(); val m = LinkedHashMap<String, Card>()
        for (k in o.keys()) { val c = o.getJSONObject(k)
            m[k] = Card(c.optString("f"), c.optString("b"), c.optString("fr"), c.optDouble("e", 2.5), c.optInt("i"), c.optLong("d"), c.optInt("l"), c.optBoolean("s"), c.optInt("r")) }
        return m
    }
    fun saveCards(m: Map<String, Card>) {
        val o = JSONObject()
        for ((k, c) in m) o.put(k, JSONObject().put("f", c.front).put("b", c.back).put("fr", c.fr).put("e", c.ease).put("i", c.interval).put("d", c.due).put("l", c.lapses).put("s", c.suspended).put("r", c.reviews))
        p.edit().putString("cards", o.toString()).apply()
    }
    fun ensureCard(front: String, back: String, fr: String) {
        val m = cards(); val key = Grader.norm(front + "|" + back)
        val c = m[key]
        if (c == null) m[key] = Card(front, back, fr)
        else if (!c.suspended) c.due = minOf(c.due, System.currentTimeMillis())
        saveCards(m)
    }
    fun newToday(): Int = p.getInt("new_" + LocalDate.now(), 0)
    fun addNewToday(n: Int) = p.edit().putInt("new_" + LocalDate.now(), newToday() + n).apply()
}

object Srs {
    private const val DAY = 86_400_000L

    /** grade: 0 Again, 1 Hard, 2 Good, 3 Easy. Returns true if the card became a leech. */
    fun apply(c: Card, grade: Int, now: Long = System.currentTimeMillis()): Boolean {
        c.reviews++
        when (grade) {
            0 -> { c.interval = 1; c.lapses++; c.ease = maxOf(1.3, c.ease - 0.2) }
            1 -> c.interval = maxOf(1, Math.round(maxOf(c.interval, 1) * 1.2).toInt())
            2 -> c.interval = if (c.interval == 0) 1 else Math.ceil(c.interval * c.ease).toInt()
            else -> { c.interval = Math.ceil(maxOf(c.interval, 1) * c.ease * 1.3).toInt(); c.ease += 0.15 }
        }
        c.due = now + c.interval * DAY
        val leech = c.lapses >= 4 && !c.suspended
        if (leech) c.suspended = true
        return leech
    }
}
