import type { Card, DeviceContext } from "./types";

/**
 * Server-side "data tools": the model asks for one, the server runs it,
 * and the model then phrases the answer. All use free, key-less public APIs
 * except `search`, which needs TAVILY_API_KEY and is offered only if set.
 */

export interface ToolResult {
  /** Plain text handed back to the model. */
  text: string;
  card?: Card;
}

const TIMEOUT = 7_000;

async function getJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`${new URL(url).host} returned ${res.status}`);
  return res.json();
}

const str = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// ---------- weather (Open-Meteo, no key) ----------

const WMO: Record<number, string> = {
  0: "clear sky", 1: "mostly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "freezing fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain", 71: "light snow", 73: "snow", 75: "heavy snow",
  80: "rain showers", 81: "heavy rain showers", 82: "violent rain showers",
  95: "thunderstorm", 96: "thunderstorm with hail", 99: "severe thunderstorm with hail",
};

async function weather(args: Record<string, unknown>, ctx: DeviceContext): Promise<ToolResult> {
  const place = str(args.place);
  let lat = ctx.lat;
  let lon = ctx.lon;
  let name = "your location";
  if (place) {
    const geo = await getJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1`
    );
    const hit = geo.results?.[0];
    if (!hit) return { text: `No place found called "${place}".` };
    lat = hit.latitude;
    lon = hit.longitude;
    name = [hit.name, hit.country].filter(Boolean).join(", ");
  } else if (lat === undefined || lon === undefined) {
    // Home base fallback when location access was not granted.
    lat = 33.6844;
    lon = 73.0479;
    name = "Islamabad";
  }
  const w = await getJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=3`
  );
  const c = w.current;
  const summary = WMO[c.weather_code] ?? "unknown conditions";
  const days = (w.daily.time as string[]).map((d, i) => ({
    label: new Date(d + "T12:00:00").toLocaleDateString("en", { weekday: "short" }),
    min: Math.round(w.daily.temperature_2m_min[i]),
    max: Math.round(w.daily.temperature_2m_max[i]),
    rain: Math.round(w.daily.precipitation_probability_max[i] ?? 0),
  }));
  const card: Card = {
    type: "weather",
    place: name,
    temp: Math.round(c.temperature_2m),
    feels: Math.round(c.apparent_temperature),
    humidity: Math.round(c.relative_humidity_2m),
    wind: Math.round(c.wind_speed_10m),
    summary,
    days,
  };
  return {
    text:
      `${name}: ${card.temp} C, feels like ${card.feels}, ${summary}, humidity ${card.humidity}%, wind ${card.wind} km/h. ` +
      days.map((d) => `${d.label} ${d.min}-${d.max} C, ${d.rain}% rain`).join("; "),
    card,
  };
}

// ---------- Wikipedia ----------

async function wiki(args: Record<string, unknown>): Promise<ToolResult> {
  const query = str(args.query);
  if (!query) return { text: "No query given." };
  const found = await getJson(
    `https://en.wikipedia.org/w/api.php?action=opensearch&limit=1&format=json&search=${encodeURIComponent(query)}`
  );
  const title = found?.[1]?.[0];
  if (!title) return { text: `Wikipedia has nothing for "${query}".` };
  const s = await getJson(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
  );
  const extract = String(s.extract ?? "").slice(0, 700);
  return {
    text: `${s.title}: ${extract}`,
    card: {
      type: "wiki",
      title: s.title,
      extract,
      url: s.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    },
  };
}

// ---------- currency (open.er-api.com, no key) ----------

async function currency(args: Record<string, unknown>): Promise<ToolResult> {
  const from = str(args.from, 3).toUpperCase();
  const to = str(args.to, 3).toUpperCase();
  const amount = Number(args.amount ?? 1);
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || !Number.isFinite(amount)) {
    return { text: "Need 3-letter currency codes like USD and PKR, and a number." };
  }
  const data = await getJson(`https://open.er-api.com/v6/latest/${from}`);
  const rate = data?.rates?.[to];
  if (typeof rate !== "number") return { text: `No rate found from ${from} to ${to}.` };
  const result = Math.round(amount * rate * 100) / 100;
  return {
    text: `${amount} ${from} = ${result} ${to} (rate ${rate}). Rates are indicative, not bank rates.`,
    card: { type: "currency", from, to, amount, result, rate },
  };
}

// ---------- prayer times (Aladhan, no key) ----------

