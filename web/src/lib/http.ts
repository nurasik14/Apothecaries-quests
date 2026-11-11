/**
 * The fetch core behind api.ts, kept free of Svelte runes so `bun test` can drive it with a stubbed fetch.
 *
 * Timeouts (hardening H1, backlog #273, architect M6 review §3.1). "Offline" and "unreachable" aren't the same:
 * a phone on Wi-Fi whose PC is asleep looks online, and a TCP connect to a sleeping Tailscale peer can hang for
 * tens of seconds. So every request carries an AbortSignal:
 * - a GET that doesn't answer in time → `TimeoutError` (a `NetworkError`) → the offline banner + offline card;
 * - a mutation that doesn't answer in time has an UNKNOWN outcome (it may have been written). The copy says so
 *   (`failureCopy`), and a retry is safe: quest PATCH / evening PUT set state, purchases replay by `request_id`.
 * All values PROVISIONAL.
 */
import { COPY } from './copy';

export const GET_TIMEOUT_MS = 10_000;
export const MUTATION_TIMEOUT_MS = 20_000;

export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

/** The request never reached the server, or no answer came back (offline, server down, PC asleep). */
export class NetworkError extends Error {
  override name = 'NetworkError';
}

/**
 * No answer within the budget. For a GET nothing changed; for a mutation the outcome is unknown: the server may
 * have written it before the answer got lost.
 */
export class TimeoutError extends NetworkError {
  override name = 'TimeoutError';
  constructor(
    readonly method: string,
    readonly ms: number
  ) {
    super(`No answer within ${ms} ms`);
  }
  get outcome(): 'unchanged' | 'unknown' {
    return this.method === 'GET' ? 'unchanged' : 'unknown';
  }
}

export interface Reply<T> {
  status: number;
  data: T;
  etag: string | null;
}

export function timeoutFor(method: string): number {
  return method === 'GET' ? GET_TIMEOUT_MS : MUTATION_TIMEOUT_MS;
}

export interface SendOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Called with true when the server answered (any status), false when it couldn't be reached. */
  onReach?: (reached: boolean) => void;
}

export async function send<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  opts: SendOptions = {}
): Promise<Reply<T>> {
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const ms = opts.timeoutMs ?? timeoutFor(method);
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, ms);
  let res: Response;
  let text: string;
  // A FormData body (photo upload) goes as multipart; the browser sets its Content-Type with the boundary.
  const form = typeof FormData !== 'undefined' && body instanceof FormData;
  try {
    try {
      res = await doFetch(path, {
        method,
        headers: { Accept: 'application/json', ...(body !== undefined && !form ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: form ? body : body !== undefined ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        signal: ctrl.signal
      });
      // The body is read inside the same budget: a connection that stalls mid-answer is still unreachable.
      text = await res.text();
    } catch (e) {
      // A timed-out mutation may have been written (H1 fix NIT-2): its toast says so, and the global
      // "Nothing was lost" banner would tell the opposite story. The next GET decides reachability.
      if (!(timedOut && method !== 'GET')) opts.onReach?.(false);
      if (timedOut) throw new TimeoutError(method, ms);
      throw new NetworkError(e instanceof Error ? e.message : String(e));
    }
  } finally {
    clearTimeout(timer);
  }
  opts.onReach?.(true);
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // e.g. an HTML page from a misconfigured proxy: treat as unreachable
    opts.onReach?.(false);
    throw new NetworkError(`Non-JSON response (${res.status})`);
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null)?.error;
    // Details go to the console, never the screen (psychologist-AC24).
    console.warn(`[api] ${method} ${path} → ${res.status}`, err);
    throw new ApiError(res.status, err?.code ?? 'unknown', err?.message ?? '', err?.details ?? {});
  }
  const etag = res.headers.get('ETag');
  return { status: res.status, data: data as T, etag: etag ? etag.replace(/^W\//, '').replace(/^"(.*)"$/, '$1') : null };
}

/**
 * The one honest sentence after a failed save (copy truth). Nothing reached the server → "Nothing was lost".
 * A mutation that timed out may have been written → "It may not have saved; try again" (the retry is safe).
 */
export function failureCopy(e: unknown): string {
  if (e instanceof TimeoutError && e.outcome === 'unknown') return COPY.maybeSaved;
  return COPY.saveRetry;
}
