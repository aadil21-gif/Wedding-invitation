package app.seefar.assistant

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import java.time.LocalTime

@Composable
fun HomeV2(brain: Brain) {
    val ctx = LocalContext.current
    var tick by remember { mutableStateOf(0) }
    LaunchedEffect(Unit) { while (true) { delay(3000); tick++ } }
    val streak = remember(tick) { Rec.streak(ctx) }
    val xp = remember(tick) { Rec.xp(ctx) }
    val used = remember(tick) { GuardStore.usedSec(ctx) / 60 }
    val limit = remember(tick) { GuardStore.limitMin(ctx) }
    val checked = remember(tick) { Rec.checkedToday(ctx) }
    val guardOn = remember(tick) { Guard.usageOn(ctx) && Guard.alive(ctx) }
    val ayah = remember { Content.ayahOfDay(ctx) }
    val hour = LocalTime.now().hour
    val hello = when { hour < 5 -> "Still up?"; hour < 12 -> "Good morning, Aadil"; hour < 18 -> "Good afternoon, Aadil"; else -> "Good evening, Aadil" }

    Column(Modifier.padding(horizontal = 16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        TopBar(hello, null) {
            StatChip("🔥", "$streak", C.gold)
            Spacer(Modifier.padding(3.dp))
            StatChip("⭐", "$xp", C.purple)
        }
        Card {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Level ${xp / 100 + 1} · ${levelName(xp)}", color = C.text, fontWeight = FontWeight.ExtraBold, fontSize = 16.sp)
                Text("${xp % 100}/100 XP", color = C.dim, fontSize = 13.sp)
            }
            XpBar((xp % 100) / 100f)
        }
        BigButton("🆘  I HAVE AN URGE", C.red, Modifier.fillMaxWidth()) { brain.recSub = "urge"; brain.screen = "sos" }

        if (ayah != null) Card {
            Text("Today's ayah · ${ayah.surah} ${ayah.ref}", color = C.dim, fontSize = 13.sp, fontWeight = FontWeight.Bold)
            Text(ayah.en, color = C.text, fontSize = 17.sp)
            Text(ayah.reflection, color = C.green.deep(), fontSize = 14.sp, fontWeight = FontWeight.Bold)
            Pill("Read more and tafsir") { brain.recSub = "daily"; brain.screen = "sos" }
        }

        Text("Today's quests", color = C.text, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
        Quest("🎙", "Talk to SeeFar", "Ask anything, read messages, plan tomorrow", C.blue) { brain.screen = "talk" }
        Quest(if (checked) "✅" else "📝", "Evening check-in", if (checked) "Done today. +5 XP" else "Two minutes. Mood, urges, one win", C.green) { brain.recSub = "checkin"; brain.screen = "sos" }
        Quest("🛡", "Guard", if (guardOn) "On · social $used of $limit min" else "Off · tap to switch it on", if (guardOn) C.green else C.red) { brain.screen = "guard" }
        Quest("🎮", "Train", "Calm games and exercises · +XP", C.purple) { brain.trainSub = "home"; brain.screen = "train" }
        Quest("📅", "Plan tomorrow", "Replaces what I added before", C.gold) { brain.screen = "talk"; brain.planTomorrow() }
        Spacer(Modifier.height(16.dp))
    }
}