async function prayer(args: Record<string, unknown>): Promise<ToolResult> {
  const city = str(args.city) || "Islamabad";
  const country = str(args.country) || "Pakistan";
  // method 1 = University of Islamic Sciences, Karachi (the usual one in Pakistan).
  const data = await getJson(
    `https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}&method=1`
  );
  const t = data?.data?.timings;
  if (!t) return { text: `No prayer times found for ${city}.` };
  const times: Record<string, string> = {};
  for (const k of ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"]) times[k] = String(t[k]).slice(0, 5);
  return {
    text:
      `Prayer times for ${city} today (Karachi method): ` +
      Object.entries(times).map(([k, v]) => `${k} ${v}`).join(", "),
    card: { type: "prayer", city, date: String(data.data.date?.readable ?? ""), times },
  };
}

// ---------- calculator (no eval) ----------

function calcExpr(input: string): number {
  const src = input.replace(/\s+/g, "").replace(/×/g, "*").replace(/÷/g, "/").replace(/,/g, "");
  let i = 0;
  const peek = () => src[i];
  function number(): number {
    const m = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(src.slice(i));
    if (!m) throw new Error("number expected");
    i += m[0].length;
    return parseFloat(m[0]);
  }
  function primary(): number {
    if (peek() === "(") {
      i++;
      const v = expr();
      if (peek() !== ")") throw new Error("missing )");
      i++;
      return v;
    }
    if (peek() === "-") { i++; return -primary(); }
    if (peek() === "+") { i++; return primary(); }
    const fn = /^(sqrt|abs|round|floor|ceil|ln|log|sin|cos|tan)\(/.exec(src.slice(i));
    if (fn) {
      i += fn[1].length;
      const v = primary();
      const f: Record<string, (x: number) => number> = {
        sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
        ln: Math.log, log: Math.log10, sin: Math.sin, cos: Math.cos, tan: Math.tan,
      };
      return f[fn[1]](v);
    }
    const v = number();
    if (peek() === "%") { i++; return v / 100; }
    return v;
  }
  function power(): number {
    const base = primary();
    if (peek() === "^") { i++; return Math.pow(base, power()); }
    return base;
  }
  function term(): number {
    let v = power();
    while (peek() === "*" || peek() === "/") {
      const op = src[i++];
      const r = power();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function expr(): number {
    let v = term();
    while (peek() === "+" || peek() === "-") {
      const op = src[i++];
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  const out = expr();
  if (i !== src.length) throw new Error("unexpected character");
  return out;
}

async function calc(args: Record<string, unknown>): Promise<ToolResult> {
  const expression = str(args.expression, 200);
  try {
    const v = calcExpr(expression);
    if (!Number.isFinite(v)) return { text: "That calculation has no finite answer." };
    const result = String(Math.round(v * 1e9) / 1e9);
    return { text: `${expression} = ${result}`, card: { type: "calc", expression, result } };
  } catch (e) {
    return { text: `Could not calculate that (${(e as Error).message}). Rewrite it using + - * / ^ ( ).` };
  }
}

// ---------- time ----------

async function time(_args: Record<string, unknown>, ctx: DeviceContext): Promise<ToolResult> {
  const d = new Date(ctx.nowIso);
  const text = d.toLocaleString("en-GB", {
    timeZone: ctx.timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return { text: `It is ${text} (${ctx.timeZone}).` };
}

// ---------- web search (Tavily, optional, unverified against the live API) ----------

async function search(args: Record<string, unknown>): Promise<ToolResult> {
  const key = process.env.TAVILY_API_KEY;
  const query = str(args.query, 200);
  if (!key) return { text: "Web search is not set up." };
  const data = await getJson("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: 4, include_answer: true }),
  });
  const results = (data.results ?? []).slice(0, 4).map((r: { title: string; url: string; content: string }) => ({
    title: String(r.title).slice(0, 120),
    url: String(r.url),
    snippet: String(r.content).slice(0, 240),
  }));
  return {
    text:
      (data.answer ? `Summary: ${String(data.answer).slice(0, 500)}\n` : "") +
      results.map((r: { title: string; snippet: string }) => `${r.title}: ${r.snippet}`).join("\n"),
    card: { type: "search", query, results },
  };
}

export const TOOL_HELP: Record<string, string> = {
  weather: 'weather {"place":"city, optional; omit for here"}',
  wiki: 'wiki {"query":"topic, person, place or thing"}',
  currency: 'currency {"amount":number,"from":"USD","to":"PKR"}',
  prayer: 'prayer {"city":"optional, default Islamabad"}',
  calc: 'calc {"expression":"(12+8)*3^2"}',
  time: "time {}",
  search: 'search {"query":"web search for current news and facts"}',
};

/** Tools a given turn may use. Kid mode gets only the harmless ones. */
export function availableTools(kid: boolean): string[] {
  if (kid) return ["calc", "time", "wiki"];
  const all = ["weather", "wiki", "currency", "prayer", "calc", "time"];
  if (process.env.TAVILY_API_KEY) all.push("search");
  return all;
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: DeviceContext
): Promise<ToolResult> {
  try {
    switch (name) {
      case "weather": return await weather(args, ctx);
      case "wiki": return await wiki(args);
      case "currency": return await currency(args);
      case "prayer": return await prayer(args);
      case "calc": return await calc(args);
      case "time": return await time(args, ctx);
      case "search": return await search(args);
      default: return { text: `Unknown tool ${name}.` };
    }
  } catch (e) {
    return { text: `The ${name} lookup failed (${(e as Error).message}). Tell the user it is unavailable right now.` };
  }
}
