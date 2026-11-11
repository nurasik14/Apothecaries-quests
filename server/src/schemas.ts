/**
 * zod schemas for the on-disk files. All objects are loose (unknown keys pass through and are
 * preserved on write). Defaults never encode judgment: missing data is null / [] / "open".
 */
import { z } from "zod";
import {
  BOSS_TYPES,
  CATEGORIES,
  CATEGORY_ALIASES,
  COSTS,
  DIFFICULTIES,
  FEEDBACK,
  GENERATION_SOURCES,
  MODES,
  QUEST_SOURCES,
  REASON_CHIPS,
  REROLL_REASONS,
  REWARD_TIERS,
  STATUSES,
  STATUS_ALIASES,
  TARIFF,
} from "./domain";

export const DATE_STRING = /^\d{4}-\d{2}-\d{2}$/;
export const WEEK_STRING = /^\d{4}-W\d{2}$/;

const alias =
  (map: Readonly<Record<string, string>>) =>
  (v: unknown): unknown =>
    typeof v === "string" && Object.hasOwn(map, v.trim().toLowerCase()) ? map[v.trim().toLowerCase()] : v;

export const categorySchema = z.preprocess(alias(CATEGORY_ALIASES), z.enum(CATEGORIES));
export const statusSchema = z.preprocess(alias(STATUS_ALIASES), z.enum(STATUSES));
export const difficultySchema = z.enum(DIFFICULTIES);

const dateStr = z.string().regex(DATE_STRING, "expected YYYY-MM-DD");

/**
 * Photo references (`media/<YYYY-MM>/<id>.<ext>` path strings). Lenient on read: anything that isn't a list of
 * strings reads as "no photos" instead of quarantining the page (a write replaces it). Write routes check the
 * format, the count (LIMITS.photosPerTarget) and that the file exists (media.ts).
 */
const photoList = z.array(z.string()).optional().catch(undefined);
const nullish = <T extends z.ZodType>(s: T) => s.nullable().optional().transform((v) => v ?? null);

export const generationSchema = z.looseObject({
  source: z.enum(GENERATION_SOURCES),
  model: z.string().nullable().optional().transform((v) => v ?? null),
  at: z.string(),
});

// Read-side schemas are lenient on lengths and counts (architect-AC17): a hand-edited 120-char title or a 4th
// quest still reads. Write routes and generation enforce LIMITS instead. Ranges/enums still quarantine.
const questCommon = {
  id: z.string().min(1).max(40).optional(),
  title: z.string().min(1),
  why: z.string().nullable().optional().transform((v) => v ?? ""),
  category: categorySchema,
  status: statusSchema.optional().default("open"),
  feedback: nullish(z.enum(FEEDBACK)),
  source: z.enum(QUEST_SOURCES).optional().default("manual"),
  completed_at: nullish(z.string()),
  reason: z.union([z.enum(REASON_CHIPS), z.string()]).optional(),
};

export const questSchema = z.looseObject({
  ...questCommon,
  slot: z.number().int().min(1).optional(),
  difficulty: difficultySchema,
  coins: z.number().int().min(0).optional(),
  minutes: z.number().int().min(0).max(24 * 60).optional(),
  cost: z.enum(COSTS).optional(),
  done_when: z.string().max(240).optional(),
});
export type Quest = z.infer<typeof questSchema>;

export const rejectedSchema = z.looseObject({
  title: z.string(),
  category: z.string().optional(),
  difficulty: z.string().optional(),
  // Typed on write (REROLL_REASONS); lenient on read so a hand-written reason never quarantines the day.
  reason: z.union([z.enum(REROLL_REASONS), z.string()]).nullable().optional(),
  minutes: z.number().optional(),
  at: z.string().optional(),
});

/**
 * One money entry on a day page (`spent:` list). A bare number (`- 38`) is accepted for hand edits.
 * Read-side lenient on the note length (write routes enforce LIMITS); a negative amount still quarantines.
 */
