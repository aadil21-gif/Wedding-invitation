import { NextResponse } from "next/server";
import { COURSE } from "@/lib/frcourse";

/** The French course, so the Android app can show the same lessons. */
export function GET() {
  return NextResponse.json({ course: COURSE }, { headers: { "Cache-Control": "private, max-age=3600" } });
}
