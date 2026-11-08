package app.seefar.assistant

import android.content.Context
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

// ---------------------------------------------------------------- progress

fun levelName(xp: Int): String = when (xp / 100) {
    0 -> "Seed"; 1 -> "Sprout"; 2 -> "Steady"; 3 -> "Anchor"; 4 -> "Tide"; 5 -> "Mountain"; else -> "Lighthouse"
}

@Composable
fun XpBar(frac: Float) {
    Box(Modifier.fillMaxWidth().height(12.dp).background(C.card2, RoundedCornerShape(6.dp))) {
        Box(Modifier.fillMaxWidth(frac.coerceIn(0.03f, 1f)).height(12.dp).background(C.purple, RoundedCornerShape(6.dp)))
    }
}

object Plays {
    private fun p(ctx: Context) = ctx.getSharedPreferences("seefar_plays", 0)
    private fun today() = java.time.LocalDate.now().toString()
    fun today(ctx: Context): Int = if (p(ctx).getString("d", "") == today()) p(ctx).getInt("n", 0) else 0
    fun done(ctx: Context, xp: Int) {
        val n = today(ctx) + 1
        p(ctx).edit().putString("d", today()).putInt("n", n).apply()
        Rec.addXp(ctx, xp)
    }
}

// ---------------------------------------------------------------- hub

