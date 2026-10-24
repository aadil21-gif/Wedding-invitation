package app.seefar.assistant

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

enum class Status { Idle, Listening, Thinking, Speaking }

/** All the assistant's state and behaviour for the main screen. */
class Brain(app: Application) : AndroidViewModel(app) {
    private val ctx = app.applicationContext
    val store = Store(ctx)
    val speaker = Speaker(ctx, viewModelScope)
    val listener = Listener(ctx)
    val grabber = FrameGrabber()

    var screen by mutableStateOf("boot") // boot, login, home, french
    var status by mutableStateOf(Status.Idle)
    var mood by mutableStateOf("happy")
    var partial by mutableStateOf("")
    var shown by mutableStateOf("")
    var question by mutableStateOf("")
    var error by mutableStateOf("")
    var cameraOn by mutableStateOf(false)
    var frontCamera by mutableStateOf(false)
    var live by mutableStateOf(false)
    var nudgesOn by mutableStateOf(true)
    var fastVoice by mutableStateOf(true)

    fun setFast(on: Boolean) {
        fastVoice = on
        speaker.mode = if (on) "phone" else "auto"
        ctx.getSharedPreferences("seefar_prefs", 0).edit().putBoolean("fast", on).apply()
    }
    var briefLine by mutableStateOf("")
    val chips = mutableStateListOf<String>()
    val cards = mutableStateListOf<String>()

    private val history = ArrayList<Pair<String, String>>()
    private var lastActivity = System.currentTimeMillis()
    private var gen = 0
    private var loop: Job? = null

    fun boot() {
        Api.init(ctx)
        nudgesOn = ctx.getSharedPreferences("seefar_prefs", 0).getBoolean("nudges", true)
        fastVoice = ctx.getSharedPreferences("seefar_prefs", 0).getBoolean("fast", true)
        speaker.mode = if (fastVoice) "phone" else "auto"
        viewModelScope.launch {
            screen = if (Api.isLoggedIn()) "home" else "login"
            if (screen == "home") onHome()
        }
    }

    fun login(code: String) {
        error = ""
        viewModelScope.launch {
            try {
                Api.login(code.trim())
                screen = "home"
                onHome()
            } catch (e: ApiException) {
                error = if (e.code == 401) "Wrong passcode." else e.message ?: "Could not log in."
            } catch (e: Exception) {
                error = "No internet connection."
            }
        }
    }

    fun logout() {
        stopAll()
        Api.logoutLocal()
        screen = "login"
    }

    private fun onHome() {
        setNudges(nudgesOn)
        viewModelScope.launch {
            try {
                val loc = Device.lastLocation(ctx)
                val b = Api.brief(loc?.first, loc?.second)
                val w = b.optJSONObject("weather")
                val parts = ArrayList<String>()
                if (w != null) parts += "${w.optInt("temp")}° ${w.optString("summary")} · ${w.optInt("lo")}–${w.optInt("hi")}°" + (if (w.optInt("rain") >= 40) " · rain ${w.optInt("rain")}%" else "")
                b.optJSONObject("prayers")?.let { p ->
                    val now = java.time.LocalTime.now()
                    val next = listOf("Fajr", "Dhuhr", "Asr", "Maghrib", "Isha").firstOrNull { k ->
                        try { java.time.LocalTime.parse(p.optString(k)).isAfter(now) } catch (e: Exception) { false }
                    }
                    if (next != null) parts += "$next ${p.optString(next)}"
                }
                briefLine = parts.joinToString("   ")
            } catch (_: Exception) {
            }
        }
    }

    fun setNudges(on: Boolean) {
        nudgesOn = on
        ctx.getSharedPreferences("seefar_prefs", 0).edit().putBoolean("nudges", on).apply()
        val wm = WorkManager.getInstance(ctx)
        if (on) wm.enqueueUniquePeriodicWork("nudges", ExistingPeriodicWorkPolicy.KEEP, PeriodicWorkRequestBuilder<NudgeWorker>(3, TimeUnit.HOURS).build())
        else wm.cancelUniqueWork("nudges")
    }

    fun stopAll() {
        gen++
        speaker.stop()
        listener.stop()
        status = Status.Idle
        partial = ""
    }

    // ---------- talking ----------

    fun micTap() {
        if (status == Status.Speaking || status == Status.Thinking) { stopAll(); return }
        if (status == Status.Listening) { stopAll(); live = false; return }
        listen()
    }

    fun toggleLive() {
        live = !live
        if (live) { if (status == Status.Idle) listen() } else if (status == Status.Listening) stopAll()
        if (live) startObserveLoop() else loop?.cancel()
    }

    fun toggleCamera() {
        cameraOn = !cameraOn
        if (!cameraOn) grabber.clear()
    }

