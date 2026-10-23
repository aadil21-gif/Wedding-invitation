/** French practice: starter deck, scoring, roast lines and spaced-repetition progress. */

export interface FrCard {
  id: string;
  fr: string;
  en: string;
  group: string;
  /** Optional memory trick shown after a miss. */
  tip?: string;
}

const g = (group: string, rows: [string, string, string?][]): FrCard[] =>
  rows.map(([fr, en, tip]) => ({ id: `${group}:${fr}`, fr, en, group, tip }));

export const DECK: FrCard[] = [
  ...g("Greetings", [
    ["bonjour", "hello / good day", "Bon + jour: good day. Use it until about 6 pm."],
    ["bonsoir", "good evening"],
    ["salut", "hi / bye (informal)"],
    ["au revoir", "goodbye"],
    ["à bientôt", "see you soon"],
    ["merci", "thank you"],
    ["merci beaucoup", "thank you very much"],
    ["s'il vous plaît", "please (formal)"],
    ["de rien", "you're welcome"],
    ["pardon", "sorry / excuse me"],
    ["excusez-moi", "excuse me (formal)"],
    ["oui", "yes"],
    ["non", "no"],
    ["peut-être", "maybe"],
    ["d'accord", "okay / agreed"],
  ]),
  ...g("Talking", [
    ["comment allez-vous ?", "how are you? (formal)"],
    ["ça va ?", "how's it going?"],
    ["ça va bien, merci", "I'm fine, thanks"],
    ["je m'appelle Aadil", "my name is Aadil"],
    ["enchanté", "nice to meet you"],
    ["je ne comprends pas", "I don't understand"],
    ["parlez-vous anglais ?", "do you speak English?"],
    ["je parle un peu français", "I speak a little French"],
    ["répétez, s'il vous plaît", "repeat, please"],
    ["parlez plus lentement, s'il vous plaît", "speak more slowly, please"],
  ]),
  ...g("Numbers", [
    ["un", "one"], ["deux", "two"], ["trois", "three"], ["quatre", "four"], ["cinq", "five"],
    ["six", "six"], ["sept", "seven"], ["huit", "eight"], ["neuf", "nine"], ["dix", "ten"],
    ["vingt", "twenty"], ["cent", "one hundred"],
  ]),
  ...g("Food", [
    ["le pain", "bread"], ["le fromage", "cheese"], ["l'eau", "water"], ["le café", "coffee"],
    ["le lait", "milk"], ["la pomme", "apple"], ["le riz", "rice"], ["le poulet", "chicken"],
    ["je voudrais un café", "I would like a coffee", "Je voudrais is the polite way to ask. Never je veux with a waiter."],
    ["je suis végétarien", "I'm vegetarian"],
    ["sans viande", "without meat"],
    ["l'addition, s'il vous plaît", "the bill, please"],
    ["c'est délicieux", "it's delicious"],
  ]),
  ...g("Getting around", [
    ["où est la gare ?", "where is the station?"],
    ["à gauche", "to the left"],
    ["à droite", "to the right"],
    ["tout droit", "straight ahead"],
    ["l'aéroport", "the airport"],
    ["l'hôtel", "the hotel"],
    ["combien ça coûte ?", "how much does it cost?"],
    ["la pharmacie", "the pharmacy"],
    ["l'hôpital", "the hospital"],
    ["j'ai besoin d'un médecin", "I need a doctor"],
    ["le médicament", "the medicine"],
    ["l'ordonnance", "the prescription"],
  ]),
  ...g("Core verbs", [
    ["je suis", "I am", "être: je suis, tu es, il est."],
    ["j'ai", "I have", "avoir: j'ai, tu as, il a."],
    ["je vais", "I go / I'm going"],
    ["je veux", "I want"],
    ["je peux", "I can"],
    ["je fais", "I do / I make"],
  ]),
  ...g("Time and words", [
    ["aujourd'hui", "today"], ["demain", "tomorrow"], ["hier", "yesterday"], ["maintenant", "now"],
    ["toujours", "always"], ["jamais", "never"], ["le matin", "the morning"], ["le soir", "the evening"],
    ["qui", "who"], ["quoi", "what"], ["où", "where"], ["quand", "when"],
    ["pourquoi", "why"], ["comment", "how"],
    ["rouge", "red"], ["bleu", "blue"], ["vert", "green"], ["jaune", "yellow"], ["noir", "black"], ["blanc", "white"],
  ]),
];

/** Lowercase, no accents, no punctuation: so a missing accent is "close", not wrong. */
export function plain(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lev(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)] as number[]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

/** 0..1 similarity between what was heard/typed and the target, ignoring accents. */
export function similarity(heard: string, target: string): number {
  const a = plain(heard);
  const b = plain(target);
  if (!a || !b) return 0;
  return 1 - lev(a, b) / Math.max(a.length, b.length);
}

/** True when the accents differ but the letters match. */
export function accentOnly(heard: string, target: string): boolean {
  return plain(heard) === plain(target) && heard.trim().toLowerCase() !== target.trim().toLowerCase();
}

