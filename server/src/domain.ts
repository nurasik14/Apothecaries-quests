/**
 * Domain vocabulary: the single source of truth for enums and tariff constants.
 * PROVISIONAL (sprint M1): categories and statuses follow docs/brainstorm/motivation.md
 * (psychologist-AC1/AC2), overriding architecture.md §2.6's `outside|chores|rest` and `failed`.
 */

export const CATEGORIES = [
  "body",
  "mind",
  "social",
  "creative",
  "adventure",
  "care",
  "learning",
  "treat",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Legacy / hand-written category values, normalized on read. */
export const CATEGORY_ALIASES: Readonly<Record<string, Category>> = {
  outside: "adventure",
  rest: "care",
  chores: "mind",
};

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const STATUSES = ["open", "done", "partial", "let_go"] as const;
export type Status = (typeof STATUSES)[number];

/** Legacy / hand-written status values, normalized on read. */
export const STATUS_ALIASES: Readonly<Record<string, Status>> = {
  failed: "let_go",
  fail: "let_go",
  skipped: "let_go",
};

export const REASON_CHIPS = ["no_time", "not_feeling_it", "not_possible", "didnt_fit"] as const;
export type ReasonChip = (typeof REASON_CHIPS)[number];

export const FEEDBACK = ["up", "down"] as const;
export type Feedback = (typeof FEEDBACK)[number];

export const QUEST_SOURCES = ["ai", "pool", "manual"] as const;
export type QuestSource = (typeof QUEST_SOURCES)[number];

export const GENERATION_SOURCES = ["ai", "pool"] as const;

export const MODES = ["normal", "exam", "rest_day", "gentle_restart"] as const;
export type Mode = (typeof MODES)[number];

export const BOSS_TYPES = ["make", "learn", "explore", "connect", "restore"] as const;
export type BossType = (typeof BOSS_TYPES)[number];

export const COSTS = ["free", "low", "medium"] as const;

export const REWARD_TIERS = ["free", "small", "medium", "large", "grand"] as const;

/** Coins per difficulty (ARCHITECTURE.md). Snapshotted into each quest at generation. */
export const TARIFF = { easy: 10, medium: 20, hard: 35, boss: 100 } as const;

/** Coins for a partial ("smaller version") completion: the next-lower tier (motivation.md §4.2). */
export const PARTIAL_TARIFF: Readonly<Record<Difficulty, number>> = { easy: 5, medium: 10, hard: 20 };

/** Coins a daily quest earns for a given status. Never negative. */
export function coinsFor(difficulty: Difficulty, status: Status): number {
  switch (status) {
    case "done":
      return TARIFF[difficulty];
    case "partial":
      return PARTIAL_TARIFF[difficulty];
    default:
      return 0;
  }
}

export const DEFAULT_STREAK_BONUS = 25;

// ---------------------------------------------------------------- M5: economy (motivation §3, sprint M5 goal)

/** Every Nth consecutive counting day earns the streak bonus and one preserved herb (motivation §3.5). */
export const STREAK_RUN = 7;
/** Preserved herbs (freeze tokens) held at most. Never purchasable. */
export const FREEZE_TOKEN_CAP = 2;
/** Purchases can be voided this many hours after `at` (wall clock; architecture.md §2.5). */
export const VOID_WINDOW_HOURS = 24;
/** Boss coins per ticked checkpoint, and for a checkpoint-less partial (psychologist-AC4, PROVISIONAL). */
export const BOSS_CHECKPOINT_COINS = 15;
export const BOSS_PARTIAL_COINS = 50;
/** Hard cap on any single quest's coins (hand edits are clamped, architecture.md §2.4). */
export const MAX_QUEST_COINS = 100;
/** Pace hint for the wishlist: averaged over this many logical days (zeros included), shown from N logged days. */
export const PACE_WINDOW_DAYS = 14;
export const PACE_MIN_LOGGED_DAYS = 7;
/**
 * The garden shows a category's average rating only with at least this many rated days (sprint M6 goal 4).
 * PROVISIONAL: the psychologist's 5 (motivation #23 confounding), stricter than the architect/designer 3.
 */
export const STATS_MIN_RATED = 5;

/**
 * Coins a weekly boss earns (psychologist-AC4, PROVISIONAL; supersedes the old 15+40 backlog formula).
 * Sealed (done) → 100. Otherwise 15 per ticked checkpoint (max 60), kept even when the week ends or the boss
 * is let go. A partial boss earns at least 50. Capped by the boss's own snapshot `coins` (clamped 0..100).
 */
export function bossCoinsFor(status: Status, ticked: number, total: number, snapshot?: number | null): number {
  const cap = Math.min(MAX_QUEST_COINS, Math.max(0, Math.round(snapshot ?? TARIFF.boss)));
  const n = Math.max(0, Math.min(Math.floor(ticked), Math.max(0, Math.floor(total))));
  let coins: number;
  if (status === "done") coins = TARIFF.boss;
  else if (status === "partial") coins = Math.max(BOSS_PARTIAL_COINS, n * BOSS_CHECKPOINT_COINS);
  else coins = n * BOSS_CHECKPOINT_COINS;
  return Math.max(0, Math.min(cap, coins));
}

export const CURRENT_SCHEMA = {
  day: 1,
  week: 1,
  rewards: 1,
  quests: 1,
  purchases: 1,
  proposals: 1,
} as const;

/** The day-file body sections the app owns, in canonical order. */
export const DAY_SECTIONS = ["Highlight", "Notes", "Gratitude"] as const;
export const WEEK_SECTIONS = ["Review"] as const;

/** Energy check-in → slot difficulties (motivation.md §1.4). Index = energy 1..5. Never more than one hard. */
export const ENERGY_SLOTS: Readonly<Record<1 | 2 | 3 | 4 | 5, readonly Difficulty[]>> = {
  1: ["easy", "easy", "easy"],
  2: ["easy", "easy", "medium"],
  3: ["easy", "medium", "medium"],
  4: ["easy", "medium", "hard"],
  5: ["medium", "medium", "hard"],
};

/** Balanced mood suggestions (motivation.md §5.1). `mood` itself stays freeform. Mirrors theme `MOOD_TAGS`. */
export const MOOD_SUGGESTIONS = [
  "calm",
  "energized",
  "proud",
  "curious",
  "cozy",
  "connected",
  "tired",
  "anxious",
  "frustrated",
  "lonely",
  "bored",
  "overwhelmed",
] as const;

/** Satisfaction anchors 1..10 (motivation.md §5.3), index 0 = rating 1. Mirrors theme `RATING_ANCHORS`. */
export const RATING_ANCHORS = [
  "One of the worst days in a long time.",
  "Very bad; most of the day hurt.",
  "Bad; more bad than good.",
  "Below par; flat or draining.",
  "Ordinary; nothing much either way.",
  "Decent; a few good moments.",
  "Good; I'd happily have this day again.",
  "Very good; something really stood out.",
  "Great; I'll remember this week for it.",
  "One of the best days this year.",
] as const;

/** Write-side caps (read side is lenient so hand edits never quarantine on length alone). */
export const LIMITS = {
  title: 80,
  why: 240,
  reason: 60,
  questsPerDay: 3,
  rerollsPerDay: 1,
  moodTag: 24,
  moodTags: 24,
  eveningText: 10_000,
  checkpoints: 4,
  /** Money noted on one day page (`spent:` in the front matter). */
  spentEntries: 50,
  spentNote: 80,
  spentAmount: 10_000_000,
} as const;

/**
 * What kind of spending a money entry is (`spent[].category`). An entry without one (older pages, hand
 * edits) or with an unknown value counts as "other". Mirrored by SPEND_CATEGORIES in
 * web/src/lib/eveningForm.ts (the web imports types only); spending.test.ts checks the two match.
 */
export const SPEND_CATEGORIES = ["entertainment", "grocery", "cafe", "electronics", "shopping_need", "shopping_want", "subscription", "transportation", "other"] as const;
export type SpendCategory = (typeof SPEND_CATEGORIES)[number];

/** Read-side: any stored value → a known category ("other" when missing or unknown). */
export function spendCategoryOf(v: unknown): SpendCategory {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (SPEND_CATEGORIES as readonly string[]).includes(s) ? (s as SpendCategory) : "other";
}

/** How far back pool titles are avoided (architecture.md §2.1). */
export const RECENT_TITLE_DAYS = 14;

/** Reroll reason chips (motivation.md §4.3). Mirrors theme `REROLL_REASONS` ids. */
export const REROLL_REASONS = ["too_long", "costs_money", "not_today", "boring", "not_me"] as const;
export type RerollReason = (typeof REROLL_REASONS)[number];

/** Boss type → card category (motivation.md §2.1). */
export const BOSS_TYPE_CATEGORY: Readonly<Record<BossType, Category>> = {
  make: "creative",
  learn: "learning",
  explore: "adventure",
  connect: "social",
  restore: "care",
};

/** Upper bound of `minutes` per difficulty (motivation.md §1.3 / §7.5). */
export const MAX_MINUTES: Readonly<Record<Difficulty, number>> = { easy: 20, medium: 60, hard: 180 };
/** At least one quest a day must fit in this many minutes (the "small win", motivation §1.4 rule 1). */
export const SMALL_WIN_MINUTES = 15;

/**
 * Safety blocklist over AI title/why/done_when (psychologist-AC6, narrowed in M4 per psychologist-AC19).
 * Phrase forms only, so "for its own sake", "wine-red notebook", "tea drunk slowly", "walk fast to the
 * library", "a varied diet of manga genres" and "Breakfast" pass. A hit makes the reply `invalid_output`.
 */
export const SAFETY_BLOCKLIST =
  /\b(?:(?:get|getting|got) drunk|(?:drink|drinking|order|ordering|try|trying|have|having|buy|buying) (?:a |an |some |one |two |three )?(?:beers?|wines?|sake|vodka|alcohol|cocktails?|shots?)|alcohol(?:ic)?|fasting|(?:intermittent|water|juice) fast|(?:go|going|be|start|starting|try|trying) on a diet|dieting|calories?|all-nighters?|no sleep|skip(?:ping)? (?:a |your )?(?:meals?|breakfast|lunch|dinner)|(?:taste|tasting|eat|eating|ingest|lick) [^.\n]{0,24}?(?:poison|plants?|herbs?|mushrooms?|berr(?:y|ies)|leaf|leaves)|forag(?:e|ing)|weigh yourself)\b/i;

/** Soft tone check (logged, never retried): controlling words in `why` (psychologist-AC7). */
export const TONE_WARNING = /\b(?:should|must)\b/i;

/**
 * Coins a quest earns as recorded (architect M2 review, psychologist-AC22). The stored `coins` snapshot wins
 * over today's tariff; a hand-edited value counts but is clamped to 0..100 (PROVISIONAL, psychologist).
 */
export function questEarnings(q: { difficulty: Difficulty; status: Status; coins?: number | undefined }): number {
  const full = Math.min(100, Math.max(0, Math.round(q.coins ?? TARIFF[q.difficulty])));
  if (q.status === "done") return full;
  if (q.status === "partial") return Math.min(PARTIAL_TARIFF[q.difficulty], full);
  return 0;
}

// ---------------------------------------------------------------- M4: reflect / insights (psychologist-AC10/13, architect-AC7)

/**
 * Forbidden inferences in an insight op (motivation §6.2). A match DROPS the op, unless the matched term
 * also appears in the user's own `profile.md` (case-insensitive): he may name it himself.
 */
export const INSIGHT_BLOCKLIST = new RegExp(
  [
    // diagnoses / labels
    String.raw`depress\w*`,
    String.raw`anxi(?:ety|ous)`,
    String.raw`adhd`,
    String.raw`burn(?:ed|t)?[- ]?out`,
    String.raw`disorder\w*`,
    String.raw`trauma\w*`,
    String.raw`addict\w*`,
    String.raw`lazy`,
    String.raw`procrastinator\w*`,
    // sensitive traits
    String.raw`relig\w*`,
    String.raw`politic\w*`,
    String.raw`sexual\w*`,
    String.raw`ethnic\w*`,
    // body
    String.raw`weight`,
    String.raw`calories?`,
    String.raw`diet(?:ing)?`,
    String.raw`eat(?:ing)? less`,
    String.raw`skinny`,
    String.raw`fat`,
    // money judgement
    String.raw`broke`,
    String.raw`can(?:'|’)?t afford`,
    // steering
    String.raw`should`,
    String.raw`must`,
    String.raw`needs? to`,
    String.raw`ought`,
    // missing data as a signal
    String.raw`skipped`,
    String.raw`missed`,
    String.raw`didn(?:'|’)?t (?:write|log|rate)`,
    String.raw`no entry`,
  ]
    .map((p) => String.raw`\b${p}\b`)
    .join("|"),
  "gi",
);

/** Crisis language in that day's highlight + notes → no AI call, fixed care copy (psychologist-AC13). */
export const CARE_PATTERN =
  /\b(?:kill(?:ing)? myself|suicid\w*|self[- ]?harm\w*|hurt(?:ing)? myself|want to die|don(?:'|’)?t want to (?:live|be here|exist)|end(?:ing)? it all|end my (?:own )?life|take my (?:own )?life|better off (?:dead|without me)|no reason to (?:live|go on))\b/i;

/** Soft flag on op text that reads like an instruction (architect-AC7). Never auto-accepted, never dropped. */
export const SUSPICIOUS_OP = /\b(?:ignore|disregard|instructions?|system prompt|assistant|you must|always respond)\b/i;

/** Soft tone warning on causal claims in an insight (psychologist-AC11). Logged only. */
export const CAUSAL_WARNING = /\b(?:makes you|because you|causes?)\b/i;

/** Soft tone warning on personality labels in an onboarding draft (psychologist-AC2). */
export const PERSONALITY_WARNING =
  /\b(?:you are (?:an? )?(?:introvert|extrovert|perfectionist|lazy)|personality type|MBTI|INTJ|INFP|ENFP|big five)\b/i;

export const INSIGHT_LIMITS = {
  opText: 200,
  opsPerReflect: 3,
  minEvidence: 3,
  maxEvidence: 5,
  capBullets: 60,
  capChars: 8_000,
  /** Evidence dates may be at most this old (psychologist-AC9). */
  evidenceMaxAgeDays: 60,
  /** Declined ops this recent are passed as <declined> and block near-duplicates (psychologist-AC12). */
  declinedDays: 30,
  /** Pending proposals older than this are no longer listed (psychologist-AC15, PROVISIONAL). */
  showDays: 7,
} as const;

export const KB_MAX_CHARS = 20_000;
export const ONBOARDING_LIMITS = { items: 30, question: 300, answer: 1_000, draft: 8_000 } as const;