    fun listen() {
        val g = ++gen
        error = ""
        partial = ""
        status = Status.Listening
        mood = "curious"
        listener.start("en",
            onPartial = { if (g == gen) partial = it },
            onFinal = { text ->
                if (g == gen) {
                    if (text.isBlank()) {
                        status = Status.Idle
                        if (live) viewModelScope.launch { delay(400); if (live && status == Status.Idle && g == gen) listen() }
                    } else send(text)
                }
            },
            onError = { msg -> if (g == gen) { status = Status.Idle; error = msg; live = false } }
        )
    }

    /** Sends something typed or said. When the camera is on, the newest frame goes with it. */
    fun send(text: String, extra: JSONObject? = null, frame: String? = null, voiceStyle: String = "natural") {
        val t = text.trim()
        if (t.isEmpty()) return
        val g = ++gen
        listener.stop()
        speaker.stop()
        lastActivity = System.currentTimeMillis()
        question = t
        partial = ""
        error = ""
        status = Status.Thinking
        mood = "curious"
        viewModelScope.launch {
            try {
                val img = frame ?: if (cameraOn) grabber.latest else null
                val reply = Api.chat(t, img, Device.context(ctx, store), history, extra)
                if (g != gen) return@launch
                history += "user" to t
                history += "assistant" to reply.say
                if (history.size > 16) repeat(2) { history.removeAt(0) }
                chips.clear()
                chips.addAll(Device.run(ctx, store, reply.actions) { cameraOn = true })
                cards.clear()
                cards.addAll(reply.cards.map { cardText(it) })
                mood = reply.mood
                speakReply(reply.say, g, voiceStyle)
            } catch (e: ApiException) {
                if (g == gen) fail(if (e.code == 401) "Your login expired. Log in again." else e.message ?: "Something went wrong.", e.code == 401)
            } catch (e: Exception) {
                if (g == gen) fail("No internet connection.", false)
            }
        }
    }

    private fun fail(msg: String, relogin: Boolean) {
        status = Status.Idle
        error = msg
        mood = "sad"
        live = false
        if (relogin) screen = "login"
    }

    private fun speakReply(text: String, g: Int, style: String) {
        if (text.isBlank()) { status = Status.Idle; return }
        status = Status.Speaking
        speaker.speak(text, style, "en",
            onStart = { if (g == gen) shown = text },
            onDone = {
                if (g == gen) {
                    status = Status.Idle
                    lastActivity = System.currentTimeMillis()
                    if (live) viewModelScope.launch { delay(250); if (live && g == gen && status == Status.Idle) listen() }
                }
            })
    }

    /** Quick buttons. */
    fun ask(prompt: String, needsCamera: Boolean = false) {
        if (needsCamera && !cameraOn) {
            cameraOn = true
            viewModelScope.launch {
                var n = 0
                while (grabber.latest == null && n++ < 20) delay(200)
                send(prompt)
            }
        } else send(prompt)
    }

    /** While live with the camera on, comment on what it sees after a quiet minute or two. */
    private fun startObserveLoop() {
        loop?.cancel()
        loop = viewModelScope.launch {
            while (live) {
                delay(15_000)
                if (live && cameraOn && status == Status.Listening && System.currentTimeMillis() - lastActivity > 100_000) {
                    val frame = grabber.latest ?: continue
                    val g = ++gen
                    listener.stop()
                    status = Status.Thinking
                    try {
                        val say = Api.nudge("observe", Device.usageToday(ctx), frame, store.facts.takeLast(8))
                        if (g != gen) continue
                        lastActivity = System.currentTimeMillis()
                        if (say.isBlank()) { listen() } else { speakReply(say, g, "natural") }
                    } catch (e: Exception) {
                        if (g == gen) listen()
                    }
                }
            }
        }
    }

    private fun cardText(c: JSONObject): String = when (c.optString("type")) {
        "weather" -> "${c.optString("place")}: ${c.optInt("temp")}° ${c.optString("summary")}, feels ${c.optInt("feels")}°, humidity ${c.optInt("humidity")}%"
        "prayer" -> c.optString("city") + ": " + (c.optJSONObject("times")?.let { t -> t.keys().asSequence().joinToString("  ") { k -> "$k ${t.optString(k)}" } } ?: "")
        "currency" -> "${c.optDouble("amount")} ${c.optString("from")} = ${"%.2f".format(c.optDouble("result"))} ${c.optString("to")}"
        "wiki" -> c.optString("title") + ": " + c.optString("extract").take(220)
        "calc" -> c.optString("expression") + " = " + c.optString("result")
        "search" -> c.optJSONArray("results")?.let { r -> (0 until minOf(3, r.length())).joinToString("\n") { "• " + r.optJSONObject(it)?.optString("title") } } ?: ""
        else -> ""
    }

    override fun onCleared() {
        speaker.shutdown()
        listener.stop()
    }
}
