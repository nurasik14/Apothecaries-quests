/**
 * Tiny typed fetch wrapper. Types come from the server via `import type` only (architect-AC2).
 * Network failures and timeouts flip `net.offline`; any answer from the server clears it. The core is http.ts.
 */
import type {
  DecideResponse,
  KbInsightsJson,
  KbProfileJson,
  ProposalJson,
  CheckinResponse,
  DayJson,
  Economy,
  EveningBody,
  PurchaseJson,
  PurchaseResponse,
  ShopResponse,
  SpentSuggestion,
  StatsResponse,
  WishlistResponse,
  EveningResponse,
  Job,
  QuestPatchBody,
  QuestPatchResponse,
  RerollResponse,
  TodayResponse
} from '../../../server/src/api-types';
import { ApiError, NetworkError, send, TimeoutError, type Reply } from './http';
import { net } from './net.svelte';

export { ApiError, NetworkError, TimeoutError, type Reply };

/** Every request has a timeout (http.ts, H1 #273); reaching the server or not drives the offline banner. */
function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply<T>> {
  return send<T>(method, path, body, headers, { onReach: (ok) => (net.offline = !ok) });
}

export const api = {
  // ---- M5: ledger + Palace Market
  economy: () => request<Economy>('GET', '/api/economy'),
  shop: () => request<ShopResponse>('GET', '/api/shop'),
  purchases: (limit = 50) => request<{ purchases: PurchaseJson[] }>('GET', `/api/purchases?limit=${limit}`),
  buy: (item_id: string, request_id: string) => request<PurchaseResponse>('POST', '/api/purchases', { item_id, request_id }),
  voidPurchase: (id: string) => request<PurchaseResponse>('POST', `/api/purchases/${encodeURIComponent(id)}/void`, {}),
  wish: (item_id: string) => request<WishlistResponse>('PUT', `/api/wishlist/${encodeURIComponent(item_id)}`, {}),
  unwish: (item_id: string) => request<WishlistResponse>('DELETE', `/api/wishlist/${encodeURIComponent(item_id)}`, {}),

  today: () => request<TodayResponse>('GET', '/api/today'),
  checkin: (energy: number) => request<CheckinResponse & { job?: Job }>('POST', '/api/today/checkin', { energy }),
  generate: () => request<{ job: Job }>('POST', '/api/today/generate', {}),
  job: (id: string) => request<Job>('GET', `/api/jobs/${encodeURIComponent(id)}`),
  patchQuest: (id: string, body: QuestPatchBody) =>
    request<QuestPatchResponse>('PATCH', `/api/quests/${encodeURIComponent(id)}`, body),
  reroll: (id: string, reason: string | null) =>
    request<RerollResponse>('POST', `/api/quests/${encodeURIComponent(id)}/reroll`, reason ? { reason } : {}),
  day: (date: string) => request<DayJson>('GET', `/api/days/${encodeURIComponent(date)}`),
  saveEvening: (date: string, body: EveningBody, etag: string) =>
    request<EveningResponse>('PUT', `/api/days/${encodeURIComponent(date)}/evening`, body, {
      'If-Match': etag === '*' ? '*' : `"${etag}"`
    }),
  spentSuggestions: () => request<{ suggestions: SpentSuggestion[] }>('GET', '/api/spent/suggestions'),
  health: () =>
    request<{ date: string; tz: string; rollover_hour: number }>('GET', '/api/health'),

  // ---- M6: the garden + Notes editor
  stats: (from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const qs = q.toString();
    return request<StatsResponse>('GET', `/api/stats${qs ? `?${qs}` : ''}`);
  },
  saveInsights: (content: string, etag: string) =>
    request<KbInsightsJson>('PUT', '/api/kb/insights', { content }, { 'If-Match': etag === '*' ? '*' : `"${etag}"` }),

  // ---- M4
  profile: () => request<KbProfileJson>('GET', '/api/kb/profile'),
  insights: () => request<KbInsightsJson>('GET', '/api/kb/insights'),
  saveProfile: (content: string, etag: string) =>
    request<KbProfileJson>('PUT', '/api/kb/profile', { content }, { 'If-Match': etag === '*' ? '*' : `"${etag}"` }),
  onboardingDraft: (answers: { question: string; answer: string }[]) =>
    request<{ job: Job }>('POST', '/api/onboarding/draft', { answers }),
  reflect: (date: string) => request<{ job: Job }>('POST', `/api/days/${encodeURIComponent(date)}/reflect`, {}),
  proposals: () => request<{ proposals: ProposalJson[] }>('GET', '/api/insights/proposals?status=pending'),
  proposal: (id: string) => request<ProposalJson>('GET', `/api/insights/proposals/${encodeURIComponent(id)}`),
  decide: (id: string, decisions: { op_id: string; accept: boolean; text?: string }[], etag: string) =>
    request<DecideResponse>('POST', `/api/insights/proposals/${encodeURIComponent(id)}/decide`, { decisions }, {
      'If-Match': `"${etag}"`
    })
};

export type { DayJson, Economy, Job, ProposalJson, PurchaseJson, ShopResponse, StatsResponse, TodayResponse };
