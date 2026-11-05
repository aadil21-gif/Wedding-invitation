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

    fun add(ctx: Context, title: String, date: String, time: String, minutes: Int): String {
        if (!Device.has(ctx, Manifest.permission.WRITE_CALENDAR)) return "Allow calendar access for SeeFar in Settings, then ask again."
        return try {
            val calId = calendarId(ctx) ?: return "I found no calendar on this phone. Add your Google account in Settings."
            val d = LocalDate.parse(date)
            val (h, m) = time.split(":").map { it.trim().toInt() }
            val start = LocalDateTime.of(d, LocalTime.of(h, m)).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
            // Old entries SeeFar made earlier are cleaned out before adding new ones.
            val todayStart = LocalDate.now().atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()
            val all = mine(ctx)
            val old = all.filter { it.second < todayStart }
            deleteIds(ctx, old.map { it.first })
            val keep = all.filter { it.second >= todayStart }.toMutableList()
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
            p(ctx).edit().putString("planDate", LocalDate.now().toString()).apply()
            "📅 $title · $date $time"
        } catch (e: Exception) {
            "I could not add that to the calendar."
        }
    }

    fun clear(ctx: Context): String {
        if (!Device.has(ctx, Manifest.permission.WRITE_CALENDAR)) return "Allow calendar access for SeeFar in Settings first."
        val all = mine(ctx)
        deleteIds(ctx, all.map { it.first })
        save(ctx, emptyList())
        return "🗑 Removed ${all.size} entries I had added. Yours are untouched."
    }
}