export type Intensity = "gentle" | "spicy" | "brutal";
export type Bucket = "great" | "ok" | "bad" | "terrible";

export function bucketOf(score: number): Bucket {
  return score >= 0.92 ? "great" : score >= 0.75 ? "ok" : score >= 0.5 ? "bad" : "terrible";
}

/**
 * Offline roasts so feedback is instant. They go after the mistake, never the
 * person's looks, family, faith, country or health. {t} is the target phrase.
 */
const ROASTS: Record<Intensity, Record<Bucket, string[]>> = {
  gentle: {
    great: ["Très bien! That was actually good.", "Parfait. I almost have nothing to say."],
    ok: ["Close! Your accent just needs a little polish.", "Nearly there. Say it once more for me."],
    bad: ["Hmm. That was brave. Try {t} again.", "Good effort. The word is {t}. Slower this time."],
    terrible: ["That was creative, but it was not French. It's {t}.", "Let's reset. Listen, then say {t}."],
  },
  spicy: {
    great: ["Wait, that was correct? Who helped you?", "Okay, okay. Don't let it go to your head. Très bien.", "Parfait. Screenshot it, it won't happen often."],
    ok: ["Almost. You said it like a tourist who read the menu twice.", "Close, but your R is still hiding in your pocket. {t}.", "Seventy percent. Seventy percent of a croissant is still a crumb."],
    bad: ["That was a bold choice. Wrong, but bold. It's {t}.", "I have heard pigeons in Paris with better pronunciation. {t}. Again.", "You butchered it, and I say that with love. {t}."],
    terrible: ["Mon Dieu. Was that French or a sneeze? It's {t}.", "I've seen baguettes with better grammar. {t}. Again.", "That sound will haunt me. Try {t}, and breathe first."],
  },
  brutal: {
    great: ["...Fine. Correct. Do not expect a medal.", "Correct. Suspicious. Who is feeding you answers?"],
    ok: ["Almost is how people describe a collapsed soufflé. {t}.", "Your accent is a crime scene, but the victim survived. {t}."],
    bad: ["That was an assault on the French language. The word is {t}. Again.", "My ears filed a complaint. {t}. Again, and with feeling."],
    terrible: ["Honestly, a vending machine speaks better French. {t}. Again.", "Zero. A glorious, perfectly round zero. {t}. Again."],
  },
};

export function roastFor(score: number, intensity: Intensity, target: string): string {
  const lines = ROASTS[intensity][bucketOf(score)];
  return lines[Math.floor(Math.random() * lines.length)].replaceAll("{t}", target);
}

// ---------- progress ----------

export interface FrProgress {
  cards: Record<string, { box: number; due: number }>;
  xp: number;
  streak: number;
  lastDay: string;
}

export const EMPTY_PROGRESS: FrProgress = { cards: {}, xp: 0, streak: 0, lastDay: "" };
const DAY = 86_400_000;
/** Review gaps per Leitner box, in days. */
const GAPS = [0, 1, 3, 7, 21];

export function parseProgress(raw: string): FrProgress {
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === "object" && p.cards) return { ...EMPTY_PROGRESS, ...p };
  } catch {
    // fall through
  }
  return EMPTY_PROGRESS;
}

export function dayKey(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/** Records a review: correct moves the card up a box, a miss sends it back to box 0. */
export function review(p: FrProgress, id: string, correct: boolean, now = Date.now()): FrProgress {
  const prev = p.cards[id]?.box ?? 0;
  const box = correct ? Math.min(GAPS.length - 1, prev + 1) : 0;
  const today = dayKey(now);
  let streak = p.streak;
  if (p.lastDay !== today) {
    streak = p.lastDay === dayKey(now - DAY) ? p.streak + 1 : 1;
  }
  return {
    cards: { ...p.cards, [id]: { box, due: now + GAPS[box] * DAY } },
    xp: p.xp + (correct ? 10 : 2),
    streak,
    lastDay: today,
  };
}

/** Cards due now first (oldest due), then new cards in deck order. */
export function nextCards(p: FrProgress, limit: number, group?: string, now = Date.now()): FrCard[] {
  const pool = group ? DECK.filter((c) => c.group === group) : DECK;
  const due = pool
    .filter((c) => p.cards[c.id] && p.cards[c.id].due <= now)
    .sort((a, b) => p.cards[a.id].due - p.cards[b.id].due);
  const fresh = pool.filter((c) => !p.cards[c.id]);
  return [...due, ...fresh].slice(0, limit);
}

export function stats(p: FrProgress, now = Date.now()) {
  const known = Object.values(p.cards).filter((c) => c.box >= 3).length;
  const learning = Object.values(p.cards).filter((c) => c.box < 3).length;
  const due = Object.values(p.cards).filter((c) => c.due <= now).length;
  return { known, learning, due, fresh: DECK.length - Object.keys(p.cards).length };
}
