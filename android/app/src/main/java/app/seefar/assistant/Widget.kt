package app.seefar.assistant

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/** Home-screen widget: one tap to talk, one tap to French. No data leaves the phone from here. */
class SeeFarWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        val lines = listOf("At your service, monsieur.", "Your French will not learn itself.", "Speak. I shall pretend to be surprised.", "Bonjour. Coffee first, grammar second.")
        for (id in ids) {
            val v = RemoteViews(ctx.packageName, R.layout.widget)
            v.setTextViewText(R.id.w_line, lines[(System.currentTimeMillis() / 3_600_000 % lines.size).toInt()])
            v.setOnClickPendingIntent(R.id.w_talk, pi(ctx, "talk", 1))
            v.setOnClickPendingIntent(R.id.w_french, pi(ctx, "french", 2))
            mgr.updateAppWidget(id, v)
        }
    }

    private fun pi(ctx: Context, go: String, code: Int): PendingIntent =
        PendingIntent.getActivity(
            ctx, code, Intent(ctx, MainActivity::class.java).putExtra("go", go).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
}
