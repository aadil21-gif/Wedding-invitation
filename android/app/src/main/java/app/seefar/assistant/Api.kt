package app.seefar.assistant

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Cookies survive app restarts, so you log in once (the server keeps you in for 30 days). */
class PersistentCookieJar(ctx: Context) : CookieJar {
    private val prefs = ctx.getSharedPreferences("seefar_cookies", Context.MODE_PRIVATE)
    private val mem = HashMap<String, Cookie>()

    init {
        for ((k, v) in prefs.all) {
            val c = (v as? String)?.let { decode(it) }
            if (c != null) mem[k] = c
        }
    }

    private fun encode(c: Cookie) =
        listOf(c.name, c.value, c.domain, c.path, c.expiresAt.toString(), c.secure.toString()).joinToString("\u0001")

    private fun decode(s: String): Cookie? {
        val p = s.split("\u0001")
        if (p.size < 6) return null
        return try {
            Cookie.Builder().name(p[0]).value(p[1]).domain(p[2]).path(p[3])
                .expiresAt(p[4].toLong()).apply { if (p[5] == "true") secure() }.httpOnly().build()
        } catch (e: Exception) {
            null
        }
    }

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val e = prefs.edit()
        for (c in cookies) {
            val key = c.name + "@" + c.domain + c.path
            mem[key] = c
            e.putString(key, encode(c))
        }
        e.apply()
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val now = System.currentTimeMillis()
        return mem.values.filter { it.expiresAt > now && it.matches(url) }
    }

    @Synchronized
    fun clear() {
        mem.clear()
        prefs.edit().clear().apply()
    }
}

class ApiException(message: String, val code: Int = 0) : Exception(message)

data class CallTurn(
    val fr: String,
    val en: String,
    val goalsDone: List<String>,
    val fixSaid: String,
    val fixBetter: String,
    val fixWhy: String,
    val finished: Boolean,
)

data class Reply(
    val say: String,
    val mood: String,
    val actions: List<JSONObject>,
    val cards: List<JSONObject>,
    val fr: List<String>,
    val call: CallTurn?,
)

object Api {
    const val BASE = "https://seefar-umber.vercel.app"
    private val JSON = "application/json; charset=utf-8".toMediaType()
    private lateinit var jar: PersistentCookieJar
    private lateinit var http: OkHttpClient

    fun init(ctx: Context) {
        if (::http.isInitialized) return
        cacheDir = java.io.File(ctx.applicationContext.filesDir, "tts").also { it.mkdirs() }
        jar = PersistentCookieJar(ctx.applicationContext)
        http = OkHttpClient.Builder()
            .cookieJar(jar)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(70, TimeUnit.SECONDS)
            .build()
    }

    fun logoutLocal() = jar.clear()

    private fun errorOf(body: String, code: Int): String {
        val m = try { JSONObject(body).optString("error") } catch (e: Exception) { "" }
        return if (m.isNotBlank()) m else "Server said $code."
    }

    private suspend fun post(path: String, json: JSONObject): String = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(BASE + path).post(json.toString().toRequestBody(JSON)).build()
        http.newCall(req).execute().use { r ->
            val body = r.body?.string() ?: ""
            if (!r.isSuccessful) throw ApiException(errorOf(body, r.code), r.code)
            body
        }
    }

    private suspend fun get(path: String): String = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(BASE + path).get().build()
        http.newCall(req).execute().use { r ->
            val body = r.body?.string() ?: ""
            if (!r.isSuccessful) throw ApiException(errorOf(body, r.code), r.code)
            body
        }
    }

    /** True when the saved login still works. */
    suspend fun isLoggedIn(): Boolean = try {
        get("/api/french/course"); true
    } catch (e: ApiException) {
        e.code != 401 && e.code != 503
    } catch (e: Exception) {
        false
    }

    suspend fun login(passcode: String) {
        post("/api/auth", JSONObject().put("passcode", passcode))
    }

    suspend fun chat(
        message: String,
        image: String?,
        context: JSONObject,
        history: List<Pair<String, String>>,
        extra: JSONObject? = null,
    ): Reply {
        val o = JSONObject()
            .put("message", message)
            .put("context", context)
            .put("history", JSONArray().also { a ->
                history.takeLast(8).forEach { (role, text) -> a.put(JSONObject().put("role", role).put("content", text.take(1500))) }
            })
        if (image != null) o.put("image", image)
        extra?.keys()?.forEach { o.put(it, extra.get(it)) }
        return parseReply(JSONObject(post("/api/chat", o)))
    }

    private fun strings(a: JSONArray?): List<String> =
        if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optString(it).takeIf { s -> s.isNotBlank() } }

    private fun objects(a: JSONArray?): List<JSONObject> =
        if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it) }

    private fun parseReply(j: JSONObject): Reply {
        val c = j.optJSONObject("call")
        val fix = c?.optJSONObject("fix")
        return Reply(
            say = j.optString("say"),
            mood = j.optString("mood", "neutral"),
            actions = objects(j.optJSONArray("actions")),
            cards = objects(j.optJSONArray("cards")),
            fr = strings(j.optJSONArray("fr")),
            call = c?.let {
                CallTurn(
                    fr = it.optString("fr"),
                    en = it.optString("en"),
                    goalsDone = strings(it.optJSONArray("goalsDone")),
                    fixSaid = fix?.optString("said") ?: "",
                    fixBetter = fix?.optString("better") ?: "",
                    fixWhy = fix?.optString("why") ?: "",
                    finished = it.optBoolean("finished"),
                )
            },
        )
    }

    /** WAV bytes of the AI voice, or null when the server has no voice (the phone voice is used then). */
    private var cacheDir: java.io.File? = null

    suspend fun tts(text: String, style: String): ByteArray? = withContext(Dispatchers.IO) {
        val f = cacheDir?.let { java.io.File(it, "tts_" + (style + "|" + text).hashCode().toUInt().toString(16) + ".wav") }
        if (f != null && f.exists() && f.length() > 100) return@withContext f.readBytes()
        try {
            val req = Request.Builder().url("$BASE/api/tts")
                .post(JSONObject().put("text", text).put("style", style).toString().toRequestBody(JSON)).build()
            http.newCall(req).execute().use { r ->
                if (!r.isSuccessful) null else r.body?.bytes()?.also { b -> if (f != null && b.size > 100) try { f.writeBytes(b) } catch (_: Exception) {} }
            }
        } catch (e: Exception) {
            null
        }
    }

    /** Madame Roast: generate / write / talk / leech. */
    suspend fun coach(body: JSONObject): JSONObject = JSONObject(post("/api/coach", body))

    suspend fun tutor(o: JSONObject): JSONObject = JSONObject(post("/api/tutor", o))

    suspend fun nudge(kind: String, usage: List<String>, image: String? = null, facts: List<String> = emptyList()): String {
        val o = JSONObject().put("kind", kind)
            .put("nowIso", java.time.Instant.now().toString())
            .put("usage", JSONArray(usage)).put("facts", JSONArray(facts))
        if (image != null) o.put("image", image)
        return JSONObject(post("/api/nudge", o)).optString("say")
    }

    suspend fun brief(lat: Double?, lon: Double?): JSONObject {
        val q = if (lat != null && lon != null) "?lat=$lat&lon=$lon" else ""
        return JSONObject(get("/api/brief$q"))
    }

    suspend fun course(): JSONArray = JSONArray(get("/api/french/course").let {
        val o = try { JSONObject(it) } catch (e: Exception) { null }
        o?.optJSONArray("course")?.toString() ?: it
    })
}
