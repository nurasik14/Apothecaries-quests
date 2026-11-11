/**
 * Today / quest / evening use cases (sprint M2). Routes in app.ts stay thin. Everything goes through the
 * store (per-file mutex, re-read at write time) and calls git.touch only when a file really changed.
 */
import { z } from "zod";
import type { BossJson, DayJson, FileProblem, Job, QuestJson, TodayResponse, WeekJson } from "./api-types";
import { addDays, isoWeek, isoWithOffset, isValidDate, logicalDate, weekdayName, type Clock } from "./clock";
import type { Config } from "./config";
import { FEEDBACK, LIMITS, questEarnings, REASON_CHIPS, REROLL_REASONS, SPEND_CATEGORIES, STATUSES, type RerollReason, type SpendCategory } from "./domain";
import { StoreError } from "./errors";
import type { Generator } from "./generation";
import type { Git } from "./git";
import type { Jobs } from "./jobs";
import { bossEarnings, type Economy } from "./economy";
import { bossHasPhotos, checkPhotoList } from "./media";
import type { Boss, Quest } from "./schemas";
import type { DayDraft, DayRecord, Store, WeekRecord } from "./store";

/** An error the API turns into `{error:{code,message}}` with the given HTTP status. */
export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const QUARANTINE = new Set(["unparseable_file", "invalid_file", "newer_schema"]);

export function isQuarantine(e: unknown): e is StoreError {
  return e instanceof StoreError && QUARANTINE.has(e.code);
}

/** Calm, structured description of a file the app can't read (never the zod message itself). */
export function problemOf(e: StoreError): FileProblem {
  const d = e.details ?? {};
  const issues = Array.isArray(d.issues) ? (d.issues as { path?: unknown }[]) : [];
  const field = typeof issues[0]?.path === "string" && issues[0].path !== "" ? issues[0].path : undefined;
  return {
    code: e.code,
    file: e.file ?? "",
    ...(typeof d.line === "number" ? { line: d.line } : {}),
    ...(field ? { field } : {}),
    ...(typeof d.raw === "string" ? { raw: d.raw } : {}),
  };
}

export function dayJson(r: DayRecord): DayJson {
  return {
    ...(r.day as unknown as DayJson),
    quests: r.day.quests.map((q) => ({ ...(q as unknown as QuestJson), earned: questEarnings(q) })),
    highlight: r.highlight,
    notes: r.notes,
    gratitude: r.gratitude,
    extra_sections: r.extraSections,
    etag: r.etag,
  };
}

/** A boss with what it earns as recorded (`bossCoinsFor`, sprint M5 AC3/AC18). */
export function bossJson(b: Boss): BossJson {
  return { ...(b as unknown as BossJson), earned: bossEarnings(b) };
}

export function weekJson(r: WeekRecord): WeekJson {
  return {
    ...(r.week as unknown as WeekJson),
    boss: r.week.boss ? bossJson(r.week.boss) : null,
    review: r.review,
    extra_sections: r.extraSections,
    etag: r.etag,
  };
}

/** Coins earned by a day's daily quests (derived via `questEarnings`: the stored snapshot wins, G25). */
export function earnedFor(day: { quests: readonly Pick<Quest, "difficulty" | "status" | "coins">[] } | null): number {
  if (!day) return 0;
  return day.quests.reduce((sum, q) => sum + questEarnings(q), 0);
}

// ---------------------------------------------------------------- request bodies (strict: unknown keys → 400)

export const checkinBody = z.strictObject({ energy: z.number().int().min(1).max(5) });

export const rerollBody = z.strictObject({ reason: z.enum(REROLL_REASONS).nullable().optional() });

/** A target's whole photo list (replaces it). Paths are checked against the media format + disk in the service. */
const photosField = z.array(z.string().max(200)).max(LIMITS.photosPerTarget);

export const questPatchBody = z
  .strictObject({
    status: z.enum(STATUSES).optional(),
    feedback: z.enum(FEEDBACK).nullable().optional(),
    reason: z.enum(REASON_CHIPS).nullable().optional(),
    /** Weekly quest only: its proof / progress photos (the whole list). */
    photos: photosField.optional(),
    checkpoints: z
      .array(
        z
          .strictObject({ index: z.number().int().min(0), done: z.boolean().optional(), photos: photosField.optional() })
          .refine((c) => c.done !== undefined || c.photos !== undefined, { message: "send done or photos" }),
      )
      .min(1)
      .max(LIMITS.checkpoints)
      .optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "nothing to change" });
