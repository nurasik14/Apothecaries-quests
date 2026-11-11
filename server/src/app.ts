/**
 * Hono app factory. Everything is injected (config, clock, store, git) so tests run against temp dirs.
 */
import { access, constants, stat } from "node:fs/promises";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { addDays, isoWithOffset, isValidDate, logicalDate, type Clock } from "./clock";
import { normalizeHost, type Config } from "./config";
import { LIMITS } from "./domain";
import { CONTENT_TYPES, isMediaPath, MediaError, resolveMedia, saveMedia, sniffImage } from "./media";
import { StoreError } from "./errors";
import type { Git } from "./git";
import { createAiMonitor, createClaudeRunner, type AiMonitor, type AiRunner } from "./ai";
import { createAnthropicRunner, createOllamaRunner, createOpenAiRunner } from "./ai-http";
import { createGenerator } from "./generation";
import { createJobs, type Jobs } from "./jobs";
import { createKbService, decideBody, kbPutBody, onboardingBody, PROPOSAL_STATUSES } from "./kb";
import { createShopService, purchaseBody, type ShopDeps } from "./shop";
import { STATS_DEFAULT_SPAN, STATS_MAX_SPAN } from "./stats";
import { createSpaHandler } from "./static";
import type { DayRecord, Store } from "./store";
import { ApiError, checkinBody, createTodayService, dayJson, eveningBody, questPatchBody, rerollBody } from "./today";

export interface AppDeps {
  config: Config;
  clock: Clock;
  store: Store;
  git: Git;
  /** Job registry; one is created if omitted. */
  jobs?: Jobs;
  /**
   * The `claude -p` seam. `null` = AI off (pool by design). Omitted: the real runner when `AI_ENABLED`,
   * except under `bun test`, where an omitted runner means AI off (tests never spawn claude, G4).
   */
  ai?: AiRunner | null;
  monitor?: AiMonitor;
  /** Check-in inline wait for fast jobs (default 250 ms). */
  inlineWaitMs?: number;
  /** Test seams inside the shop service (architect-AC23). */
  shopHooks?: ShopDeps["hooks"];
}

/** Days between two ISO dates, inclusive (both valid). */
function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export function defaultRunner(config: Config): AiRunner | null {
  if (!config.aiEnabled || config.nodeEnv === "test") return null;
  // A missing binary still gets a runner: every call then reports `enoent` and falls back to the pool,
  // and /api/health says `claude_missing` (architect-AC17).
  const http = { baseUrl: config.aiBaseUrl ?? "", model: config.aiModel, apiKey: config.aiApiKey, jsonMode: config.aiJsonMode };
  switch (config.aiProvider) {
    case "anthropic":
      return createAnthropicRunner(http);
    case "ollama":
      return createOllamaRunner({ ...http, numCtx: config.ollamaNumCtx });
    case "openai":
      return createOpenAiRunner(http);
    default:
      return createClaudeRunner({ bin: config.claudeBinResolved ?? config.claudeBin, model: config.aiModel, nodeEnv: config.nodeEnv });
  }
}

type AiConfigView = Pick<Config, "claudeBin" | "claudeBinResolved" | "aiTimeoutMs"> &
  Partial<Pick<Config, "aiProvider" | "aiBaseUrl" | "aiApiKey">>;

/** Whether the configured AI can actually run (binary found / key present). Never reads the network. */
export function aiAvailability(config: AiConfigView): { available: boolean; reason?: string } {
  const provider = config.aiProvider ?? "claude-cli";
  if (provider === "claude-cli") return config.claudeBinResolved === null ? { available: false, reason: "claude_missing" } : { available: true };
  if (provider === "anthropic" && !config.aiApiKey) return { available: false, reason: "api_key_missing" };
  return { available: true };
}

/**
 * The startup "AI:" log line (M6 fix 1, NIT-2): a missing `claude` must not read like a working setup.
 * `ai` is the runner (null = AI off by config); `claudeBinResolved === null` = the binary wasn't found at startup.
 */
