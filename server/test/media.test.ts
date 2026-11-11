/**
 * Photos (media.ts + the attach fields on PATCH /api/quests/:id and PUT /api/days/:date/evening).
 * Fixtures are tiny images built here, never real photos. Every DATA_DIR is a temp dir.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AiRequest } from "../src/ai";
import { LIMITS } from "../src/domain";
import { DATA_GITIGNORE } from "../src/init";
import { bossHasPhotos, ensureMediaIgnored, MEDIA_PATH_RE, sniffImage } from "../src/media";
// @ts-expect-error plain JS module shared with the service worker
import { routeFor } from "../../web/src/sw/route.js";
import { fitWithin, MAX_PHOTOS, MEDIA_PATH_RE as WEB_MEDIA_PATH_RE, photosOf, photoUrl, slotsLeft } from "../../web/src/lib/photos";
import { saveBody, emptyForm } from "../../web/src/lib/eveningForm";
import { cleanupTempDirs, envelope, GIT_TEST_ENV, makeTestApp, req, scriptedRunner, VALID_DAY, type Step, type TestApp } from "./helpers";

afterAll(cleanupTempDirs);

type Json = Record<string, any>;
const NOW = "2026-10-25T10:00:00+05:00"; // logical 2026-10-25 (Sunday, 2026-W43), Asia/Tashkent
const TODAY = "2026-10-25";
const WEEK = "2026-W43";
const BOSS = `${WEEK}-boss`;

/** A few-byte JPEG / PNG / WebP: enough for the magic-byte check (the server never decodes pixels). */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const WEBP = new Uint8Array([...new TextEncoder().encode("RIFF"), 4, 0, 0, 0, ...new TextEncoder().encode("WEBPVP8 ")]);

async function call(t: TestApp, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    (init.headers as Record<string, string>)["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await req(t.app, path, init);
  const text = await res.text();
  let data: Json | null = null;
  try {
    data = text ? (JSON.parse(text) as Json) : null;
  } catch {
    data = null;
  }
  return { status: res.status, data: data as Json, etag: res.headers.get("etag")?.replace(/"/g, "") ?? null };
}

async function upload(t: TestApp, bytes: Uint8Array, name = "x.jpg", type = "image/jpeg") {
  const fd = new FormData();
  fd.append("file", new File([bytes], name, { type }));
  const res = await req(t.app, "/api/media", { method: "POST", body: fd });
  return { status: res.status, data: (await res.json()) as Json };
}

async function evening(t: TestApp, date: string, body: Json) {
  const cur = await call(t, "GET", `/api/days/${date}`);
  const etag = cur.status === 200 ? `"${cur.etag}"` : "*";
  return call(t, "PUT", `/api/days/${date}/evening`, body, { "if-match": etag });
}

async function git(dir: string, ...args: string[]): Promise<string> {
  const p = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...GIT_TEST_ENV } });
  const out = await new Response(p.stdout).text();
  await p.exited;
  return out.trim();
}

const app = (env: Record<string, string> = {}) => makeTestApp({ now: NOW, env: { AI_BOSS_ON_OPEN: "false", ...env } });

/** Today's page with the pool boss in place. */
async function withBoss(env: Record<string, string> = {}) {
  const t = await app(env);
  const today = await call(t, "GET", "/api/today");
  expect(today.data.week.boss.id).toBe(BOSS);
  return t;
}

// ---------------------------------------------------------------- pure helpers

