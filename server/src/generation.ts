/**
 * Quest generation use cases (sprint M3): AI first, pool fallback, written under the file mutex with the
 * preconditions re-checked at write time (architect-AC11/14/15). The AI call always happens OUTSIDE the
 * lock: read inputs → call → lock → re-check → write.
 */
import type { JobOutcome } from "./jobs";
import { PreemptedError } from "./jobs";
import { callAi, type AiErrorCode, type AiMonitor, type AiRunner } from "./ai";
import { addDays, isoWeek, isoWithOffset, weekdayName, type Clock } from "./clock";
import type { Config } from "./config";
import { BOSS_TYPE_CATEGORY, LIMITS, RECENT_TITLE_DAYS, TARIFF, type Difficulty, type RerollReason } from "./domain";
import { StoreError } from "./errors";
import { estimateMinutes, hashString, selectBoss, selectDaily, selectReroll, type HistoryDay } from "./fallback";
import type { Git } from "./git";
import { bossHasPhotos } from "./media";
import {
  buildBossPrompt,
  buildDailyPrompt,
  buildRerollPrompt,
  nextBossType,
  AVOID_DAYS,
  type AvoidItem,
  type HistoryInput,
} from "./prompts";
import {
  aiBossSchema,
  aiDaySchema,
  aiRerollSchema,
  bossJsonSchema,
  dayJsonSchema,
  slotsFor,
  validateBoss,
  validateDay,
  validateReroll,
  type AiBoss,
  type AiQuest,
} from "./quest-rules";
import type { Boss, PoolQuest, Quest } from "./schemas";
import type { DayRecord, Store } from "./store";

export interface GenerationDeps {
  config: Config;
  clock: Clock;
  store: Store;
  git: Git;
  /** null = AI off (pool by design: no fallback banner). */
  ai: AiRunner | null;
  monitor?: AiMonitor;
}

const QUARANTINE = new Set(["unparseable_file", "invalid_file", "newer_schema"]);
const isQuarantine = (e: unknown) => e instanceof StoreError && QUARANTINE.has(e.code);

/** Error with a code the job queue reports (`job.error.code`). */
function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

export interface GatheredHistory {
  /** Parseable previous days (private ones included; the prompt builder drops them). */
  records: HistoryInput[];
  /** For the fallback pool (titles incl. rejected, 30 days). */
  poolHistory: HistoryDay[];
  /** Titles (incl. rejected) of the last 14 days, private days included: never sent, still avoided. */
  recentTitles: string[];
  avoid: AvoidItem[];
}