export const spentSchema = z.preprocess(
  (v) => (typeof v === "number" ? { amount: v } : v),
  z.looseObject({
    amount: z.number().min(0),
    note: z.string().nullable().optional(),
    /** Kind of spending (SPEND_CATEGORIES); lenient here, unknown values count as "other" in the stats. */
    category: z.string().nullable().optional(),
  }),
);
export type Spent = z.infer<typeof spentSchema>;

export const daySchema = z.looseObject({
  schema: z.number().int().min(1).optional().default(1),
  date: dateStr,
  energy: nullish(z.number().int().min(1).max(5)),
  satisfaction: nullish(z.number().int().min(1).max(10)),
  mood: z.array(z.string().min(1)).nullable().optional().transform((v) => v ?? []),
  private: z.boolean().optional().default(false),
  publish: z.boolean().optional().default(false),
  rerolls_used: z.number().int().min(0).optional().default(0),
  generation: nullish(generationSchema),
  quests: z.array(questSchema).nullable().optional().transform((v) => v ?? []),
  rejected: z.array(rejectedSchema).nullable().optional().transform((v) => v ?? []),
  spent: z.array(spentSchema).nullable().optional().transform((v) => v ?? []),
  mode: z.enum(MODES).optional(),
  backfilled: z.boolean().optional(),
  prompt_id: z.string().max(40).optional(),
  /** Photos attached to the Highlight / Notes sections (omitted from the file when empty). */
  highlight_photos: photoList,
  notes_photos: photoList,
});
export type DayFrontmatter = z.infer<typeof daySchema>;

export const checkpointSchema = z.looseObject({
  text: z.string().min(1).max(160),
  done: z.boolean().optional().default(false),
  photos: photoList,
});

export const bossSchema = z.looseObject({
  ...questCommon,
  difficulty: z.literal("boss").optional().default("boss"),
  coins: z.number().int().min(0).optional(),
  type: z.enum(BOSS_TYPES).optional(),
  checkpoints: z.array(checkpointSchema).max(4).optional(),
  shrunk: z.boolean().optional(),
  /** Proof / progress photos for the whole weekly quest (omitted from the file when empty). */
  photos: photoList,
});
export type Boss = z.infer<typeof bossSchema>;

export const weekSchema = z.looseObject({
  schema: z.number().int().min(1).optional().default(1),
  week: z.string().regex(WEEK_STRING, "expected YYYY-Www"),
  boss: nullish(bossSchema),
  generation: nullish(generationSchema),
});
export type WeekFrontmatter = z.infer<typeof weekSchema>;

// ---------------------------------------------------------------- YAML data files
// The seed files (docs/brainstorm/seed) use `quests:` / `rewards:` / `title`; architecture.md
// §2.1 uses `daily:` / `items:` / `name`. Both shapes are accepted (PROVISIONAL, conflicts C1/C2).

export const poolQuestSchema = z.looseObject({
  id: z.string().optional(),
  title: z.string().min(1).max(80),
  why: z.string().max(240).nullable().optional().transform((v) => v ?? ""),
  category: categorySchema,
  difficulty: difficultySchema,
  cooldown_days: z.number().int().min(0).optional().default(0),
  cost: z.enum(COSTS).optional(),
  /** Optional estimate (H1 #124): lets a "too long" reroll keep its promise on the pool path. */
  minutes: z.number().int().min(1).max(600).optional().catch(undefined),
});
export type PoolQuest = z.infer<typeof poolQuestSchema>;

export const poolBossSchema = z.looseObject({
  id: z.string().optional(),
  title: z.string().min(1).max(80),
  why: z.string().max(240).nullable().optional().transform((v) => v ?? ""),
  category: categorySchema,
  type: z.enum(BOSS_TYPES).optional(),
  checkpoints: z.array(z.string().min(1).max(160)).max(4).optional(),
});
export type PoolBoss = z.infer<typeof poolBossSchema>;

export const questPoolFileSchema = z
  .looseObject({
    schema: z.number().int().min(1).optional().default(1),
    quests: z.array(poolQuestSchema).optional(),
    daily: z.array(poolQuestSchema).optional(),
    boss: z.array(poolBossSchema).nullable().optional(),
  })
  .transform((f) => ({
    schema: f.schema,
    daily: [...(f.quests ?? []), ...(f.daily ?? [])],
    boss: f.boss ?? [],
  }));
