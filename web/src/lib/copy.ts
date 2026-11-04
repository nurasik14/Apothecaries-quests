/**
 * All app copy that isn't theme flavour (theme copy lives in lib/theme/vocab.ts). Source: the psychologist's
 * M2 copy table (docs/sprints/M2/plan-psychologist.md), used verbatim, plus designer screens.md labels.
 * Tone: informational, never controlling; no loss framing. Words like "fail", "missed", "lost", "invalid",
 * "error" or "wrong" never appear in user-visible text (psychologist-AC24).
 */
export const COPY = {
  checkinHeading: 'Morning check-in',
  checkinPrompt: "How's your pulse this morning?",
  checkinButton: "Write today's prescriptions",
  /** M3: every AI loader uses theme `vocab.LOADING.*` (one source, designer risk 8). */
  ready: "Today's prescriptions are ready.",
  newPrescription: (title: string) => `New prescription: ${title}`,
  rerollEmpty: "The cat couldn't find another one. This one stays.",
  bossProgress: (done: number, total: number) => `${done} of ${total}`,
  bossSealOffer: (total: number) => (total === 4 ? 'All four ticked. Seal the week?' : 'All ticked. Seal the week?'),
  bossSealButton: 'Seal the week',
  bossDone: 'Sealed for the week.',
  staleToast: 'Not sealed yet. This page changed elsewhere; your text is still here.',
  noQuestsTitle: "The herbs didn't grind this time.",
  noQuestsDetail: 'The apothecary can try again from its own shelf.',
  tryAgain: 'Try again',
  allSettled: "Today's prescriptions are filled.",
  toEvening: 'Write the evening ledger',
  eveningLink: 'Evening ledger →',
  letGoAfter: 'Set aside. Herbs keep.',
  letGoWhy: 'What got in the way? (optional)',
  smallerStamped: 'A smaller dose still counts.',
  bossPaused: 'Paused today. It keeps.',
  stampedToday: (n: number) => (n === 1 ? '1 stamped today' : `${n} stamped today`),
  energyShown: (label: string) => `Energy: ${label}`,

  eveningTitle: 'Evening ledger',
  eveningEmpty: 'Even one leaf is enough tonight.',
  eveningLegend: 'How was today, overall?',
  clearRating: 'Clear rating',
  moodLegend: 'Mood (optional)',
  moodCustomLabel: 'Add your own',
  moodCustomButton: 'Add',
  highlightLabel: 'Highlight',
  highlightHint: 'One moment worth keeping.',
  notesLabel: 'Notes',
  gratitudeLabel: 'Gratitude',
  gratitudeAdd: '+ Add gratitude',
  // ---- money noted on the page (`spent:`). Plain sums, never a verdict.
  spentLegend: 'Spent today',
  spentLegendPast: 'Spent that day',
  spentHint: 'Note what went out, even small things.',
  spentAmountLabel: 'Amount',
  spentNoteLabel: 'What for',
  spentNotePlaceholder: 'lunch, bus, snacks…',
  spentSuggestLabel: 'Earlier notes',
  spentAdd: 'Add',
  spentRemove: (what: string) => `Remove ${what}`,
  spentNone: 'Nothing noted yet.',
  spentTotal: (amount: string) => `Total: ${amount}`,
  spentBadAmount: 'Type an amount, like 38 or 12.50.',
  spentNoNote: 'no note',
  spentCategoryLabel: 'Type of spending',
  spentCategoryOf: (what: string) => `Type of spending for ${what}`,
  spendCategory: {
    entertainment: 'Relax & Entertainment',
    grocery: 'Grocery',
    cafe: 'Café & restaurant',
    electronics: 'Electronics',
    shopping_need: 'Shopping (necessary)',
    shopping_want: 'Shopping (not needed)',
    subscription: 'Subscription',
    transportation: 'Transportation',
    other: 'Other'
  } as Record<string, string>,
  sealButton: "Seal today's ledger",
  sealPast: 'Seal this ledger page',
  sealing: 'Sealing…',
  editToday: "✓ Sealed · Edit today's ledger",
  editPast: '✓ Sealed · Edit this page',
  sealed: 'Sealed in the ledger.',
  /** H1 #227: one merged toast when the evening save itself lands the week's bonus. */
  sealedWithBonus: (b: number) => `Sealed in the ledger. Another week in the ledger. +${b} taels`,
  lowRating: 'Rest is also medicine.',
  writtenLater: 'Written later',
  yesterdayLink: "Yesterday's ledger",
  todayLink: "Today's ledger",
  pastQuests: 'This page is closed; its quests stay as they were.',
  ownSectionsKept: (names: string[]) => `Your own sections are kept: ${names.join(', ')}.`,

  stale: 'This page changed elsewhere. Your text is still here. Review and save again.',
  staleTheirs: 'The version now on disk',
  staleField: (name: string) => `${name} on disk:`,
  staleUpdated: (names: string[]) => `Updated from the page on disk: ${names.join(', ')}.`,

  quarantine: (line?: number) =>
    line !== undefined
      ? `Your words are safe. Line ${line} needs a small fix in your editor.`
      : 'Your words are safe. This page needs a small fix in your editor.',
  quarantineField: (field: string) => `Look at the “${field}” line.`,
  quarantineNewer: 'Your words are safe. This page was written by a newer version of the app, so it stays read-only here.',
  quarantineFile: (file: string) => `File: ${file}`,
  quarantineWeek: 'The weekly page needs a small fix in your editor. Your words are safe.',

  todayTitle: "Today's prescriptions",
  offline: "Couldn't reach the apothecary. Nothing was lost. Try again in a moment.",
  saveRetry: "Couldn't reach the apothecary. Nothing was lost. Try again in a moment.",
  // H1 #273: a save that timed out has an unknown outcome, so it never claims "nothing was lost".
  maybeSaved: "The laptop didn't answer in time. It may not have saved; try again.",
  // H1 #299: one neutral card per route. "Unreachable", not "offline": a phone on Wi-Fi with the PC asleep is online.
  offlineCard: "Can't reach your laptop right now. Your pages are safe there; they open again once it's reachable.",
  noDay: 'No ledger page for this date yet.',
  notFoundPage: 'This corner of the palace is empty.',
  backToday: 'Back to today',

  shopPlaceholder: 'The Palace Market opens soon.',
  archivePlaceholder: 'The garden is still growing.',
  profilePlaceholder: 'Your notes come later.',
  /** Today header: when the next page opens. Minute precision, muted, never a deadline (opt-out in Notes). */
  countdownLine: (hour: number, left: string) => `Fresh page at ${String(hour).padStart(2, '0')}:00 · in ${left}`,
  clockLine: (tz: string, hour: number, date: string) =>
    `Ledger date ${date} · day starts ${String(hour).padStart(2, '0')}:00 · ${tz}`,

  // ---- M4: honest fallback banner by cause (psychologist-AC18 / backlog #465 #477)
  fallbackUnreachable:
    "From the apothecary's own shelf today: Claude couldn't answer, so these come from your saved pool.",
  fallbackDidntFit:
    "From the apothecary's own shelf today: Claude's draft didn't fit your rules, so these come from your saved pool.",
  fallbackLogin: "From the apothecary's own shelf today: the model needs a fresh login (or a working API key) on the computer.",

  // ---- M4: onboarding (designer-AC1–8, psychologist-AC1–4)
  onboardingTitle: 'Welcome to the apothecary',
  onboardingIntro: 'Answer a few questions so the prescriptions fit you. Skip anything you like.',
  onboardingProgress: (n: number, m: number) => `Question ${n} of ${m}`,
  onboardingBack: 'Back',
  onboardingSkip: 'Skip',
  onboardingNext: 'Next',
  onboardingAsk: 'Ask Maomao to write my notes',
  onboardingStartOver: 'Start over',
  onboardingKeep: 'Keep this tab open, or come back later. Your answers are kept.',
  onboardingFailed: "Couldn't reach Claude. Your answers are safe.",
  onboardingTryAgain: 'Try again',
  onboardingSelf: 'Write my notes myself',
  draftHint: 'Edit freely. This file is yours.',
  draftLabel: 'Your notes',
  draftReplaces: 'This replaces your current notes.',
  draftSave: 'Save my notes',
  draftSaving: 'Saving…',
  draftSaved: 'Notes saved.',
  draftStale: 'Your notes page changed elsewhere since you started. Your text is still here; save again to replace it.',
  draftBackToQuiz: 'Back to the questions',
  inviteLine: 'Maomao knows nothing about you yet.',
  inviteLink: 'Answer a few questions',
  inviteDismiss: 'Not now',
  quizStart: 'Start the onboarding quiz',
  quizRetake: 'Retake the quiz',
  likert: ['Not me', 'A little', 'Somewhat', 'Mostly', 'Very me'] as readonly string[],

  // ---- M4: reflection + approval (designer-AC9–14, psychologist §F)
  reflectHeading: "Maomao's notes",
  reflectLeave: 'You can leave; her notes will wait in Notes.',
  reflectNone: 'Nothing new to note today.',
  reflectFailed: "Couldn't reach Claude for reflections. Your ledger is saved.",
  reflectTryAgain: 'Try again',
  careNote:
    "That sounded heavy. If it's more than a hard day, please talk to someone you trust or a local crisis line. The ledger will wait.",
  proposalAdd: 'New note',
  proposalEdit: 'Changed note',
  proposalRemove: 'Remove note',
  proposalWhy: (reason: string) => `Why: ${reason}`,
  proposalKeep: 'Keep',
  proposalSkip: 'Skip',
  proposalSkipAll: 'Skip all',
  proposalApply: 'Apply my choices',
  proposalApplying: 'Applying…',
  proposalApplied: 'Added to your notes.',
  proposalAppliedNone: 'Your choices are saved.',
  proposalStale: 'This note changed in your notebook, so it was left alone.',
  proposalFlag: 'This one reads like an instruction. Keep it only if you wrote it that way.',
  proposalChanged: 'These suggestions changed elsewhere. Showing the latest.',
  proposalEvidence: 'Seen on',
  proposalTextLabel: 'Note text',
  proposalCounter: (n: number) => `${n} / 200`,
  proposalFrom: (date: string) => `From the ledger of ${date}`,
  notesPending: 'New suggestions',
  notesTabLabel: 'Notes, new suggestions',

  // ---- M5: coins + streaks (psychologist §F copy truth table, verbatim where given; designer-AC7–9)
  balanceLabel: 'silver taels',
  earnedToday: (n: number) => `+${n} today`,
  questDone: (n: number) => `Done. Earned ${n} silver taels.`,
  questPartial: (n: number) => `+${n} taels. A smaller dose still counts.`,
  bossSealed: (n: number) => `Sealed for the week. +${n} taels.`,
  checkpointEarned: (n: number) => `Ticked. Earned ${n} silver taels.`,
  streakBonus: (b: number) => `Another week in the ledger. +${b} taels`,
  tokenUsed: (weekday: string) => `A preserved herb kept your streak on ${weekday}.`,
  streakRests: (n: number) => `The streak rests. ${n} ${n === 1 ? 'day' : 'days'} logged this month.`,
  welcomeBack: 'Welcome back. Your page is here.',
  countUp: (quests: number, days: number) =>
    `${quests} ${quests === 1 ? 'quest' : 'quests'} done · ${days} ${days === 1 ? 'day' : 'days'} logged`,
  streakLine: (n: number) => `${n} days in a row in the ledger`,
  herbs: (n: number) => (n === 1 ? '1 preserved herb' : `${n} preserved herbs`),
  herbsHint: 'A preserved herb keeps a streak through one quiet day, all by itself.',
  dismiss: 'Dismiss',

  // ---- M5: Palace Market (designer-AC10–16, psychologist-AC13–19)
  marketTitle: 'Palace market',
  marketEmpty: 'The market stalls are empty. Add rewards to',
  marketEmptyFile: 'rewards.yaml',
  marketBalanceUnknown: 'The purchase book needs a small fix in your editor, so the balance is resting for now.',
  tierHeading: { free: 'Free permissions', small: 'Small', medium: 'Medium', large: 'Large', grand: 'Grand' } as Record<string, string>,
  tierFreeNote: 'no money needed',
  needsMore: (n: number | string) => `needs ${n} more taels`,
  availableAgain: (when: string) => `available again ${when}`,
  sheetHave: (b: number | string, p: number | string) => `You have ${b} of ${p} taels.`,
  sheetCooldown: (when: string) => `Available again on ${when}.`,
  balanceAfter: (n: string) => `Balance after: ${n}`,
  buyFor: (p: number) => `Buy for ${p} taels`,
  buying: 'Wrapping it up…',
  bought: 'Prescribed. Take as directed.',
  boughtToast: (title: string) => `Bought: ${title}.`,
  undo: 'Undo',
  voided: (p: number) => `Put back on the shelf. ${p} taels returned.`,
  returned: 'Returned',
  unknownResult: "Couldn't reach the market. Tap again; you won't be charged twice.",
  recentPurchases: 'Recent purchases',
  noPurchases: 'Nothing bought yet.',
  saveToward: 'Save toward this',
  savingToward: 'Saving toward this ✓',
  wishlistHeading: 'Saving toward',
  wishProgress: (have: string, price: number) => `${have} / ${price} taels`,
  wishPace: (n: number) => `About ${n} ${n === 1 ? 'day' : 'days'} at your recent pace.`,
  wishReady: 'Ready when you are.',
  close: 'Close',
  spentAnnounce: (p: number, bal: string) => `Spent ${p} silver taels. Balance ${bal}.`,
  returnedAnnounce: (p: number, bal: string) => `Returned ${p} silver taels. Balance ${bal}.`,

  // ---- M6: the garden (designer-AC1–11, psychologist-AC1–10). Counts up; missing ≠ bad; correlation, never verdict.
  gardenTitle: 'The garden',
  gardenDaysLogged: 'Days logged',
  gardenQuestsDone: 'Quests done',
  gardenLongest: 'Longest streak',
  gardenCurrent: (n: number) => `Current: ${n}`,
  gardenRange: 'Show',
  gardenRange4w: '4 weeks',
  gardenRange3m: '3 months',
  gardenGridLabel: 'Days in the garden',
  gardenLegend: 'Legend',
  gardenNoEntry: 'not written',
  gardenNoRating: 'no rating',
  gardenNotYet: 'not rated yet',
  gardenBroken: "can't be read",
  gardenAnchors: ['Worst', 'Bad', 'Ordinary', 'Good', 'Best'] as readonly string[],
  gardenEmpty: 'Your garden is still seeds. Each sealed day plants something here.',
  gardenError: "Couldn't read the garden.",
  gardenPartial: (n: number) => (n === 1 ? "1 page couldn't be read." : `${n} pages couldn't be read.`),
  gardenByCategory: 'By kind of quest',
  gardenDone: (n: number) => `done ${n}`,
  gardenAvg: (avg: string, n: number) => `avg ${avg} · ${n} ${n === 1 ? 'day' : 'days'}`,
  gardenTooFew: (n: number, min: number) => `Too few days to say yet (${n} of ${min})`,
  /** psychologist-AC6, verbatim. */
  gardenCaption: "Days, not causes. Higher-rated days and these quests tend to show up together; that doesn't mean one made the other.",
  gardenMonthAgo: 'A month ago today',
  gardenReadPage: 'Open that page',
  gardenWriteLedger: 'Write in the ledger',
  gardenQuests: 'Quests',
  gardenPrivate: 'Private page',
  gardenMoney: 'Money spent',
  gardenMoneyToday: 'Today',
  gardenMoney7: 'Last 7 days',
  gardenMoneyMonth: 'This month',
  gardenMoneyRange: (range: string) => `Over ${range}`,
  gardenMoneyAvg: (amount: string) => `about ${amount} a day`,
  gardenMoneyBiggest: (amount: string, when: string) => `Biggest day: ${amount} on ${when}`,
  gardenMoneyWhere: 'Where it went',
  gardenMoneyKinds: 'By type',
  gardenMoneyChart: 'Money spent per day',
  gardenMoneyEmpty: 'No money noted yet. Add what you spend in the evening ledger and it shows up here.',
  gardenMoneyNoneInRange: 'Nothing noted in this stretch.',
  gardenMoneyTimes: (n: number) => (n === 1 ? 'once' : `${n}×`),
  gardenMoneyLog: 'Note today\'s spending',
  gardenSpentDay: 'Spent',
  plotLabel: (when: string, what: string) => `${when}: ${what}`,
  plotRated: (s: number, done: number, total: number) =>
    total > 0 ? `satisfaction ${s}, ${done} of ${total} quests` : `satisfaction ${s}`,

  // ---- M6: Notes on you (designer-AC12–16, psychologist-AC11–13)
  notesTitle: 'Notes on you',
  notesTabInsights: 'Insights',
  notesTabProfile: 'Profile',
  notesEdit: 'Edit',
  notesEditRaw: 'Edit raw',
  notesSave: 'Save',
  notesCancel: 'Cancel',
  notesSaving: 'Saving…',
  notesSaved: 'Notes saved.',
  notesDiscardAsk: 'Discard your changes?',
  notesDiscardYes: 'Discard',
  notesDiscardNo: 'Keep editing',
  notesStale: 'This page changed on disk since you opened it. Your text is still here.',
  notesCopy: 'Copy my text',
  notesCopied: 'Copied.',
  notesReload: 'Load the newer page',
  notesOverwrite: 'Save mine anyway',
  notesTooLarge: (max: number) => `Notes pages hold at most ${max.toLocaleString('en-US')} characters. Your text is still here.`,
  notesEmptyInsights: 'No notes yet. Kept suggestions from the evening ledger appear here.',
  notesEmptyProfile: 'Nothing written yet.',
  notesUnparsed: (n: number) =>
    n === 1 ? "1 line isn't in the usual format; it's kept as-is." : `${n} lines aren't in the usual format; they're kept as-is.`,
  notesCap: 'Your notes are at the 60-note limit. Remove one to make room for new suggestions.',
  notesEvidence: 'Seen on',
  settingsTitle: 'Settings',
  settingsTheme: 'Theme',
  settingsMotion: 'Motion',
  settingsStickers: 'Stickers',
  settingsCountdown: 'Next-page timer',
  themeSystem: 'System',
  themePaper: 'Paper',
  themeNight: 'Night',
  motionSystem: 'System',
  motionReduce: 'Reduce',
  stickersOn: 'On',
  stickersOff: 'Off',
  aboutTitle: 'About',
  aboutVersion: (v: string) => `Quest Journal ${v}`,
  aboutImages: 'Image sources',

  // ---- M6: PWA (designer-AC19)
  freshPage: 'A fresh page is ready',
  reload: 'Reload'
} as const;

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Thursday" within 6 days, otherwise "4 Nov" (psychologist §F cooldown row). Pure calendar math. */
export function whenLabel(date: string, today: string): string {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!d || !t) return date;
  const a = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]));
  const b = Date.UTC(Number(t[1]), Number(t[2]) - 1, Number(t[3]));
  const days = Math.round((a - b) / 86_400_000);
  if (days >= 0 && days <= 6) return WEEKDAYS[new Date(a).getUTCDay()] ?? date;
  return `${Number(d[3])} ${MONTHS_SHORT[Number(d[2]) - 1] ?? ''}`;
}

