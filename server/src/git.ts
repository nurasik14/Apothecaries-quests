/**
 * Debounced, serialized auto-commit of the data repo (architecture.md §2.9).
 * - `touch(reason)` schedules one commit after `debounceMs`; touches inside the window are batched.
 * - Never pushes, pulls, merges or rebases (there is no code path for it).
 * - Failures are recorded in `status().last_error` and never thrown at callers.
 * - Commit messages only contain reason codes + ids/dates, never user text (psychologist-AC15).
 */
import { childEnv } from "./config";

/** The photo folder in the data repo (media.ts). Never committed. */
const MEDIA_DIR = "media";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type GitRunner = (args: string[]) => Promise<GitResult>;

export const COMMIT_KINDS = [
  "init",
  "day",
  "checkin",
  "quest",
  "reroll",
  "evening",
  "week",
  "boss",
  "kb",
  "profile",
  "insights",
  "proposal",
  "reflect",
  "purchase",
  "void",
  "wishlist",
  "rewards",
] as const;
export type CommitKind = (typeof COMMIT_KINDS)[number];

export interface CommitReason {
  kind: CommitKind;
  /** A date, week or id such as `2026-10-25`, `2026-W43`, `2026-10-25-2`. No free text. */
  ref?: string;
  /** Status word for quest changes, e.g. `done`. Must be a short lowercase token. */
  detail?: string;
  /** A small non-negative count appended after the detail, e.g. `insights 2026-10-25 accepted 2`. */
  count?: number;
}

const REF_RE = /^[A-Za-z0-9-]{1,40}$/;
const DETAIL_RE = /^[a-z_]{1,16}$/;

/** Render a reason as a privacy-safe message fragment. Invalid parts are dropped. */
export function formatReason(r: CommitReason): string {
  if (!(COMMIT_KINDS as readonly string[]).includes(r.kind)) return "change";
  let s: string = r.kind;
  if (r.ref !== undefined && REF_RE.test(r.ref)) s += ` ${r.ref}`;
  if (r.detail !== undefined && DETAIL_RE.test(r.detail)) s += ` ${r.detail}`;
  if (r.count !== undefined && Number.isInteger(r.count) && r.count >= 0 && r.count < 1000) s += ` ${r.count}`;
  return s;
}

export interface GitStatus {
  enabled: boolean;
  last_commit_at: string | null;
  last_error: string | null;
}

export interface GitOptions {
  dataDir: string;
  enabled: boolean;
  debounceMs?: number;
  /** Override the git runner (tests). Default spawns `git -C <dataDir> …`. */
  runner?: GitRunner;
  /** Extra environment for the default runner (tests isolate global git config with this). */
  env?: Record<string, string>;
  now?: () => Date;
  log?: (msg: string) => void;
  /** Each git call is abandoned (and the default runner's process killed) after this long. Default 30 s. */
  timeoutMs?: number;
}

export const GIT_TIMEOUT_MS = 30_000;

export interface Git {
  touch(reason: CommitReason, files?: string[]): void;
  /** Run any pending commit now and wait for the queue to drain (bounded by `maxWaitMs` if given). */
  flush(maxWaitMs?: number): Promise<void>;
  /** `git init` the data dir if it isn't a repo yet. */
  init(): Promise<void>;
  status(): GitStatus;
  /** Cancel timers (does NOT commit). Use flush() first for a graceful shutdown. */
  close(): void;
}

export function defaultGitRunner(
  dataDir: string,
  env?: Record<string, string>,
  timeoutMs: number = GIT_TIMEOUT_MS,
): GitRunner {
  return async (args) => {
    const proc = Bun.spawn(["git", "-C", dataDir, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: childEnv({ GIT_TERMINAL_PROMPT: "0", ...env }),
    });
    // A hook, gpg pinentry or credential prompt must never wedge the commit queue (architect-AC19).
    const killer = setTimeout(() => proc.kill(9), timeoutMs);
    (killer as { unref?: () => void }).unref?.();
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { code, stdout, stderr };
    } finally {
      clearTimeout(killer);
    }
  };
}

