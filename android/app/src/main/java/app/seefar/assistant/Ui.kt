package app.seefar.assistant

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Light, chunky, game-like palette. */
object C {
    val bg = Color(0xFFFFFFFF)
    val card = Color(0xFFF7F7F7)
    val card2 = Color(0xFFE5E5E5)
    val line = Color(0xFFE5E5E5)
    val text = Color(0xFF3C3C3C)
    val dim = Color(0xFF777777)
    val blue = Color(0xFF1CB0F6)
    val red = Color(0xFFFF4B4B)
    val green = Color(0xFF58CC02)
    val gold = Color(0xFFE5A400)
    val purple = Color(0xFFCE82FF)
}

fun Color.deep() = Color(red * 0.80f, green * 0.80f, blue * 0.80f, alpha)

/** Big chunky button with a solid "pressed-edge" underneath. */
@Composable
fun BigButton(label: String, color: Color = C.blue, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val light = color.luminance() > 0.7f
    Box(
        modifier = modifier
            .padding(bottom = 4.dp)
            .drawBehind { drawRoundRect(color.deep(), topLeft = Offset(0f, 4.dp.toPx()), size = size, cornerRadius = CornerRadius(16.dp.toPx())) }
            .background(color, RoundedCornerShape(16.dp))
            .clickable(onClick = onClick)
            .heightIn(min = 52.dp)
            .padding(horizontal = 18.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(label, color = if (light) C.text else Color.White, fontSize = 17.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center)
    }
}

@Composable
fun Pill(label: String, selected: Boolean = false, onClick: () -> Unit) {
    val face = if (selected) C.blue else Color.White
    val edge = if (selected) C.blue.deep() else C.line
    Box(
        modifier = Modifier
            .padding(bottom = 3.dp)
            .drawBehind { drawRoundRect(edge, topLeft = Offset(0f, 3.dp.toPx()), size = size, cornerRadius = CornerRadius(14.dp.toPx())) }
            .background(face, RoundedCornerShape(14.dp))
            .border(2.dp, if (selected) C.blue else C.line, RoundedCornerShape(14.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 9.dp),
        contentAlignment = Alignment.Center
    ) { Text(label, color = if (selected) Color.White else C.text, fontSize = 15.sp, fontWeight = FontWeight.Bold) }
}

@Composable
fun Card(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(Color.White, RoundedCornerShape(18.dp))
            .border(2.dp, C.line, RoundedCornerShape(18.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) { content() }
}

/** One row of the daily quest list. */
@Composable
fun Quest(icon: String, title: String, sub: String, accent: Color = C.green, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth()
            .background(Color.White, RoundedCornerShape(18.dp))
            .border(2.dp, C.line, RoundedCornerShape(18.dp))
            .clickable(onClick = onClick)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Box(Modifier.size(46.dp).background(accent.copy(alpha = 0.18f), CircleShape), contentAlignment = Alignment.Center) { Text(icon, fontSize = 24.sp) }
        Column(Modifier.weight(1f)) {
            Text(title, color = C.text, fontSize = 17.sp, fontWeight = FontWeight.ExtraBold)
            Text(sub, color = C.dim, fontSize = 13.sp)
        }
        Text("GO", color = accent.deep(), fontSize = 14.sp, fontWeight = FontWeight.ExtraBold)
    }
}

@Composable
fun StatChip(icon: String, value: String, color: Color) {
    Row(
        Modifier.background(color.copy(alpha = 0.14f), RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text(icon, fontSize = 16.sp)
        Text(value, color = color.deep(), fontSize = 15.sp, fontWeight = FontWeight.ExtraBold)
    }
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

val TABS = listOf("home" to ("🏠" to "Home"), "sos" to ("🆘" to "Help"), "guard" to ("🛡" to "Guard"), "french" to ("🇫🇷" to "French"), "me" to ("⚙" to "Me"))

@Composable
fun NavBar(current: String, onGo: (String) -> Unit) {
    Row(
        Modifier.fillMaxWidth().border(1.dp, C.line).background(Color.White).padding(horizontal = 6.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        for ((key, v) in TABS) {
            val on = key == current
            Column(
                Modifier.weight(1f).padding(horizontal = 3.dp)
                    .background(if (on) C.blue.copy(alpha = 0.12f) else Color.Transparent, RoundedCornerShape(14.dp))
                    .border(2.dp, if (on) C.blue else Color.Transparent, RoundedCornerShape(14.dp))
                    .clickable { onGo(key) }.padding(vertical = 6.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(v.first, fontSize = 22.sp)
                Text(v.second, color = if (on) C.blue.deep() else C.dim, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}