export type QuestPatch = z.infer<typeof questPatchBody>;

const eveningText = z.string().max(LIMITS.eveningText);
export const eveningBody = z.strictObject({
  satisfaction: z.number().int().min(1).max(10).nullable().optional(),
  mood: z.array(z.string()).max(LIMITS.moodTags).optional(),
  highlight: eveningText.optional(),
  notes: eveningText.optional(),
  gratitude: eveningText.optional(),
  /** Photos under Highlight / Notes: the whole list for that section (an empty list removes the key). */
  highlight_photos: photosField.optional(),
  notes_photos: photosField.optional(),
  /** Money spent that day: the whole list (replaces the page's `spent:`). */
  spent: z
    .array(
      z.strictObject({
        amount: z.number().finite().min(0).max(LIMITS.spentAmount),
        note: z.string().max(LIMITS.spentNote).optional(),
        category: z.enum(SPEND_CATEGORIES).optional(),
      }),
    )
    .max(LIMITS.spentEntries)
    .optional(),
});
export type EveningInput = z.infer<typeof eveningBody>;

/**
 * Write-side money entries: amounts rounded to cents, notes trimmed, an empty note left out of the file.
 * A category is written when one was sent.
 */
export function normalizeSpent(
  incoming: NonNullable<EveningInput["spent"]>,
): { amount: number; note?: string; category?: SpendCategory }[] {
  return incoming.map((e) => {
    const amount = Math.round(e.amount * 100) / 100;
    const note = (e.note ?? "").trim();
    return { amount, ...(note ? { note } : {}), ...(e.category ? { category: e.category } : {}) };
  });
}

const spentKey = (xs: readonly { amount: number; note?: string | null | undefined; category?: string | null | undefined }[]) =>
  JSON.stringify(xs.map((x) => [x.amount, (x.note ?? "").trim(), x.category ?? null]));

/**
 * Write-side mood normalization: trim, lowercase, drop empties, dedupe (case-insensitive). A tag that is
 * already stored verbatim is kept as-is, so re-saving a hand-written `Rainy` is a no-op (psychologist-AC16).
 */
export function normalizeMood(incoming: readonly string[], existing: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of incoming) {
    const kept = existing.includes(raw) ? raw : raw.trim().toLowerCase();
    if (kept.trim() === "") continue;
    if (kept.trim().length > LIMITS.moodTag) {
      throw new ApiError(400, "bad_request", `Mood tags are at most ${LIMITS.moodTag} characters.`);
    }
    const key = kept.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(kept);
  }
  return out;
}

const DAILY_ID = /^(\d{4}-\d{2}-\d{2})-([1-9]\d?)([b-z])?$/;
const BOSS_ID = /^(\d{4}-W\d{2})-boss$/;

// ---------------------------------------------------------------- service

export interface TodayDeps {
  config: Config;
  clock: Clock;
  store: Store;
  git: Git;
  jobs: Jobs;
  gen: Generator;
  /** Whether AI jobs (the weekly boss) are enqueued at all. */
  aiEnabled: boolean;
  /** How long a check-in waits inline for a fast (pool) job before answering 202 running. */
  inlineWaitMs?: number;
  /** The one ledger (sprint M5): every coin number comes from here. */
  economy: () => Promise<Economy>;
  /** ≥2 logical days without a day file before today (psychologist-AC23). */
  welcomeBack: () => Promise<boolean>;
}

/** Wait for a job up to `ms`; returns the latest snapshot either way. */
async function settleBriefly(jobs: Jobs, job: Job, ms: number): Promise<Job> {
  if (job.finished_at || ms <= 0) return jobs.get(job.id) ?? job;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const t = new Promise<null>((r) => {
    timer = setTimeout(() => r(null), ms);
  });
  const done = await Promise.race([jobs.wait(job.id), t]);
  if (timer) clearTimeout(timer);
  return done ?? jobs.get(job.id) ?? job;
}

