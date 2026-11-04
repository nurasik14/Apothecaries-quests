/**
 * API contract shared with the web client. TYPE-ONLY: the web imports this file with `import type`,
 * so it must never import runtime code (architect-AC2). It only references `domain.ts` types.
 */
import type { Category, Difficulty, Feedback, ReasonChip, RerollReason, Status } from "./domain";

// ---------------------------------------------------------------- M5: ledger shapes (computed in economy.ts)

export interface Warning {
  file: string;
  code: string;
  message: string;
}

export type StreakEventType = "bonus" | "token_earned" | "token_used" | "rest";
export interface StreakEvent {
  date: string;
  type: StreakEventType;
  amount?: number;
}

export interface Economy {
  /** `null` when purchases.yaml can't be read (never guessed). May be negative after an undo. */
  balance: number | null;
  earned_total: number;
  spent_total: number | null;
  adjustments_total: number | null;
  /** Today's daily-quest earnings (the quiet "+N today" footer line). */
  earned_today: number;
  streak: number;
  longest_streak: number;
  freeze_tokens: number;
  streak_bonus_total: number;
  next_bonus_in_days: number;
  days_logged: number;
  days_logged_month: number;
  quests_done: number;
  /** Streak bonus credited on today's date (0 or STREAK_BONUS). Drives the once-only toast. */
  bonus_today: number;
  /** Walk events dated today or yesterday (token used, rest, bonus). */
  events_recent: StreakEvent[];
  /** Average daily earnings over the last 14 logical days (zeros included). */
  pace_per_day: number;
  warnings: Warning[];
}

export interface PurchaseJson {
  id: string;
  item_id: string;
  title: string;
  price: number;
  at: string;
  date: string;
  voided_at: string | null;
  /** Undo is offered (within 24 h of `at`, not voided yet). */
  voidable: boolean;
}

export interface ShopItemJson {
  id: string;
  title: string;
  price: number;
  cooldown_days: number;
  tier?: string;
  note?: string;
  available_on: string | null;
  affordable: boolean;
  wished: boolean;
}

export interface WishlistJson {
  item_id: string;
  title: string;
  price: number;
  have: number | null;
  need: number | null;
  est_days: number | null;
}

export type QuestStatusApi = Status;

interface QuestBase {
  id: string;
  slot?: number;
  title: string;
  why: string;
  category: Category;
  difficulty: Difficulty;
  coins?: number;
  status: Status;
  feedback: Feedback | null;
  source: "ai" | "pool" | "manual";
  completed_at: string | null;
  reason?: ReasonChip | string;
}

/** A daily quest. Hand-written unknown keys pass through but aren't typed. */
export interface QuestJson extends QuestBase {
  /** Coins this quest earns as recorded (server `questEarnings`; 0 unless done/partial). */
  earned?: number;
  minutes?: number;
  cost?: "free" | "low" | "medium";
  done_when?: string;
}

export interface CheckpointJson {
  text: string;
  done: boolean;
}

export interface BossJson extends Omit<QuestBase, "difficulty" | "slot"> {
  difficulty: "boss";
  /** Coins this boss earns as recorded (server `bossCoinsFor`, sprint M5). */
  earned?: number;
  type?: string;
  checkpoints?: CheckpointJson[];
  artifact?: string;
  cost?: "free" | "low" | "medium";
}

export interface GenerationJson {
  source: "ai" | "pool";
  model: string | null;
  at: string;
  attempts?: number;
  /** Set only when AI was tried and the pool stood in (an error code, never text). */
  fallback_reason?: string;
}

export interface DayJson {
  date: string;
  energy: number | null;
  satisfaction: number | null;
  mood: string[];
  private: boolean;
  rerolls_used: number;
  generation: GenerationJson | null;
  quests: QuestJson[];
  highlight: string;
  notes: string;
  gratitude: string;
  /** Money noted for the day (front matter `spent:`), in the user's currency. */
  spent: SpentJson[];
  extra_sections: string[];
  etag: string;
  [extra: string]: unknown;
}

export interface SpentJson {
  amount: number;
  note?: string | null;
  /** SPEND_CATEGORIES; missing or unknown = "other". */
  category?: string | null;
}

export interface WeekJson {
  week: string;
  boss: BossJson | null;
  generation: GenerationJson | null;
  review: string;
  extra_sections: string[];
  etag: string;
  [extra: string]: unknown;
}

/** A day/week file the app can't read (quarantined). Shown calmly with the raw text. */
export interface FileProblem {
  code: "unparseable_file" | "invalid_file" | "newer_schema" | string;
  file: string;
  line?: number;
  /** First zod issue path, e.g. `satisfaction` (never the zod message). */
  field?: string;
  raw?: string;
}

export type JobKind = "generate_day" | "reroll" | "generate_boss" | "reflect" | "onboarding";
export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface Job {
  id: string;
  kind: JobKind;
  key: string;
  status: JobStatus;
  source?: "ai" | "pool";
  error?: { code: string; message: string };
  result?: unknown;
  created_at: string;
  /** When the job first started running (server time). */
  started_at?: string;
  /** Server-measured ms since the job started, while queued/running (clock-skew-free loader phases). */
  elapsed_ms?: number;
  finished_at?: string;
}

