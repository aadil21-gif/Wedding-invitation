package app.seefar.assistant

import android.Manifest
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

class MainActivity : ComponentActivity() {
    private val brain: Brain by viewModels()

    private val perms = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        brain.boot()
        val needed = buildList {
            add(Manifest.permission.RECORD_AUDIO)
            add(Manifest.permission.CAMERA)
            add(Manifest.permission.CALL_PHONE)
            add(Manifest.permission.READ_CONTACTS)
            add(Manifest.permission.ACCESS_COARSE_LOCATION)
            if (android.os.Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
        }.filter { !Device.has(this, it) }
        if (needed.isNotEmpty()) perms.launch(needed.toTypedArray())

        setContent {
            MaterialTheme(colorScheme = darkColorScheme(background = C.bg, surface = C.card, primary = C.blue)) {
                Box(Modifier.fillMaxSize().background(C.bg).statusBarsPadding().navigationBarsPadding().imePadding()) {
                    when (brain.screen) {
                        "login" -> Login(brain)
                        "home" -> Home(brain)
                        "french" -> FrenchScreen(brain) { brain.screen = "home" }
                        else -> Text("SeeFar…", color = C.dim, modifier = Modifier.align(Alignment.Center), fontSize = 20.sp)
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Keep the screen on only while hands-free is running.
        if (brain.live) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    override fun onStop() {
        super.onStop()
        // No background listening yet: stop cleanly instead of hanging.
        if (brain.status == Status.Listening) brain.stopAll()
    }
}

@Composable
fun Login(brain: Brain) {
    var code by remember { mutableStateOf("") }
    Column(
        Modifier.fillMaxSize().padding(28.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text("👀", fontSize = 80.sp)
        Text("SeeFar", color = C.text, fontSize = 36.sp, fontWeight = FontWeight.ExtraBold)
        Text("Your friend who sees, hears and helps.", color = C.dim, fontSize = 16.sp, textAlign = TextAlign.Center)
        Spacer(Modifier.height(28.dp))
        OutlinedTextField(
            code, { code = it }, singleLine = true, label = { Text("Passcode") },
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { brain.login(code) }),
            modifier = Modifier.fillMaxWidth()
        )
        if (brain.error.isNotBlank()) Text(brain.error, color = C.red, modifier = Modifier.padding(top = 8.dp))
        Spacer(Modifier.height(16.dp))
        BigButton("Let's go", C.blue, Modifier.fillMaxWidth()) { brain.login(code) }
    }
}

private fun faceOf(mood: String) = when (mood) {
    "happy" -> "😄"; "excited" -> "🤩"; "curious" -> "🤔"; "sad" -> "😢"
    "surprised" -> "😮"; "sleepy" -> "😴"; "love" -> "😍"; else -> "🙂"
}

@Composable
fun Home(brain: Brain) {
    val ctx = LocalContext.current
    var typed by remember { mutableStateOf("") }
    var showSettings by remember { mutableStateOf(false) }
    if (showSettings) { SettingsScreen(brain) { showSettings = false }; return }

    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        TopBar("SeeFar", null) {
            Pill(if (brain.live) "🟢 Live" else "⚪ Live", brain.live) { brain.toggleLive() }
            Spacer(Modifier.size(8.dp))
            Pill(if (brain.cameraOn) "📷 On" else "📷 Off", brain.cameraOn) { brain.toggleCamera() }
            Spacer(Modifier.size(8.dp))
            Text("⚙", fontSize = 26.sp, color = C.text, modifier = Modifier.clickable { showSettings = true }.padding(6.dp))
        }

        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            if (brain.cameraOn) {
                Box(Modifier.fillMaxWidth().height(190.dp).clip(RoundedCornerShape(22.dp))) {
                    CameraView(brain.grabber, brain.frontCamera, Modifier.fillMaxSize())
                    Text("🔄", fontSize = 24.sp, modifier = Modifier.align(Alignment.TopEnd).padding(10.dp).clickable { brain.frontCamera = !brain.frontCamera })
                    Text("● I can see this", color = Color.White, fontSize = 12.sp, modifier = Modifier.align(Alignment.BottomStart).padding(10.dp).background(Color(0x99000000), RoundedCornerShape(50)).padding(horizontal = 8.dp, vertical = 3.dp))
                }
            } else if (brain.briefLine.isNotBlank()) {
                Row(Modifier.fillMaxWidth().background(C.card, RoundedCornerShape(18.dp)).padding(14.dp)) {
                    Text(brain.briefLine, color = C.text, fontSize = 15.sp)
                }
            }

            Orb(brain)

            val label = when (brain.status) {
                Status.Idle -> if (brain.error.isBlank()) "Tap me and just talk" else brain.error
                Status.Listening -> if (brain.partial.isBlank()) "Listening…" else "“${brain.partial}”"
                Status.Thinking -> "Thinking…"
                Status.Speaking -> "Speaking… (tap to stop)"
            }
            Text(label, color = if (brain.error.isNotBlank() && brain.status == Status.Idle) C.red else C.dim, fontSize = 16.sp, textAlign = TextAlign.Center)

            if (brain.shown.isNotBlank()) {
                Card {
                    if (brain.question.isNotBlank()) Text("You: " + brain.question, color = C.dim, fontSize = 14.sp)
                    Text(brain.shown, color = C.text, fontSize = 20.sp, lineHeight = 28.sp)
                    for (c in brain.chips) Text(c, color = C.green, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                    for (c in brain.cards) if (c.isNotBlank()) Text(c, color = C.gold, fontSize = 15.sp)
                }
            }
        }

        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Pill("👁 What's this?") { brain.ask("Look at the camera. What is this? If it is a medicine, read the name, what it is for and the usual warnings, and tell me to check the label.", true) }
            Pill("🇫🇷 Learn French") { brain.stopAll(); brain.screen = "french" }
            Pill("📰 Brief me") { brain.ask("Brief me for today: the time, weather, my reminders and anything important in my notifications. Keep it short and fun.") }
            Pill("🔔 My notifications") { brain.ask("Read my latest notifications and tell me which ones matter.") }
            Pill("🎲 Surprise me") { brain.ask("Tell me one random fascinating fact that I probably do not know.") }
            Pill("😏 Roast my phone use") { brain.ask("Look at how I used my phone today and roast me gently, then tell me what to do next.") }
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                typed, { typed = it }, modifier = Modifier.weight(1f), singleLine = true, placeholder = { Text("or type here") },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { brain.send(typed); typed = "" })
            )
            Pill("Send") { brain.send(typed); typed = "" }
        }
        Spacer(Modifier.height(4.dp))
    }
}

@Composable
fun Orb(brain: Brain) {
    val t = rememberInfiniteTransition(label = "orb")
    val pulse by t.animateFloat(1f, 1.09f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "p")
    val active = brain.status != Status.Idle
    val color = when (brain.status) {
        Status.Listening -> C.red
        Status.Thinking -> C.gold
        Status.Speaking -> C.green
        else -> C.blue
    }
    Box(
        Modifier.size(170.dp).scale(if (active) pulse else 1f).clip(CircleShape)
            .background(Brush.radialGradient(listOf(color.copy(alpha = 0.95f), color.copy(alpha = 0.35f))))
            .clickable { brain.micTap() },
        contentAlignment = Alignment.Center
    ) { Text(if (brain.status == Status.Listening) "🎤" else faceOf(brain.mood), fontSize = 76.sp) }
}

@Composable
fun SettingsScreen(brain: Brain, close: () -> Unit) {
    val ctx = LocalContext.current
    var tick by remember { mutableStateOf(0) }
    Column(Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        TopBar("Settings", close)
        val notif = tick >= 0 && Device.hasNotificationAccess(ctx)
        val usage = tick >= 0 && Device.hasUsageAccess(ctx)
        Card {
            Text("What I can do on this phone", color = C.text, fontWeight = FontWeight.Bold, fontSize = 18.sp)
            Text("Calls and WhatsApp by contact name, timers, reminders, navigation, music. For WhatsApp I open the chat with your message ready; you tap send (Android does not let apps press send for you).", color = C.dim, fontSize = 14.sp)
        }
        Card {
            Text(if (notif) "🔔 Reading notifications: ON" else "🔔 Reading notifications: OFF", color = C.text, fontWeight = FontWeight.Bold, fontSize = 17.sp)
            Text("Lets me tell you what matters (messages, emails that show up as notifications). I do not read your Gmail directly.", color = C.dim, fontSize = 14.sp)
            BigButton(if (notif) "Manage" else "Turn on", C.blue, Modifier.fillMaxWidth()) { Device.openNotificationSettings(ctx); tick++ }
        }
        Card {
            Text(if (usage) "⏳ Phone-use tracking: ON" else "⏳ Phone-use tracking: OFF", color = C.text, fontWeight = FontWeight.Bold, fontSize = 17.sp)
            Text("Lets me tell you when you are wasting time. Turn on SeeFar in the list.", color = C.dim, fontSize = 14.sp)
            BigButton(if (usage) "Manage" else "Turn on", C.blue, Modifier.fillMaxWidth()) { Device.openUsageSettings(ctx); tick++ }
        }
        Card {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("💬 Friendly nudges", color = C.text, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                    Text("A random fact or a tease every few hours (8am to 10pm).", color = C.dim, fontSize = 14.sp)
                }
                Switch(brain.nudgesOn, { brain.setNudges(it) })
            }
        }
        Card {
            Text("Hands-free", color = C.text, fontWeight = FontWeight.Bold, fontSize = 17.sp)
            Text("Turn on Live (top of the home screen) and I keep listening and answering while the app is open and the screen stays on. With the camera on, I will also comment on what I see after a quiet minute or two.", color = C.dim, fontSize = 14.sp)
        }
        BigButton("Forget what you know about me", C.card2, Modifier.fillMaxWidth()) { brain.store.forget() }
        BigButton("Log out", C.red, Modifier.fillMaxWidth()) { close(); brain.logout() }
        Text("SeeFar 2.0 · camera frames go to the AI only when the camera is on.", color = C.dim, fontSize = 12.sp)
    }
}