export function aiStartupLine(
  ai: { model: string } | null,
  config: AiConfigView,
): string {
  if (!ai) return "off (pool only)";
  const provider = config.aiProvider ?? "claude-cli";
  if (provider !== "claude-cli") {
    if (!aiAvailability(config).available) {
      return `${provider} API key NOT SET (AI_API_KEY or ANTHROPIC_API_KEY), so quests come from the pool until it is`;
    }
    return `${provider} at ${config.aiBaseUrl}, model ${ai.model}, timeout ${config.aiTimeoutMs} ms`;
  }
  if (config.claudeBinResolved === null) {
    return `claude NOT FOUND ("${config.claudeBin}" is not on PATH), so quests come from the pool until it is installed`;
  }
  return `${config.claudeBinResolved} --model ${ai.model}, timeout ${config.aiTimeoutMs} ms`;
}

export function errorBody(code: string, message: string, details?: unknown) {
  return { error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

/** API shape of a day (architecture.md §2.3 `Day`). */
export function dayToJson(r: DayRecord) {
  return dayJson(r);
}

/** Parse a JSON body against a strict zod schema; malformed JSON or unknown keys → 400. */
async function parseBody<T>(c: Context, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, "bad_request", "The request body isn't valid JSON.");
  }
  const res = schema.safeParse(raw);
  if (!res.success) {
    throw new ApiError(400, "bad_request", "The request has fields the app doesn't accept.", {
      issues: res.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
    });
  }
  return res.data;
}