@Composable
fun TrainHome(brain: Brain) {
    val ctx = LocalContext.current
    var tick by remember { mutableStateOf(0) }
    val done = remember(tick, brain.trainSub) { Plays.today(ctx) }
    val xp = remember(tick, brain.trainSub) { Rec.xp(ctx) }
    val back: () -> Unit = { brain.trainSub = "home"; tick++ }
    when (brain.trainSub) {
        "surf" -> SurfGame(back)
        "defuse" -> DefuseGame(back)
        "quest" -> QuestGame(back)
        "ground" -> GroundGame(back)
        "bubbles" -> BubbleGame(back)
        else -> Column(Modifier.padding(horizontal = 16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            TopBar("Train", null) { StatChip("⭐", "$xp", C.purple) }
            Card {
                Text("Daily goal: 2 exercises", color = C.text, fontWeight = FontWeight.ExtraBold, fontSize = 17.sp)
                XpBar(done / 2f)
                Text(if (done >= 2) "Goal done today. Keep going if you like." else "$done of 2 done today.", color = C.dim, fontSize = 13.sp)
            }
            Quest("🌊", "Ride the wave", "Breathing game · hold to breathe in · +10 XP", C.blue) { brain.trainSub = "surf" }
            Quest("☁️", "Let thoughts float", "Defusion exercise from ACT · +10 XP", C.purple) { brain.trainSub = "defuse" }
            Quest("🧭", "What would future-you do?", "5 real moments, pick the move · up to +25 XP", C.green) { brain.trainSub = "quest" }
            Quest("🖐", "5-4-3-2-1", "Grounding for when your head is loud · +10 XP", C.gold) { brain.trainSub = "ground" }
            Quest("🫧", "Pop and breathe", "Pure calm. No score pressure · +5 XP", C.blue) { brain.trainSub = "bubbles" }
            Text("Exercises use ideas from acceptance and commitment therapy, CBT, and habit science, written in my own words. They support treatment, they don't replace it.", color = C.dim, fontSize = 12.sp)
            Spacer(Modifier.height(16.dp))
        }
    }
}

// ---------------------------------------------------------------- 1. breathing wave

@Composable
fun SurfGame(close: () -> Unit) {
    val ctx = LocalContext.current
    var t by remember { mutableStateOf(0f) }
    var pressed by remember { mutableStateOf(false) }
    var hit by remember { mutableStateOf(0) }
    var total by remember { mutableStateOf(0) }
    var started by remember { mutableStateOf(false) }
    var finished by remember { mutableStateOf(false) }
    var round by remember { mutableStateOf(0) }
    val len = 40f

    LaunchedEffect(started, round) {
        if (started) {
            while (t < len) {
                delay(100)
                t += 0.1f
                val inPhase = (t % 8f) < 4f
                total++
                if (pressed == inPhase) hit++
            }
            val score = if (total == 0) 0 else hit * 100 / total
            Plays.done(ctx, 5 + score / 20)
            finished = true
        }
    }

    val c = t % 8f
    val target = if (c < 4f) 0.55f + 0.45f * (c / 4f) else 1f - 0.45f * ((c - 4f) / 4f)
    val s by animateFloatAsState(if (started) target else 0.7f, label = "wave")
    val score = if (total == 0) 0 else hit * 100 / total

    Column(Modifier.padding(horizontal = 16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        TopBar("Ride the wave", close)
        if (finished) {
            Text("🌊 Done", fontSize = 40.sp)
            Text("You matched the wave $score% of the time.", color = C.text, fontSize = 18.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            Text("+${5 + score / 20} XP. Urges rise and fall the same way. You just practised not fighting one.", color = C.dim, fontSize = 14.sp, textAlign = TextAlign.Center)
            BigButton("Again", C.blue, Modifier.fillMaxWidth()) { t = 0f; hit = 0; total = 0; finished = false; started = true; round++ }
            BigButton("Back", C.card2, Modifier.fillMaxWidth()) { close() }
        } else {
            Text(if (!started) "Hold the circle while it grows (breathe in). Let go while it shrinks (breathe out). 40 seconds." else if (c < 4f) "Breathe in · hold" else "Breathe out · let go", color = C.text, fontSize = 18.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            Box(Modifier.size(260.dp), contentAlignment = Alignment.Center) {
                Box(
                    Modifier.size(240.dp).scale(s).background(if (pressed) C.blue else C.blue.copy(alpha = 0.35f), CircleShape)
                        .pointerInput(Unit) { detectTapGestures(onPress = { pressed = true; tryAwaitRelease(); pressed = false }) }
                )
            }
            if (!started) BigButton("Start", C.green, Modifier.fillMaxWidth()) { started = true }
            else { Text("${(len - t).toInt()}s left · in sync $score%", color = C.dim, fontSize = 14.sp) }
        }
    }
}

// ---------------------------------------------------------------- 2. defusion

private val THOUGHT_SETS = listOf(
    listOf("I'm hopeless", "I always ruin things", "I can't stop", "Everyone is done with me", "One look won't matter", "I'm a bad person"),
    listOf("I'm failing everyone", "I'll never change", "I deserve to feel awful", "Nobody understands", "I need this to cope", "It's too late"),
)

@Composable
fun DefuseGame(close: () -> Unit) {
    val ctx = LocalContext.current
    val set = remember { THOUGHT_SETS.random() }
    val state = remember { mutableStateListOf(*Array(set.size) { 0 }) }
    var finished by remember { mutableStateOf(false) }
    val left = state.count { it < 2 }
    LaunchedEffect(left) { if (left == 0 && !finished) { Plays.done(ctx, 10); finished = true } }

    Column(Modifier.padding(horizontal = 16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        TopBar("Let thoughts float", close)
        if (finished) {
            Text("☁️ All floated away", color = C.text, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
            Text("+10 XP. A thought is something your mind says, not an order. You can notice it and still choose.", color = C.dim, fontSize = 15.sp)
            BigButton("Back", C.green, Modifier.fillMaxWidth()) { close() }
        } else {
            Text("Tap a thought to add 'I'm having the thought that…'. Tap again to let it float away.", color = C.dim, fontSize = 14.sp)
            for ((i, th) in set.withIndex()) {
                if (state[i] < 2) {
                    val txt = if (state[i] == 0) "“$th”" else "I'm having the thought that $th."
                    Box(
                        Modifier.fillMaxWidth().background(if (state[i] == 0) C.card else C.purple.copy(alpha = 0.18f), RoundedCornerShape(18.dp))
                            .border(2.dp, if (state[i] == 0) C.line else C.purple, RoundedCornerShape(18.dp))
                            .clickable { state[i] = state[i] + 1 }.padding(16.dp)
                    ) { Text(txt, color = C.text, fontSize = 17.sp, fontWeight = FontWeight.Bold) }
                }
            }
            Text("$left left", color = C.dim, fontSize = 13.sp)
        }
    }
}

// ---------------------------------------------------------------- 3. scenarios

private data class Sc(val q: String, val opts: List<String>, val best: Int, val why: String)

private val SCENES = listOf(
    Sc("11:40 pm. You're in bed with your phone. The pull starts.", listOf("Scroll a little to relax first", "Charge the phone in another room, stand up, wash your face", "Argue with the thought until it leaves"), 1, "Distance beats willpower. Remove the cue first; bed plus phone is the strongest trigger."),
    Sc("A message stings. You feel angry and small.", listOf("Numb it with the usual escape", "Write one sentence about what you feel, then walk 10 minutes", "Fire back a cutting reply"), 1, "Name the feeling and move the body. The escape works for a minute and costs hours."),
    Sc("You slipped. It's 1 am. What now?", listOf("It's ruined anyway, keep going", "Stop here. Phone away, wash, sleep, log it tomorrow", "Spend an hour attacking yourself"), 1, "A slip is data. Shame and continuing are what turn one slip into a night."),
    Sc("Urge at 8 out of 10, alone at home.", listOf("Promise yourself you'll never feel this again", "Ride it for 15 minutes doing something with your hands and body", "Check just one site to test yourself"), 1, "Urges peak and fall if you don't feed them. 'Testing' is feeding."),
    Sc("3 pm, bored after meetings.", listOf("Open social for a minute", "Walk 10 minutes or call someone, then pick one task", "Daydream about the old routine"), 1, "Boredom is a cue. Give it a better routine before the old one volunteers."),
    Sc("The phone shows a 'blocked' screen.", listOf("Hunt for a workaround", "Treat it as the plan working and do the next thing", "Turn the guard off 'just for tonight'"), 1, "Past you built the wall for this moment. Obey the wall, not the mood."),
    Sc("You're hungry, tired and stressed.", listOf("Push through, you're strong", "Eat, drink water, rest 20 minutes before deciding anything", "Reward yourself online"), 1, "Hungry, angry, lonely, tired all raise urges. Fix the body first."),
    Sc("You think: 'One look won't matter.'", listOf("Believe it, it sounds reasonable", "Say 'I'm having the thought that…' and turn to a task", "Shout it down in your head"), 1, "Notice the thought without obeying or fighting it. That's defusion."),
    Sc("A friend invites you out but you feel low.", listOf("Stay in alone with the phone", "Go for an hour", "Cancel with an excuse"), 1, "Isolation feeds the habit. Low mood plus company beats low mood plus screen."),
    Sc("Weekly review: 3 urges, 2 resisted.", listOf("Focus only on the one slip", "Note the 2 wins and the trigger of the 1", "Skip the review"), 1, "Count wins and learn the trigger. Reviewing without shame is how the pattern shrinks."),
)

@Composable
fun QuestGame(close: () -> Unit) {
    val ctx = LocalContext.current
    val picks = remember { SCENES.shuffled().take(5) }
    var i by remember { mutableStateOf(0) }
    var chosen by remember { mutableStateOf(-1) }
    var score by remember { mutableStateOf(0) }
    var finished by remember { mutableStateOf(false) }

    Column(Modifier.padding(horizontal = 16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        TopBar("What would future-you do?", close)
        if (finished) {
            Text("🧭 $score of 5", color = C.text, fontSize = 30.sp, fontWeight = FontWeight.ExtraBold)
            Text("+${score * 5} XP", color = C.gold, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
            BigButton("Back", C.green, Modifier.fillMaxWidth()) { close() }
        } else {
            val s = picks[i]
            XpBar((i + 1) / 5f)
            Text(s.q, color = C.text, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
            for ((k, o) in s.opts.withIndex()) {
                val shown = chosen >= 0
                val col = when { !shown -> C.line; k == s.best -> C.green; k == chosen -> C.red; else -> C.line }
                Box(
                    Modifier.fillMaxWidth().background(if (shown && k == s.best) C.green.copy(alpha = 0.15f) else Color.White, RoundedCornerShape(16.dp))
                        .border(2.dp, col, RoundedCornerShape(16.dp))
                        .clickable { if (chosen < 0) { chosen = k; if (k == s.best) score++ } }.padding(14.dp)
                ) { Text(o, color = C.text, fontSize = 16.sp, fontWeight = FontWeight.Bold) }
            }
            if (chosen >= 0) {
                Card { Text(if (chosen == s.best) "✅ Right move" else "Not quite", color = if (chosen == s.best) C.green.deep() else C.red, fontWeight = FontWeight.ExtraBold); Text(s.why, color = C.text, fontSize = 14.sp) }
                BigButton(if (i == 4) "Finish" else "Next", C.green, Modifier.fillMaxWidth()) {
                    if (i == 4) { Plays.done(ctx, score * 5); finished = true } else { i++; chosen = -1 }
                }
            }
        }
        Spacer(Modifier.height(12.dp))
    }
}

// ---------------------------------------------------------------- 4. grounding

private val SENSES = listOf(5 to "things you can see", 4 to "things you can feel", 3 to "things you can hear", 2 to "things you can smell", 1 to "thing you can taste")

@Composable
fun GroundGame(close: () -> Unit) {
    val ctx = LocalContext.current
    var step by remember { mutableStateOf(0) }
    var taps by remember { mutableStateOf(0) }
    var finished by remember { mutableStateOf(false) }
    Column(Modifier.padding(horizontal = 16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        TopBar("5-4-3-2-1", close)
        if (finished) {
            Text("🖐 Back in the room", color = C.text, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold)
            Text("+10 XP. Your mind was about the past or the future. Now it's here.", color = C.dim, fontSize = 15.sp, textAlign = TextAlign.Center)
            BigButton("Back", C.green, Modifier.fillMaxWidth()) { close() }
        } else {
            val (n, what) = SENSES[step]
            Text("Name $n $what.", color = C.text, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center)
            Text("Say each one out loud, then tap once.", color = C.dim, fontSize = 14.sp)
            Text("$taps / $n", color = C.purple.deep(), fontSize = 40.sp, fontWeight = FontWeight.ExtraBold)
            BigButton("Tap", C.purple, Modifier.fillMaxWidth()) {
                taps++
                if (taps >= n) {
                    taps = 0
                    if (step == SENSES.size - 1) { Plays.done(ctx, 10); finished = true } else step++
                }
            }
        }
    }
}

// ---------------------------------------------------------------- 5. bubbles

@Composable
fun BubbleGame(close: () -> Unit) {
    val ctx = LocalContext.current
    val popped = remember { mutableStateListOf(*Array(20) { false }) }
    var finished by remember { mutableStateOf(false) }
    val left = popped.count { !it }
    LaunchedEffect(left) { if (left == 0 && !finished) { Plays.done(ctx, 5); finished = true } }
    Column(Modifier.padding(horizontal = 16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        TopBar("Pop and breathe", close)
        if (finished) {
            Text("🫧 All popped. +5 XP", color = C.text, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
            BigButton("Back", C.green, Modifier.fillMaxWidth()) { close() }
        } else {
            Text("One slow breath per bubble.", color = C.dim, fontSize = 14.sp)
            for (row in (0 until 20).chunked(4)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                    for (k in row) {
                        Box(
                            Modifier.size(70.dp).background(if (popped[k]) Color.Transparent else C.blue.copy(alpha = 0.3f), CircleShape)
                                .border(2.dp, if (popped[k]) Color.Transparent else C.blue, CircleShape)
                                .clickable { popped[k] = true }
                        )
                    }
                }
            }
            Text("$left left", color = C.dim, fontSize = 13.sp)
        }
    }
}