export type QuestPool = z.infer<typeof questPoolFileSchema>;

export const rewardSchema = z
  .looseObject({
    id: z.string().regex(/^[a-z0-9-]+$/, "slug [a-z0-9-]+"),
    title: z.string().min(1).max(120).optional(),
    name: z.string().min(1).max(120).optional(),
    price: z.number().int().min(1),
    cooldown_days: z.number().int().min(0).optional().default(0),
    tier: z.enum(REWARD_TIERS).optional(),
    approx_cost: z.number().min(0).optional(),
    note: z.string().max(240).optional(),
  })
  .refine((r) => r.title !== undefined || r.name !== undefined, { message: "reward needs a title" })
  .transform((r) => ({ ...r, title: (r.title ?? r.name) as string }));
export type Reward = z.infer<typeof rewardSchema>;

export const rewardsFileSchema = z
  .looseObject({
    schema: z.number().int().min(1).optional().default(1),
    rewards: z.array(rewardSchema).optional(),
    items: z.array(rewardSchema).optional(),
  })
  .transform((f) => ({ schema: f.schema, items: [...(f.rewards ?? []), ...(f.items ?? [])] }))
  .superRefine((f, ctx) => {
    const seen = new Set<string>();
    for (const [i, r] of f.items.entries()) {
      if (seen.has(r.id)) ctx.addIssue({ code: "custom", message: `duplicate reward id ${r.id}`, path: ["rewards", i, "id"] });
      seen.add(r.id);
    }
  });
export type RewardsFile = z.infer<typeof rewardsFileSchema>;

/** Coins for a quest when the file doesn't carry a snapshot (hand-written quests). */
export function defaultCoins(difficulty: keyof typeof TARIFF): number {
  return TARIFF[difficulty];
}

// ---------------------------------------------------------------- M5: purchases.yaml (architect-AC7)
// Spending is stored, earnings are derived (architecture.md §2.4). `title`/`price` are snapshots taken at
// purchase time, so a later rewards.yaml edit never rewrites history. Unknown keys pass through.

const isoish = z.string().min(1);

export const purchaseSchema = z.looseObject({
  id: z.string().min(1).max(60),
  request_id: z.string().min(1).max(80).optional(),
  item_id: z.string().min(1).max(80),
  title: z.string().max(200).optional(),
  name: z.string().max(200).optional(),
  price: z.number().int().min(0),
  at: isoish,
  date: dateStr,
  voided_at: nullish(z.string()),
});
export type Purchase = z.infer<typeof purchaseSchema>;

export const adjustmentSchema = z.looseObject({
  amount: z.number().int(),
  reason: z.string().max(200).nullable().optional(),
  at: z.string().nullable().optional(),
  date: dateStr.nullable().optional(),
});
export type Adjustment = z.infer<typeof adjustmentSchema>;

export const wishSchema = z.looseObject({
  item_id: z.string().min(1).max(80),
  added_at: z.string().nullable().optional(),
});

export const purchasesFileSchema = z
  .looseObject({
    schema: z.number().int().min(1).optional().default(1),
    purchases: z.array(purchaseSchema).nullable().optional().transform((v) => v ?? []),
    adjustments: z.array(adjustmentSchema).nullable().optional().transform((v) => v ?? []),
    wishlist: z.array(wishSchema).nullable().optional().transform((v) => v ?? []),
  })
  .superRefine((f, ctx) => {
    const ids = new Set<string>();
    const reqs = new Set<string>();
    for (const [i, p] of f.purchases.entries()) {
      if (ids.has(p.id)) ctx.addIssue({ code: "custom", message: `duplicate purchase id ${p.id}`, path: ["purchases", i, "id"] });
      ids.add(p.id);
      if (p.request_id !== undefined) {
        if (reqs.has(p.request_id)) ctx.addIssue({ code: "custom", message: "duplicate request_id", path: ["purchases", i, "request_id"] });
        reqs.add(p.request_id);
      }
    }
  });
export type PurchasesFile = z.infer<typeof purchasesFileSchema>;
