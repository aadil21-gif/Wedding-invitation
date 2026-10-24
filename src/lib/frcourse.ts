/**
 * The French course: a short path of goal-based units. Each unit has cards to
 * learn (with a picture-emoji, Duolingo style), a practice round, and a
 * "phone call" mission where Pierre plays a character and the learner has to
 * reach specific goals. Shared by the app and the server (the server reads the
 * mission from here, so the browser cannot rewrite it).
 */

export interface FrCard {
  id: string;
  fr: string;
  en: string;
  emoji: string;
  group: string;
  tip?: string;
}

export interface Goal {
  id: string;
  label: string;
  /** A sentence that achieves it, offered as a hint. */
  model: string;
}

export interface Mission {
  /** Who Pierre plays. */
  role: string;
  setting: string;
  opener: string;
  goals: Goal[];
}

export interface Unit {
  id: string;
  title: string;
  titleEn: string;
  emoji: string;
  /** What you can do after this unit. */
  can: string;
  cards: FrCard[];
  mission: Mission;
}

type Row = [fr: string, en: string, emoji: string, tip?: string];
const cards = (unit: string, rows: Row[]): FrCard[] =>
  rows.map(([fr, en, emoji, tip]) => ({ id: `${unit}:${fr}`, fr, en, emoji, group: unit, tip }));

