/**
 * The French course, written for a complete beginner (think grade 10 class):
 * every unit starts with a short lesson that explains the rule in plain English,
 * then picture cards with an English-style pronunciation guide, practice, and a
 * guided phone-call mission where Pierre plays a real person.
 * Shared by the apps and the server (the server reads the mission from here, so
 * the client cannot rewrite it).
 */

export interface FrCard {
  id: string;
  fr: string;
  en: string;
  emoji: string;
  group: string;
  /** Pronunciation in English-style spelling; capitals = stressed part. */
  say: string;
  tip?: string;
}

export interface LessonExample {
  fr: string;
  en: string;
  say: string;
}

export interface LessonStep {
  title: string;
  /** Plain-English explanation, like a teacher at the board. */
  body: string;
  examples: LessonExample[];
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
  lesson: LessonStep[];
  cards: FrCard[];
  mission: Mission;
}

export const COURSE: Unit[] = [
  {
    "id": "sons",
    "title": "Les sons",
    "titleEn": "Sounds first",
    "emoji": "🔊",
    "can": "Read French words aloud without panic.",
    "lesson": [
      {
        "title": "Most last letters are silent",
        "body": "In French you often do not say the final letter. The letters C, R, F and L (think CaReFuL) are the usual exceptions. So 'vous' is just 'voo', 'petit' is 'puh-TEE' and 'merci' is 'mehr-SEE'. Silent endings are the number one reason beginners sound wrong.",
        "examples": [
          {
            "fr": "vous",
            "en": "you",
            "say": "voo"
          },
          {
            "fr": "petit",
            "en": "small",
            "say": "puh-TEE"
          },
          {
            "fr": "beaucoup",
            "en": "a lot",
            "say": "boh-KOO"
          }
        ]
      },
      {
        "title": "Vowel teams",
        "body": "Some letter pairs always make one sound. 'ou' = oo. 'oi' = wah. 'au' and 'eau' = oh. 'ai' and 'ei' = eh. Learn these five and you can read half of French.",
        "examples": [
          {
            "fr": "vous",
            "en": "you",
            "say": "voo"
          },
          {
            "fr": "moi",
            "en": "me",
            "say": "mwah"
          },
          {
            "fr": "beau",
            "en": "beautiful",
            "say": "boh"
          },
          {
            "fr": "j'aime",
            "en": "I like",
            "say": "zhem"
          }
        ]
      },
      {
        "title": "Nasal sounds",
        "body": "Before an 'n' or 'm' at the end, the vowel goes through your nose and you do NOT say the n. 'on' = ohn (nose), 'an' and 'en' = ahn (nose), 'in' and 'ain' = like 'ang' without the g. Hold your nose: if the sound changes, you did it right.",
        "examples": [
          {
            "fr": "bonjour",
            "en": "hello",
            "say": "bohn-ZHOOR"
          },
          {
            "fr": "enfant",
            "en": "child",
            "say": "ahn-FAHN"
          },
          {
            "fr": "pain",
            "en": "bread",
            "say": "pan (nasal)"
          }
        ]
      },
      {
        "title": "Letters that change",
        "body": "'c' before e or i = s (merci). 'ç' = always s (français). 'j' and 'g' before e or i = zh like the s in 'measure' (jour, rouge). 'ch' = sh (chat). 'gn' = ny (montagne). 'qu' = k (qui). 'h' is silent (hôtel).",
        "examples": [
          {
            "fr": "chat",
            "en": "cat",
            "say": "shah"
          },
          {
            "fr": "rouge",
            "en": "red",
            "say": "roozh"
          },
          {
            "fr": "français",
            "en": "French",
            "say": "frahn-SAY"
          }
        ]
      },
      {
        "title": "Accents change the sound",
        "body": "é = ay (café). è and ê = eh (père). à = plain a, and it separates words: 'ou' = or, 'où' = where. Accents never mark stress. Every French word is said almost flat, with the push on the last syllable.",
        "examples": [
          {
            "fr": "café",
            "en": "coffee",
            "say": "ka-FAY"
          },
          {
            "fr": "où",
            "en": "where",
            "say": "oo"
          },
          {
            "fr": "père",
            "en": "father",
            "say": "pehr"
          }
        ]
      },
      {
        "title": "The two scary sounds",
        "body": "French R comes from the back of the throat, like a soft gargle or clearing your throat quietly. French U: say 'ee' and then round your lips like you are going to whistle. Practise 'tu' and 'rue' ten times; Pierre will wait.",
        "examples": [
          {
            "fr": "tu",
            "en": "you (friend)",
            "say": "tew"
          },
          {
            "fr": "rue",
            "en": "street",
            "say": "rew"
          },
          {
            "fr": "rouge",
            "en": "red",
            "say": "roozh"
          }
        ]
      }
    ],
    "cards": [
      {
        "fr": "bonjour",
        "en": "hello",
        "emoji": "👋",
        "say": "bohn-ZHOOR",
        "tip": "Bon + jour = good day. The n is nasal, the r is soft.",
        "id": "sons:bonjour",
        "group": "sons"
      },
      {
        "fr": "merci",
        "en": "thank you",
        "emoji": "🙏",
        "say": "mehr-SEE",
        "tip": "The final i carries the stress.",
        "id": "sons:merci",
        "group": "sons"
      },
      {
        "fr": "oui",
        "en": "yes",
        "emoji": "✅",
        "say": "wee",
        "id": "sons:oui",
        "group": "sons"
      },
      {
        "fr": "non",
        "en": "no",
        "emoji": "❌",
        "say": "nohn (nasal)",
        "id": "sons:non",
        "group": "sons"
      },
      {
        "fr": "beaucoup",
        "en": "a lot",
        "emoji": "💯",
        "say": "boh-KOO",
        "tip": "'eau' = oh, final p silent.",
        "id": "sons:beaucoup",
        "group": "sons"
      },
      {
        "fr": "vous",
        "en": "you (polite)",
        "emoji": "🧑‍🤝‍🧑",
        "say": "voo",
        "tip": "'ou' = oo, final s silent.",
        "id": "sons:vous",
        "group": "sons"
      },
      {
        "fr": "rouge",
        "en": "red",
        "emoji": "🔴",
        "say": "roozh",
        "id": "sons:rouge",
        "group": "sons"
      },
      {
        "fr": "chat",
        "en": "cat",
        "emoji": "🐱",
        "say": "shah",
        "tip": "ch = sh, final t silent.",
        "id": "sons:chat",
        "group": "sons"
      },
      {
        "fr": "café",
        "en": "coffee",
        "emoji": "☕",
        "say": "ka-FAY",
        "id": "sons:café",
        "group": "sons"
      },
      {
        "fr": "français",
        "en": "French",
        "emoji": "🇫🇷",
        "say": "frahn-SAY",
        "tip": "ç = s, 'ais' = ay, final s silent.",
        "id": "sons:français",
        "group": "sons"
      }
    ],
    "mission": {
      "role": "Pierre himself, a strict sound coach, on the phone",
      "setting": "a phone lesson on pronunciation",
      "opener": "Allô ? Ici Pierre. Répétez après moi : bonjour.",
      "goals": [
        {
          "id": "bonjour",
          "label": "Say bonjour",
          "model": "Bonjour"
        },
        {
          "id": "merci",
          "label": "Say merci",
          "model": "Merci"
        },
        {
          "id": "oui",
          "label": "Say oui",
          "model": "Oui"
        },
        {
          "id": "beaucoup",
          "label": "Say merci beaucoup",
          "model": "Merci beaucoup"
        }
      ]
    }
  },
  {
    "id": "salut",
    "title": "Salut !",
    "titleEn": "Meet someone",
    "emoji": "👋",
    "can": "Greet someone, say your name and ask how they are.",
    "lesson": [
      {
        "title": "Say hello",
        "body": "'Bonjour' works all day until about evening, then use 'bonsoir'. 'Salut' means hi or bye but only with friends. 'Au revoir' is goodbye. When in doubt, bonjour is never wrong.",
        "examples": [
          {
            "fr": "bonjour",
            "en": "hello",
            "say": "bohn-ZHOOR"
          },
          {
            "fr": "bonsoir",
            "en": "good evening",
            "say": "bohn-SWAHR"
          },
          {
            "fr": "au revoir",
            "en": "goodbye",
            "say": "oh ruh-VWAHR"
          }
        ]
      },
      {
        "title": "Tu or vous?",
        "body": "French has two words for 'you'. 'Tu' is for friends, family and kids. 'Vous' is for strangers, older people, bosses and always for more than one person. Using tu with a stranger is rude; using vous with a friend is just cold. Default to vous.",
        "examples": [
          {
            "fr": "comment allez-vous ?",
            "en": "how are you? (polite)",
            "say": "koh-mahn tah-lay VOO"
          },
          {
            "fr": "ça va ?",
            "en": "how's it going? (casual)",
            "say": "sa VA"
          }
        ]
      },
      {
        "title": "I am and my name is",
        "body": "'Je suis' = I am. You use it for jobs and feelings: 'je suis pharmacien'. For your name French says 'je m'appelle', literally 'I call myself'. Jobs have no 'a' in French: not 'I am a pharmacist' but 'I am pharmacist'.",
        "examples": [
          {
            "fr": "je m'appelle Aadil",
            "en": "my name is Aadil",
            "say": "zhuh ma-PEL aa-deel"
          },
          {
            "fr": "je suis pharmacien",
            "en": "I am a pharmacist",
            "say": "zhuh swee far-ma-SYAN"
          }
        ]
      },
      {
        "title": "Answer and bounce it back",
        "body": "To answer 'how are you': 'ça va bien, merci'. Then ALWAYS bounce it back with 'et vous ?' (and you?). It is the polite move everyone expects.",
        "examples": [
          {
            "fr": "ça va bien, merci",
            "en": "I'm fine, thanks",
            "say": "sa va byan mehr-SEE"
          },
          {
            "fr": "et vous ?",
            "en": "and you?",
            "say": "ay VOO"
          }
        ]
      }
    ],
    "cards": [
      {
        "fr": "bonjour",
        "en": "hello / good day",
        "emoji": "👋",
        "say": "bohn-ZHOOR",
        "id": "salut:bonjour",
        "group": "salut"
      },
      {
        "fr": "bonsoir",
        "en": "good evening",
        "emoji": "🌙",
        "say": "bohn-SWAHR",
        "id": "salut:bonsoir",
        "group": "salut"
      },
      {
        "fr": "salut",
        "en": "hi / bye (friends)",
        "emoji": "🙋",
        "say": "sa-LOO",
        "id": "salut:salut",
        "group": "salut"
      },
      {
        "fr": "comment allez-vous ?",
        "en": "how are you? (polite)",
        "emoji": "🤔",
        "say": "koh-mahn tah-lay VOO",
        "id": "salut:comment allez-vous ?",
        "group": "salut"
      },
      {
        "fr": "ça va bien, merci",
        "en": "I'm fine, thanks",
        "emoji": "😊",
        "say": "sa va byan mehr-SEE",
        "id": "salut:ça va bien, merci",
        "group": "salut"
      },
      {
        "fr": "et vous ?",
        "en": "and you?",
        "emoji": "🔁",
        "say": "ay VOO",
        "id": "salut:et vous ?",
        "group": "salut"
      },
      {
        "fr": "je m'appelle Aadil",
        "en": "my name is Aadil",
        "emoji": "🪪",
        "say": "zhuh ma-PEL aa-deel",
        "id": "salut:je m'appelle Aadil",
        "group": "salut"
      },
      {
        "fr": "enchanté",
        "en": "nice to meet you",
        "emoji": "🤝",
        "say": "ahn-shahn-TAY",
        "id": "salut:enchanté",
        "group": "salut"
      },
      {
        "fr": "je suis pharmacien",
        "en": "I am a pharmacist",
        "emoji": "🧑‍⚕️",
        "say": "zhuh swee far-ma-SYAN",
        "id": "salut:je suis pharmacien",
        "group": "salut"
      },
      {
        "fr": "au revoir",
        "en": "goodbye",
        "emoji": "🚪",
        "say": "oh ruh-VWAHR",
        "id": "salut:au revoir",
        "group": "salut"
      }
    ],
    "mission": {
      "role": "Camille, a friendly Parisian Aadil meets at a party",
      "setting": "a lively party in Paris",
      "opener": "Bonjour ! Moi, c'est Camille. Et vous ?",
      "goals": [
        {
          "id": "greet",
          "label": "Say hello",
          "model": "Bonjour !"
        },
        {
          "id": "name",
          "label": "Tell her your name",
          "model": "Je m'appelle Aadil."
        },
        {
          "id": "ask",
          "label": "Ask how she is",
          "model": "Comment allez-vous ?"
        },
        {
          "id": "bye",
          "label": "Say goodbye",
          "model": "Au revoir !"
        }
      ]
    }
  },
  {
    "id": "cafe",
    "title": "Au café",
    "titleEn": "Order a coffee",
    "emoji": "☕",
    "can": "Order food and drink politely and ask for the bill.",
    "lesson": [
      {
        "title": "Every noun has a gender",
        "body": "French nouns are masculine or feminine, and the little word before them changes. 'Un' goes with masculine (un café, un croissant). 'Une' goes with feminine (une baguette, une crêpe). You must learn the little word WITH the noun. Always memorise 'un café', never just 'café'.",
        "examples": [
          {
            "fr": "un café",
            "en": "a coffee",
            "say": "uhn ka-FAY"
          },
          {
            "fr": "une crêpe",
            "en": "a crepe",
            "say": "ewn KREP"
          }
        ]
      },
      {
        "title": "Some water: de l'eau",
        "body": "For 'some' of something you cannot count, French uses 'du / de la / de l''. Water is 'de l'eau' because 'eau' starts with a vowel.",
        "examples": [
          {
            "fr": "de l'eau",
            "en": "some water",
            "say": "duh LOH"
          }
        ]
      },
      {
        "title": "Je voudrais, never je veux",
        "body": "'Je veux' means 'I want' and sounds like a toddler grabbing a toy. 'Je voudrais' means 'I would like' and is how every polite person orders. Add 's'il vous plaît' and you are a gentleman.",
        "examples": [
          {
            "fr": "je voudrais un café",
            "en": "I would like a coffee",
            "say": "zhuh voo-DRAY uhn ka-FAY"
          },
          {
            "fr": "s'il vous plaît",
            "en": "please",
            "say": "seel voo PLAY"
          }
        ]
      },
      {
        "title": "Paying and thanking",
        "body": "The bill is 'l'addition'. You ask 'l'addition, s'il vous plaît'. Then thank them: 'merci beaucoup'.",
        "examples": [
          {
            "fr": "l'addition, s'il vous plaît",
            "en": "the bill, please",
            "say": "la-dee-SYOHN seel voo PLAY"
          },
          {
            "fr": "merci beaucoup",
            "en": "thank you very much",
            "say": "mehr-SEE boh-KOO"
          }
        ]
      }
    ],
    "cards": [
      {
        "fr": "un café",
        "en": "a coffee",
        "emoji": "☕",
        "say": "uhn ka-FAY",
        "id": "cafe:un café",
        "group": "cafe"
      },
      {
        "fr": "un croissant",
        "en": "a croissant",
        "emoji": "🥐",
        "say": "uhn krwa-SAHN",
        "id": "cafe:un croissant",
        "group": "cafe"
      },
      {
        "fr": "de l'eau",
        "en": "some water",
        "emoji": "💧",
        "say": "duh LOH",
        "id": "cafe:de l'eau",
        "group": "cafe"
      },
      {
        "fr": "je voudrais un café",
        "en": "I would like a coffee",
        "emoji": "🙋",
        "say": "zhuh voo-DRAY uhn ka-FAY",
        "tip": "Je voudrais is polite. Never 'je veux' with a waiter.",
        "id": "cafe:je voudrais un café",
        "group": "cafe"
      },
      {
        "fr": "s'il vous plaît",
        "en": "please",
        "emoji": "🙏",
        "say": "seel voo PLAY",
        "id": "cafe:s'il vous plaît",
        "group": "cafe"
      },
      {
        "fr": "l'addition, s'il vous plaît",
        "en": "the bill, please",
        "emoji": "🧾",
        "say": "la-dee-SYOHN seel voo PLAY",
        "id": "cafe:l'addition, s'il vous plaît",
        "group": "cafe"
      },
      {
        "fr": "merci beaucoup",
        "en": "thank you very much",
        "emoji": "💐",
        "say": "mehr-SEE boh-KOO",
        "id": "cafe:merci beaucoup",
        "group": "cafe"
      },
      {
        "fr": "je suis végétarien",
        "en": "I am vegetarian",
        "emoji": "🥗",
        "say": "zhuh swee vay-zhay-ta-RYAN",
        "id": "cafe:je suis végétarien",
        "group": "cafe"
      }
    ],
    "mission": {
      "role": "Julien, a waiter at a Paris café",
      "setting": "a small café near the Seine",
      "opener": "Bonjour monsieur ! Vous désirez ?",
      "goals": [
        {
          "id": "greet",
          "label": "Greet the waiter",
          "model": "Bonjour !"
        },
        {
          "id": "order",
          "label": "Order a coffee politely",
          "model": "Je voudrais un café, s'il vous plaît."
        },
        {
          "id": "bill",
          "label": "Ask for the bill",
          "model": "L'addition, s'il vous plaît."
        },
        {
          "id": "thanks",
          "label": "Say thank you",
          "model": "Merci beaucoup !"
        }
      ]
    }
  },
  {
    "id": "ville",
    "title": "En ville",
    "titleEn": "Find your way",
    "emoji": "🗺️",
    "can": "Ask where something is and understand left, right and straight.",
    "lesson": [
      {
        "title": "Get attention, then ask",
        "body": "Start with 'Excusez-moi' (excuse me). Then the magic question: 'Où est…?' = Where is…? Add the place: 'Où est la gare ?'",
        "examples": [
          {
            "fr": "excusez-moi",
            "en": "excuse me",
            "say": "ek-skew-zay MWAH"
          },
          {
            "fr": "où est la gare ?",
            "en": "where is the station?",
            "say": "oo ay la GAHR"
          }
        ]
      },
      {
        "title": "The: le, la, l', les",
        "body": "'The' is 'le' for masculine, 'la' for feminine, 'l'' before a vowel, 'les' for plurals. La gare, la pharmacie, le musée, l'hôpital, l'hôtel.",
        "examples": [
          {
            "fr": "la pharmacie",
            "en": "the pharmacy",
            "say": "la far-ma-SEE"
          },
          {
            "fr": "l'hôpital",
            "en": "the hospital",
            "say": "loh-pee-TAL"
          }
        ]
      },
      {
        "title": "Directions",
        "body": "'À gauche' = left, 'à droite' = right, 'tout droit' = straight on. People say them in a row: 'tout droit, puis à gauche' (straight, then left).",
        "examples": [
          {
            "fr": "à gauche",
            "en": "left",
            "say": "a GOHSH"
          },
          {
            "fr": "à droite",
            "en": "right",
            "say": "a DRWAHT"
          },
          {
            "fr": "tout droit",
            "en": "straight on",
            "say": "too DRWAH"
          }
        ]
      }
    ],
    "cards": [
      {
        "fr": "excusez-moi",
        "en": "excuse me",
        "emoji": "🙋‍♂️",
        "say": "ek-skew-zay MWAH",
        "id": "ville:excusez-moi",
        "group": "ville"
      },
      {
        "fr": "où est la gare ?",
        "en": "where is the station?",
        "emoji": "🚉",
        "say": "oo ay la GAHR",
        "id": "ville:où est la gare ?",
        "group": "ville"
      },
      {
        "fr": "à gauche",
        "en": "to the left",
        "emoji": "⬅️",
        "say": "a GOHSH",
        "id": "ville:à gauche",
        "group": "ville"
      },
      {
        "fr": "à droite",
        "en": "to the right",
        "emoji": "➡️",
        "say": "a DRWAHT",
        "id": "ville:à droite",
        "group": "ville"
      },
      {
        "fr": "tout droit",
        "en": "straight ahead",
        "emoji": "⬆️",
        "say": "too DRWAH",
        "id": "ville:tout droit",
        "group": "ville"
      },
      {
        "fr": "la pharmacie",
        "en": "the pharmacy",
        "emoji": "💊",
        "say": "la far-ma-SEE",
        "id": "ville:la pharmacie",
        "group": "ville"
      },
      {
        "fr": "l'hôpital",
        "en": "the hospital",
        "emoji": "🏥",
        "say": "loh-pee-TAL",
        "id": "ville:l'hôpital",
        "group": "ville"
      },
      {
        "fr": "l'hôtel",
        "en": "the hotel",
        "emoji": "🏨",
        "say": "loh-TEL",
        "id": "ville:l'hôtel",
        "group": "ville"
      }
    ],
    "mission": {
      "role": "Madame Laurent, a helpful passer-by",
      "setting": "a street in Lyon",
      "opener": "Oui ? Je peux vous aider ?",
      "goals": [
        {
          "id": "excuse",
          "label": "Get her attention politely",
          "model": "Excusez-moi, madame."
        },
        {
          "id": "where",
          "label": "Ask where the pharmacy is",
          "model": "Où est la pharmacie, s'il vous plaît ?"
        },
        {
          "id": "repeat",
          "label": "Repeat back her direction (gauche, droite or tout droit)",
          "model": "À gauche, puis tout droit. Merci !"
        },
        {
          "id": "thanks",
          "label": "Thank her",
          "model": "Merci beaucoup, madame."
        }
      ]
    }
  },
  {
    "id": "chiffres",
    "title": "Les chiffres",
    "titleEn": "Numbers and prices",
    "emoji": "🔢",
    "can": "Count to ten and ask how much something costs.",
    "lesson": [
      {
        "title": "One to five",
        "body": "un, deux, trois, quatre, cinq. Watch out: 'deux' has no x sound, it is 'duh'. 'Cinq' ends with a k sound: 'sank'.",
        "examples": [
          {
            "fr": "un",
            "en": "one",
            "say": "uhn"
          },
          {
            "fr": "deux",
            "en": "two",
            "say": "duh"
          },
          {
            "fr": "trois",
            "en": "three",
            "say": "trwah"
          },
          {
            "fr": "quatre",
            "en": "four",
            "say": "KAT-ruh"
          },
          {
            "fr": "cinq",
            "en": "five",
            "say": "sank"
          }
        ]
      },
      {
        "title": "Six to ten",
        "body": "six, sept, huit, neuf, dix. 'Sept' is 'set' (the p is silent). 'Huit' is 'weet'. 'Dix' is 'dees'.",
        "examples": [
          {
            "fr": "six",
            "en": "six",
            "say": "sees"
          },
          {
            "fr": "sept",
            "en": "seven",
            "say": "set"
          },
          {
            "fr": "huit",
            "en": "eight",
            "say": "weet"
          },
          {
            "fr": "neuf",
            "en": "nine",
            "say": "nuhf"
          },
          {
            "fr": "dix",
            "en": "ten",
            "say": "dees"
          }
        ]
      },
      {
        "title": "How much?",
        "body": "'Combien ça coûte ?' = how much is it? To buy something: 'Je prends ça' = I'll take it. Too expensive: 'c'est trop cher'.",
        "examples": [
          {
            "fr": "combien ça coûte ?",
            "en": "how much is it?",
            "say": "kohm-BYAN sa KOOT"
          },
          {
            "fr": "je prends ça",
            "en": "I'll take it",
            "say": "zhuh prahn SA"
          }
        ]
      }
    ],
    "cards": [
      {
        "fr": "un",
        "en": "one",
        "emoji": "1️⃣",
        "say": "uhn",
        "id": "chiffres:un",
        "group": "chiffres"
      },
      {
        "fr": "deux",
        "en": "two",
        "emoji": "2️⃣",
        "say": "duh",
        "id": "chiffres:deux",
        "group": "chiffres"
      },
      {
        "fr": "trois",
        "en": "three",
        "emoji": "3️⃣",
        "say": "trwah",
        "id": "chiffres:trois",
        "group": "chiffres"
      },
      {
        "fr": "quatre",
        "en": "four",
        "emoji": "4️⃣",
        "say": "KAT-ruh",
        "id": "chiffres:quatre",
        "group": "chiffres"
      },
      {
        "fr": "cinq",
        "en": "five",
        "emoji": "5️⃣",
        "say": "sank",
        "id": "chiffres:cinq",
        "group": "chiffres"
      },
      {
        "fr": "six",
        "en": "six",
        "emoji": "6️⃣",
        "say": "sees",
        "id": "chiffres:six",
        "group": "chiffres"
      },
      {
        "fr": "sept",
        "en": "seven",
        "emoji": "7️⃣",
        "say": "set",
        "id": "chiffres:sept",
        "group": "chiffres"
      },
      {
        "fr": "huit",
        "en": "eight",
        "emoji": "8️⃣",
        "say": "weet",
        "id": "chiffres:huit",
        "group": "chiffres"
      },
      {
        "fr": "neuf",
        "en": "nine",
        "emoji": "9️⃣",
        "say": "nuhf",
        "id": "chiffres:neuf",
        "group": "chiffres"
      },
      {
        "fr": "dix",
        "en": "ten",
        "emoji": "🔟",
        "say": "dees",
        "id": "chiffres:dix",
        "group": "chiffres"
      },
      {
        "fr": "combien ça coûte ?",
        "en": "how much is it?",
        "emoji": "💶",
        "say": "kohm-BYAN sa KOOT",
        "id": "chiffres:combien ça coûte ?",
        "group": "chiffres"
      },
      {
        "fr": "je prends ça",
        "en": "I'll take it",
        "emoji": "🛍️",
        "say": "zhuh prahn SA",
        "id": "chiffres:je prends ça",
        "group": "chiffres"
      }
    ],
    "mission": {
      "role": "Marc, a fruit seller at a Marseille market",
      "setting": "a sunny open-air market",
      "opener": "Bonjour ! Belles pommes, belles poires ! Qu'est-ce que vous voulez ?",
      "goals": [
        {
          "id": "greet",
          "label": "Greet him",
          "model": "Bonjour !"
        },
        {
          "id": "price",
          "label": "Ask how much the apples cost",
          "model": "Combien ça coûte ?"
        },
        {
          "id": "number",
          "label": "Say how many you want (a number from 1 to 10)",
          "model": "Cinq, s'il vous plaît."
        },
        {
          "id": "take",
          "label": "Say you will take them",
          "model": "Je prends ça. Merci !"
        }
      ]
    }
  },
  {
    "id": "pharmacie",
    "title": "À la pharmacie",
    "titleEn": "At the pharmacy",
    "emoji": "💊",
    "can": "Say you are unwell and ask a pharmacist for help.",
    "lesson": [
      {
        "title": "I have pain in…",
        "body": "French says 'I have pain at the…': 'j'ai mal à la tête' (headache), 'j'ai mal au ventre' (stomach ache). Fever is 'j'ai de la fièvre'.",
        "examples": [
          {
            "fr": "j'ai mal à la tête",
            "en": "I have a headache",
            "say": "zhay mal a la TET"
          },
          {
            "fr": "j'ai de la fièvre",
            "en": "I have a fever",
            "say": "zhay duh la FYEV-ruh"
          }
        ]
      },
      {
        "title": "Asking if they have it",
        "body": "'Avez-vous…?' = do you have…? So: 'Avez-vous du paracétamol ?' The medicine word is just the English word with a French accent.",
        "examples": [
          {
            "fr": "avez-vous du paracétamol ?",
            "en": "do you have paracetamol?",
            "say": "a-vay-VOO dew pa-ra-say-ta-MOL"
          }
        ]
      },
      {
        "title": "Emergencies",
        "body": "'J'ai besoin d'un médecin' = I need a doctor. 'C'est urgent' = it's urgent. You will probably never need them. Learn them anyway.",
        "examples": [
          {
            "fr": "j'ai besoin d'un médecin",
            "en": "I need a doctor",
            "say": "zhay buh-ZWAN duhn mayd-SAN"
          },
          {
            "fr": "c'est urgent",
            "en": "it's urgent",
            "say": "set ewr-ZHAHN"
          }
        ]
      }
    ],
    "cards": [
      {
        "fr": "la pharmacie",
        "en": "the pharmacy",
        "emoji": "💊",
        "say": "la far-ma-SEE",
        "id": "pharmacie:la pharmacie",
        "group": "pharmacie"
      },
      {
        "fr": "j'ai mal à la tête",
        "en": "I have a headache",
        "emoji": "🤕",
        "say": "zhay mal a la TET",
        "id": "pharmacie:j'ai mal à la tête",
        "group": "pharmacie"
      },
      {
        "fr": "j'ai de la fièvre",
        "en": "I have a fever",
        "emoji": "🤒",
        "say": "zhay duh la FYEV-ruh",
        "id": "pharmacie:j'ai de la fièvre",
        "group": "pharmacie"
      },
      {
        "fr": "avez-vous du paracétamol ?",
        "en": "do you have paracetamol?",
        "emoji": "💊",
        "say": "a-vay-VOO dew pa-ra-say-ta-MOL",
        "id": "pharmacie:avez-vous du paracétamol ?",
        "group": "pharmacie"
      },
      {
        "fr": "l'ordonnance",
        "en": "the prescription",
        "emoji": "📄",
        "say": "lor-doh-NAHNS",
        "id": "pharmacie:l'ordonnance",
        "group": "pharmacie"
      },
      {
        "fr": "j'ai besoin d'un médecin",
        "en": "I need a doctor",
        "emoji": "🩺",
        "say": "zhay buh-ZWAN duhn mayd-SAN",
        "id": "pharmacie:j'ai besoin d'un médecin",
        "group": "pharmacie"
      },
      {
        "fr": "c'est urgent",
        "en": "it's urgent",
        "emoji": "🚨",
        "say": "set ewr-ZHAHN",
        "id": "pharmacie:c'est urgent",
        "group": "pharmacie"
      }
    ],
    "mission": {
      "role": "Mme Bernard, a pharmacist in Paris",
      "setting": "a pharmacy counter",
      "opener": "Bonjour monsieur. Qu'est-ce qui ne va pas ?",
      "goals": [
        {
          "id": "greet",
          "label": "Greet the pharmacist",
          "model": "Bonjour, madame."
        },
        {
          "id": "symptom",
          "label": "Say you have a headache or a fever",
          "model": "J'ai mal à la tête."
        },
        {
          "id": "ask",
          "label": "Ask if she has paracetamol",
          "model": "Avez-vous du paracétamol ?"
        },
        {
          "id": "job",
          "label": "Tell her you are a pharmacist too",
          "model": "Je suis pharmacien aussi."
        }
      ]
    }
  }
];

export const DECK: FrCard[] = COURSE.flatMap((u) => u.cards);

export function unitOf(id: unknown): Unit | undefined {
  return COURSE.find((u) => u.id === id);
}
