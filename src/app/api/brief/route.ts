import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 15;

const WMO: Record<number, string> = {
  0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Fog",
  51: "Drizzle", 53: "Drizzle", 55: "Drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain",
  80: "Showers", 81: "Showers", 82: "Heavy showers", 95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm",
};

async function getJson(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(6_000) });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

/** Today's weather and prayer times for the home briefing. Both free, key-less public APIs. */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const num = (k: string, lo: number, hi: number, d: number) => {
    const v = Number(q.get(k));
    return Number.isFinite(v) && q.get(k) !== null && v >= lo && v <= hi ? v : d;
  };
  // Islamabad when location is off.
  const lat = num("lat", -90, 90, 33.6844);
  const lon = num("lon", -180, 180, 73.0479);

  const [wx, pr] = await Promise.allSettled([
    getJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`
    ),
    getJson(`https://api.aladhan.com/v1/timings?latitude=${lat}&longitude=${lon}&method=1`),
  ]);

  const weather =
    wx.status === "fulfilled"
      ? {
          temp: Math.round(wx.value.current.temperature_2m),
          summary: WMO[wx.value.current.weather_code] ?? "",
          hi: Math.round(wx.value.daily.temperature_2m_max[0]),
          lo: Math.round(wx.value.daily.temperature_2m_min[0]),
          rain: Math.round(wx.value.daily.precipitation_probability_max?.[0] ?? 0),
        }
      : null;

  let prayers: Record<string, string> | null = null;
  if (pr.status === "fulfilled" && pr.value?.data?.timings) {
    const t = pr.value.data.timings;
    prayers = {};
    for (const k of ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"]) prayers[k] = String(t[k]).slice(0, 5);
  }
  return NextResponse.json({ weather, prayers }, { headers: { "Cache-Control": "private, max-age=900" } });
}
