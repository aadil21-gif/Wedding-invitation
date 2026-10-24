package app.seefar.assistant

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object C {
    val bg = Color(0xFF0B1020)
    val card = Color(0xFF151C33)
    val card2 = Color(0xFF1E2747)
    val text = Color(0xFFF2F5FF)
    val dim = Color(0xFF9AA6C9)
    val blue = Color(0xFF4F7BFF)
    val red = Color(0xFFEF4135)
    val green = Color(0xFF2EC27E)
    val gold = Color(0xFFFFC857)
}

@Composable
fun BigButton(label: String, color: Color = C.blue, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier = modifier
            .heightIn(min = 56.dp)
            .background(color, RoundedCornerShape(18.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 14.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(label, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
    }
}

@Composable
fun Pill(label: String, selected: Boolean = false, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .background(if (selected) C.blue else C.card2, RoundedCornerShape(50))
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 10.dp)
    ) { Text(label, color = C.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold) }
}

@Composable
fun Card(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(C.card, RoundedCornerShape(22.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) { content() }
}

@Composable
fun TopBar(title: String, onBack: (() -> Unit)?, right: @Composable () -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (onBack != null) {
                Text("←", color = C.text, fontSize = 28.sp, modifier = Modifier.clickable(onClick = onBack).padding(end = 14.dp, top = 4.dp, bottom = 4.dp))
            }
            Text(title, color = C.text, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
        }
        Row(verticalAlignment = Alignment.CenterVertically) { right() }
    }
}
