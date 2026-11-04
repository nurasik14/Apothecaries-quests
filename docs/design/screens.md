# Screens: layout specs (mobile-first)

> Owner: `quest-designer` · Phase 2 · 2026-10-26 (§1/§2 + Implementation notes updated to match M2–M3 as shipped, at the M3 review). Read with `design-system.md`. API shapes come from `docs/brainstorm/architecture.md` §2.3. Copy and behaviour come from `docs/brainstorm/motivation.md`.
> Base viewport: **360×740** (works from 320px). One column, `max-width: 36rem`, centred on tablet/desktop.
> Every AI or user string is rendered as **plain text** (`{text}`, never `{@html}`).

---

## 0. App shell (every screen)

```
┌──────────────────────────────┐
│ (screen content in .qj-page) │  ← paper texture background, 16px gutters
│                              │
│                              │
├──────────────────────────────┤
│ 📜Today 🖌Ledger 🪙Market 🌸Garden 🌕Notes │  ← bottom tab bar, 64px + safe area
└──────────────────────────────┘
```

- **Bottom tab bar** (`<nav aria-label="Main">`): 5 tabs, from `vocab.NAV`. Each is an `Icon` (24px) plus a 13px label, with a minimum 48px target and `aria-current="page"` on the active tab. Active tab: `--accent-ink` label + a 3px jade bar on top. Inactive: `--ink-muted`. Background `--surface` with `--shadow-3` upwards and a 1px `--line` top border. Fixed to the bottom, `z-index: var(--z-nav)`.
- **Badges:** a small jade dot on "Notes" when insight proposals are pending, and a dot on "Ledger" after 18:00 if today isn't sealed. **No counts and no red badges** (rejected dark pattern).
- **Theme:** default is system. The Profile screen has a 3-way control (System / Paper / Night) that calls `applyTheme()`.
- **Offline / server down** (`fetch` fails or `/api/health` is unreachable): a sticky top `.qj-banner--info` with the text "The apothecary is closed. Showing what was last on the shelf." Mutating buttons are disabled with an `aria-describedby` pointing to the banner (read-only offline, PROVISIONAL per architecture Open #9).
- **Broken-file warnings** (`warnings[]` in Economy, or a 422): `.qj-banner--error` with the text "`days/2026-10-25.md` can't be read (line 4). Fix it in your editor; the app will pick it up." The file path goes in `<code>`. Never auto-repair.
- **Toasts** (polite live region, **top of the viewport** under the safe area and any offline banner, 4s; changed from "bottom above the nav" in the M3 review because bottom toasts covered Done/Seal): used for undo-able actions only ("Bought: café meal. Undo"). Max one at a time.
- **Page transitions:** none beyond each screen's own unroll. Route changes move focus to the page `h1`.

---

## 1. Today: "Prescriptions"

**Purpose:** morning check-in → 3 quests + weekly boss → mark outcomes. API: `GET /api/today`, `POST /api/today/checkin`, `POST /api/today/generate`, `GET /api/jobs/:id` (poll 2s), `PATCH /api/quests/:id`, `POST /api/quests/:id/reroll`.

### Layout (top → bottom)
1. **`FolioHeader`** (was `MoonGate` before the 2026-10-27 redesign; also shows the herb of the day): `date` = `today.date` (server logical date), `week="Week 44"`. `trailing` = `CoinBadge amount={economy.balance}` from M5; **until M5 it shows `earned_today`** (label "silver taels earned today", as shipped in M2/M3). At night (after 19:00, in the dark theme) `photo="lanterns-night"` is optional.
2. **Fallback banner** (only when `day.generation.fallback_reason` is set): `.qj-banner--fallback` directly under the FolioHeader, **above** the boss card, so it's always in the first viewport (M3 review; shipped M3 places it after a boss-first card, which hides it below the fold).
3. **State block** (one of the states below).
4. **Boss card**: `QuestCard quest={week.boss}` (boss variant: Jinshi's violet double rule + silk cord + 勝 seal; the margin column reads 依頼). Boss micro-copy goes in its `note` snippet ("Paused today, no penalty." at energy 1 · "N of 4" · "All four ticked. Seal the week?" + button · "Sealed for the week."). Until M5 the boss card shows **no coin number** (a done boss adds nothing to `earned_today` yet). Order: **above** the dailies on **Monday only** (to introduce it), **below** them from Tuesday on, and always below the check-in card. PROVISIONAL (M3 review: the boss card is ~600 px tall at 390 px, so boss-first on two days hid every daily below the fold).
5. **Daily quests**: 3 × `QuestCard` in a `<ol>` (slot order). The `canReroll` prop = `rerolls_left > 0 && quest.status === 'open' && no reroll running`.
6. **Day footer**: a muted line, "Streak: 4 days · 37 quests done in total" (the numbers that never break are listed first, per motivation §3.5). Then a quiet link: "Evening ledger →".
7. **Sticker slot**: one `Sticker` (`size=96`), shown for 4 s after an event, then **nothing** (no idle sticker during Ready). Shipped M2/M3 uses `position: fixed` bottom-right above the nav, which covers card text and buttons (`M3-11`). Target: the sticker sits in the **gutter of the card that triggered it** (absolute, right edge, vertically aligned to that card's title row, `pointer-events:none`), the caption goes into the live region rather than a floating label, and at <400 px the sticker is 72 px and may overlap only the card's decorative band/rods, never text or buttons. The idle sticker appears only on the check-in and all-settled states.
8. **Toasts** never cover the primary action of the card they talk about: on Today/Evening they sit at the **top** of the viewport under the safe area (below the offline banner), not above the nav (M3: `M3-10` covers Done, `M3-04` covers the Seal bar).

### States

| State | Trigger | What's shown |
|---|---|---|
| **Empty: check-in** | `needs_checkin` | `ScrollCard unroll` with the heading "Morning check-in" → `LanternScale bind:value` (the 一–五 pulse reading) → primary block button **"Write today's prescriptions"** (disabled until a value is chosen). If a gap of ≥1 day was detected: an info banner above it, "Welcome back. The herbs kept." with `Sticker event="welcome_back"`, and the lantern defaults to 2 (gentle restart, motivation §4.1; not shipped through M3: no gap detection yet, so the lantern starts unselected). Optional link: "Declare a rest day" (later) |
| **Loading: generating** | A job is `queued`/`running` (`POST /api/today/checkin` → 202) | `ScrollCard` with `HerbLoader message="Maomao is grinding herbs…" startedAt={job.started_at}` keyed on the job id (escalating messages at 15s and 45s, measured from the server's start time so remounts don't restart them; the server's worst case is ~130 s: 2 × 60 s + kill grace) + `Sticker event="loading"` (small). The animated dots replace the copy's `…` (render the message without its trailing ellipsis, so it never reads "herbs……"). Three **ghost cards** below: `ScrollCard variant="quiet"` with 2 shimmer-free grey bars each (no shimmer animation; static `--surface-sunk` bars). The boss card shows if it already exists. The check-in lantern value is shown read-only ("Energy: Steady"). Polling continues if the user navigates away and back (the job id is kept in a store) |
| **Error / fallback** | Job `succeeded` and `generation.fallback_reason` is set (AI was tried). Pool-by-design days (`AI_ENABLED=false`) show **no** banner | Quests render normally, each with the muted "from the shelf" tag, plus **one** `.qj-banner--fallback` under the FolioHeader (layout item 2). From M4 the text depends on `fallback_reason` (psychologist M3 review): unreachable codes → "From the apothecary's own shelf today: Claude couldn't answer, so these come from your saved pool."; `invalid_output|ai_error` → "…Claude's draft didn't fit your rules, so these come from your saved pool." M3 text: "From the apothecary's own shelf: Claude couldn't be reached, so these come from your saved pool." No retry button (the pool result is final for today) |
| **Error: no quests** | Job `failed`, or `needs_generation` after a restart | `ScrollCard variant="alert"`: "The herbs didn't grind this time." + primary **"Try again"** (`POST /api/today/generate`) + muted detail "Try again asks Claude first, then the apothecary's own shelf." (psychologist M3 wording; the shipped "can try again from its own shelf" misdescribes the order). Never shows a raw error code. A 409 `already_generated` → refetch silently |
| **Ready** | 3 quests | Cards with `editable`. AI quests carry **no** source tag; pool quests show "from the shelf". From M4, AI quests with `minutes` show a muted "~15 min" chip on the tag row (after the coin chip, wraps before the seal space), and `done_when` shows as one muted line "Done when: …" under `why` (2-line clamp, tap to expand, `overflow-wrap:anywhere`); pool quests without the fields show neither. The first render after generation uses `unroll` on each card, staggered by 80ms (not shipped yet, COULD). Live region: "Today's prescriptions are ready." |
| **Rerolling one card** | Reroll job running | That card shows `HerbLoader size="sm" message="Fetching another prescription…"`, `aria-busy`. Other cards stay interactive. On success the new quest fades in (not shipped yet) and `Sticker event="reroll"` (the cat) pops; live text "New prescription: <title>"; every card loses Swap. On failure: the card is restored, Swap stays, toast "The cat couldn't find another one. This one stays." |
| **Quest done** | `PATCH status=done` | **Optimistic:** the seal stamps immediately and `CoinBadge` floats "+20". On server error: revert, and show a toast "Couldn't save. Tap Done again." `Sticker event="quest_done"` with `seed=quest.id` |
| **Smaller version** | `PATCH status=partial` (when supported) | 半 round seal; status line "Smaller version. An honest dose still counts." |
| **Let go** | `PATCH status=let_go` | Title in `--ink-muted` (no strike-through, per psychologist M2 review), **no coin badge**; status line "Let go. No penalty, and that tells the apothecary something." **No seal, no red, no sticker.** Undo is available |
| **All three settled** | All quests ≠ open | A gentle card: "Today's prescriptions are filled." + the button **"Write the evening ledger"** (primary). Not a celebration screen; the seals already celebrated |
| **Boss done** | Boss `done` | 勝 seal (68px, gold ring) in the card's top-right; the tag row reserves its width so the seal never covers the coin chip or category tag. One status line only: "Sealed for the week." (don't also print "Done. Sealed in the ledger."). `Sticker event="boss_done"` (Jinshi/Gaoshun), caption "The whole week's prescription, filled." (caption announced, see layout item 7) |
| **Boss pending / none** | `boss_pending` is true (the AI may still replace the untouched pool placeholder, or there's no boss yet) | The boss slot shows `HerbLoader size="sm" message="Consulting the Jade Pavilion…"`. If the pool is empty and the job failed: the slot is hidden (no error; the boss is optional) |
| **Energy 1** | — | The boss card shows a muted note: "Paused today, no penalty." (motivation §1.4) |
| **Read-only file** | 422 on the day file | The error banner (shell §0), cards render with `editable={false}` |

### Interaction details
- **Reroll:** tap "Swap" (cat icon) → an inline reason chip row expands inside the card ("Why swap? (optional)": Too long · Costs money · Not today · Boring · Not me · Just swap). Choosing one sends `POST /api/quests/:id/reroll {reason?}` (shipped M3; ids from `domain.REROLL_REASONS`).
- **Undo:** a quiet "Undo" on settled cards sets the status back to `open` (allowed while the quest is editable).
- **Feedback** chips ("Suits me" / "Not for me") toggle with `aria-pressed`, and `PATCH feedback`.
- The source tag "from the shelf" (muted, 13px) appears on pool quests.

---

## 2. Evening ledger: "Seal the day"

**Purpose:** rate the day in 10 seconds; optionally write more; then review insight proposals. API: `GET/PUT /api/days/:date/evening` (ETag / If-Match), `GET /api/insights/proposals?status=pending`, `POST …/decide`.

### Layout
1. **Header**: `ScrollCard band="var(--qj-img-band-evening)" unroll` (宮樂圖) with a `PageTitle` slip 日録 and the `h1` "Evening ledger" and the subtitle "Sunday, 26 October".
2. **Rating**: `LatticeFrame pattern="ice"` → `HerbRating bind:value legend="How was today, overall?"`. The anchor sentence shows below. **The only required field.** Yesterday's rating is *not* shown until today's is saved (motivation §6.1/⚙11).
3. **Mood** (optional): a `.qj-chip` toggle group (`role=group`, legend "Mood (optional)") with the 12 tags from `vocab.MOOD_TAGS`, wrapping.
4. **Highlight**: `.qj-input`, label "Highlight", hint "One moment worth keeping.", max 300.
5. **Notes**: `.qj-textarea` (ruled), label "Notes".
6. **Gratitude**: `.qj-textarea` with 3 rows, label "Gratitude". Shown on Wed/Sun by default (motivation §5.1). On other days it's collapsed behind a quiet "+ Add gratitude".
6b. **Spent today** (past page: "Spent that day"): money noted for the day, stored as `spent: [{amount, note, category}]` in the page's front matter (amounts in HK$, rounded to cents; a hand-written bare number `- 38` also reads). `category` is one of `entertainment` (Relax & Entertainment), `grocery`, `cafe` (Café & restaurant), `electronics`, `shopping_need` (Shopping (necessary)), `shopping_want` (Shopping (not needed)), `subscription`, `transportation`, `other`; an entry without one, or with an unknown value, counts as Other. A list of rows (note with a small type picker under it · amount · × remove; changing a row's type is an edit like any other) with a bold "Total: HK$…" line, then an add block: Amount (`inputmode=decimal`, accepts `38`, `12.50`, `38,50`, `1,200`) · What for on the first line, Type of spending (select, defaults to Other and resets after each Add) · **Add** on the second. Typing in What for opens a list of earlier notes that match the keyword (from GET /api/spent/suggestions; notes starting with it first, then a word starting with it, then any substring, newest first within each, at most 6), each showing its last type and amount, like a calendar suggesting earlier events. Tapping one, or arrow keys + Enter, fills the note and its type, and the amount too when none is typed yet (then the amount box is focused and selected so it can be changed); Escape closes the list. Enter adds. This block sits **outside** the sealed fieldset, so a new amount can be noted on a sealed page straight away: typing one unlocks the page and brings back the red Seal button. Sealing with a typed-but-not-added amount adds it first; an unreadable amount shows "Type an amount, like 38 or 12.50." and blocks the seal. Spending never counts toward the streak and is never sent to the AI.
7. **Save**: a sticky bottom bar above the tab bar, with the `.qj-btn--seal` block button **"Seal today's ledger"**. Enabled when something differs from the saved page (a new rating, or any edit). Once sealed it becomes the grey "Edit" button (see Sealed state). The bar has a paper backing (`var(--bg)` gradient + upward `--shadow-3`, full-bleed) and the form ends with a spacer of the bar's height, so nothing shows through or hides under it (still open after M3).

### States

| State | What's shown |
|---|---|
| **Empty (new day)** | The rating hint "Tap a leaf. Only this is required." Fields are empty. The save button is disabled with `aria-describedby` → the hint |
| **Loading** | Static skeleton: the lattice frame with 10 outlined leaves (readonly), grey field bars. No spinner (the GET is fast) |
| **Saving** | The button label becomes "Sealing…" (disabled). Fields stay editable |
| **Saved (done)** | Big 済-style seal animation on the header (`SealStamp kind="done" size={72}`), a toast "Sealed in the ledger." Rating ≤ 4 → `Sticker event="low_rating"` (Luomen / tired Maomao) with "Rest is also medicine." Otherwise no sticker (keeps it calm). Then the **Reflection** block appears below |
| **Sealed (unchanged)** | Shown right after a seal and on any later visit to a page that already holds an evening entry. Fields are read-only (`fieldset disabled`). The save button turns into a grey, pressed-in `.sealed-btn` **"✓ Sealed · Edit today's ledger"** (past page: "✓ Sealed · Edit this page"). Tapping it reopens the fields and focuses Highlight. The red Seal button comes back, enabled once something changes. The next seal locks the page again |
| **Reflection loading** | `HerbLoader message="Maomao is reading your ledger…" size="sm"` inside a quiet ScrollCard. The user can leave; the proposals wait in Notes |
| **Reflection ready** | ScrollCard "Maomao's notes on today", with one row per op: **add** = jade left stripe + "+ New note" + an editable `.qj-input` prefilled with the text; **edit** = old text struck through in `--ink-muted` above the new editable text; **remove** = struck-through text + the reason. Evidence dates show as small chips linking to Archive days. Each row has **Accept** (primary sm) / **Skip** (quiet sm). Bottom: "Apply decisions". Accepted rows get a small 済 seal |
| **Reflection: no ops** | One muted line: "Nothing new to note today." |
| **Reflection failed** | Muted line: "Couldn't reach Claude for reflections. Your ledger is saved." + quiet "Try again" |
| **Stale (412)** | As shipped (M2 fix 2 + M3): an **info-style** panel (not red) at the top of the form, scrolled into view and focused (`tabindex=-1`): "This page changed elsewhere. Your text is still here. Review and save again." It lists real conflicts ("The version now on disk", per field) and names untouched fields adopted from disk. The header 済 seal un-stamps. Toast: "Not sealed yet. This page changed elsewhere; your text is still here." The user's text stays in the fields; the next Seal saves against the new ETag |
| **Draft** | Unsaved Evening text lives in a memory-only store (no `localStorage`) and survives in-app navigation; `beforeunload` warns while dirty |
| **Backfill (past date ≤ 2 days)** | Header subtitle "Written later", and a muted chip "written later" |

---

## 3. Palace market (shop)

**Purpose:** spend taels on rewards, guilt-free. API: `GET /api/shop`, `POST /api/purchases` (`request_id` UUID per tap), `POST /api/purchases/:id/void`, `GET /api/purchases`.

### Layout
1. **Hero**: a 132px banner with the `apothecary-drawers` photo + scrim inside a vermilion double rule (each reward row below is a cabinet drawer with a paper label), `h1` "Palace market" on a text-shadowed plate (light text on the photo always has a dark scrim behind it; contrast is checked against the scrim colour, not the photo). Top-right: `CoinBadge size="lg" amount={balance}`.
2. **Wishlist** (if any): a ScrollCard with the target item and a progress bar (`jade → gold` gradient, `role="progressbar"` with `aria-valuenow/max`), "245 / 350, about 2 more good days".
3. **Items**: a list grouped by tier (Free permissions · Small · Medium · Large · Grand) with `h2` tier headings. Each row:
   `[title + sub-line]  [CoinBadge kind=price]` → tap the row to open the **buy sheet**.
   - Sub-line states: "available now" · "available again in 3 days" (neutral, `--ink-muted`) · "needs 40 more taels".
   - Unaffordable or cooldown: the `CoinBadge muted`, the row stays tappable (opens the sheet with an explanation), **never hidden**.
4. **Recent purchases**: a collapsible list with "Void" (quiet) for purchases within 24h.

### Buy sheet (bottom sheet, `role="dialog"`, focus-trapped, Esc/close)
- The item title, the price, and the balance after purchase.
- **Seal button** "Buy for 150 taels". No "are you sure?" copy (motivation §3.7).
- The optional real-money hint (later: "This would exceed this month's purse", shown once, neutral).

### States

| State | What's shown |
|---|---|
| **Loading** | The hero (photo) + 4 static row skeletons |
| **Empty shop** | "The market stalls are empty. Add rewards to `rewards.yaml`." + the drawers photo |
| **Buying** | The sheet button reads "Wrapping it up…", disabled. The same `request_id` is reused on retry |
| **Bought (done)** | The sheet closes → a 買 `SealStamp kind="bought"` stamps on the row, `CoinBadge` floats "−150", `Sticker event="shop_buy"` (Gyokuyou / Lihaku) with "Prescribed. Take as directed." A toast offers "Undo" (voids within 24h) |
| **409 insufficient_funds / cooldown** | Inline in the sheet: "You have 120 of 150 taels." / "Available again on Thursday." No red; `--ink` text on `--surface-sunk` |
| **Error** | Toast "Couldn't reach the market. Nothing was spent." |
| **Negative balance** (after an undo) | The balance shows "−20" neutrally, and the items show "needs N more taels" |

---

## 4. Archive: "The garden"

**Purpose:** see how days felt over time. API: `GET /api/days?from&to`, `GET /api/stats`, `GET /api/days/:date`.

### Layout
1. **Header** ScrollCard with the `band-garden` painting (簪花仕女圖) and a 花苑 `PageTitle` slip: `h1` "The garden". Under it, three **counting-up stats** in a row: Days logged · Quests done · Longest streak (display numerals). The current streak appears smaller beside them ("Current: 4").
2. **Garden grid** (heatmap): weeks as rows (newest at the top), Mon→Sun columns, plus a week label column. Each plot is a `button` (min 40px, square, `--r-sm`). The fill is `--garden-N` by satisfaction (1–2→1 … 9–10→5), and the **number is printed in the cell** (`--garden-ink-N`), so colour is never the only cue. A day with no entry is a dashed outline. Today has a focus-ring outline. `aria-label="Sat 25 Oct: satisfaction 9, 3 of 3 quests"`. Range selector chips: 4 weeks · 3 months · Year (the year view switches to 16px plots without numbers, and then the accessible label is the only value source; a "Show numbers" toggle is available).
3. **Legend** below: the 6 swatches with labels.
4. **Day detail** (tap a plot): a bottom sheet with the date, `HerbRating readonly size="sm"`, mood chips, the quests with their seals (read-only `QuestCard editable={false}`), and the highlight and notes as plain text.
5. **By category**: a horizontal bar list per category (category icon + label, done count bar in the `--cat-*` colour, avg satisfaction on done days as a number). Bars always have numeric labels.
5b. **Money spent** (below By category): three numbers that ignore the range chips (Today · Last 7 days · This month, with a small "HK$" mark; the columns wrap at 320 px rather than breaking a number), then for the selected range: "Over 4 weeks: HK$… · about HK$… a day" (the average spreads the total over the calendar days from the first noted spend in the range up to today), a bar chart with one bar per day (today's bar full-strength, first/last date under it), "Biggest day", **By type**: every kind of spending in the range with its total, count and a bar, largest first, and **Where it went**: the top 5 notes by amount (grouped case-insensitively) with count and a bar. Nothing ever noted: one line pointing to the evening ledger plus a "Note today's spending" link. Nothing in the range: "Nothing noted in this stretch." The day sheet lists the day's entries under "Spent · HK$total", each with its type. Data: `/api/stats` → `spending` (`by_category` for By type) and `heatmap[].spent`.
6. **This day last month**: a small ScrollCard "A month ago today" with the rating, the highlight and the quests. Hidden if empty.

### States

| State | What's shown |
|---|---|
| **Empty (no logged days yet)** | `Sticker event="idle"` + "Your garden is still seeds. Each sealed day plants something here." |
| **Loading** | The grid with all plots dashed (static), stats as "—" |
| **Error** | `.qj-banner--error` "Couldn't read the garden." + "Try again". Days with `broken` show a plot with a diagonal hatch pattern and the label "can't be read" |
| **Done (normal)** | As in the layout |

---

## 5. Profile: "The apothecary's notes on you"

**Purpose:** view and edit `profile.md` and `insights.md`, review pending proposals, and change settings. API: `GET/PUT /api/kb/profile`, `GET/PUT /api/kb/insights`, proposals endpoints.

### Layout
1. **Header**: `LatticeFrame pattern="floral"` containing a round `Sticker event="idle" frame="round" size={88}`, `h1` "Notes on you", and the muted line "Written by you, refined with Maomao."
2. **Pending proposals** (if any): the same review UI as Evening §2, at the top.
3. **Tabs** (`role=tablist`, 2 tabs, 48px): **Insights** · **Profile**.
   - *Insights*: a list of bullets. Each has its text and evidence chips. Overflow menu: Edit · Remove. "Edit raw" switches to a full `.qj-textarea` (monospace off, ruled). It shows `unparsed_lines` as an info banner ("2 lines aren't in the usual format; they're kept as-is.").
   - *Profile*: a rendered Markdown **preview as plain text blocks** (headings as `h3`, bullets as list items; no HTML injection), plus an "Edit" button → a full-height `.qj-textarea` with a sticky Save/Cancel bar.
4. **Settings** ScrollCard (quiet): Theme (System / Paper / Night segmented control), Reduced motion (System / Reduce), Gratitude prompt (2×/week / daily), Stickers (On / Off; Off hides all character art).
5. **About**: a link to the image credits (render `IMAGE_SOURCES.md` as plain text) and the app version.

### States

| State | What's shown |
|---|---|
| **Empty profile** | "No notes yet." + primary **"Start the onboarding quiz"** → §6 |
| **Loading** | Static text-line skeletons |
| **Saving** | "Saving…" on the button |
| **Saved** | Toast "Notes saved." (no seal; reserved for the quest/ledger/market moments) |
| **Stale (412)** | Same as Evening: keep the user's text, offer Copy + Reload |
| **Insights at cap** | Info banner: "The notebook is full (60 notes). Maomao will suggest merges instead of new notes." |

---

## 6. Onboarding: "Entering the Inner Court"

**Purpose:** about 15 questions → Claude drafts `profile.md` → the user edits and saves. API: `POST /api/onboarding/draft` (job), `PUT /api/kb/profile`. Shown full-screen **without** the tab bar.

### Layout
1. **Hero**: the `hero-consorts` painting (簪花仕女圖) full-bleed (220px) under a dark scrim, with `h1` "Welcome to the apothecary" on a paper plate below it, and `Sticker event="idle" seed="onboarding"`. Body copy: "Answer a few questions so the prescriptions fit you. Skip anything you like."
2. **Progress**: "Question 4 of 15" + a thin progress bar of 15 dots (filled jade). It's `role="progressbar"`.
3. **Question card**: one `ScrollCard unroll` per question with the `h2` question text. The input depends on the type:
   - Likert (Big-Five-ish): 5 `.qj-chip` radios in a row ("Not me" … "Very me").
   - Short text: `.qj-input`. Long text: `.qj-textarea`.
   - Multi-select (hobbies): wrapping chips.
4. **Footer** (sticky): **Back** (quiet) · **Skip** (quiet) · **Next** (primary). On the last question: **"Ask Maomao to write my notes"** (seal button).
5. **Draft review**: `HerbLoader message="Maomao is writing up her notes on you…"` → then a full `.qj-textarea` with the Markdown draft, a muted hint "Edit freely. This file is yours.", and the primary "Save my notes" → toast + navigate to Today (check-in).

### States

| State | What's shown |
|---|---|
| **Empty** | Question 1 |
| **Loading (draft job)** | HerbLoader with phases; "Keep this tab open, or come back later. Your answers are kept." Answers persist in `localStorage` until saved |
| **Error (job failed)** | "Couldn't reach Claude. Your answers are safe." + "Try again" + "Write my notes myself" (opens an empty editor with a template of headings) |
| **Done** | Draft editor → Save → Today |

---

## 7. Shared moments: celebrations and copy

| Event | Visual | Sticker | Announce (live region) |
|---|---|---|---|
| Quest done | 済 seal stamps on tap; "+20" floats | `quest_done` (Maomao + herb) | "Done. Earned 20 silver taels. Balance 265." |
| Smaller version | 半 round seal | — | "Smaller version saved. Earned 10." |
| Let go | Strike-through, neutral | — | "Let go. No penalty." |
| Boss done | 勝 seal + gold ring | `boss_done` (Jinshi) | "Weekly prescription complete." |
| 7-day streak | Header toast with a plum-blossom photo strip: "Another week in the ledger. +25 taels" | `streak` (Xiaolan) | Toast text |
| Purchase | 買 seal on the row | `shop_buy` (Gyokuyou/Lihaku) | "Bought café meal. Spent 150." |
| Reroll | The new card fades in | `reroll` (the cat) | "New prescription: <title>" |
| Low rating (≤4) | Ledger seal only | `low_rating` (Luomen) | "Sealed." |
| Return after gap | Info banner | `welcome_back` | — |

Never: confetti, sounds by default, streak-loss warnings, red failure states, or countdowns.

---

## Implementation notes (hand-off to `quest-builder`)

1. **Use the theme as-is.** In `web/src/main.ts`: `import './lib/theme/tokens.css'`. Put the Google Fonts `<link>`s and the no-flash theme script from `web/src/lib/theme/README.md` into `web/index.html`. Import components from `$lib/theme` (or `./lib/theme`). Use `.qj-btn`, `.qj-chip`, `.qj-input` and the rest rather than new button styles.
2. **Svelte ≥ 5.16** is required (class arrays/objects in `class={[...]}`). Verified with Svelte 5.57 + TS 6 under `svelte-check`: 0 errors.
3. **Images are gitignored.** `web/public/stickers/*` (except `manifest.json`) and `web/public/decor/img/` must stay out of git (already in `.gitignore`). The app must look fine without them: everything falls back to SVG/colour. **Don't** add them to the PWA precache manifest at build time; use a runtime cache-first route for `/decor/img/` and `/stickers/` instead. Vite copies `public/` into `dist/` on build, which is fine because `dist/` is gitignored and only served on the tailnet.
4. **Sticker selection:** pass a stable `seed` (quest id, ISO date or week). Don't re-key on every render. Keep **one** Sticker visible at a time on a screen. The parent owns the 4s "show then return to idle" timer.
5. **Jobs/polling:** keep `{jobId, kind}` in a small store so the loader survives navigation. Poll every 2s; on 404, refetch `/api/today`. Render `HerbLoader` for every `queued`/`running` job; it escalates its own messages.
6. **Optimistic quest status:** stamp first, then PATCH, and revert on failure. `SealStamp` animates only on false→true, so the revert and re-stamp still look right.
7. **ETag flows:** keep the user's unsaved text in the memory-only draft store when a 412 happens. Show the info-style stale panel (Evening §2 "Stale").
8. **Status mapping:** the API has `partial` and `let_go` since M2. Pass `letGoStatus="let_go"` and `allowPartial` on Today.
9. **Accessibility checklist:** one `h1` per screen (FolioHeader renders it on Today), focus to `h1` on route change, `aria-current` on the active tab, focus trap in sheets, `aria-busy` on cards while busy, every icon-only button has a label, and all text uses tokens (contrast is pre-checked; don't introduce new colours).
10. **Motion:** honour `prefers-reduced-motion` automatically through the tokens. The Profile "Reduced motion" setting sets `document.documentElement.dataset.motion = 'reduce'`.
11. **Preview:** run the real app on demo data (see the "Preview" section of `web/src/lib/theme/README.md`). The static `preview.html` was removed in the 2026-10-27 redesign.
12. **Sub-path hosting** (not planned): call `setAssetBase(import.meta.env.BASE_URL)` and override the `--qj-img-*`/`--qj-decor-*` URL tokens.
13. **Theme ownership (from M3).** The builder may edit theme files only for backlog items that name a prop, with exactly that prop, and logs each edit under "Theme edits" in PROGRESS.md. Pre-approved for M4: `QuestCard` `showCoins?: boolean` (hide the chip on let-go cards and on the boss until M5), `unroll?: boolean` + `delay?: number`; `HerbLoader` honouring `:root[data-motion=reduce]` and stripping a trailing `…` from `message`. No new colours or tokens.
14. **Async feedback lives where the thumb is.** Loaders, results and errors render inside the card or slot that started them; toasts go to the top of the viewport; stickers never cover text or buttons (Today layout items 7–8).
