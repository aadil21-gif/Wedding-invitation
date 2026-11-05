package app.seefar.assistant

import android.Manifest
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.provider.CalendarContract
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId

/** Writes to the phone's calendar (which syncs to Google). Only ever deletes entries SeeFar itself created. */
object Cal {
    private fun p(ctx: Context) = ctx.getSharedPreferences("seefar_cal", 0)

    private fun mine(ctx: Context): MutableList<Pair<Long, Long>> {
        val a = try { JSONArray(p(ctx).getString("ids", "[]")) } catch (e: Exception) { JSONArray() }
        return (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map { it.optLong("id") to it.optLong("s") }.toMutableList()
    }

    private fun save(ctx: Context, l: List<Pair<Long, Long>>) =
        p(ctx).edit().putString("ids", JSONArray(l.takeLast(200).map { JSONObject().put("id", it.first).put("s", it.second) }).toString()).apply()

    fun plannedToday(ctx: Context) = p(ctx).getString("planDate", "") == LocalDate.now().toString()

    private fun calendarId(ctx: Context): Long? {
        val proj = arrayOf(CalendarContract.Calendars._ID, CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.Calendars.IS_PRIMARY)
        val sel = "${CalendarContract.Calendars.VISIBLE}=1 AND ${CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL}>=${CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR}"
        var google: Long? = null
        var first: Long? = null
        ctx.contentResolver.query(CalendarContract.Calendars.CONTENT_URI, proj, sel, null, null)?.use { c ->
            while (c.moveToNext()) {
                val id = c.getLong(0)
                if (first == null) first = id
                if (c.getString(1) == "com.google") {
                    if (c.getInt(2) == 1) return id
                    if (google == null) google = id
                }
            }
        }
        return google ?: first
    }

    private fun deleteIds(ctx: Context, ids: List<Long>) {
        for (id in ids) try { ctx.contentResolver.delete(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, id), null, null) } catch (_: Exception) { }
    }

    private fun wipeMine(ctx: Context) {
        val ids = HashSet<Long>(mine(ctx).map { it.first })
        try {
            ctx.contentResolver.query(
                CalendarContract.Events.CONTENT_URI, arrayOf(CalendarContract.Events._ID),
                "${CalendarContract.Events.DESCRIPTION}=? AND ${CalendarContract.Events.DELETED}=0", arrayOf("Added by SeeFar"), null
            )?.use { c -> while (c.moveToNext()) ids.add(c.getLong(0)) }
        } catch (_: Exception) { }
        deleteIds(ctx, ids.toList())
        save(ctx, emptyList())
    }

    fun add(ctx: Context, title: String, date: String, time: String, minutes: Int): String {
        if (!Device.has(ctx, Manifest.permission.WRITE_CALENDAR)) return "Allow calendar access for SeeFar in Settings, then ask again."
        return try {
            val calId = calendarId(ctx) ?: return "I found no calendar on this phone. Add your Google account in Settings."
            val d = LocalDate.parse(date)
            val (h, m) = time.split(":").map { it.trim().toInt() }
            val start = LocalDateTime.of(d, LocalTime.of(h, m)).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
            // First entry of a new planning session: wipe everything SeeFar added before (any date),
            // found both by saved ids and by the "Added by SeeFar" tag, so older builds' entries go too.
            val nowMs = System.currentTimeMillis()
            val newBatch = nowMs - p(ctx).getLong("lastAdd", 0L) > 120_000L
            var keep = mine(ctx)
            if (newBatch) { wipeMine(ctx); keep = mutableListOf() }
            val v = ContentValues().apply {
                put(CalendarContract.Events.CALENDAR_ID, calId)
                put(CalendarContract.Events.TITLE, title.take(100))
                put(CalendarContract.Events.DESCRIPTION, "Added by SeeFar")
                put(CalendarContract.Events.DTSTART, start)
                put(CalendarContract.Events.DTEND, start + minutes.coerceIn(5, 720) * 60_000L)
                put(CalendarContract.Events.EVENT_TIMEZONE, ZoneId.systemDefault().id)
                put(CalendarContract.Events.HAS_ALARM, 1)
            }
            val uri = ctx.contentResolver.insert(CalendarContract.Events.CONTENT_URI, v) ?: return "The calendar refused that entry."
            val id = ContentUris.parseId(uri)
            try {
                ctx.contentResolver.insert(CalendarContract.Reminders.CONTENT_URI, ContentValues().apply {
                    put(CalendarContract.Reminders.EVENT_ID, id)
                    put(CalendarContract.Reminders.MINUTES, 30)
                    put(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT)
                })
            } catch (_: Exception) { }
            keep.add(id to start)
            save(ctx, keep)
            p(ctx).edit().putString("planDate", LocalDate.now().toString()).putLong("lastAdd", System.currentTimeMillis()).apply()
            "📅 $title · $date $time"
        } catch (e: Exception) {
            "I could not add that to the calendar."
        }
    }

    fun clear(ctx: Context): String {
        if (!Device.has(ctx, Manifest.permission.WRITE_CALENDAR)) return "Allow calendar access for SeeFar in Settings first."
        wipeMine(ctx)
        return "🗑 Removed the entries I had added. Yours are untouched."
    }
}