export function createTodayService(deps: TodayDeps) {
  const { config, clock, store, git, jobs, gen } = deps;
  const inlineWaitMs = deps.inlineWaitMs ?? 250;
  const today = () => logicalDate(clock.now(), config.tz, config.rolloverHour);
  const stamp = () => isoWithOffset(clock.now(), config.tz);

  /**
   * Lazily create this week's file with a pool placeholder, then (AI on) enqueue the AI boss once.
   * Create-if-absent; never overwrites (architect-AC8/AC15).
   */
  async function ensureWeek(week: string, date: string): Promise<{ rec: WeekRecord | null; problem: FileProblem | null }> {
    try {
      const rec = await store.readWeek(week);
      if (rec) return { rec, problem: null };
    } catch (e) {
      if (isQuarantine(e)) return { rec: null, problem: problemOf(e) };
      throw e;
    }
    if (deps.aiEnabled && config.aiBossOnOpen && bossAttempted.has(week)) return { rec: null, problem: null };
    const { created } = await gen.createPlaceholderWeek(week, date);
    const enqueueBoss = created || (await store.readWeek(week).catch(() => null)) === null; // empty boss pool → the AI creates it
    if (deps.aiEnabled && config.aiBossOnOpen && !bossAttempted.has(week) && enqueueBoss) {
      bossAttempted.add(week); // at most one boss job per week per process; never re-enqueued
      jobs.enqueue("generate_boss", `generate_boss:${week}`, ({ signal }) => gen.generateBoss(week, date, signal));
    }
    try {
      return { rec: await store.readWeek(week), problem: null };
    } catch (e) {
      if (isQuarantine(e)) return { rec: null, problem: problemOf(e) };
      throw e;
    }
  }
  const bossAttempted = new Set<string>();

  function startGeneration(date: string): Job {
    return jobs.enqueue("generate_day", `generate_day:${date}`, ({ signal }) => gen.generateDay(date, signal));
  }

  const activeGenerate = (date: string) => jobs.active().find((j) => j.key === `generate_day:${date}`);

  async function readDaySafe(date: string): Promise<{ rec: DayRecord | null; problem: FileProblem | null }> {
    try {
      return { rec: await store.readDay(date), problem: null };
    } catch (e) {
      if (isQuarantine(e)) return { rec: null, problem: problemOf(e) };
      throw e;
    }
  }

  return {
    today,

    async getToday(): Promise<Omit<TodayResponse, "pending_proposals" | "profile_empty">> {
      const [economy, welcomeBack] = await Promise.all([deps.economy(), deps.welcomeBack()]);
      const date = today();
      const week = isoWeek(date);
      const { rec: day, problem: dayProblem } = await readDaySafe(date);
      const { rec: wk, problem: weekProblem } = await ensureWeek(week, date);
      const active = jobs.active().filter((j) => j.key.endsWith(`:${date}`) || j.key.endsWith(`:${week}`));
      const energy = day?.day.energy ?? null;
      const generating = active.some((j) => j.kind === "generate_day");
      const bossJob = active.some((j) => j.kind === "generate_boss");
      const b = wk?.week.boss ?? null;
      // The placeholder may still be swapped: show a loader, not a tickable card (G23).
      const bossPending =
        bossJob &&
        (b === null || (b.source === "pool" && b.status === "open" && b.feedback === null && !(b.checkpoints ?? []).some((c) => c.done) && !bossHasPhotos(b)));
      return {
        date,
        week_id: week,
        weekday: weekdayName(date),
        tz: config.tz,
        rollover_hour: config.rolloverHour,
        day: day ? dayJson(day) : null,
        day_error: dayProblem,
        week: wk ? weekJson(wk) : null,
        week_error: weekProblem,
        rerolls_left: day ? Math.max(0, LIMITS.rerollsPerDay - day.day.rerolls_used) : LIMITS.rerollsPerDay,
        needs_checkin: dayProblem === null && energy === null,
        needs_generation: dayProblem === null && energy !== null && (day?.day.quests.length ?? 0) === 0 && !generating,
        jobs: active,
        earned_today: earnedFor(day?.day ?? null),
        boss_pending: bossPending,
        ai_enabled: deps.aiEnabled,
        economy,
        welcome_back: welcomeBack,
      };
    },

    async checkin(energy: number) {
      const date = today();
      const file = store.paths.day(date);
      const running = activeGenerate(date);
      if (running) {
        // Energy is frozen while today's quests are being written (architect-AC11, PROVISIONAL).
        const cur = await store.readDay(date);
        if (cur?.day.energy !== energy) throw new ApiError(409, "generating", "Today's prescriptions are being written.");
        return { status: 202 as const, job: running, day: dayJson(cur) };
      }
      const { record, changed } = await store.updateDay(date, (d) => {
        d.energy = energy;
      });
      if (changed) git.touch({ kind: "checkin", ref: date }, [file]);
      if (record.day.quests.length > 0) return { status: 200 as const, day: dayJson(record) };
      const job = await settleBriefly(jobs, startGeneration(date), inlineWaitMs);
      const after = await store.readDay(date);
      return { status: 202 as const, job, day: after ? dayJson(after) : dayJson(record) };
    },

    async generate() {
      const date = today();
      const rec = await store.readDay(date);
      if (!rec || rec.day.energy === null) throw new ApiError(409, "needs_checkin", "Check in first.");
      if (rec.day.quests.length > 0) throw new ApiError(409, "already_generated", "Today's quests are already here.");
      const job = await settleBriefly(jobs, startGeneration(date), inlineWaitMs);
      return { job };
    },

    async reroll(id: string, reason: RerollReason | null) {
      const date = today();
      const daily = DAILY_ID.exec(id);
      if (!daily || !isValidDate(daily[1]!)) throw new ApiError(400, "bad_request", "Only a daily quest can be swapped.");
      if (daily[1] !== date) throw new ApiError(409, "not_today", "This page is closed; its quests stay as they were.");
      if (activeGenerate(date)) throw new ApiError(409, "generating", "Today's prescriptions are being written.");
      const existing = jobs.active().find((j) => j.key === `reroll:${date}`);
      if (existing) return { job: existing }; // double tap → the same job (architect-AC14)
      const rec = await store.readDay(date);
      const problem = gen.rerollProblem(rec, id);
      if (problem) throw new ApiError(problem.status, problem.code, problem.message);
      const job = jobs.enqueue("reroll", `reroll:${date}`, ({ signal }) => gen.reroll(date, id, reason, signal));
      return { job: await settleBriefly(jobs, job, inlineWaitMs) };
    },

    async patchQuest(
      id: string,
      body: QuestPatch,
    ): Promise<{ quest: QuestJson | BossJson; earned_today: number; changed: boolean; economy: Economy }> {
      const now = stamp();
      const date = today();
      const daily = DAILY_ID.exec(id);
      if (daily) {
        const qDate = daily[1]!;
        if (!isValidDate(qDate)) throw new ApiError(400, "bad_request", "Unknown quest id.");
        if (qDate !== date) throw new ApiError(409, "not_today", "This page is closed; its quests stay as they were.");
        if (body.checkpoints) throw new ApiError(400, "bad_request", "Only the weekly quest has checkpoints.");
        if (body.photos) throw new ApiError(400, "bad_request", "Only the weekly quest has photos.");
        const existing = await store.readDay(date);
        if (!existing?.day.quests.some((q) => q.id === id)) throw new ApiError(404, "not_found", "No such quest today.");
        let quest: Quest | undefined;
        const { record, changed } = await store.updateDay(date, (d: DayDraft) => {
          const q = d.quests.find((x) => x.id === id);
          if (!q) throw new ApiError(404, "not_found", "No such quest today.");
          applyPatch(q, body, now);
          quest = q;
        });
        if (changed) {
          git.touch({ kind: "quest", ref: id, detail: body.status ?? (body.feedback !== undefined ? "feedback" : "reason") }, [
            store.paths.day(date),
          ]);
        }
        const q = record.day.quests.find((x) => x.id === id) ?? quest!;
        return {
          quest: { ...(q as unknown as QuestJson), earned: questEarnings(q) },
          earned_today: earnedFor(record.day),
          changed,
          economy: await deps.economy(),
        };
      }

      const boss = BOSS_ID.exec(id);
      if (boss) {
        const week = boss[1]!;
        if (week !== isoWeek(date)) throw new ApiError(409, "not_this_week", "This week's page is closed.");
        const existing = await store.readWeek(week);
        const b = existing?.week.boss;
        if (!b || b.id !== id) throw new ApiError(404, "not_found", "No weekly quest here.");
        if (body.checkpoints) {
          const n = b.checkpoints?.length ?? 0;
          for (const cp of body.checkpoints) {
            if (cp.index >= n) throw new ApiError(400, "bad_request", `Checkpoint ${cp.index} doesn't exist.`);
          }
        }
        const { record, changed } = await store.updateWeek(week, async (d) => {
          const q = d.boss;
          if (!q) throw new ApiError(404, "not_found", "No weekly quest here.");
          applyPatch(q, body, now);
          // New photo paths must exist on disk (checked inside the file lock, against the page as it is now).
          if (body.photos !== undefined) setPhotos(q, "photos", await photoList(store.dataDir, body.photos, q.photos));
          for (const cp of body.checkpoints ?? []) {
            const target = q.checkpoints?.[cp.index];
            if (!target) continue;
            if (cp.done !== undefined) target.done = cp.done; // text is never rewritten (architect-AC14)
            if (cp.photos !== undefined) setPhotos(target, "photos", await photoList(store.dataDir, cp.photos, target.photos));
          }
        });
        if (changed) git.touch({ kind: "boss", ref: week, detail: bossDetail(body) }, [store.paths.week(week)]);
        const todayRec = await readDaySafe(date);
        return {
          quest: bossJson(record.week.boss!),
          earned_today: earnedFor(todayRec.rec?.day ?? null),
          changed,
          economy: await deps.economy(),
        };
      }
      throw new ApiError(400, "bad_request", "Unknown quest id.");
    },

    async saveEvening(date: string, body: EveningInput, ifMatch: string) {
      if (!isValidDate(date)) throw new ApiError(400, "bad_request", "Dates look like YYYY-MM-DD and must exist on the calendar.");
      if (date > today()) throw new ApiError(409, "future_date", "That page isn't open yet.");
      // Backlog #434 (PROVISIONAL): no ledger pages more than a year back.
      if (date < addDays(today(), -EVENING_MAX_AGE_DAYS)) throw new ApiError(409, "too_old", "That page is too far back to write.");
      let result: Awaited<ReturnType<typeof store.updateDay>>;
      try {
        result = await store.updateDay(
          date,
          async (d) => {
            // New photo paths must exist on disk (checked inside the file lock, against the page as it is now).
            const hl = body.highlight_photos !== undefined ? await photoList(store.dataDir, body.highlight_photos, d.highlight_photos) : undefined;
            const np = body.notes_photos !== undefined ? await photoList(store.dataDir, body.notes_photos, d.notes_photos) : undefined;
            const dirty = date < today() && d.backfilled === undefined && changesSomething(d, body);
            if (body.satisfaction !== undefined) d.satisfaction = body.satisfaction;
            if (body.mood !== undefined) d.mood = normalizeMood(body.mood, d.mood);
            if (body.highlight !== undefined) d.highlight = body.highlight;
            if (body.notes !== undefined) d.notes = body.notes;
            if (body.gratitude !== undefined) d.gratitude = body.gratitude;
            if (hl) setPhotos(d, "highlight_photos", hl);
            if (np) setPhotos(d, "notes_photos", np);
            if (body.spent !== undefined) {
              const next = normalizeSpent(body.spent);
              // Leave the page untouched when nothing changed (a hand-written `- 38` stays as written).
              if (spentKey(next) !== spentKey(d.spent ?? [])) d.spent = next;
            }
            // Backlog #62: a page written after its logical day is marked once (motivation §4.1). Only when
            // the save really changes something, so a no-op re-save of an old page stays byte-identical.
            if (dirty) d.backfilled = true;
          },
          { expectedEtag: ifMatch },
        );
      } catch (e) {
        if (e instanceof StoreError && e.code === "stale") {
          // M2 BUG-1: the page changed elsewhere (usually a hand edit). Commit that version *now*, so it
          // is in git history before the user's re-save can replace any of it. Bounded; never throws.
          // M2 R-BUG-2: only when the bytes on disk aren't the ones this app last wrote (a bad/old
          // If-Match against an app-written file is not a hand edit, and needn't wait for a flush).
          const rel = store.paths.day(date);
          const onDisk = e.details?.current_etag;
          if (typeof onDisk === "string" && onDisk !== store.lastWrittenEtag(rel)) {
            git.touch({ kind: "day", ref: date, detail: "hand_edit" }, [rel]);
            await git.flush(STALE_SNAPSHOT_MS);
          }
        }
        throw e;
      }
      const { record, changed } = result;
      if (changed) git.touch({ kind: "evening", ref: date }, [store.paths.day(date)]);
      return { record, changed };
    },
  };
}