export const COURSE: Unit[] = [
  {
    id: "salut",
    title: "Salut !",
    titleEn: "Meet someone",
    emoji: "👋",
    can: "Greet someone, say your name and ask how they are.",
    cards: cards("salut", [
      ["bonjour", "hello / good day", "👋", "Bon + jour: good day. Use it until about 6 pm."],
      ["salut", "hi / bye (friends)", "🙋"],
      ["comment allez-vous ?", "how are you? (polite)", "🤔"],
      ["ça va bien, merci", "I'm fine, thanks", "😊"],
      ["je m'appelle Aadil", "my name is Aadil", "🪪"],
      ["enchanté", "nice to meet you", "🤝"],
      ["au revoir", "goodbye", "🚪"],
    ]),
    mission: {
      role: "Camille, a friendly Parisian Aadil meets at a party",
      setting: "a lively party in Paris",
      opener: "Bonjour ! Moi, c'est Camille. Et vous ?",
      goals: [
        { id: "greet", label: "Say hello", model: "Bonjour !" },
        { id: "name", label: "Tell her your name", model: "Je m'appelle Aadil." },
        { id: "ask", label: "Ask how she is", model: "Comment allez-vous ?" },
        { id: "bye", label: "Say goodbye", model: "Au revoir !" },
      ],
    },
  },
  {
    id: "cafe",
    title: "Au café",
    titleEn: "Order a coffee",
    emoji: "☕",
    can: "Order food and drink politely and ask for the bill.",
    cards: cards("cafe", [
      ["un café", "a coffee", "☕"],
      ["un croissant", "a croissant", "🥐"],
      ["de l'eau", "some water", "💧"],
      ["je voudrais un café", "I would like a coffee", "🙋", "Je voudrais is the polite way to ask. Never 'je veux' with a waiter."],
      ["s'il vous plaît", "please", "🙏"],
      ["l'addition, s'il vous plaît", "the bill, please", "🧾"],
      ["merci beaucoup", "thank you very much", "💐"],
      ["je suis végétarien", "I'm vegetarian", "🥗"],
    ]),
    mission: {
      role: "Julien, a waiter at a Paris café",
      setting: "a small café near the Seine",
      opener: "Bonjour monsieur ! Vous désirez ?",
      goals: [
        { id: "greet", label: "Greet the waiter", model: "Bonjour !" },
        { id: "order", label: "Order a coffee politely", model: "Je voudrais un café, s'il vous plaît." },
        { id: "bill", label: "Ask for the bill", model: "L'addition, s'il vous plaît." },
        { id: "thanks", label: "Say thank you", model: "Merci beaucoup !" },
      ],
    },
  },
  {
    id: "ville",
    title: "En ville",
    titleEn: "Find your way",
    emoji: "🗺️",
    can: "Ask where something is and understand left, right and straight.",
    cards: cards("ville", [
      ["où est la gare ?", "where is the station?", "🚉"],
      ["à gauche", "to the left", "⬅️"],
      ["à droite", "to the right", "➡️"],
      ["tout droit", "straight ahead", "⬆️"],
      ["la pharmacie", "the pharmacy", "💊"],
      ["l'hôpital", "the hospital", "🏥"],
      ["l'hôtel", "the hotel", "🏨"],
      ["excusez-moi", "excuse me", "🙋‍♂️"],
    ]),
    mission: {
      role: "Madame Laurent, a helpful passer-by",
      setting: "a street in Lyon",
      opener: "Oui ? Je peux vous aider ?",
      goals: [
        { id: "excuse", label: "Get her attention politely", model: "Excusez-moi, madame." },
        { id: "where", label: "Ask where the pharmacy is", model: "Où est la pharmacie, s'il vous plaît ?" },
        { id: "repeat", label: "Repeat back her direction (gauche, droite or tout droit)", model: "À gauche, puis tout droit. Merci !" },
        { id: "thanks", label: "Thank her", model: "Merci beaucoup, madame." },
      ],
    },
  },
  {
    id: "chiffres",
    title: "Les chiffres",
    titleEn: "Numbers and prices",
    emoji: "🔢",
    can: "Count to ten and ask how much something costs.",
    cards: cards("chiffres", [
      ["un, deux, trois", "one, two, three", "1️⃣"],
      ["quatre, cinq, six", "four, five, six", "4️⃣"],
      ["sept, huit, neuf, dix", "seven, eight, nine, ten", "🔟"],
      ["vingt", "twenty", "2️⃣"],
      ["cent", "one hundred", "💯"],
      ["combien ça coûte ?", "how much is it?", "💶"],
      ["c'est trop cher", "it's too expensive", "😱"],
      ["je prends ça", "I'll take this", "🛍️"],
    ]),
    mission: {
      role: "Marc, a fruit seller at a Marseille market",
      setting: "a sunny open-air market",
      opener: "Bonjour ! Belles pommes, belles poires ! Qu'est-ce que vous voulez ?",
      goals: [
        { id: "greet", label: "Greet him", model: "Bonjour !" },
        { id: "price", label: "Ask how much the apples cost", model: "Combien coûtent les pommes ?" },
        { id: "number", label: "Say how many you want (a number)", model: "J'en voudrais cinq, s'il vous plaît." },
        { id: "take", label: "Say you will take them", model: "Je prends ça. Merci !" },
      ],
    },
  },
  {
    id: "pharmacie",
    title: "À la pharmacie",
    titleEn: "At the pharmacy",
    emoji: "💊",
    can: "Say you are unwell and ask a pharmacist for help.",
    cards: cards("pharmacie", [
      ["la pharmacie", "the pharmacy", "💊"],
      ["j'ai mal à la tête", "I have a headache", "🤕"],
      ["j'ai de la fièvre", "I have a fever", "🤒"],
      ["avez-vous du paracétamol ?", "do you have paracetamol?", "💊"],
      ["l'ordonnance", "the prescription", "📄"],
      ["j'ai besoin d'un médecin", "I need a doctor", "🩺"],
      ["je suis pharmacien", "I'm a pharmacist", "🧑‍⚕️"],
      ["c'est urgent", "it's urgent", "🚨"],
    ]),
    mission: {
      role: "Mme Bernard, a pharmacist in Paris",
      setting: "a pharmacy counter",
      opener: "Bonjour monsieur. Qu'est-ce qui ne va pas ?",
      goals: [
        { id: "greet", label: "Greet the pharmacist", model: "Bonjour, madame." },
        { id: "symptom", label: "Say you have a headache or a fever", model: "J'ai mal à la tête." },
        { id: "ask", label: "Ask if she has paracetamol", model: "Avez-vous du paracétamol ?" },
        { id: "job", label: "Tell her you are a pharmacist too", model: "Je suis pharmacien aussi." },
      ],
    },
  },
];

export const DECK: FrCard[] = COURSE.flatMap((u) => u.cards);

export function unitOf(id: unknown): Unit | undefined {
  return COURSE.find((u) => u.id === id);
}
