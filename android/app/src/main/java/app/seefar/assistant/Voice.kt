package app.seefar.assistant

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import java.util.Locale
import kotlin.coroutines.resume

/**
 * Speaks with the server's AI voice (Gemini) and falls back to the phone's own voice.
 * onStart fires when sound actually begins, so text can appear in sync with the voice.
 */
class Speaker(private val ctx: Context, private val scope: CoroutineScope) {
    private var job: Job? = null
    private var player: MediaPlayer? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = CompletableDeferred<Boolean>()

    init {
        tts = TextToSpeech(ctx.applicationContext) { status -> ttsReady.complete(status == TextToSpeech.SUCCESS) }
    }

    /** "auto" = AI voice, but the phone voice steps in if the AI voice is slow. "phone" = always the phone voice (instant). */
    var mode = "auto"

    val speaking: Boolean get() = job?.isActive == true

    fun stop() {
        job?.cancel()
        job = null
        try { player?.stop() } catch (_: Exception) {}
        try { player?.release() } catch (_: Exception) {}
        player = null
        tts?.stop()
    }

    fun shutdown() {
        stop()
        tts?.shutdown()
    }

    /** Sentences grouped to fit the voice limit, with a short first chunk so the voice starts fast. */
    private fun chunks(text: String): List<String> {
        val clean = text.replace(Regex("[*_`#>]+"), "").replace(Regex("\\s+"), " ").trim()
        val sentences = Regex("[^.!?…]+[.!?…]*\\s*").findAll(clean).map { it.value.trim() }.filter { it.isNotEmpty() }.toList()
        val out = ArrayList<String>()
        var cur = ""
        for (s in sentences) {
            val limit = if (out.isEmpty()) 60 else 260
            if (cur.isNotEmpty() && cur.length + s.length + 1 > limit) { out.add(cur); cur = s } else cur = if (cur.isEmpty()) s else "$cur $s"
        }
        if (cur.isNotEmpty()) out.add(cur)
        return out.map { it.take(300) }
    }

    fun speak(text: String, style: String = "natural", lang: String = "en", onStart: () -> Unit = {}, onDone: () -> Unit = {}, forceAi: Boolean = false) {
        stop()
        val parts = chunks(text)
        if (parts.isEmpty()) { onStart(); onDone(); return }
        job = scope.launch {
            var started = false
            var cancelled = false
            val fire = { if (!started) { started = true; onStart() } }
            try {
                val clips = if (mode == "phone" && !forceAi) null else parts.map { p -> async(Dispatchers.IO) { Api.tts(p, style) } }
                for ((i, p) in parts.withIndex()) {
                    val wav = when {
                        clips == null -> null
                        i == 0 -> kotlinx.coroutines.withTimeoutOrNull(if (forceAi) 5000L else 2200L) { clips[0].await() }
                        else -> clips[i].await()
                    }
                    if (wav != null && wav.size > 100) playWav(wav, fire) else speakPhone(p, lang, fire)
                }
            } catch (e: kotlinx.coroutines.CancellationException) {
                cancelled = true
                throw e
            } finally {
                if (!cancelled) { fire(); onDone() }
            }
        }
    }

    /** French through the phone's own voice: slow first (0.7), then normal. Instant and works offline. */
    fun speakFrench(text: String, slowFirst: Boolean = true, onDone: () -> Unit = {}) {
        stop()
        job = scope.launch {
            var cancelled = false
            try {
                if (slowFirst) speakPhone(text, "fr", {}, 0.7f)
                speakPhone(text, "fr", {}, 1.0f)
            } catch (e: kotlinx.coroutines.CancellationException) {
                cancelled = true
                throw e
            } finally {
                if (!cancelled) onDone()
            }
        }
    }

    /** False when the phone has no French voice installed. */
    suspend fun frenchAvailable(): Boolean {
        if (!ttsReady.await()) return false
        val r = tts?.isLanguageAvailable(Locale.FRANCE) ?: return false
        return r >= TextToSpeech.LANG_AVAILABLE
    }

    private suspend fun playWav(bytes: ByteArray, onStart: () -> Unit) {
        val f = withContext(Dispatchers.IO) {
            File.createTempFile("clip", ".wav", ctx.cacheDir).also { it.writeBytes(bytes) }
        }
        try {
            suspendCancellableCoroutine<Unit> { cont ->
                val mp = MediaPlayer()
                player = mp
                mp.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                mp.setDataSource(f.path)
                mp.setOnPreparedListener { it.start(); onStart() }
                mp.setOnCompletionListener { it.release(); if (cont.isActive) cont.resume(Unit) }
                mp.setOnErrorListener { m, _, _ -> m.release(); if (cont.isActive) cont.resume(Unit); true }
                cont.invokeOnCancellation { try { mp.release() } catch (_: Exception) {} }
                mp.prepareAsync()
            }
        } finally {
            f.delete()
        }
    }

    private suspend fun speakPhone(text: String, lang: String, onStart: () -> Unit, rate: Float? = null) {
        if (!ttsReady.await()) { onStart(); return }
        val engine = tts ?: return
        engine.language = if (lang == "fr") Locale.FRANCE else Locale.US
        engine.setSpeechRate(rate ?: if (lang == "fr") 0.85f else 1.0f)
        suspendCancellableCoroutine<Unit> { cont ->
            val id = "u" + System.nanoTime()
            engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) { onStart() }
                override fun onDone(utteranceId: String?) { if (utteranceId == id && cont.isActive) cont.resume(Unit) }
                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) { if (utteranceId == id && cont.isActive) cont.resume(Unit) }
            })
            cont.invokeOnCancellation { engine.stop() }
            engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, id)
        }
    }
}

/** Wraps Android's SpeechRecognizer. Must be used from the main thread. */
class Listener(private val ctx: Context) {
    private var rec: SpeechRecognizer? = null
    var active = false
        private set

    fun available() = SpeechRecognizer.isRecognitionAvailable(ctx)

    /**
     * onPartial: live words. onFinal: best sentence or "" if nothing heard.
     * onError: message for the user, only for real problems.
     */
    fun start(lang: String, onPartial: (String) -> Unit, onFinal: (String) -> Unit, onError: (String) -> Unit) {
        stop()
        if (!available()) { onError("This phone has no speech recogniser. Install or enable the Google app."); return }
        val r = SpeechRecognizer.createSpeechRecognizer(ctx)
        rec = r
        active = true
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
            override fun onPartialResults(partialResults: Bundle?) {
                partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let(onPartial)
            }
            override fun onResults(results: Bundle?) {
                active = false
                onFinal(results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: "")
            }
            override fun onError(error: Int) {
                active = false
                when (error) {
                    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> onFinal("")
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> onError("Allow the microphone for SeeFar in Settings.")
                    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> onError("Speech needs internet. Check your connection.")
                    SpeechRecognizer.ERROR_CLIENT -> onFinal("")
                    else -> onError("Could not hear that (error $error).")
                }
            }
        })
        val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, if (lang == "fr") "fr-FR" else "en-US")
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, ctx.packageName)
        r.startListening(i)
    }

    fun stop() {
        active = false
        rec?.let { try { it.cancel(); it.destroy() } catch (_: Exception) {} }
        rec = null
    }
}