/** Fallback banner copy by `generation.fallback_reason` code class (psychologist-AC18). */
export function fallbackNote(reason: string): string {
  if (reason === 'claude_not_logged_in') return COPY.fallbackLogin;
  if (reason === 'invalid_output' || reason === 'ai_error') return COPY.fallbackDidntFit;
  return COPY.fallbackUnreachable;
}

/**
 * The onboarding quiz (psychologist-AC1, PROVISIONAL). Every question is skippable. Preferences for quest
 * design only. Deliberately no questions about health, weight, diet, mood history, religion, politics,
 * relationships or family (motivation §6.2; a test greps for those words).
 */
export type OnboardingKind = 'short' | 'long' | 'likert' | 'multi' | 'choice';
export interface OnboardingQuestion {
  id: string;
  text: string;
  kind: OnboardingKind;
  options?: readonly string[];
}
export const ONBOARDING_QUESTIONS: readonly OnboardingQuestion[] = [
  { id: 'name', text: 'What do people call you, and what are you studying?', kind: 'short' },
  { id: 'weekday', text: 'What does a normal weekday look like: classes, work, commute?', kind: 'long' },
  { id: 'free', text: 'Which days or times are usually free?', kind: 'short' },
  {
    id: 'enjoy',
    text: 'Things you enjoy',
    kind: 'multi',
    options: ['manga', 'cafés', 'ML / coding', 'drawing', 'walking', 'games', 'music', 'cooking', 'sport', 'reading', 'other']
  },
  { id: 'current', text: "A manga, series or project you're into right now", kind: 'short' },
  { id: 'places', text: 'Places you can easily reach: cafés, library, park, gym, kitchen?', kind: 'long' },
  { id: 'grow', text: "Up to 3 things you'd like to grow in this term", kind: 'long' },
  { id: 'avoid', text: 'Anything you want quests to stay away from?', kind: 'long' },
  { id: 'recharge', text: 'Solo or with people: which recharges you?', kind: 'likert', options: ['Mostly solo', 'More solo', 'Either', 'More people', 'Mostly people'] },
  { id: 'structure', text: 'Structured tasks or open-ended ones?', kind: 'likert', options: ['Very structured', 'Mostly structured', 'Either', 'Mostly open', 'Very open-ended'] },
  { id: 'energy', text: 'When is your energy usually best?', kind: 'choice', options: ['morning', 'afternoon', 'evening', 'varies'] },
  { id: 'budget', text: 'Roughly how much can you spend on treats per month, and on one quest at most?', kind: 'short' },
  { id: 'deadlines', text: 'Exam or deadline periods coming up?', kind: 'short' },
  { id: 'voice', text: 'How would you like Maomao to talk to you: gentle, dry, or blunt?', kind: 'choice', options: ['gentle', 'dry', 'blunt'] },
  { id: 'else', text: "Anything else you'd like the apothecary to know?", kind: 'long' }
];