export interface TodayResponse {
  date: string;
  week_id: string;
  weekday: string;
  tz: string;
  rollover_hour: number;
  day: DayJson | null;
  day_error: FileProblem | null;
  week: WeekJson | null;
  week_error: FileProblem | null;
  rerolls_left: number;
  needs_checkin: boolean;
  needs_generation: boolean;
  jobs: Job[];
  /** Coins earned today from daily quests (derived; no stored balance until M5). */
  earned_today: number;
  /** An AI boss job may still replace this week's untouched placeholder: show a loader, not the card. */
  boss_pending: boolean;
  ai_enabled: boolean;
  /** Pending insight suggestions (≤7 days old) → the jade dot on the Notes tab (M4). */
  pending_proposals: number;
  /** `kb/profile.md` is missing or still the untouched template → the onboarding invitation (M4). */
  profile_empty: boolean;
  /** The one ledger (M5): balance, streak, preserved herbs. Feeds the header badge. */
  economy: Economy;
  /** ≥2 logical days without a page before today → "Welcome back. Your page is here." (M5, reworded M6) */
  welcome_back: boolean;
}

export interface RerollBody {
  reason?: RerollReason | null;
}

export interface RerollResponse {
  job: Job;
  economy: Economy;
}

export interface CheckinResponse {
  day: DayJson;
  job?: Job;
  economy: Economy;
}

export interface QuestPatchBody {
  status?: Status;
  feedback?: Feedback | null;
  reason?: ReasonChip | null;
  checkpoints?: { index: number; done: boolean }[];
}

export interface QuestPatchResponse {
  quest: QuestJson | BossJson;
  earned_today: number;
  /** false = the same value was already stored: no reward reaction (architect-AC4). */
  changed: boolean;
  economy: Economy;
}

// ---------------------------------------------------------------- M5: Palace Market

export interface ShopResponse {
  /** Logical today (cooldown labels are computed against it, never the device clock). */
  date: string;
  items: ShopItemJson[];
  wishlist: WishlistJson | null;
  economy: Economy;
  /** purchases.yaml can't be read (balance is null then). */
  purchases_error: FileProblem | null;
}

export interface PurchaseResponse {
  purchase: PurchaseJson;
  economy: Economy;
  changed: boolean;
}

export interface WishlistResponse extends ShopResponse {
  changed: boolean;
}

export interface EveningBody {
  satisfaction?: number | null;
  mood?: string[];
  highlight?: string;
  notes?: string;
  gratitude?: string;
  spent?: SpentJson[];
}

export type ReflectSkip = "ai_off" | "not_recent" | "private" | "care" | "exists" | "unchanged" | "few_days" | "empty";

export interface EveningResponse {
  day: DayJson;
  reflect_job: Job | null;
  /** Why no reflect job was queued (null when one was). `care` → show the fixed care note. */
  reflect_skip: ReflectSkip | null;
  /** Every economy-input mutation returns it (architect-AC22): a rating save can land a streak bonus. */
  economy: Economy;
}

// ---------------------------------------------------------------- M4: knowledge base

export interface KbProfileJson {
  content: string;
  etag: string;
  empty: boolean;
  /** Present on PUT responses (architect-AC22). */
  economy?: Economy;
}

export interface InsightItemJson {
  id: string;
  text: string;
  evidence: string[];
}

export interface KbInsightsJson {
  content: string;
  etag: string;
  items: InsightItemJson[];
  unparsed_lines: number;
  /** Present on PUT responses (architect-AC22). */
  economy?: Economy;
}

export type ProposalDecision = "accepted" | "rejected" | "stale";

export interface ProposalOpJson {
  op_id: string;
  op: "add" | "edit" | "remove";
  /** Target insight id (edit/remove). */
  id?: string;
  text?: string;
  reason?: string;
  evidence: string[];
  /** The target bullet's text when the suggestion was made (edit/remove). */
  base_text?: string;
  flag?: string;
  decision: ProposalDecision | null;
}

export interface ProposalJson {
  id: string;
  date: string;
  created_at: string | null;
  status: "pending" | "decided";
  etag: string;
  ops: ProposalOpJson[];
}

export interface DecideBody {
  decisions: { op_id: string; accept: boolean; text?: string }[];
}

export interface DecideResponse {
  proposal: ProposalJson;
  insights: KbInsightsJson;
  economy: Economy;
}

/** `reflect` job result. */
export type ReflectResult =
  | { outcome: "proposed"; proposal: ProposalJson; dropped: number }
  | { outcome: "none"; dropped: number }
  | { outcome: "care" | "private" | "superseded" };

/** `onboarding` job result (memory only; never written by the server). */
export interface OnboardingResult {
  draft: string;
  tone_warnings: string[];
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

// ---------------------------------------------------------------- M6: the garden
export type { SpendCategory } from "./domain";
export type { CategoryStat, HeatmapDay, MonthAgo, PlotState, SpendingStats, SpentSuggestion, Stats as StatsResponse } from "./stats";