function changesSomething(d: DayDraft, body: EveningInput): boolean {
  if (body.satisfaction !== undefined && body.satisfaction !== d.satisfaction) return true;
  for (const k of ["highlight_photos", "notes_photos"] as const) {
    const v = body[k];
    if (v !== undefined && !samePhotos(Array.from(new Set(v)), d[k])) return true;
  }
  for (const k of ["highlight", "notes", "gratitude"] as const) {
    const v = body[k];
    if (v !== undefined && v.replace(/\s+$/, "") !== d[k].replace(/\s+$/, "")) return true;
  }
  if (body.spent !== undefined && spentKey(normalizeSpent(body.spent)) !== spentKey(d.spent ?? [])) return true;
  return body.mood !== undefined && JSON.stringify(normalizeMood(body.mood, d.mood)) !== JSON.stringify(d.mood);
}

/** Evening pages further back than this are refused (409 too_old). */
export const EVENING_MAX_AGE_DAYS = 366;

/** How long a 412 waits for the snapshot commit of the newer on-disk version (M2 BUG-1). */
const STALE_SNAPSHOT_MS = 5_000;

export type TodayService = ReturnType<typeof createTodayService>;

/** A write's photo list for one target, checked (format + on disk for new paths, media.ts) and deduped. 400 otherwise. */
async function photoList(dataDir: string, next: readonly string[], current: readonly string[] | undefined): Promise<string[]> {
  const res = await checkPhotoList(dataDir, next, current);
  if (!res.ok) throw new ApiError(400, "bad_photo", "That photo isn't in the journal's photo folder. Add it again.");
  return res.list;
}

