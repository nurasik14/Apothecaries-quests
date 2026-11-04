/** Money noted on the ledger page (`spent:`): the evening PUT, the day file, and the garden's spending stats. */
import { afterAll, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spendingStats, spentSuggestions, type StatsDay } from "../src/stats";
import { matchSpentSuggestions, parseAmount, saveBody, emptyForm, spentRows, spentTotal, SPEND_CATEGORIES as WEB_SPEND_CATEGORIES, spendCategoryOf as webSpendCategoryOf } from "../../web/src/lib/eveningForm";
import { SPEND_CATEGORIES, spendCategoryOf } from "../src/domain";
import { COPY } from "../../web/src/lib/copy";
import { cleanupTempDirs, makeTestApp, req, type TestApp } from "./helpers";

afterAll(cleanupTempDirs);

type Json = Record<string, any>;
const NOW = "2026-10-25T10:00:00+05:00"; // logical 2026-10-25, Asia/Tashkent
const TODAY = "2026-10-25";

async function call(t: TestApp, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    (init.headers as Record<string, string>)["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await req(t.app, path, init);
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : null) as Json, etag: res.headers.get("etag")?.replace(/"/g, "") ?? null };
}

const app = () => makeTestApp({ now: NOW, env: { AI_BOSS_ON_OPEN: "false" } });
const sd = (date: string, spent: StatsDay["spent"]): StatsDay => ({ date, satisfaction: null, quests: [], spent });

describe("evening PUT with spent", () => {
  test("saves the list to the front matter, rounds to cents, drops empty notes; a re-save of the same list is a no-op", async () => {
    const t = await app();
    const r = await call(t, "PUT", `/api/days/${TODAY}/evening`, { spent: [{ amount: 38.499, note: " lunch " }, { amount: 12, note: "" }] }, { "if-match": "*" });
    expect(r.status).toBe(200);
    expect(r.data.day.spent).toEqual([{ amount: 38.5, note: "lunch" }, { amount: 12 }]);
    const text = await readFile(join(t.dataDir, "days", `${TODAY}.md`), "utf8");
    expect(text).toContain("spent:");
    expect(text).toContain("note: lunch");
    const again = await call(t, "PUT", `/api/days/${TODAY}/evening`, { spent: [{ amount: 38.5, note: "lunch" }, { amount: 12 }] }, { "if-match": r.etag! });
    expect(again.status).toBe(200);
    expect(again.etag).toBe(r.etag);
  });

  test("rejects negative amounts, long notes and unknown keys", async () => {
    const t = await app();
    for (const spent of [[{ amount: -1 }], [{ amount: 5, note: "x".repeat(81) }], [{ amount: 5, what: "?" }]]) {
      const r = await call(t, "PUT", `/api/days/${TODAY}/evening`, { spent }, { "if-match": "*" });
      expect(r.status).toBe(400);
    }
  });

  test("a hand-written bare number reads as an entry and doesn't quarantine the page", async () => {
    const t = await app();
    await writeFile(join(t.dataDir, "days", `${TODAY}.md`), `---\ndate: ${TODAY}\nspent:\n  - 20\n  - amount: 5.5\n    note: bus\n---\n`);
    const r = await call(t, "GET", `/api/days/${TODAY}`);
    expect(r.status).toBe(200);
    expect(r.data.spent).toEqual([{ amount: 20 }, { amount: 5.5, note: "bus" }]);
  });

  test("/api/stats carries per-day sums and the spending block", async () => {
    const t = await app();
    await call(t, "PUT", `/api/days/2026-10-24/evening`, { satisfaction: 6, spent: [{ amount: 100, note: "Books" }] }, { "if-match": "*" });
    await call(t, "PUT", `/api/days/${TODAY}/evening`, { spent: [{ amount: 30, note: "books" }, { amount: 10 }] }, { "if-match": "*" });
    const r = await call(t, "GET", `/api/stats?from=2026-10-19&to=${TODAY}`);
    expect(r.status).toBe(200);
    expect(r.data.heatmap.find((h: Json) => h.date === TODAY).spent).toBe(40);
    expect(r.data.spending.today).toBe(40);
    expect(r.data.spending.total).toBe(140);
    expect(r.data.spending.avg_per_day).toBe(70);
    expect(r.data.spending.top[0]).toEqual({ note: "Books", amount: 130, count: 2 });
  });
});

describe("spending categories", () => {
  test("the web mirror matches the server list, every kind has a label, and both read rules agree", () => {
    expect([...WEB_SPEND_CATEGORIES]).toEqual([...SPEND_CATEGORIES]);
    for (const c of SPEND_CATEGORIES) expect(COPY.spendCategory[c]).toBeTruthy();
    for (const v of [undefined, null, "", "cafe", " Cafe ", "rent", 5]) expect(webSpendCategoryOf(v)).toBe(spendCategoryOf(v));
  });

  test("PUT stores the category; an unknown one is a 400; a category change alone is a real save", async () => {
    const t = await app();
    const r = await call(t, "PUT", `/api/days/${TODAY}/evening`, { spent: [{ amount: 60, note: "film", category: "entertainment" }, { amount: 9 }] }, { "if-match": "*" });
    expect(r.status).toBe(200);
    expect(r.data.day.spent).toEqual([{ amount: 60, note: "film", category: "entertainment" }, { amount: 9 }]);
    const text = await readFile(join(t.dataDir, "days", `${TODAY}.md`), "utf8");
    expect(text).toContain("category: entertainment");
    const changed = await call(t, "PUT", `/api/days/${TODAY}/evening`, { spent: [{ amount: 60, note: "film", category: "subscription" }, { amount: 9 }] }, { "if-match": r.etag! });
    expect(changed.status).toBe(200);
    expect(changed.etag).not.toBe(r.etag);
    const bad = await call(t, "PUT", `/api/days/${TODAY}/evening`, { spent: [{ amount: 1, category: "rent" }] }, { "if-match": "*" });
    expect(bad.status).toBe(400);
  });

  test("a hand-written unknown category reads fine and counts as other", async () => {
    const t = await app();
    await writeFile(join(t.dataDir, "days", `${TODAY}.md`), `---\ndate: ${TODAY}\nspent:\n  - amount: 20\n    category: rent\n  - amount: 5\n    category: Grocery\n---\n`);
    const r = await call(t, "GET", `/api/stats?from=2026-10-19&to=${TODAY}`);
    expect(r.status).toBe(200);
    expect(r.data.spending.by_category).toEqual([
      { category: "other", amount: 20, count: 1 },
      { category: "grocery", amount: 5, count: 1 },
    ]);
  });

  test("by_category sums the range only, largest first; entries without a category are other", () => {
    const days = [
      sd("2026-09-30", [{ amount: 500, category: "electronics" }]),
      sd("2026-10-20", [{ amount: 10, note: "tea", category: "cafe" }, { amount: 30, category: "grocery" }]),
      sd("2026-10-25", [{ amount: 5, note: "Tea", category: "cafe" }, { amount: 1 }]),
    ];
    expect(spendingStats(days, TODAY, "2026-10-19", TODAY).by_category).toEqual([
      { category: "grocery", amount: 30, count: 1 },
      { category: "cafe", amount: 15, count: 2 },
      { category: "other", amount: 1, count: 1 },
    ]);
    expect(spendingStats([sd(TODAY, [])], TODAY, "2026-10-19", TODAY).by_category).toEqual([]);
  });
});

describe("spendingStats (pure)", () => {
  const days = [sd("2026-09-30", [{ amount: 500 }]), sd("2026-10-20", [{ amount: 10, note: "tea" }]), sd("2026-10-25", [{ amount: 5.25, note: "Tea" }, { amount: 1 }])];

  test("today / 7 days / month are independent of the range; range sums and averages over calendar days", () => {
    const s = spendingStats(days, TODAY, "2026-10-19", TODAY);
    expect(s).toMatchObject({ today: 6.25, last_7_days: 16.25, this_month: 16.25, total: 16.25, days: 2, entries: 3, any: true });
    expect(s.avg_per_day).toBe(2.71); // 16.25 over 10-20..10-25 (6 days)
    expect(s.biggest_day).toEqual({ date: "2026-10-20", amount: 10 });
    expect(s.top).toEqual([
      { note: "tea", amount: 15.25, count: 2 },
      { note: null, amount: 1, count: 1 },
    ]);
  });

  test("nothing noted → zeros, null average, any=false", () => {
    const s = spendingStats([sd(TODAY, [])], TODAY, "2026-10-19", TODAY);
    expect(s).toMatchObject({ today: 0, total: 0, avg_per_day: null, biggest_day: null, top: [], any: false });
  });
});

describe("evening form helpers", () => {
  test("parseAmount", () => {
    expect(parseAmount("38")).toBe(38);
    expect(parseAmount("12.5")).toBe(12.5);
    expect(parseAmount("38,50")).toBe(38.5);
    expect(parseAmount("1,200")).toBe(1200);
    expect(parseAmount("HK$ 7")).toBe(7);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("1.2.3")).toBeNull();
  });

  test("saveBody sends the whole spent list when it changed, notes trimmed, empty notes left out", () => {
    const loaded = emptyForm();
    const form = { ...loaded, spent: [{ amount: 5, note: " bus ", category: "other" as const }, { amount: 2, note: "", category: "cafe" as const }] };
    expect(saveBody(form, loaded)).toEqual({ spent: [{ amount: 5, note: "bus", category: "other" }, { amount: 2, category: "cafe" }] });
    expect(spentRows([{ amount: 3, note: null }])).toEqual([{ amount: 3, note: "", category: "other" }]);
    expect(spentRows([{ amount: 3, category: "Grocery" }, { amount: 1, category: "rent" }])).toEqual([
      { amount: 3, note: "", category: "grocery" },
      { amount: 1, note: "", category: "other" },
    ]);
    expect(spentTotal([{ amount: 0.1 }, { amount: 0.2 }])).toBe(0.3);
  });
});