/** "Write my notes myself" template (designer-AC6; headings match the server's profile template). */
export const PROFILE_TEMPLATE = `# Profile

## About me

## Goals

## What I enjoy

## Limits and budget
`;

/** "Let go" reason chips (domain REASON_CHIPS, psychologist-AC7). */
export const LET_GO_REASONS = [
  { id: 'no_time', label: 'No time' },
  { id: 'not_feeling_it', label: 'Not feeling it' },
  { id: 'not_possible', label: 'Not possible today' },
  { id: 'didnt_fit', label: "Didn't fit" }
] as const;
export type LetGoReason = (typeof LET_GO_REASONS)[number]['id'];

/** Human names for evening fields (stale-diff labels). */
export const FIELD_NAMES = {
  satisfaction: 'Rating',
  mood: 'Mood',
  highlight: 'Highlight',
  notes: 'Notes',
  gratitude: 'Gratitude',
  spent: 'Spent'
} as const;

/** The user's currency (his profile: Hong Kong). Display only; amounts are stored as plain numbers. */
export const CURRENCY = 'HK$';

/** "HK$38", "HK$12.50", "HK$1,200". */
export function money(n: number): string {
  return `${CURRENCY}${moneyNumber(n)}`;
}

/** The number alone ("38", "12.50", "1,200"), for layouts that set the currency apart. */
export function moneyNumber(n: number): string {
  const cents = Math.round(n * 100) % 100 !== 0;
  return n.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
}