/** Reject with a timeout error if `p` doesn't settle within `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolvePromise, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    (t as { unref?: () => void }).unref?.();
    p.then(
      (v) => {
        clearTimeout(t);
        resolvePromise(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export function createGit(opts: GitOptions): Git {
  const debounceMs = opts.debounceMs ?? 5_000;
  const timeoutMs = opts.timeoutMs ?? GIT_TIMEOUT_MS;
  const rawRun = opts.runner ?? defaultGitRunner(opts.dataDir, opts.env, timeoutMs);
  const run: GitRunner = (args) => withTimeout(rawRun(args), timeoutMs, `git ${args.find((a) => !a.startsWith("-") && !a.includes("=")) ?? ""}`);
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? ((m: string) => console.warn(`[git] ${m}`));
  const state: GitStatus = { enabled: opts.enabled, last_commit_at: null, last_error: null };

  /** A reason plus the files it is about; a reason with files is dropped if none of them is staged (M2 R-BUG-2). */
  interface Pending {
    msg: string;
    files: string[];
  }
  let pendingReasons: Pending[] = [];
  let pendingFiles = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queue: Promise<void> = Promise.resolve();

  async function must(args: string[]): Promise<GitResult> {
    const r = await run(args);
    if (r.code !== 0) throw new Error(`git ${args[0]} failed (${r.code}): ${r.stderr.trim().slice(0, 300)}`);
    return r;
  }

  async function commitNow(reasons: Pending[], files: Set<string>): Promise<void> {
    try {
      await must(["add", "-A"]);
      let staged = await run(["diff", "--cached", "--name-only", "-z"]);
      if (staged.code !== 0) throw new Error(`git diff failed: ${staged.stderr.trim()}`);
      // Photos (`media/`) are never committed. The data repo's .gitignore keeps them out (media.ts ensures the line);
      // if it was removed by hand, they're unstaged here, so they still never reach a commit.
      if (staged.stdout.split("\0").some((n) => n === MEDIA_DIR || n.startsWith(`${MEDIA_DIR}/`))) {
        await must(["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", MEDIA_DIR]);
        staged = await run(["diff", "--cached", "--name-only", "-z"]);
        if (staged.code !== 0) throw new Error(`git diff failed: ${staged.stderr.trim()}`);
      }
      const names = staged.stdout.split("\0").filter(Boolean);
      if (names.length === 0) {
        state.last_error = null;
        return; // nothing to commit
      }
      const stagedSet = new Set(names);
      // A write whose touch() is still pending but whose files `add -A` just staged belongs to THIS commit:
      // adopt its reason now, so it isn't mislabelled "(+hand edits)" and then lost (M4, tester M3 LOW-5).
      const adopted = pendingReasons.filter((r) => r.files.length > 0 && r.files.every((f) => stagedSet.has(f)));
      if (adopted.length) {
        pendingReasons = pendingReasons.filter((r) => !adopted.includes(r));
        for (const r of adopted) for (const f of r.files) files.add(f);
        reasons = [...reasons, ...adopted];
      }
      const relevant = reasons.filter((r) => r.files.length === 0 || r.files.some((f) => stagedSet.has(f)));
      const unique = Array.from(new Set(relevant.map((r) => r.msg)));
      let msg = unique.length > 0 ? `qj: ${unique.slice(0, 5).join(", ")}${unique.length > 5 ? ", …" : ""}` : "qj: hand edits";
      if (unique.length > 0 && files.size > 0 && names.some((n) => !files.has(n))) msg += " (+hand edits)";
      const email = await run(["config", "user.email"]);
      const identity =
        email.code === 0 && email.stdout.trim() !== ""
          ? []
          : ["-c", "user.name=Quest Journal", "-c", "user.email=quest-journal@localhost"];
      await must([...identity, "commit", "-q", "-m", msg]);
      state.last_commit_at = now().toISOString();
      state.last_error = null;
    } catch (e) {
      state.last_error = e instanceof Error ? e.message : String(e);
      log(state.last_error);
      // Keep the reasons so the next touch retries with them.
      pendingReasons = [...reasons, ...pendingReasons];
      for (const f of files) pendingFiles.add(f);
    }
  }

  /**
   * Chain one commit. The reasons are taken when the commit STARTS (not when it's scheduled), so a touch that
   * arrives while another commit is running stays visible to that commit's adoption step (M4).
   */
  function schedule(): Promise<void> {
    if (pendingReasons.length === 0) return queue;
    queue = queue.then(() => {
      const reasons = pendingReasons;
      const files = pendingFiles;
      pendingReasons = [];
      pendingFiles = new Set();
      return reasons.length === 0 ? undefined : commitNow(reasons, files);
    });
    return queue;
  }

  return {
    touch(reason, files) {
      if (!state.enabled) return;
      pendingReasons.push({ msg: formatReason(reason), files: [...(files ?? [])] });
      for (const f of files ?? []) pendingFiles.add(f);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void schedule();
      }, debounceMs);
      (timer as { unref?: () => void }).unref?.();
    },
    async flush(maxWaitMs) {
      if (!state.enabled) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const drained = schedule().then(() => queue);
      if (maxWaitMs === undefined) return drained;
      try {
        await withTimeout(drained, maxWaitMs, "git flush");
      } catch (e) {
        state.last_error = e instanceof Error ? e.message : String(e);
        log(state.last_error);
      }
    },
    async init() {
      if (!state.enabled) return;
      try {
        const top = await run(["rev-parse", "--show-toplevel"]);
        const { realpath } = await import("node:fs/promises");
        const here = await realpath(opts.dataDir);
        if (top.code === 0 && (await realpath(top.stdout.trim()).catch(() => "")) === here) return;
        await must(["init", "-q"]);
      } catch (e) {
        state.last_error = e instanceof Error ? e.message : String(e);
        log(state.last_error);
      }
    },
    status: () => ({ ...state }),
    close() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