describe("spent note suggestions (Evening \"What for\" autocomplete)", () => {
  test("distinct notes, case-insensitive, newest first, carrying the latest category and amount; future and empty notes left out", () => {
    const days = [
      sd("2026-10-20", [{ amount: 10, note: "MTR", category: "other" }, { amount: 4 }]),
      sd("2026-10-22", [{ amount: 28.4, note: "mtr ", category: "transportation" }, { amount: 50, note: "Lunch", category: "cafe" }]),
      sd("2026-10-23", [{ amount: 285, note: "Pinduoduo", category: "entertainment" }]),
      sd("2026-10-30", [{ amount: 1, note: "future" }]),
    ];
    expect(spentSuggestions(days, TODAY)).toEqual([
      { note: "Pinduoduo", category: "entertainment", amount: 285, count: 1, last_date: "2026-10-23" },
      { note: "mtr", category: "transportation", amount: 28.4, count: 2, last_date: "2026-10-22" },
      { note: "Lunch", category: "cafe", amount: 50, count: 1, last_date: "2026-10-22" },
    ]);
  });

  test("GET /api/spent/suggestions reads the day pages", async () => {
    const t = await app();
    await call(t, "PUT", `/api/days/2026-10-24/evening`, { spent: [{ amount: 12, note: "Bus", category: "transportation" }] }, { "if-match": "*" });
    const r = await call(t, "GET", "/api/spent/suggestions");
    expect(r.status).toBe(200);
    expect(r.data.suggestions).toEqual([{ note: "Bus", category: "transportation", amount: 12, count: 1, last_date: "2026-10-24" }]);
  });

  test("matchSpentSuggestions: prefix, then word start, then substring; empty input offers nothing", () => {
    const s = (note: string) => ({ note, category: "other" as const, amount: 1, count: 1, last_date: TODAY });
    const list = [s("Bistro AC3 lunch"), s("Transportation"), s("Lunch box"), s("MTR"), s("brunch")];
    expect(matchSpentSuggestions(list, "lun").map((x) => x.note)).toEqual(["Lunch box", "Bistro AC3 lunch"]);
    expect(matchSpentSuggestions(list, "unch").map((x) => x.note)).toEqual(["Bistro AC3 lunch", "Lunch box", "brunch"]);
    expect(matchSpentSuggestions(list, " TR").map((x) => x.note)).toEqual(["Transportation", "Bistro AC3 lunch", "MTR"]);
    expect(matchSpentSuggestions(list, "  ")).toEqual([]);
    expect(matchSpentSuggestions(list, "u", 2)).toHaveLength(2);
  });
});
