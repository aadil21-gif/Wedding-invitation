# SeeFar

A voice-first assistant app for a user with low vision. It sees through
the phone camera, answers questions aloud, remembers what it saw, helps
with navigation, and tracks wellness over time.

This is a personal tool, built one milestone at a time. **It is not a
medical device** and does not diagnose, treat, or monitor any disease —
see "About the health module" below.

Current status: **Milestone 0 — scaffold.** You can open the app, type
one question, and get an answer back from Gemini through the app's own
server (your API key never reaches the browser). Voice, the camera, and
everything else come in later milestones.

## What's in Milestone 0

- A Next.js Progressive Web App (installable on Android Chrome) with a
  light theme, a high-contrast dark theme, and four text sizes.
- A passcode screen protecting the whole app, so a stranger who finds the
  URL can't burn through your free AI quota.
- One AI provider interface (`src/lib/ai/`) with a Gemini adapter plugged
  in. Groq, OpenRouter and Anthropic adapters are added in later
  milestones without changing anything that calls them.
- A single "ask a question" box on the home page that proves the whole
  pipeline: your text → the app's server → Gemini → back to your screen.

## Running it on your own computer

You need [Node.js](https://nodejs.org) 18 or later installed.

```bash
npm install
cp .env.example .env.local
```

Open `.env.local` and fill in:

- `APP_PASSCODE` — make up any passcode. The app won't call any AI
  provider until this is set.
- `GEMINI_API_KEY` — get a free key at
  [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

Then:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), enter your passcode,
and ask a question.

## Deploying to Vercel (free)

1. Push this repository to GitHub (already done if you're reading this
   from the repo).
2. On [vercel.com](https://vercel.com), import the repository as a new
   project. Framework preset: Next.js (auto-detected).
3. Before the first deploy, add environment variables under **Project
   Settings → Environment Variables**: `APP_PASSCODE` and
   `GEMINI_API_KEY`, same values as your `.env.local`. **Never paste real
   keys into chat, email, or this repository** — only into Vercel's
   dashboard or your local `.env.local`.
4. Deploy. Open the Vercel URL on your Android phone in Chrome, enter the
   passcode, and you should be able to ask a question. To install it as
   an app: Chrome menu → "Add to Home screen" / "Install app".

## Adding or changing a key later

Project Settings → Environment Variables on Vercel → edit the value →
redeploy (Vercel prompts you, or trigger one from the Deployments tab).
Locally, just edit `.env.local` and restart `npm run dev`.

## Backing up your data

Milestone 0 doesn't store anything yet (no camera, no memory, no health
log). Once Milestone 2 adds local storage, this section will describe the
Settings page's export/import buttons — all your data lives in your
phone's browser storage (IndexedDB), never on a server, so backing it up
means exporting that file yourself.

## AI providers and your data

All AI calls happen through the app's own server routes, behind your
passcode — your API keys never reach the browser, and a per-IP limit
caps how many requests the server will pass through per minute.

**Free-tier Gemini usage may be used by Google to improve its products**
(human reviewers may read API input/output on the free tier; paid usage
is excluded). Source:
[ai.google.dev/gemini-api/terms](https://ai.google.dev/gemini-api/terms),
checked 2026-10-23. Keep this in mind once the health module (Milestone 4)
exists — it is built to refuse free-provider calls for health data unless
you explicitly turn that on in Settings.

Model IDs, and which providers may or may not train on your data, are
centralized in `src/lib/ai/config.ts`, with the source and the date each
entry was checked written next to it. Re-verify before trusting an old
entry — provider terms and model names change.

## About the health module

Not built yet (Milestone 4+). When it exists: it will log symptoms and
vitals you enter yourself, show trends against your own baseline, and
raise alerts using a deterministic, cited rules engine — never an AI
guess. It will not diagnose, will not suggest doses or medicine changes,
and will always say to confirm with a pharmacist or doctor. Before
sharing this app with anyone else, or using it for someone other than
yourself, get advice on medical-device software rules in Pakistan and
review the privacy implications of storing health data.

## Project layout

```
src/
  app/
    page.tsx           Home screen (M0: the question box + settings)
    login/page.tsx      Passcode screen
    api/auth/route.ts   Passcode check -> httpOnly cookie
    api/chat/route.ts   The "hello" AI call
    manifest.ts         PWA manifest
  components/            UI: settings, login form, chat demo
  lib/
    auth.ts              Cookie constants (edge-safe, no Node APIs)
    passcode.ts           Passcode comparison (Node-only, timing-safe)
    rateLimit.ts           Per-IP request limiter
    ai/
      types.ts            The AIProvider interface every adapter implements
      config.ts            Model IDs, data policy, capabilities — one file
      registry.ts           Picks a provider per feature, falls back on 429
      providers/gemini.ts    The Gemini adapter
  middleware.ts            Passcode gate + rate limiting, runs before every route
public/
  icons/                   App icons (regular + maskable, 192/512px)
  sw.js                    Minimal offline app-shell caching
```

## Known limitations (by design, for now)

- PWA, not a native app: no Android Health Connect, no background
  processing, no wake word. A Capacitor wrapper to add those is a later,
  separate phase — not attempted here.
- The per-IP rate limit is in-memory and per serverless instance; it's a
  cheap first line of defence for a single-user app, not a hard
  multi-instance guarantee.