export function createGenerator(deps: GenerationDeps) {
  const { config, clock, store, git, ai, monitor } = deps;
  const stamp = () => isoWithOffset(clock.now(), config.tz);
  /** ETag of each week file this process created with a pool placeholder (architect-AC15). */
  const placeholderEtags = new Map<string, string>();

  async function readText(name: "profile" | "insights"): Promise<string | null> {
    try {
      return (await store.readKb(name))?.content ?? null;
    } catch {
      return null;
    }
  }

  async function gather(date: string, days = AVOID_DAYS): Promise<GatheredHistory> {
    const records: HistoryInput[] = [];
    const poolHistory: HistoryDay[] = [];
    const recentTitles: string[] = [];
    const avoid: AvoidItem[] = [];
    const cutoff14 = addDays(date, -RECENT_TITLE_DAYS);
    for (let i = 1; i <= days; i++) {
      const d = addDays(date, -i);
      let rec: DayRecord | null;
      try {
        rec = await store.readDay(d);
      } catch (e) {
        if (isQuarantine(e)) continue; // quarantined days are skipped (architect-AC8)
        throw e;
      }
      if (!rec) continue;
      const titles = [...rec.day.quests.map((q) => q.title), ...rec.day.rejected.map((r) => r.title)];
      poolHistory.push({ date: d, titles });
      if (d >= cutoff14) {
        recentTitles.push(...titles);
        // Gratitude is deliberately not copied (privacy, G9).
        records.push({ date: d, day: rec.day, highlight: rec.highlight, notes: rec.notes });
      }
      if (rec.day.private) continue;
      for (const r of rec.day.rejected) avoid.push({ title: r.title, date: d, kind: "rerolled", reason: typeof r.reason === "string" ? r.reason : null });
      for (const q of rec.day.quests) if (q.feedback === "down") avoid.push({ title: q.title, date: d, kind: "down" });
    }
    return { records, poolHistory, recentTitles, avoid };
  }

  async function weekBossTitle(date: string): Promise<string | null> {
    try {
      return (await store.readWeek(isoWeek(date)))?.week.boss?.title ?? null;
    } catch {
      return null;
    }
  }

  function aiQuestToQuest(q: AiQuest, slot: number, id: string, difficulty: Difficulty): Quest {
    // Explicit mapping: nothing the model invents (coins, status, id…) reaches the file (architect-AC5).
    return {
      id,
      slot,
      title: q.title,
      why: q.why,
      category: q.category,
      difficulty,
      coins: TARIFF[difficulty],
      status: "open",
      feedback: null,
      source: "ai",
      completed_at: null,
      minutes: q.minutes,
      cost: q.cost,
      done_when: q.done_when,
    } as Quest;
  }

  function poolQuestToQuest(p: PoolQuest, slot: number, id: string, difficulty: Difficulty): Quest {
    const q: Record<string, unknown> = {
      id,
      slot,
      title: p.title,
      why: p.why,
      category: p.category,
      difficulty,
      coins: TARIFF[difficulty], // the pool's own `coins:` is ignored (psychologist-AC5)
      status: "open",
      feedback: null,
      source: "pool",
      completed_at: null,
    };
    if (p.cost) q.cost = p.cost;
    if (typeof p.minutes === "number") q.minutes = p.minutes; // H1 #124: a later "too long" can compare
    return q as Quest;
  }

  async function readPool() {
    try {
      return await store.readQuestPool();
    } catch (e) {
      if (isQuarantine(e)) return null;
      throw e;
    }
  }

  // ------------------------------------------------------------ daily

  async function generateDay(date: string, signal?: AbortSignal): Promise<JobOutcome> {
    const start = await store.readDay(date);
    if (!start || start.day.energy === null) throw coded("needs_checkin", "Check in first.");
    if (start.day.quests.length > 0) return { result: { result: "superseded" } };
    const energy = start.day.energy; // frozen for the job (architect-AC11)
    const slots = slotsFor(energy);
    const hist = await gather(date);

    let quests: Quest[] | null = null;
    let source: "ai" | "pool" = "pool";
    let attempts = 0;
    let fallback: AiErrorCode | null = null;

    if (ai) {
      const now = stamp();
      const built = buildDailyPrompt({
        date,
        weekday: weekdayName(date),
        time: now.slice(11, 16),
        energy,
        mode: typeof start.day.mode === "string" ? start.day.mode : "normal",
        profile: await readText("profile"),
        insights: await readText("insights"),
        history: hist.records,
        avoid: hist.avoid,
        weekBossTitle: await weekBossTitle(date),
        slots,
      });
      const res = await callAi({
        runner: ai,
        request: { kind: "generate_day", system: built.system, prompt: built.prompt, schema: dayJsonSchema(3), timeoutMs: config.aiTimeoutMs },
        output: aiDaySchema,
        check: (v) => validateDay(v, { energy, recentTitles: hist.recentTitles }),
        ...(monitor ? { monitor } : {}),
        ...(signal ? { signal } : {}),
        now: stamp,
      });
      attempts = res.attempts;
      if (res.ok) {
        source = "ai";
        quests = res.value.quests.map((q, i) => aiQuestToQuest(q, i + 1, `${date}-${i + 1}`, slots[i]!));
      } else {
        if (res.code === "preempted") throw new PreemptedError();
        fallback = res.code;
      }
    }

    if (!quests) {
      const pool = await readPool();
      if (!pool || pool.daily.length === 0) throw coded("pool_empty", "The quest pool is empty.");
      const sel = selectDaily({ pool: pool.daily, energy, date, history: hist.poolHistory });
      quests = sel.quests.map(({ slot, pool: p, difficulty }) => poolQuestToQuest(p, slot, `${date}-${slot}`, difficulty));
    }

    const at = stamp();
    let wrote = false;
    const { changed } = await store.updateDay(date, (d) => {
      // Re-check under the mutex: a hand edit or a concurrent path may have filled the day (architect-AC11).
      if (d.quests.length > 0 || d.energy === null) return;
      d.quests = quests!;
      const generation: Record<string, unknown> = {
        source,
        model: source === "ai" ? ai!.model : null,
        at,
        attempts,
      };
      if (fallback) generation.fallback_reason = fallback;
      d.generation = generation as typeof d.generation;
      wrote = true;
    });
    if (changed) git.touch({ kind: "day", ref: date, detail: source }, [store.paths.day(date)]);
    return {
      source,
      result: { result: wrote ? "written" : "superseded", ...(fallback ? { fallback_reason: fallback } : {}) },
    };
  }

  // ------------------------------------------------------------ reroll

  function nextId(id: string): string {
    const m = /^(.*-\d{1,2})([b-z])?$/.exec(id);
    if (!m) return `${id}b`;
    const letter = m[2] ? String.fromCharCode(m[2].charCodeAt(0) + 1) : "b";
    return `${m[1]}${letter > "z" ? "z" : letter}`;
  }

  /** Synchronous-ish precondition check shared by the route and the job (architect-AC14). */
  function rerollProblem(rec: DayRecord | null, id: string): { status: number; code: string; message: string } | null {
    const q = rec?.day.quests.find((x) => x.id === id);
    if (!rec || !q) return { status: 404, code: "not_found", message: "No such quest today." };
    if (q.status !== "open") return { status: 409, code: "not_open", message: "Only an open quest can be swapped." };
    if (rec.day.rerolls_used >= LIMITS.rerollsPerDay) return { status: 409, code: "no_rerolls_left", message: "Today's swap is used." };
    return null;
  }

  async function reroll(date: string, id: string, reason: RerollReason | null, signal?: AbortSignal): Promise<JobOutcome> {
    const rec = await store.readDay(date);
    const problem = rerollProblem(rec, id);
    if (problem) return { result: { result: "superseded", code: problem.code } };
    const day = rec!.day;
    const target = day.quests.find((x) => x.id === id)!;
    const slotIndex = day.quests.indexOf(target);
    const difficulty = target.difficulty;
    const others = day.quests.filter((x) => x.id !== id);
    const energy = day.energy ?? 3;
    const hist = await gather(date);
    const todayTitles = [...day.quests.map((q) => q.title), ...day.rejected.map((r) => r.title)];
    // The rejected quest's length: its `minutes`, or what its title/why names (H1 fix LOW-1), so a
    // "too long" swap can compare even when the quest came from a pool entry without `minutes`.
    const rejectedMinutes = estimateMinutes(target);
    const rejected = { title: target.title, category: target.category, minutes: rejectedMinutes ?? undefined };
    const newId = nextId(id);
    const slot = target.slot ?? slotIndex + 1;

    let replacement: Quest | null = null;
    let source: "ai" | "pool" = "pool";
    let fallback: AiErrorCode | null = null;
    if (ai) {
      const now = stamp();
      const avoid: AvoidItem[] = [...hist.avoid, ...day.rejected.map((r) => ({ title: r.title, date, kind: "rerolled" as const, reason: typeof r.reason === "string" ? r.reason : null }))];
      const built = buildRerollPrompt({
        date,
        weekday: weekdayName(date),
        time: now.slice(11, 16),
        energy,
        mode: typeof day.mode === "string" ? day.mode : "normal",
        profile: await readText("profile"),
        insights: await readText("insights"),
        history: hist.records,
        avoid,
        weekBossTitle: await weekBossTitle(date),
        slots: day.quests.map((q) => q.difficulty),
        slotIndex: slotIndex + 1,
        slotDifficulty: difficulty,
        rejected,
        reason,
        otherCategories: others.map((o) => o.category),
      });
      const res = await callAi({
        runner: ai,
        request: { kind: "reroll", system: built.system, prompt: built.prompt, schema: dayJsonSchema(1), timeoutMs: config.aiTimeoutMs },
        output: aiRerollSchema,
        check: (v) =>
          validateReroll(v, {
            energy,
            difficulty,
            rejected,
            reason,
            others: others.map((o) => ({ title: o.title, category: o.category, cost: o.cost })),
            recentTitles: [...hist.recentTitles, ...todayTitles],
          }),
        ...(monitor ? { monitor } : {}),
        ...(signal ? { signal } : {}),
        now: stamp,
      });
      if (res.ok) {
        source = "ai";
        replacement = aiQuestToQuest(res.value.quests[0]!, slot, newId, difficulty);
      } else {
        if (res.code === "preempted") throw new PreemptedError();
        fallback = res.code;
      }
    }
    if (!replacement) {
      const pool = await readPool();
      const pick = pool
        ? selectReroll({
            pool: pool.daily,
            date,
            energy,
            difficulty,
            rejected,
            reason,
            others: others.map((o) => ({ title: o.title, category: o.category, cost: o.cost })),
            history: hist.poolHistory,
            todayTitles,
          })
        : null;
      // AI and pool both empty: the job fails and the swap is NOT consumed (architect-AC14).
      if (!pick) throw coded("no_replacement", "Nothing else fits this slot today.");
      replacement = poolQuestToQuest(pick, slot, newId, difficulty);
    }

    const at = stamp();
    let wrote = false;
    const { changed } = await store.updateDay(date, (d) => {
      const i = d.quests.findIndex((x) => x.id === id);
      const cur = d.quests[i];
      // Re-check under the mutex: still there, still open, swap still available (architect-AC14).
      if (!cur || cur.status !== "open" || d.rerolls_used >= LIMITS.rerollsPerDay) return;
      if (d.quests.some((x) => x.id === newId)) return;
      const rej: Record<string, unknown> = { title: cur.title, category: cur.category, difficulty: cur.difficulty };
      if (reason) rej.reason = reason;
      if (typeof cur.minutes === "number") rej.minutes = cur.minutes;
      rej.at = at;
      d.quests[i] = replacement!;
      d.rejected = [...d.rejected, rej as (typeof d.rejected)[number]];
      d.rerolls_used = d.rerolls_used + 1;
      wrote = true;
    });
    if (changed) git.touch({ kind: "reroll", ref: id, detail: source }, [store.paths.day(date)]);
    return {
      source,
      result: wrote
        ? { result: "written", quest_id: newId, title: replacement.title, ...(fallback ? { fallback_reason: fallback } : {}) }
        : { result: "superseded" },
    };
  }

  // ------------------------------------------------------------ weekly boss

  function bossFromPool(week: string, pick: NonNullable<ReturnType<typeof selectBoss>>): Boss {
    const boss: Record<string, unknown> = {
      id: `${week}-boss`,
      title: pick.title,
      why: pick.why,
      category: pick.category,
      difficulty: "boss",
      coins: TARIFF.boss,
      status: "open",
      feedback: null,
      source: "pool",
      completed_at: null,
    };
    if (pick.type) boss.type = pick.type;
    if (pick.checkpoints?.length) boss.checkpoints = pick.checkpoints.map((text) => ({ text, done: false }));
    return boss as Boss;
  }

  function bossFromAi(week: string, b: AiBoss): Boss {
    return {
      id: `${week}-boss`,
      title: b.title,
      why: b.why,
      category: BOSS_TYPE_CATEGORY[b.type],
      difficulty: "boss",
      coins: TARIFF.boss,
      status: "open",
      feedback: null,
      source: "ai",
      completed_at: null,
      type: b.type,
      checkpoints: b.checkpoints.slice(0, LIMITS.checkpoints).map((text) => ({ text, done: false })),
      artifact: b.artifact,
      cost: b.cost,
    } as Boss;
  }

  async function previousBosses(week: string, date: string): Promise<{ lastType: string | null; last: Boss | null; titles: string[] }> {
    const titles: string[] = [];
    let last: Boss | null = null;
    for (let i = 1; i <= 4; i++) {
      try {
        const b = (await store.readWeek(isoWeek(addDays(date, -7 * i))))?.week.boss ?? null;
        if (i === 1) last = b;
        if (b) titles.push(b.title);
      } catch (e) {
        if (!isQuarantine(e)) throw e;
      }
    }
    void week;
    return { lastType: (last?.type as string | undefined) ?? null, last, titles };
  }

  /**
   * Create this week's file with a pool placeholder if it doesn't exist (create-if-absent, never overwrites).
   * Returns whether the app created it (so the caller can enqueue the AI boss). Empty `boss:` pool → no file.
   */
  async function createPlaceholderWeek(week: string, date: string): Promise<{ created: boolean }> {
    const pool = await readPool();
    const prev = await previousBosses(week, date);
    const pick = pool ? selectBoss({ pool: pool.boss, week, previous: prev.last }) : null;
    if (!pick) return { created: false }; // backlog COULD: no boss-less file; the AI job may create it
    const at = stamp();
    try {
      const { record, changed } = await store.updateWeek(
        week,
        (d) => {
          d.boss = bossFromPool(week, pick);
          d.generation = { source: "pool", model: null, at };
        },
        { expectedEtag: "*" },
      );
      if (changed) {
        placeholderEtags.set(week, record.etag);
        git.touch({ kind: "boss", ref: week, detail: "pool" }, [store.paths.week(week)]);
      }
      return { created: changed };
    } catch (e) {
      if (e instanceof StoreError && e.code === "stale") return { created: false }; // someone else made it first
      throw e;
    }
  }

  async function generateBoss(week: string, date: string, signal?: AbortSignal): Promise<JobOutcome> {
    if (!ai) return { result: { result: "skipped" } };
    const prev = await previousBosses(week, date);
    const bossType = nextBossType(prev.lastType, hashString(week));
    const hist = await gather(date, RECENT_TITLE_DAYS);
    const built = buildBossPrompt({
      week,
      date,
      mode: "normal",
      bossType,
      lastType: prev.lastType,
      profile: await readText("profile"),
      insights: await readText("insights"),
      history: hist.records,
      recentBossTitles: prev.titles,
    });
    const res = await callAi({
      runner: ai,
      request: { kind: "generate_boss", system: built.system, prompt: built.prompt, schema: bossJsonSchema, timeoutMs: config.aiTimeoutMs },
      output: aiBossSchema,
      check: (v) => validateBoss(v, { lastType: prev.lastType ?? undefined, recentBossTitles: prev.titles }),
      ...(monitor ? { monitor } : {}),
      ...(signal ? { signal } : {}),
      now: stamp,
    });
    if (!res.ok) {
      if (res.code === "preempted") throw new PreemptedError();
      return { source: "pool", result: { result: "kept", fallback_reason: res.code } };
    }
    const boss = bossFromAi(week, res.value.boss);
    const expected = placeholderEtags.get(week) ?? "*";
    const at = stamp();
    let wrote = false;
    try {
      const { changed } = await store.updateWeek(
        week,
        (d) => {
          const cur = d.boss;
          // Only an untouched placeholder may be replaced (architect-AC15, psychologist-AC18). Photos count as a
          // touch: swapping the boss would silently drop them.
          if (cur) {
            const touched =
              cur.source !== "pool" ||
              cur.status !== "open" ||
              cur.feedback !== null ||
              (cur.checkpoints ?? []).some((c) => c.done) ||
              bossHasPhotos(cur);
            if (touched) return;
          }
          d.boss = boss;
          d.generation = { source: "ai", model: ai.model, at, attempts: res.attempts } as typeof d.generation;
          wrote = true;
        },
        { expectedEtag: expected },
      );
      if (changed) {
        placeholderEtags.delete(week);
        git.touch({ kind: "boss", ref: week, detail: "ai" }, [store.paths.week(week)]);
      }
    } catch (e) {
      if (e instanceof StoreError && (e.code === "stale" || isQuarantine(e))) return { source: "ai", result: { result: "superseded" } };
      throw e;
    }
    return { source: "ai", result: { result: wrote ? "written" : "superseded" } };
  }

  return { generateDay, reroll, rerollProblem, createPlaceholderWeek, generateBoss, gather, nextId };
}

export type Generator = ReturnType<typeof createGenerator>;