describe("media helpers", () => {
  test("magic bytes: JPEG, PNG, WebP only", () => {
    expect(sniffImage(JPEG)).toBe("jpg");
    expect(sniffImage(PNG)).toBe("png");
    expect(sniffImage(WEBP)).toBe("webp");
    expect(sniffImage(new TextEncoder().encode("GIF89a......"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });

  test("path format", () => {
    for (const ok of ["media/2026-11/abcdEFGH1234-_xy.jpg", "media/2026-01/abcdefgh.png", "media/1999-12/abcdefgh.webp"]) {
      expect([ok, MEDIA_PATH_RE.test(ok)]).toEqual([ok, true]);
    }
    for (const bad of [
      "media/2026-13/abcdefgh.jpg",
      "media/2026-11/abc.jpg",
      "media/2026-11/../../.env",
      "/media/2026-11/abcdefgh.jpg",
      "media/2026-11/abcdefgh.jpg/../x",
      "media/2026-11/abcdefgh.gif",
      "media/2026-11/abcd.efgh.jpg",
      "days/2026-10-25.md",
      "media/2026-11/abcdefgh.JPG",
    ]) {
      expect([bad, MEDIA_PATH_RE.test(bad)]).toEqual([bad, false]);
    }
  });

  test("the web mirrors LIMITS.photosPerTarget and the path format", () => {
    expect(MAX_PHOTOS).toBe(LIMITS.photosPerTarget);
    expect(WEB_MEDIA_PATH_RE.source).toBe(MEDIA_PATH_RE.source);
    expect(photoUrl("media/2026-11/abcdefgh.jpg")).toBe("/api/media/2026-11/abcdefgh.jpg");
    expect(photosOf(["media/2026-11/abcdefgh.jpg", "../x", 3, null])).toEqual(["media/2026-11/abcdefgh.jpg"]);
    expect(photosOf(undefined)).toEqual([]);
    expect(slotsLeft(4)).toBe(2);
    expect(slotsLeft(9)).toBe(0);
  });

  test("resize math: longest side 1600, never upscaled", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(10_000, 3)).toEqual({ width: 1600, height: 1 });
  });

  test("bossHasPhotos", () => {
    expect(bossHasPhotos(null)).toBe(false);
    expect(bossHasPhotos({ photos: [] })).toBe(false);
    expect(bossHasPhotos({ photos: ["a"] })).toBe(true);
    expect(bossHasPhotos({ checkpoints: [{}, { photos: ["a"] }] })).toBe(true);
  });

  test("the service worker never caches photos or uploads", () => {
    const o = "https://pc.tail.ts.net";
    expect(routeFor({ url: `${o}/api/media/2026-11/abcdefgh.jpg`, method: "GET", mode: "no-cors" }, o)).toBe("network");
    expect(routeFor({ url: `${o}/api/media`, method: "POST", mode: "cors" }, o)).toBe("network");
  });

  test("evening saveBody sends a photo-only change", () => {
    const loaded = emptyForm();
    const form = { ...emptyForm(), highlight_photos: ["media/2026-11/abcdefgh.jpg"] };
    expect(saveBody(form, loaded)).toEqual({ highlight_photos: ["media/2026-11/abcdefgh.jpg"] });
    expect(saveBody({ ...loaded, notes_photos: [] }, { ...loaded, notes_photos: ["media/2026-11/abcdefgh.jpg"] })).toEqual({ notes_photos: [] });
  });
});

describe("ensureMediaIgnored", () => {
  test("new data repos list media/; old ones get it appended once; other lines are kept", async () => {
    expect(DATA_GITIGNORE).toContain("\nmedia/\n");
    const t = await app();
    const gi = join(t.dataDir, ".gitignore");
    await writeFile(gi, "*.swp\n.trash/"); // an old file, no trailing newline
    expect(await ensureMediaIgnored(t.dataDir)).toBe(true);
    expect(await ensureMediaIgnored(t.dataDir)).toBe(false);
    const text = await readFile(gi, "utf8");
    expect(text.startsWith("*.swp\n.trash/\n")).toBe(true);
    expect(text.match(/^media\/$/gm)?.length).toBe(1);
    await writeFile(gi, "/media\n");
    expect(await ensureMediaIgnored(t.dataDir)).toBe(false);
  });
});

// ---------------------------------------------------------------- upload + serve

describe("POST /api/media + GET /api/media/*", () => {
  test("stores media/<YYYY-MM>/<id>.<ext>, serves it back with a private immutable cache header", async () => {
    const t = await app();
    await writeFile(join(t.dataDir, ".gitignore"), "*.swp\n"); // a data dir initialised before photos existed
    const r = await upload(t, JPEG);
    expect(r.status).toBe(201);
    expect(r.data.path).toMatch(/^media\/2026-10\/[A-Za-z0-9_-]{16}\.jpg$/);
    expect(await readFile(join(t.dataDir, ".gitignore"), "utf8")).toContain("media/");
    expect(new Uint8Array(await readFile(join(t.dataDir, r.data.path)))).toEqual(JPEG);

    const res = await req(t.app, `/api/${r.data.path}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);

    const png = await upload(t, PNG, "a.png", "image/png");
    expect(png.data.path).toEndWith(".png");
    expect((await req(t.app, `/api/${png.data.path}`)).headers.get("content-type")).toBe("image/png");
    const webp = await upload(t, WEBP, "a.webp", "image/webp");
    expect(webp.data.path).toEndWith(".webp");

    // two uploads of the same bytes get different ids; the upload alone writes no page
    const again = await upload(t, JPEG);
    expect(again.data.path).not.toBe(r.data.path);
    expect((await call(t, "GET", `/api/days/${TODAY}`)).status).toBe(404);
  });

  test("rejects non-images (by bytes, not by name), oversize files, missing fields and foreign origins", async () => {
    const t = await app();
    const html = await upload(t, new TextEncoder().encode("<html><script>alert(1)</script></html>"), "x.jpg", "image/jpeg");
    expect(html.status).toBe(400);
    expect(html.data.error.code).toBe("unsupported_image");

    const big = new Uint8Array(LIMITS.photoBytes + 1);
    big.set(JPEG.subarray(0, 4));
    expect((await upload(t, big)).status).toBe(413);

    const fd = new FormData();
    fd.append("other", "x");
    expect((await req(t.app, "/api/media", { method: "POST", body: fd })).status).toBe(400);
    expect((await call(t, "POST", "/api/media", { file: "x" })).status).toBe(400);

    const foreign = new FormData();
    foreign.append("file", new File([JPEG], "x.jpg"));
    expect((await req(t.app, "/api/media", { method: "POST", body: foreign, headers: { origin: "https://evil.example" } })).status).toBe(403);

    // multipart is accepted on this route only
    const elsewhere = new FormData();
    elsewhere.append("energy", "3");
    expect((await req(t.app, "/api/today/checkin", { method: "POST", body: elsewhere })).status).toBe(415);
  });

  test("path traversal, absolute paths, odd names and symlinks never serve anything", async () => {
    const t = await app();
    await writeFile(join(t.dataDir, ".env"), "SECRET=1\n");
    const ok = await upload(t, JPEG);
    const month = ok.data.path.split("/")[1];

    // a symlink with a valid-looking name that points outside media/ (and one outside DATA_DIR)
    await symlink(join(t.dataDir, ".env"), join(t.dataDir, "media", month, "linklinklink.jpg"));
    await symlink("/etc/hostname", join(t.dataDir, "media", month, "etcetcetcetc.jpg"));
    // a non-image file with a valid name
    await writeFile(join(t.dataDir, "media", month, "notanimage1.jpg"), "SECRET=2\n");

    const paths = [
      "/api/media/../.env",
      "/api/media/%2e%2e/.env",
      "/api/media/..%2f..%2f.env",
      `/api/media/${month}/..%2f..%2f.env`,
      "/api/media/%2Fetc%2Fpasswd",
      "/api/media//etc/passwd",
      `/api/media/${month}/linklinklink.jpg`,
      `/api/media/${month}/etcetcetcetc.jpg`,
      `/api/media/${month}/notanimage1.jpg`,
      `/api/media/${month}/missingmissing.jpg`,
      "/api/media/2026-10",
      "/api/media/",
    ];
    for (const p of paths) {
      const res = await req(t.app, p);
      const body = await res.text();
      expect([p, [400, 404].includes(res.status)]).toEqual([p, true]);
      expect([p, body.includes("SECRET")]).toEqual([p, false]);
      expect([p, res.headers.get("cache-control")]).toEqual([p, "no-store"]);
    }
    // the request with the raw `..` segment as sent by `curl --path-as-is`
    const raw = await t.app.fetch(new Request("http://localhost:4317/api/media/../.env", { headers: { host: "localhost:4317" } }));
    expect([400, 404]).toContain(raw.status);
    expect(await raw.text()).not.toContain("SECRET");
  });
});

// ---------------------------------------------------------------- attach: weekly quest + checkpoints

describe("PATCH /api/quests/:id photos (weekly quest and checkpoints)", () => {
  test("boss photos and checkpoint photos are written as path lists; empty lists leave the file", async () => {
    const t = await withBoss();
    const a = (await upload(t, JPEG)).data.path as string;
    const b = (await upload(t, PNG)).data.path as string;
    const weekFile = join(t.dataDir, "weeks", `${WEEK}.md`);

    const r = await call(t, "PATCH", `/api/quests/${BOSS}`, { photos: [a, b, a] });
    expect(r.status).toBe(200);
    expect(r.data.changed).toBe(true);
    expect(r.data.quest.photos).toEqual([a, b]); // deduped, order kept
    let text = await readFile(weekFile, "utf8");
    expect(text).toContain(`photos:\n    - ${a}\n    - ${b}`);

    // the same list again is a no-op
    const same = await call(t, "PATCH", `/api/quests/${BOSS}`, { photos: [a, b] });
    expect(same.data.changed).toBe(false);
    expect(await readFile(weekFile, "utf8")).toBe(text);

    // a checkpoint gets its own photos without being ticked
    const cp = await call(t, "PATCH", `/api/quests/${BOSS}`, { checkpoints: [{ index: 1, photos: [b] }] });
    expect(cp.status).toBe(200);
    expect(cp.data.changed).toBe(true);
    expect(cp.data.quest.checkpoints[1]).toMatchObject({ done: false, photos: [b] });
    expect(cp.data.quest.checkpoints[0].photos).toBeUndefined();
    expect(cp.data.quest.earned).toBe(0);

    // tick + photo in one request
    const both = await call(t, "PATCH", `/api/quests/${BOSS}`, { checkpoints: [{ index: 0, done: true, photos: [a] }] });
    expect(both.data.quest.checkpoints[0]).toMatchObject({ done: true, photos: [a] });

    // removing: [] drops the key from the file (no `photos: []`)
    await call(t, "PATCH", `/api/quests/${BOSS}`, { photos: [], checkpoints: [{ index: 1, photos: [] }, { index: 0, photos: [] }] });
    text = await readFile(weekFile, "utf8");
    expect(text).not.toContain("photos");
    // the file stays on disk (orphans are kept, see media.ts)
    expect((await stat(join(t.dataDir, a))).isFile()).toBe(true);
    // GET /api/today shows the boss without photos
    const today = await call(t, "GET", "/api/today");
    expect(today.data.week.boss.photos).toBeUndefined();
    expect(today.data.week.boss.checkpoints[0].done).toBe(true);
  });

  test("only existing media paths are accepted; at most 6; strict body; dailies have no photos", async () => {
    const t = await withBoss();
    const a = (await upload(t, JPEG)).data.path as string;
    const missing = "media/2026-10/doesnotexist1234.jpg";
    expect((await call(t, "PATCH", `/api/quests/${BOSS}`, { photos: [missing] })).data.error.code).toBe("bad_photo");
    expect((await call(t, "PATCH", `/api/quests/${BOSS}`, { photos: ["days/2026-10-25.md"] })).status).toBe(400);
    expect((await call(t, "PATCH", `/api/quests/${BOSS}`, { photos: ["../../.env"] })).status).toBe(400);
    expect((await call(t, "PATCH", `/api/quests/${BOSS}`, { photos: ["/etc/passwd"] })).status).toBe(400);
    expect((await call(t, "PATCH", `/api/quests/${BOSS}`, { photos: Array(7).fill(a) })).status).toBe(400);
    expect((await call(t, "PATCH", `/api/quests/${BOSS}`, { checkpoints: [{ index: 0 }] })).status).toBe(400);
    expect((await call(t, "PATCH", `/api/quests/${BOSS}`, { checkpoints: [{ index: 0, photos: [a], extra: 1 }] })).status).toBe(400);
    expect((await call(t, "PATCH", `/api/quests/${BOSS}`, { checkpoints: [{ index: 9, photos: [a] }] })).status).toBe(400);
    expect((await call(t, "PATCH", `/api/quests/${BOSS}`, { photo: [a] })).status).toBe(400);
    expect(await readFile(join(t.dataDir, "weeks", `${WEEK}.md`), "utf8")).not.toContain("photos");

    await call(t, "POST", "/api/today/checkin", { energy: 3 });
    const today = await call(t, "GET", "/api/today");
    const daily = today.data.day.quests[0].id;
    expect((await call(t, "PATCH", `/api/quests/${daily}`, { photos: [a] })).status).toBe(400);
  });

  test("a path already on the page stays accepted even if its file was removed by hand", async () => {
    const t = await withBoss();
    const a = (await upload(t, JPEG)).data.path as string;
    const b = (await upload(t, JPEG)).data.path as string;
    await call(t, "PATCH", `/api/quests/${BOSS}`, { photos: [a] });
    await Bun.file(join(t.dataDir, a)).delete();
    const r = await call(t, "PATCH", `/api/quests/${BOSS}`, { photos: [a, b] });
    expect(r.status).toBe(200);
    expect(r.data.quest.photos).toEqual([a, b]);
  });

  test("a hand-written odd `photos:` value reads as none instead of quarantining the week", async () => {
    const t = await withBoss();
    const file = join(t.dataDir, "weeks", `${WEEK}.md`);
    const text = await readFile(file, "utf8");
    await writeFile(file, text.replace("boss:\n", "boss:\n  photos: 3\n"));
    const today = await call(t, "GET", "/api/today");
    expect(today.data.week_error).toBeNull();
    expect(today.data.week.boss.title).toBeTruthy();
  });
});

// ---------------------------------------------------------------- attach: evening Highlight + Notes

describe("PUT /api/days/:date/evening highlight_photos / notes_photos", () => {
  test("front matter lists, a photo-only change is a real change, [] removes the key", async () => {
    const t = await app();
    const a = (await upload(t, JPEG)).data.path as string;
    const b = (await upload(t, JPEG)).data.path as string;
    const dayFile = join(t.dataDir, "days", `${TODAY}.md`);

    const first = await evening(t, TODAY, { satisfaction: 7, highlight: "tea by the river" });
    expect(first.status).toBe(200);
    const r = await evening(t, TODAY, { highlight_photos: [a], notes_photos: [b, a] });
    expect(r.status).toBe(200);
    expect(r.etag).not.toBe(first.etag);
    expect(r.data.day.highlight_photos).toEqual([a]);
    expect(r.data.day.notes_photos).toEqual([b, a]);
    let text = await readFile(dayFile, "utf8");
    expect(text).toContain(`highlight_photos:\n  - ${a}`);
    expect(text).toContain(`notes_photos:\n  - ${b}\n  - ${a}`);
    expect(text).toContain("tea by the river");

    const got = await call(t, "GET", `/api/days/${TODAY}`);
    expect(got.data.highlight_photos).toEqual([a]);

    const same = await evening(t, TODAY, { highlight_photos: [a] });
    expect(same.etag).toBe(r.etag);

    await evening(t, TODAY, { highlight_photos: [], notes_photos: [b] });
    text = await readFile(dayFile, "utf8");
    expect(text).not.toContain("highlight_photos");
    expect(text).toContain(`notes_photos:\n  - ${b}`);
    expect(text).not.toContain(a);
  });

  test("bad paths → 400 and nothing written; unknown keys still 400", async () => {
    const t = await app();
    const a = (await upload(t, JPEG)).data.path as string;
    expect((await evening(t, TODAY, { highlight_photos: ["media/2026-10/doesnotexist1234.jpg"] })).status).toBe(400);
    expect((await evening(t, TODAY, { notes_photos: ["../../../etc/passwd"] })).status).toBe(400);
    expect((await evening(t, TODAY, { notes_photos: Array(7).fill(a) })).status).toBe(400);
    expect((await evening(t, TODAY, { gratitude_photos: [a] })).status).toBe(400);
    expect((await call(t, "GET", `/api/days/${TODAY}`)).status).toBe(404);
  });

  test("a photo added to an old page marks it backfilled (it changed something)", async () => {
    const t = await app();
    const a = (await upload(t, JPEG)).data.path as string;
    await t.store.updateDay("2026-10-20", (d) => {
      d.satisfaction = 6;
    });
    const r = await evening(t, "2026-10-20", { highlight_photos: [a] });
    expect(r.status).toBe(200);
    expect(r.data.day.backfilled).toBe(true);
  });
});

// ---------------------------------------------------------------- privacy: git + AI

describe("photos are never committed", () => {
  test("upload + action commit in a real data repo: git ls-files holds no media/ path", async () => {
    const t = await withBoss({ GIT_ENABLED: "true" });
    // A data repo initialised before photos existed: its .gitignore has no media/ line.
    await writeFile(join(t.dataDir, ".gitignore"), "*.swp\n*.tmp-*\n");
    await t.git.flush();
    t.git.touch({ kind: "day", ref: TODAY });
    await t.git.flush();

    const a = (await upload(t, JPEG)).data.path as string;
    const p = (await upload(t, PNG)).data.path as string;
    expect((await call(t, "PATCH", `/api/quests/${BOSS}`, { photos: [a], checkpoints: [{ index: 0, done: true, photos: [p] }] })).status).toBe(200);
    expect((await evening(t, TODAY, { satisfaction: 8, highlight_photos: [a], notes_photos: [p] })).status).toBe(200);
    await t.git.flush();

    const files = await git(t.dataDir, "ls-files");
    expect(files).toContain(`weeks/${WEEK}.md`);
    expect(files).toContain(`days/${TODAY}.md`);
    expect(files.split("\n").filter((f) => f.startsWith("media"))).toEqual([]);
    expect(await git(t.dataDir, "log", "--all", "--name-only", "--format=")).not.toContain("media/");
    const log = await git(t.dataDir, "log", "--format=%s");
    expect(log).toContain(`qj: boss ${WEEK} checkpoint`);
    expect(log).toContain(`evening ${TODAY}`);
    expect(await readFile(join(t.dataDir, ".gitignore"), "utf8")).toContain("media/");
    // the page references are committed (they're just paths); the files are not
    expect(await git(t.dataDir, "show", `HEAD:days/${TODAY}.md`)).toContain(a);
    // nothing left over: media/ is ignored, so the tree is clean
    expect(await git(t.dataDir, "status", "--porcelain")).toBe("");
  });

  test("a photo-only boss change commits as `boss <week> photos`", async () => {
    const t = await withBoss({ GIT_ENABLED: "true" });
    await t.git.flush();
    const a = (await upload(t, JPEG)).data.path as string;
    await call(t, "PATCH", `/api/quests/${BOSS}`, { photos: [a] });
    await t.git.flush();
    expect(await git(t.dataDir, "log", "-1", "--format=%s")).toBe(`qj: boss ${WEEK} photos`);
  });

  test("even without the ignore line, git.ts never stages media/", async () => {
    const t = await withBoss({ GIT_ENABLED: "true" });
    await t.git.flush();
    await mkdir(join(t.dataDir, "media", "2026-10"), { recursive: true });
    await writeFile(join(t.dataDir, "media", "2026-10", "handplaced1.jpg"), JPEG);
    await writeFile(join(t.dataDir, ".gitignore"), "*.swp\n");
    t.git.touch({ kind: "day", ref: TODAY });
    await t.git.flush();
    expect((await git(t.dataDir, "ls-files")).split("\n").filter((f) => f.startsWith("media"))).toEqual([]);
  });
});

describe("photos never reach the AI", () => {
  test("generate_day and reflect prompts carry no media path", async () => {
    const calls: AiRequest[] = [];
    const reflectOk = envelope({ ops: [], care: false });
    const pick: Step = (r) => {
      calls.push(r);
      return r.kind === "generate_day" ? envelope(VALID_DAY) : r.kind === "reflect" ? reflectOk : { type: "enoent", durationMs: 0 };
    };
    const t = await makeTestApp({ now: NOW, ai: scriptedRunner([pick]), env: { AI_BOSS_ON_OPEN: "false" } });
    const a = (await upload(t, JPEG)).data.path as string;
    for (const d of ["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]) {
      await t.store.updateDay(d, (x) => {
        x.energy = 3;
        x.satisfaction = 6;
        x.highlight = `walk on ${d}`;
        x.notes = `notes on ${d}`;
        x.highlight_photos = [a];
        x.notes_photos = [a];
      });
    }
    await call(t, "POST", "/api/today/checkin", { energy: 3 });
    await (t.app as any).jobs.idle();
    const r = await evening(t, TODAY, { satisfaction: 7, notes: "a long walk", highlight: "river", highlight_photos: [a], notes_photos: [a] });
    expect(r.status).toBe(200);
    await (t.app as any).jobs.idle();
    expect(calls.map((c) => c.kind)).toContain("generate_day");
    expect(calls.map((c) => c.kind)).toContain("reflect");
    for (const c of calls) {
      const all = JSON.stringify(c);
      expect([c.kind, all.includes("media/"), all.includes(a), all.includes("photos")]).toEqual([c.kind, false, false, false]);
    }
    // the history did reach the prompt (so the check above is meaningful)
    expect(calls.find((c) => c.kind === "generate_day")!.prompt).toContain("walk on 2026-10-24");
  });
});