function samePhotos(a: readonly string[], b: readonly string[] | undefined): boolean {
  const bb = b ?? [];
  return a.length === bb.length && a.every((p, i) => p === bb[i]);
}

/** Set a photo list on a page object; an empty list removes the key, so the file never carries `photos: []`. */
function setPhotos<K extends string>(obj: { [k in K]?: string[] | undefined }, key: K, list: string[]): void {
  if (list.length > 0) {
    if (!samePhotos(list, obj[key])) obj[key] = list;
  } else if (obj[key] !== undefined) {
    delete obj[key];
  }
}

/** Commit-message detail for a boss patch (a short token, never user text). */
function bossDetail(body: QuestPatch): string {
  if (body.status) return body.status;
  if (body.checkpoints?.some((c) => c.done !== undefined)) return "checkpoint";
  if (body.photos !== undefined || body.checkpoints?.some((c) => c.photos !== undefined)) return "photos";
  return body.feedback !== undefined ? "feedback" : "reason";
}

/** Apply a status/feedback/reason patch to a quest-like object (daily or boss). */
function applyPatch(q: Quest | Boss, body: QuestPatch, now: string): void {
  if (body.status !== undefined && body.status !== q.status) {
    q.status = body.status;
    q.completed_at = body.status === "done" || body.status === "partial" ? now : null;
    if (body.status !== "let_go") delete q.reason;
  }
  if (body.feedback !== undefined) q.feedback = body.feedback;
  if (body.reason !== undefined) {
    if (body.reason === null) delete q.reason;
    else if (q.status !== "let_go") throw new ApiError(400, "bad_request", "A reason goes with “let go” only.");
    else q.reason = body.reason;
  }
}