/** `If-Match: "abc"` / `W/"abc"` / `*` → the bare etag (or `*`). */
export function parseIfMatch(h: string | undefined): string | null {
  if (h === undefined) return null;
  const v = h.trim();
  if (v === "") return null;
  if (v === "*") return "*";
  return v.replace(/^W\//, "").replace(/^"(.*)"$/, "$1");
}

function storeErrorResponse(c: Context, e: StoreError) {
  return c.json(errorBody(e.code, e.message, { ...(e.file ? { file: e.file } : {}), ...e.details }), e.status as 400);
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function createApp(deps: AppDeps) {
  const { config, clock, store, git } = deps;
  const jobs = deps.jobs ?? createJobs({ now: () => clock.now(), stamp: (d) => isoWithOffset(d, config.tz) });
  const ai = deps.ai === undefined ? defaultRunner(config) : deps.ai;
  const monitor = deps.monitor ?? createAiMonitor({ debug: config.debug });
  const gen = createGenerator({ config, clock, store, git, ai, monitor });
  const shop = createShopService({ config, clock, store, git, ...(deps.shopHooks ? { hooks: deps.shopHooks } : {}) });
  const svc = createTodayService({
    economy: shop.economy,
    welcomeBack: shop.welcomeBack,
    config,
    clock,
    store,
    git,
    jobs,
    gen,
    aiEnabled: ai !== null,
    ...(deps.inlineWaitMs !== undefined ? { inlineWaitMs: deps.inlineWaitMs } : {}),
  });
  const kb = createKbService({ config, clock, store, git, jobs, ai, monitor });
  const allowed = new Set(config.allowedHosts.map(normalizeHost));
  const app = new Hono();

  // --- /api guards: no-store, Host allowlist (DNS rebinding), Origin check + JSON-only mutations.
  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    const hostHeader = c.req.header("host") ?? new URL(c.req.url).host;
    if (!allowed.has(normalizeHost(hostHeader))) {
      return c.json(errorBody("misdirected_host", "This host name isn't allowed. Add it to ALLOWED_HOSTS."), 421);
    }
    if (MUTATING.has(c.req.method)) {
      const origin = c.req.header("origin");
      if (origin !== undefined && origin !== "null") {
        let originHost = "";
        try {
          originHost = new URL(origin).host;
        } catch {
          /* invalid origin → rejected below */
        }
        if (!allowed.has(normalizeHost(originHost))) {
          return c.json(errorBody("forbidden_origin", "Cross-origin requests aren't allowed."), 403);
        }
      } else if (origin === "null") {
        return c.json(errorBody("forbidden_origin", "Cross-origin requests aren't allowed."), 403);
      }
      const ct = c.req.header("content-type") ?? "";
      // The one non-JSON mutation: a photo upload is multipart (POST /api/media).
      const upload = c.req.method === "POST" && c.req.path === "/api/media" && /^multipart\/form-data\b/i.test(ct);
      if (!upload && !/^application\/json\b/i.test(ct)) {
        return c.json(errorBody("unsupported_media_type", "Send JSON (Content-Type: application/json)."), 415);
      }
    }
    await next();
    // A served photo keeps its own long private cache header (its path never changes content); everything else is no-store.
    const photo = c.req.method === "GET" && c.req.path.startsWith("/api/media/") && c.res.status === 200;
    if (!photo) c.header("Cache-Control", "no-store");
  });

  app.onError((err, c) => {
    if (err instanceof StoreError) return storeErrorResponse(c, err);
    if (err instanceof ApiError) return c.json(errorBody(err.code, err.message, err.details), err.status as 400);
    console.error(`[api] ${c.req.method} ${new URL(c.req.url).pathname}: ${err instanceof Error ? err.message : String(err)}`);
    return c.json(errorBody("internal", "Something went wrong on the server."), 500);
  });

  // --- health
  app.get("/api/health", async (c) => {
    const now = clock.now();
    let dataDirOk = false;
    try {
      const s = await stat(store.dataDir);
      await access(store.dataDir, constants.W_OK);
      dataDirOk = s.isDirectory();
    } catch {
      dataDirOk = false;
    }
    let broken: Awaited<ReturnType<Store["scanBroken"]>> = [];
    try {
      broken = dataDirOk ? [...(await store.scanBroken()), ...(await kb.scanBroken())] : [];
    } catch (e) {
      broken = [{ file: ".", code: "scan_error", message: e instanceof Error ? e.message : String(e) }];
    }
    return c.json({
      ok: true,
      now: isoWithOffset(now, config.tz),
      date: logicalDate(now, config.tz, config.rolloverHour),
      tz: config.tz,
      rollover_hour: config.rolloverHour,
      data_dir_ok: dataDirOk,
      git: git.status(),
      // Kept under the historical name `claude`; `provider` says which backend is in use.
      claude: {
        provider: config.aiProvider,
        bin: config.aiProvider === "claude-cli" ? config.claudeBinResolved : null,
        ...(config.aiProvider !== "claude-cli" ? { base_url: config.aiBaseUrl } : {}),
        ...(aiAvailability(config).reason ? { reason: aiAvailability(config).reason } : {}),
        enabled: ai !== null,
        /** NIT-2: `enabled` = AI on by config; `available` = it can actually run (binary found / key set). */
        available: ai !== null && aiAvailability(config).available,
        model: ai?.model ?? null,
        ...monitor.status(),
        reflect_flags: kb.reflectFlags(),
      },
      broken_files: broken,
    });
  });

  // --- read a day. `/api/days/:date` is canonical; `/api/day/:date` is an alias (conflict C6).
  const getDay = async (c: Context) => {
    const date = c.req.param("date") ?? "";
    if (!isValidDate(date)) {
      return c.json(errorBody("bad_request", "Dates look like YYYY-MM-DD and must exist on the calendar."), 400);
    }
    const rec = await store.readDay(date);
    if (!rec) return c.json(errorBody("not_found", "No ledger page for this date yet."), 404);
    c.header("ETag", `"${rec.etag}"`);
    return c.json(dayToJson(rec));
  };
  app.get("/api/days/:date", getDay);
  app.get("/api/day/:date", getDay);

  // --- today (sprint M2)
  app.get("/api/today", async (c) => {
    const t = await svc.getToday();
    // Cheap discoverability for the Notes dot and the onboarding invitation (sprint goal 14).
    return c.json({ ...t, pending_proposals: await kb.pendingCount(), profile_empty: await kb.profileEmpty() });
  });

  app.post("/api/today/checkin", async (c) => {
    const { energy } = await parseBody(c, checkinBody);
    const out = await svc.checkin(energy);
    // Every mutation that writes a ledger input returns `economy` (architect-AC22).
    const economy = await shop.economy();
    if (out.status === 200) return c.json({ day: out.day, economy }, 200);
    return c.json({ job: out.job, day: out.day, economy }, 202);
  });

  app.post("/api/today/generate", async (c) => {
    await parseBody(c, { safeParse: (v: unknown) => ({ success: true as const, data: v }) });
    const out = await svc.generate();
    return c.json({ ...out, economy: await shop.economy() }, 202);
  });

  app.get("/api/jobs/:id", (c) => {
    const job = jobs.get(c.req.param("id"));
    if (!job) return c.json(errorBody("not_found", "That job is gone. Reload today's page."), 404);
    return c.json(job);
  });

  app.patch("/api/quests/:id", async (c) => {
    const body = await parseBody(c, questPatchBody);
    return c.json(await svc.patchQuest(c.req.param("id"), body));
  });

  app.post("/api/quests/:id/reroll", async (c) => {
    const body = await parseBody(c, rerollBody);
    const out = await svc.reroll(c.req.param("id"), body.reason ?? null);
    return c.json({ ...out, economy: await shop.economy() }, 202);
  });

  // Raw AI ring buffer: only with DEBUG=1, otherwise indistinguishable from an unknown route (G5).
  if (config.debug) app.get("/api/debug/ai", (c) => c.json({ entries: monitor.ring() }));

  app.put("/api/days/:date/evening", async (c) => {
    const date = c.req.param("date");
    if (!isValidDate(date)) {
      return c.json(errorBody("bad_request", "Dates look like YYYY-MM-DD and must exist on the calendar."), 400);
    }
    const ifMatch = parseIfMatch(c.req.header("if-match"));
    if (ifMatch === null) {
      return c.json(errorBody("precondition_required", "Send If-Match with the ETag you loaded (or * for a new page)."), 428);
    }
    const body = await parseBody(c, eveningBody);
    const { record } = await svc.saveEvening(date, body, ifMatch);
    c.header("ETag", `"${record.etag}"`);
    const reflect = await kb.maybeReflect(date, record);
    return c.json({ day: dayJson(record), reflect_job: reflect.job, reflect_skip: reflect.skip, economy: await shop.economy() });
  });

  // --- photos (media.ts). Upload first, then attach the returned path with PATCH /api/quests/:id (`photos`,
  // `checkpoints[].photos`) or PUT /api/days/:date/evening (`highlight_photos`, `notes_photos`). The upload alone
  // changes no page and makes no commit; `media/` is gitignored in the data repo and never committed.
  app.post(
    "/api/media",
    bodyLimit({
      maxSize: LIMITS.photoBytes + 64 * 1024, // the file + multipart framing
      onError: (c) => c.json(errorBody("too_large", "Photos are at most 8 MB."), 413),
    }),
    async (c) => {
      let form: Record<string, unknown>;
      try {
        form = await c.req.parseBody();
      } catch {
        throw new ApiError(400, "bad_request", "Send the photo as multipart/form-data in the field `file`.");
      }
      const file = form.file;
      if (!(file instanceof File)) throw new ApiError(400, "bad_request", "Send the photo as multipart/form-data in the field `file`.");
      if (file.size > LIMITS.photoBytes) return c.json(errorBody("too_large", "Photos are at most 8 MB."), 413);
      const month = logicalDate(clock.now(), config.tz, config.rolloverHour).slice(0, 7);
      try {
        const path = await saveMedia(store.dataDir, new Uint8Array(await file.arrayBuffer()), month);
        return c.json({ path }, 201);
      } catch (e) {
        if (e instanceof MediaError) return c.json(errorBody(e.code, e.message), e.status);
        throw e;
      }
    },
  );

  app.get("/api/media/*", async (c) => {
    let rel: string;
    try {
      rel = decodeURIComponent(c.req.path.slice("/api/".length));
    } catch {
      return c.json(errorBody("bad_request", "Not a photo path."), 400);
    }
    // Strict: only media/<YYYY-MM>/<id>.<jpg|png|webp>; no `..`, no absolute paths, no symlink out of media/.
    if (!isMediaPath(rel)) return c.json(errorBody("bad_request", "Not a photo path."), 400);
    const abs = await resolveMedia(store.dataDir, rel);
    if (!abs) return c.json(errorBody("not_found", "No such photo."), 404);
    const file = Bun.file(abs);
    const type = sniffImage(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
    if (!type) return c.json(errorBody("not_found", "No such photo."), 404);
    c.header("Cache-Control", "private, max-age=31536000, immutable");
    c.header("X-Content-Type-Options", "nosniff");
    return c.body(file.stream(), 200, { "Content-Type": CONTENT_TYPES[type], "Content-Length": String(file.size) });
  });

  app.post("/api/days/:date/reflect", async (c) => {
    await parseBody(c, { safeParse: (v: unknown) => ({ success: true as const, data: v }) });
    return c.json({ job: await kb.startReflect(c.req.param("date")) }, 202);
  });

  // --- knowledge base (sprint M4)
  app.get("/api/kb/:name", async (c) => {
    const out = await kb.getKb(c.req.param("name"));
    c.header("ETag", `"${out.etag}"`);
    return c.json(out);
  });

  app.put("/api/kb/:name", async (c) => {
    const name = c.req.param("name");
    await kb.getKb(name); // unknown name → 404 before anything else
    const ifMatch = parseIfMatch(c.req.header("if-match"));
    if (ifMatch === null) {
      return c.json(errorBody("precondition_required", "Send If-Match with the ETag you loaded."), 428);
    }
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(errorBody("bad_request", "The request body isn't valid JSON."), 400);
    }
    if (raw && typeof raw === "object" && typeof (raw as { content?: unknown }).content === "string" && (raw as { content: string }).content.length > 20_000) {
      return c.json(errorBody("too_large", "Notes pages hold at most 20000 characters."), 400);
    }
    const parsed = kbPutBody.safeParse(raw);
    if (!parsed.success) return c.json(errorBody("bad_request", "Send {content}."), 400);
    const out = await kb.putKb(name, parsed.data.content, ifMatch);
    c.header("ETag", `"${out.etag}"`);
    // Listed in the economy invariant table (a no-op for coins, but the response proves it, psychologist-AC11).
    return c.json({ ...out, economy: await shop.economy() });
  });

  app.post("/api/onboarding/draft", async (c) => {
    const { answers } = await parseBody(c, onboardingBody);
    return c.json({ job: kb.startOnboarding(answers) }, 202);
  });

  app.get("/api/insights/proposals", async (c) => {
    const status = c.req.query("status") ?? "pending";
    if (!(PROPOSAL_STATUSES as readonly string[]).includes(status)) {
      return c.json(errorBody("bad_request", "status is pending, decided or all."), 400);
    }
    return c.json({ proposals: await kb.listProposals(status as (typeof PROPOSAL_STATUSES)[number]) });
  });

  app.get("/api/insights/proposals/:id", async (c) => {
    const p = await kb.getProposal(c.req.param("id"));
    if (!p) return c.json(errorBody("not_found", "No such suggestion."), 404);
    c.header("ETag", `"${p.etag}"`);
    return c.json(p);
  });

  app.post("/api/insights/proposals/:id/decide", async (c) => {
    const ifMatch = parseIfMatch(c.req.header("if-match"));
    if (ifMatch === null) {
      return c.json(errorBody("precondition_required", "Send If-Match with the suggestion's ETag."), 428);
    }
    const body = await parseBody(c, decideBody);
    const out = await kb.decide(c.req.param("id"), body, ifMatch);
    c.header("ETag", `"${out.proposal.etag}"`);
    return c.json({ proposal: out.proposal, insights: out.insights, economy: await shop.economy() });
  });

  // --- economy + Palace Market (sprint M5)
  app.get("/api/economy", async (c) => c.json(await shop.economy()));

  app.get("/api/shop", async (c) => c.json(await shop.shop()));

  // --- the garden (sprint M6, architect-AC1): read-only, derived from the same inputs as the ledger
  app.get("/api/stats", async (c) => {
    const today = shop.today();
    const qFrom = c.req.query("from");
    const qTo = c.req.query("to");
    for (const v of [qFrom, qTo]) {
      if (v !== undefined && !isValidDate(v)) {
        return c.json(errorBody("bad_request", "Dates look like YYYY-MM-DD and must exist on the calendar."), 400);
      }
    }
    const to = qTo === undefined || qTo > today ? today : qTo;
    const from = qFrom ?? addDays(to, -(STATS_DEFAULT_SPAN - 1));
    if (from > to) return c.json(errorBody("bad_request", "from must be on or before to."), 400);
    if (spanDays(from, to) > STATS_MAX_SPAN) {
      return c.json(errorBody("bad_request", `Ask for at most ${STATS_MAX_SPAN} days at a time.`), 400);
    }
    return c.json(await shop.stats(from, to));
  });

  // Past money notes, for the Evening "What for" autocomplete (newest first; the web filters by keyword).
  app.get("/api/spent/suggestions", async (c) => c.json({ suggestions: await shop.spentSuggestions() }));

  app.get("/api/purchases", async (c) => {
    const raw = c.req.query("limit");
    const limit = raw === undefined ? 50 : Number(raw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || (raw !== undefined && !/^\d+$/.test(raw))) {
      return c.json(errorBody("bad_request", "limit is a whole number from 1 to 200."), 400);
    }
    return c.json(await shop.listPurchases(limit));
  });

  app.post("/api/purchases", async (c) => {
    const { item_id, request_id } = await parseBody(c, purchaseBody);
    const out = await shop.purchase(item_id, request_id);
    return c.json(out, out.changed ? 201 : 200);
  });

  app.post("/api/purchases/:id/void", async (c) => {
    await parseBody(c, z.strictObject({}));
    return c.json(await shop.voidPurchase(c.req.param("id")));
  });

  app.put("/api/wishlist/:item_id", async (c) => {
    await parseBody(c, z.strictObject({}));
    return c.json(await shop.setWish(c.req.param("item_id")));
  });

  app.delete("/api/wishlist/:item_id", async (c) => c.json(await shop.clearWish(c.req.param("item_id"))));

  app.all("/api/*", (c) => c.json(errorBody("not_found", "Unknown API route."), 404));

  // --- the built SPA (production), after every /api route so typos never get HTML (architect-AC4)
  if (config.serveWeb) {
    // NIT-6 (M6 fix 1): the static shell honours the same Host allowlist as /api ("421 until listed"), as plain text.
    app.use("*", async (c, next) => {
      const hostHeader = c.req.header("host") ?? new URL(c.req.url).host;
      if (!allowed.has(normalizeHost(hostHeader))) {
        return c.text("This host name isn't allowed. Add it to ALLOWED_HOSTS and restart Quest Journal.", 421, { "Cache-Control": "no-store" });
      }
      await next();
    });
    app.all("*", createSpaHandler(config.webDist));
  }

  return Object.assign(app, { jobs, ai, kb, shop });
}

/**
 * Mutating /api routes that write nothing the ledger reads, so they don't return `economy` (architect-AC22).
 * Every other mutating route must; the route-table test fails when a new one appears in neither list.
 */
export const ECONOMY_EXEMPT_ROUTES: readonly string[] = [
  "POST /api/days/:date/reflect", // queues a reflect job; writes proposals only
  "POST /api/onboarding/draft", // queues a draft job; writes nothing
  "POST /api/media", // stores a photo file under media/; no page changes until it is attached
];
