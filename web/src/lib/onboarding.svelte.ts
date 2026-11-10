/**
 * Onboarding quiz state (designer-AC4, PROVISIONAL C4 in docs/sprints/M4/sprint-goal.md).
 * Kept in localStorage under ONE key so a failed draft job, a phone sleep or a reload never resets the quiz.
 * Cleared on a successful profile save and on "Start over". Nothing else from the app goes into storage.
 */
export const ONBOARDING_KEY = 'qj:onboarding:v1';

export type Answer = string | string[];
export type OnboardingMode = 'quiz' | 'drafting' | 'failed' | 'editing';

export interface OnboardingState {
  step: number;
  answers: Record<string, Answer>;
  mode: OnboardingMode;
  jobId: string | null;
  draft: string | null;
  /** ETag of profile.md loaded BEFORE the quiz started (architect-AC2: a hand edit meanwhile → 412). */
  baseEtag: string | null;
  /** Whether profile.md had real content when the quiz started (→ "This replaces your current notes."). */
  hadProfile: boolean;
}

export function freshState(): OnboardingState {
  return { step: 0, answers: {}, mode: 'quiz', jobId: null, draft: null, baseEtag: null, hadProfile: false };
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadOnboarding(): OnboardingState {
  const raw = storage()?.getItem(ONBOARDING_KEY);
  if (!raw) return freshState();
  try {
    const v = JSON.parse(raw) as Partial<OnboardingState>;
    const s = { ...freshState(), ...v };
    if (typeof s.step !== 'number' || s.step < 0) s.step = 0;
    if (!s.answers || typeof s.answers !== 'object') s.answers = {};
    return s;
  } catch {
    return freshState();
  }
}

export function saveOnboarding(s: OnboardingState): void {
  try {
    storage()?.setItem(ONBOARDING_KEY, JSON.stringify(s));
  } catch {
    /* storage full / private mode: the quiz still works in memory */
  }
}

export function clearOnboarding(): void {
  try {
    storage()?.removeItem(ONBOARDING_KEY);
  } catch {
    /* ignore */
  }
}

/** Answer key for the free-text box under a multi-select question's chips ("Anything else? Write your own"). */
export function ownKey(id: string): string {
  return `${id}:own`;
}

/**
 * Question/answer pairs for POST /api/onboarding/draft. Skipped questions go as "" (the server drops them).
 * A multi-select's own text is appended after its chips: "manga, games, chess, photography".
 */
export function answerPairs(
  questions: readonly { id: string; text: string }[],
  answers: Record<string, Answer>
): { question: string; answer: string }[] {
  return questions.map((q) => {
    const a = answers[q.id];
    const own = answers[ownKey(q.id)];
    const parts = [Array.isArray(a) ? a.join(', ') : (a ?? ''), typeof own === 'string' ? own : ''].map((s) => s.trim()).filter(Boolean);
    return { question: q.text, answer: parts.join(', ').slice(0, 1000) };
  });
}
