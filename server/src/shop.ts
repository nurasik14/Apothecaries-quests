/**
 * Economy + Palace Market use cases (sprint M5). Gathers the ledger inputs from disk, then hands them to the
 * pure `computeEconomy`. Spending writes go through `store.updateYaml("purchases.yaml")`, whose per-file mutex
 * covers the request_id lookup, the balance check and the append in ONE critical section (architect risk 2).
 * Only the purchases lock is taken there; no day lock is ever nested inside it (no deadlock with PATCH).
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { addDays, isoWeek, isoWithOffset, logicalDate, type Clock } from "./clock";
import type { Config } from "./config";
import { VOID_WINDOW_HOURS } from "./domain";
import {
  availableOn,
  computeEconomy,
  paceEstimate,
  type BrokenInput,
  type Economy,
  type SpendInput,
  type WeekInput,
} from "./economy";
import { StoreError } from "./errors";
import type { Git } from "./git";
import { purchasesFileSchema, type Purchase, type PurchasesFile, type Reward } from "./schemas";
import type { Store } from "./store";
import { ApiError, isQuarantine, problemOf } from "./today";
import type { FileProblem, PurchaseJson, ShopItemJson, WishlistJson } from "./api-types";
import { computeStats, spentSuggestions as suggestSpent, type SpentSuggestion, type Stats, type StatsDay } from "./stats";

export const PURCHASES_FILE = "purchases.yaml";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const purchaseBody = z.strictObject({
  item_id: z.string().min(1).max(80),
  request_id: z.string().regex(UUID, "request_id must be a UUID"),
});

export interface ShopDeps {
  config: Config;
  clock: Clock;
  store: Store;
  git: Git;
  /** Test seam (architect-AC23): runs inside the purchases lock, BEFORE earnings are gathered there. */
  hooks?: { insideLock?: () => Promise<void> };
}

/** How long a purchase waits for the snapshot commit of a hand-edited purchases.yaml. */
const HAND_EDIT_SNAPSHOT_MS = 5_000;

