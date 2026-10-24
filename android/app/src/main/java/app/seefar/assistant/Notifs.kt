package app.seefar.assistant

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import java.time.LocalTime

/** Recent notifications the assistant can read to you. Kept on the phone; only the latest few are sent as context. */
object Notifs {
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("seefar_notifs", Context.MODE_PRIVATE)

    fun recent(ctx: Context): List<String> {
        val a = try { JSONArray(prefs(ctx).getString("list", "[]")) } catch (e: Exception) { JSONArray() }
        return (0 until a.length()).map { a.getString(it) }.reversed()
    }

    fun add(ctx: Context, line: String) {
        val l = recent(ctx).reversed().toMutableList()
        if (l.lastOrNull() == line) return
        l.add(line)
        prefs(ctx).edit().putString("list", JSONArray(l.takeLast(15)).toString()).apply()
    }

    fun channel(ctx: Context) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel("seefar", "SeeFar nudges", NotificationManager.IMPORTANCE_DEFAULT))
    }

    fun post(ctx: Context, title: String, text: String, id: Int) {
        channel(ctx)
        val open = android.app.PendingIntent.getActivity(
            ctx, 0, android.content.Intent(ctx, MainActivity::class.java),
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
        )
        val n = NotificationCompat.Builder(ctx, "seefar")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title).setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(open).setAutoCancel(true).build()
        try {
            (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(id, n)
        } catch (e: SecurityException) { /* notification permission not granted */ }
    }
}

class SeeFarNotificationListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName == packageName || sbn.isOngoing) return
        val n = sbn.notification
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        val title = n.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
        val text = n.extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
        if (title.isBlank() && text.isBlank()) return
        val app = try { packageManager.getApplicationLabel(packageManager.getApplicationInfo(sbn.packageName, 0)).toString() } catch (e: Exception) { sbn.packageName }
        Notifs.add(this, "$app · $title: $text".take(200))
    }
}

class ReminderWorker(ctx: Context, p: WorkerParameters) : Worker(ctx, p) {
    override fun doWork(): Result {
        Notifs.post(applicationContext, "Reminder", inputData.getString("text") ?: "Time!", (System.nanoTime() % 100000).toInt())
        return Result.success()
    }
}

/** Every few hours: a fun fact, or a pointed word about wasted time. */
class NudgeWorker(ctx: Context, p: WorkerParameters) : CoroutineWorker(ctx, p) {
    override suspend fun doWork(): Result {
        val hour = LocalTime.now().hour
        if (hour < 8 || hour >= 22) return Result.success()
        Api.init(applicationContext)
        val usage = Device.usageToday(applicationContext)
        val heavy = usage.any { u ->
            val parts = u.split(" ")
            val mins = parts.getOrNull(parts.size - 2)?.toIntOrNull() ?: 0
            val social = listOf("instagram", "tiktok", "facebook", "youtube", "snapchat", "twitter", "reddit", "netflix", "game")
            mins >= 40 && social.any { u.lowercase().contains(it) }
        }
        val kind = when {
            heavy -> "usage"
            hour in 8..10 -> "morning"
            hour % 2 == 0 -> "fact"
            else -> "idle"
        }
        return try {
            val say = Api.nudge(kind, usage, facts = Store(applicationContext).facts.takeLast(10))
            if (say.isNotBlank()) Notifs.post(applicationContext, "SeeFar", say, 7001)
            Result.success()
        } catch (e: Exception) {
            Result.success()
        }
    }
}