export function createShopService(deps: ShopDeps) {
  const { config, clock, store, git } = deps;
  const today = () => logicalDate(clock.now(), config.tz, config.rolloverHour);
  const stamp = () => isoWithOffset(clock.now(), config.tz);

  /** Every earning file (broken ones as warnings) — the slow-ish part, measured in PROGRESS (architect-AC15). */
  async function gatherEarnings(): Promise<{ days: StatsDay[]; weeks: WeekInput[]; broken: BrokenInput[] }> {
    const broken: BrokenInput[] = [];
    const days: StatsDay[] = [];
    const weeks: WeekInput[] = [];
    const [dayIds, weekIds] = await Promise.all([store.listDays(), store.listWeeks()]);
    await Promise.all(
      dayIds.map(async (d) => {
        try {
          const r = await store.readDay(d);
          if (r) {
            days.push({
              date: r.day.date,
              quests: r.day.quests,
              satisfaction: r.day.satisfaction,
              highlight: r.highlight,
              notes: r.notes,
              gratitude: r.gratitude,
              energy: r.day.energy ?? null,
              private: r.day.private === true,
              spent: r.day.spent,
            });
          }
        } catch (e) {
          if (!(e instanceof StoreError)) throw e;
          broken.push({ file: e.file ?? `days/${d}.md`, code: e.code, message: e.message, date: d });
        }
      }),
    );
    await Promise.all(
      weekIds.map(async (w) => {
        try {
          const r = await store.readWeek(w);
          if (r) weeks.push({ week: r.week.week, boss: r.week.boss });
        } catch (e) {
          if (!(e instanceof StoreError)) throw e;
          broken.push({ file: e.file ?? `weeks/${w}.md`, code: e.code, message: e.message });
        }
      }),
    );
    days.sort((a, b) => (a.date < b.date ? -1 : 1));
    return { days, weeks, broken };
  }

  async function readSpend(): Promise<{ file: PurchasesFile | null; problem: FileProblem | null; warning: BrokenInput | null }> {
    try {
      return { file: (await store.readPurchases()).data, problem: null, warning: null };
    } catch (e) {
      if (!isQuarantine(e)) throw e;
      // NEVER read a broken spend file as empty: that would inflate the balance (architect-AC11).
      return { file: null, problem: problemOf(e), warning: { file: PURCHASES_FILE, code: e.code, message: e.message } };
    }
  }

  const spendOf = (f: PurchasesFile): SpendInput => ({
    purchases: f.purchases.map((p) => ({ ...p, voided_at: p.voided_at ?? null })),
    adjustments: f.adjustments,
  });

  function economyFrom(earn: Awaited<ReturnType<typeof gatherEarnings>>, spend: PurchasesFile | null, extra: BrokenInput[] = []): Economy {
    return computeEconomy({
      days: earn.days,
      weeks: earn.weeks,
      spend: spend ? spendOf(spend) : null,
      broken: [...earn.broken, ...extra],
      today: today(),
      streakBonus: config.streakBonus,
    });
  }

  async function economy(): Promise<Economy> {
    const [earn, spend] = await Promise.all([gatherEarnings(), readSpend()]);
    return economyFrom(earn, spend.file, spend.warning ? [spend.warning] : []);
  }

  async function rewards(): Promise<Reward[]> {
    return (await store.readRewards())?.items ?? []; // broken → throws 422 (calm quarantine UI)
  }

  function purchaseJson(p: Purchase): PurchaseJson {
    const at = Date.parse(p.at);
    const voidable = !p.voided_at && Number.isFinite(at) && clock.now().getTime() - at <= VOID_WINDOW_HOURS * 3_600_000;
    return {
      id: p.id,
      item_id: p.item_id,
      title: p.title ?? p.name ?? p.item_id,
      price: p.price,
      at: p.at,
      date: p.date,
      voided_at: p.voided_at ?? null,
      voidable,
    };
  }

  /** If purchases.yaml was hand-edited since this process last wrote it, commit that version first (A-AC14). */
  async function snapshotHandEdit(): Promise<void> {
    let etag: string | null = null;
    try {
      etag = (await store.readPurchases()).etag;
    } catch {
      return; // broken: the write is refused anyway
    }
    if (etag !== null && etag !== store.lastWrittenEtag(PURCHASES_FILE)) {
      git.touch({ kind: "purchase", detail: "hand_edit" }, [PURCHASES_FILE]);
      await git.flush(HAND_EDIT_SNAPSHOT_MS);
    }
  }

  function newId(date: string, taken: Set<string>): string {
    for (;;) {
      const id = `p-${date}-${randomBytes(2).toString("hex")}`;
      if (!taken.has(id)) return id;
    }
  }

  /** Throw the 422 for a quarantined purchases.yaml (bytes untouched). */
  async function assertSpendReadable(): Promise<void> {
    await store.readPurchases(); // throws StoreError 422 with raw + line
  }

  async function update(fn: (raw: Record<string, unknown>, parsed: PurchasesFile) => void | Promise<void>): Promise<PurchasesFile> {
    return store.updateYaml(PURCHASES_FILE, purchasesFileSchema, async (raw) => {
      const parsed = purchasesFileSchema.parse(raw);
      if (raw.schema === undefined) raw.schema = 1;
      await fn(raw, parsed);
    });
  }

  const arr = (raw: Record<string, unknown>, key: string): unknown[] => {
    if (!Array.isArray(raw[key])) raw[key] = [];
    return raw[key] as unknown[];
  };

  async function shop() {
    const items = await rewards();
    const [earn, spend] = await Promise.all([gatherEarnings(), readSpend()]);
    const econ = economyFrom(earn, spend.file, spend.warning ? [spend.warning] : []);
    const t = today();
    const purchases = spend.file ? spendOf(spend.file).purchases : [];
    const wishId = spend.file?.wishlist[0]?.item_id ?? null;
    const out: ShopItemJson[] = items.map((r) => ({
      id: r.id,
      title: r.title,
      price: r.price,
      cooldown_days: r.cooldown_days,
      ...(r.tier ? { tier: r.tier } : {}),
      ...(r.note ? { note: r.note } : {}),
      available_on: availableOn(purchases, r.id, r.cooldown_days, t),
      affordable: econ.balance !== null && econ.balance >= r.price,
      wished: r.id === wishId,
    }));
    const w = wishId ? items.find((r) => r.id === wishId) : undefined;
    const wishlist: WishlistJson | null = w
      ? {
          item_id: w.id,
          title: w.title,
          price: w.price,
          have: econ.balance,
          need: econ.balance === null ? null : Math.max(0, w.price - econ.balance),
          est_days: econ.balance === null ? null : paceEstimate(w.price - econ.balance, econ),
        }
      : null;
    return { date: t, items: out, wishlist, economy: econ, purchases_error: spend.problem };
  }

  /** The garden (sprint M6): the ledger's inputs and the ledger's own result, never a second streak walk. */
  async function stats(from: string, to: string): Promise<Stats> {
    const [earn, spend] = await Promise.all([gatherEarnings(), readSpend()]);
    const econ = economyFrom(earn, spend.file, spend.warning ? [spend.warning] : []);
    return computeStats({ days: earn.days, broken: earn.broken, today: today(), from, to, economy: econ });
  }

  /** Past money notes for the Evening "What for" autocomplete (read-only, no economy work). */
  async function spentSuggestions(): Promise<SpentSuggestion[]> {
    const earn = await gatherEarnings();
    return suggestSpent(earn.days, today());
  }

  return {
    economy,
    gatherEarnings,
    stats,
    spentSuggestions,
    today,

    shop,

    async listPurchases(limit: number): Promise<{ purchases: PurchaseJson[] }> {
      const f = (await store.readPurchases()).data; // broken → 422
      const list = f.purchases.map((p, i) => ({ p, i }));
      const ms = (x: string) => (Number.isFinite(Date.parse(x)) ? Date.parse(x) : 0);
      list.sort((a, b) => ms(b.p.at) - ms(a.p.at) || b.i - a.i);
      return { purchases: list.slice(0, limit).map((x) => purchaseJson(x.p)) };
    },

    async purchase(itemId: string, requestId: string) {
      await assertSpendReadable();
      const items = await rewards();
      const item = items.find((r) => r.id === itemId);
      // Replays are answered before anything else, so a retried tap is idempotent even if the item vanished.
      const before = (await store.readPurchases()).data;
      const prior = before.purchases.find((p) => p.request_id === requestId);
      if (!prior && !item) throw new ApiError(409, "unknown_item", "That isn't on the market shelves.");
      if (!prior) await snapshotHandEdit();
      // Both sides are read INSIDE the purchases lock (architect-AC8 + AC23/NIT-5): two concurrent taps can never
      // both pass the balance check, and a quest undo racing the tap is seen. Earnings are reads only, so no day
      // lock is ever nested inside this one (no deadlock with PATCH).
      const date = today();
      const at = stamp();
      let result: { purchase: Purchase; changed: boolean } | null = null;
      let earn: Awaited<ReturnType<typeof gatherEarnings>> | null = null;
      const file = await update(async (raw, parsed) => {
        const replay = parsed.purchases.find((p) => p.request_id === requestId);
        if (replay) {
          if (replay.item_id !== itemId) throw new ApiError(409, "request_conflict", "That request was for something else.");
          result = { purchase: replay, changed: false };
          return;
        }
        if (!item) throw new ApiError(409, "unknown_item", "That isn't on the market shelves.");
        await deps.hooks?.insideLock?.();
        earn = await gatherEarnings();
        const econ = economyFrom(earn, parsed);
        if (econ.balance === null) throw new ApiError(422, "unreadable_file", "The purchases page can't be read.");
        const balance = econ.balance;
        const next = availableOn(spendOf(parsed).purchases, item.id, item.cooldown_days, date);
        if (next !== null) throw new ApiError(409, "cooldown", "Not on the shelf again yet.", { available_on: next });
        if (balance < item.price) throw new ApiError(409, "insufficient_funds", "Not enough taels yet.", { balance, price: item.price });
        const p: Purchase = {
          id: newId(date, new Set(parsed.purchases.map((x) => x.id))),
          request_id: requestId,
          item_id: item.id,
          title: item.title,
          price: item.price,
          at,
          date,
          voided_at: null,
        };
        arr(raw, "purchases").push({ ...p });
        result = { purchase: p, changed: true };
      });
      const r = result as { purchase: Purchase; changed: boolean } | null;
      if (!r) throw new Error("purchase: no result");
      if (r.changed) git.touch({ kind: "purchase", ref: r.purchase.item_id }, [PURCHASES_FILE]);
      return { purchase: purchaseJson(r.purchase), economy: economyFrom(earn ?? (await gatherEarnings()), file), changed: r.changed };
    },

    async voidPurchase(id: string) {
      await assertSpendReadable();
      const cur = (await store.readPurchases()).data;
      const target = cur.purchases.find((p) => p.id === id);
      if (!target) throw new ApiError(404, "not_found", "No such purchase.");
      if (!target.voided_at) await snapshotHandEdit();
      const earn = await gatherEarnings();
      const nowMs = clock.now().getTime();
      let result: { purchase: Purchase; changed: boolean } | null = null;
      const file = await update((raw, parsed) => {
        const i = parsed.purchases.findIndex((p) => p.id === id);
        const p = parsed.purchases[i];
        if (!p) throw new ApiError(404, "not_found", "No such purchase.");
        if (p.voided_at) {
          result = { purchase: p, changed: false };
          return;
        }
        const at = Date.parse(p.at);
        if (!Number.isFinite(at) || nowMs - at > VOID_WINDOW_HOURS * 3_600_000) {
          throw new ApiError(409, "void_window_closed", "This one stays on the record.");
        }
        const voidedAt = stamp();
        const rawP = arr(raw, "purchases")[i] as Record<string, unknown>;
        rawP.voided_at = voidedAt;
        result = { purchase: { ...p, voided_at: voidedAt }, changed: true };
      });
      const r = result as { purchase: Purchase; changed: boolean } | null;
      if (!r) throw new Error("void: no result");
      if (r.changed) git.touch({ kind: "void", ref: r.purchase.id }, [PURCHASES_FILE]);
      return { purchase: purchaseJson(r.purchase), economy: economyFrom(earn, file), changed: r.changed };
    },

    /** Pin ONE wishlist target (psychologist-AC17); replaces any earlier pin. */
    async setWish(itemId: string) {
      await assertSpendReadable();
      const items = await rewards();
      if (!items.some((r) => r.id === itemId)) throw new ApiError(409, "unknown_item", "That isn't on the market shelves.");
      const cur = (await store.readPurchases()).data;
      const already = cur.wishlist.length === 1 && cur.wishlist[0]?.item_id === itemId;
      let changed = false;
      if (!already) {
        await snapshotHandEdit();
        const at = stamp();
        await update((raw) => {
          const list = Array.isArray(raw.wishlist) ? (raw.wishlist as Record<string, unknown>[]) : [];
          if (list.length === 1 && list[0]?.item_id === itemId) return;
          raw.wishlist = [{ item_id: itemId, added_at: at }];
          changed = true;
        });
      }
      if (changed) git.touch({ kind: "wishlist" }, [PURCHASES_FILE]);
      return { changed, ...(await shop()) };
    },

    async clearWish(itemId: string) {
      await assertSpendReadable();
      const cur = (await store.readPurchases()).data;
      const present = cur.wishlist.some((w) => w.item_id === itemId);
      if (!present) {
        const items = await rewards();
        if (!items.some((r) => r.id === itemId)) throw new ApiError(409, "unknown_item", "That isn't on the market shelves.");
      }
      let changed = false;
      if (present) {
        await snapshotHandEdit();
        await update((raw) => {
          const list = Array.isArray(raw.wishlist) ? (raw.wishlist as Record<string, unknown>[]) : [];
          const next = list.filter((w) => w?.item_id !== itemId);
          if (next.length === list.length) return;
          raw.wishlist = next;
          changed = true;
        });
      }
      if (changed) git.touch({ kind: "wishlist" }, [PURCHASES_FILE]);
      return { changed, ...(await shop()) };
    },

    /** `welcome back` after ≥2 logical days without any day file (psychologist-AC23). Cheap: one readdir. */
    async welcomeBack(): Promise<boolean> {
      const t = today();
      const past = (await store.listDays()).filter((d) => d < t);
      const last = past.at(-1);
      return last !== undefined && last < addDays(t, -2);
    },

    currentWeek: () => isoWeek(today()),
  };
}

export type ShopService = ReturnType<typeof createShopService>;
