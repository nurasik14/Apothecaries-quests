# Quest Journal theme: "Maomao's herbal notebook"

The tokens, base styles and Svelte 5 (runes) components for Quest Journal.
Design rationale: `docs/design/design-system.md`. Screen specs: `docs/design/screens.md`.

Every screen is a leaf of a thread-bound apothecary's notebook, built from the conventions of real Ming/Qing woodblock herbals: a vermilion double rule round the page (四周雙邊), vertical brush labels in the margin, seals for completion, a woodblock herb plate as the specimen of the day.

## Files

| File | What |
|---|---|
| `tokens.css` | All CSS custom properties (light "paper by day" + dark "by lamplight"), reduced-motion collapse, shared keyframes, a minimal `:where()` base, the page leaf (`.qj-page`: double rule, desktop binding), and shared classes (`.qj-btn`, `.qj-chip`, `.qj-input`, `.qj-textarea`, `.qj-banner`, `.qj-brush`, `.qj-sr-only`) |
| `fonts.css` + `fonts/` | `@font-face` for the self-hosted WOFF2 subsets (Shippori Mincho B1, Zen Kaku Gothic New, Yuji Syuku; SIL OFL 1.1). Made by `scripts/subset-fonts.py` |
| `folio.ts` | The notebook vocabulary: kanji numerals and dates (`kanjiNumber`, `folioDate`), category and nav brush labels, page title slips, `entryLabel` (第一方 / 依頼), and the 17 herb plates with `plateFor(date)` |
| `index.ts` | Barrel: components + types + vocab + folio + helpers |
| `types.ts` | `QuestView`, `QuestStatus`, `StickerEvent`, `DecorPhoto`, `DecorSvg`, … |
| `vocab.ts` | English flavour copy: categories, difficulty, status notes, seal glyphs, energy labels, rating anchors, mood tags, reroll reasons, loader messages, nav |
| `assets.ts` | `photoUrl()`, `herbPlateUrl()`, `svgUrl()`, `stickerUrl()`, `setAssetBase()`, `PHOTO_FALLBACK` |
| `stickers.ts` | `loadStickerManifest()` (cached, falls back to SVG-only), `orderStickerFiles()`, `hashSeed()` |
| `theme.ts` | `applyTheme('light' \| 'dark' \| 'system')`, `getStoredTheme()` |
| `*.svelte` | Components (below) |

Assets: court paintings and a herbal page in `web/public/decor/img/` (gitignored), woodblock herb plates in `web/public/decor/herbs/` (public domain, committed), character stickers in `web/public/stickers/` + `manifest.json` (gitignored, personal use only), and SVG fallbacks/icons in `web/public/decor/*.svg`. Credits: `web/public/IMAGE_SOURCES.md`.

**Adding a kanji anywhere in `web/src`?** Re-run `python3 scripts/subset-fonts.py <dir-with-the-ttfs>` (needs `fonttools` + `brotli`), or that glyph falls back to a system Mincho.

## Setup

`web/src/main.ts` (already done):

```ts
import './lib/theme/fonts.css';
import './lib/theme/tokens.css';
```

`web/index.html` keeps the no-flash script that applies `qj-theme`, `qj-motion` and `qj-stickers` from `localStorage` before first paint, and the two `theme-color` metas (`#f3ead6` light, `#15120e` dark). No third-party font requests.

Requires **Svelte ≥ 5.16** (class arrays). `svelte-check`: 0 errors, 0 warnings.

## Components

All components are typed with `interface Props`. Callbacks are props (`onchange`, `onstatus`…), not events. Decorative parts are `aria-hidden`; every brush label is either inside an `aria-hidden` element or repeats something the English text already says.

### `FolioHeader`
Today's page head: the 版心 spine column (fish-tail mark and the date in brush, e.g. 十月廿六日 · 月曜), the date as the `h1`, and the herb of the day as a woodblock plate with a one-line note and its source.

| Prop | Type | Default |
|---|---|---|
| `date` | `string` `YYYY-MM-DD` (server date) | — |
| `week` | `string` | — |
| `eyebrow` | `string` | `'Prescriptions for'` |
| `plate` | `HerbPlate` | `plateFor(date)` |
| `headingLevel` | `1 \| 2` | `1` |
| `animate` | `boolean` | `true` (ink-in; reduced motion: fade) |
| `trailing` / `children` | `Snippet` | Balance badge / countdown line |

```svelte
<FolioHeader date={data.date} week="Week 44" eyebrow="Monday's prescriptions">
  {#snippet trailing()}<BalanceBadge />{/snippet}
</FolioHeader>
```

### `HerbPlate`
One plate from 植物名實圖考 (1848), drawn as a CSS mask so it prints in `currentColor`. It's `role="img"` with a label ("Woodblock drawing of licorice root (甘草, gāncǎo)"). If the file fails to load, a herb-sprig icon stands in.
Props: `plate: HerbPlate`, `height = '7rem'`, `caption: 'full' | 'name' | 'none' = 'full'`, `class`.

### `PageTitle`
A page heading with its 題簽, the narrow title slip pasted on a bound book, written vertically in brush inside a double rule. The slip is `aria-hidden`; the `h1` you pass in names the page.
Props: `kanji` (use `PAGE_KANJI.evening` etc.), `children` (the heading).

```svelte
<PageTitle kanji={PAGE_KANJI.evening}><h1 tabindex="-1">Evening ledger</h1></PageTitle>
```

### `ScrollCard`
A loose leaf laid into the notebook. (The name is kept from the old design so routes and tests didn't change.)

| Prop | Type | Default | |
|---|---|---|---|
| `variant` | `'default' \| 'boss' \| 'quiet' \| 'alert'` | `'default'` | `boss` = Jinshi's violet double rule; `quiet` = dashed sunk placeholder; `alert` = vermilion left edge |
| `unroll` | `boolean` | `false` | Ink in once on mount (reduced motion: fade) |
| `rods` | `boolean` | `true` | Boss only: the violet silk cord and tassel |
| `tag` | `'section' \| 'article' \| 'div' \| 'li' \| 'aside'` | `'section'` | |
| `band` | `string \| false` | — | A 72px strip of a painting, e.g. `"var(--qj-img-band-evening)"`, closed by a vermilion double rule |
| `heading` / `footer` / `children` | `Snippet` | — | |
| …rest | HTML attributes | | `class`, `aria-*`, `data-*`, `style` pass through |

A parent can reserve a left margin column by setting `--leaf-pad-start` on the card (QuestCard does).

### `LatticeFrame`
The 四周雙邊 border of a woodblock page (thick outer rule, thin inner rule) around content that matters on its own, such as the day's rating. Ruling only, no photo.

| Prop | Type | Default |
|---|---|---|
| `pattern` | `'ice' \| 'floral' \| 'tiles' \| 'beams'` | `'ice'` = vermilion; floral/tiles = jade; beams = violet |
| `weight` | `'thin' \| 'regular' \| 'thick'` | `'regular'` (1/2/3px outer rule) |
| `inset` | `'none' \| 'sm' \| 'md'` | `'md'` |

### `QuestCard`
One prescription entry. Left margin column: the entry number in brush (第一方, 第二方…, or 依頼 for the weekly commission), the category's materia-medica heading (安神, 本草, 遠行…) and a category-coloured diamond, behind a vermilion rule; all `aria-hidden`, since the English meta line says the same. Maomao's note (`why`) is set in the reading Mincho. Checkpoints are ruled lines with a vermilion 圈點 circle when ticked. The parent does the API calls.

| Prop | Type | Default | |
|---|---|---|---|
| `quest` | `QuestView` | — | `{id,title,why?,category,difficulty,coins,status,feedback?,source?,checkpoints?}` |
| `index` | `number` | — | 0-based position → 第一方… |
| `editable` | `boolean` | `true` | |
| `canReroll` | `boolean` | `false` | Shows Swap → reason chips |
| `allowPartial` | `boolean` | `true` | |
| `letGoStatus` | `'let_go' \| 'failed'` | `'failed'` | What "Let go" sends |
| `busy` / `rerolling` | `boolean` | `false` | While `busy`, checkpoints and feedback chips stay focusable (`aria-disabled`) and ignore input, so keyboard focus isn't lost mid-save |
| `showCoins` | `boolean` | `true` | |
| `headingLevel` | `2 \| 3` | `3` | |
| `note` | `Snippet` | | Micro-copy under the note/checkpoints |
| `extra` | `Snippet` | | Content between the why/checkpoints and `note` (the boss card's photo strip) |
| `checkpointExtra` | `Snippet<[number]>` | | Per-checkpoint content after the label, wraps under it when wide (the boss card's camera button / thumbnails) |
| `onstatus` / `onfeedback` / `onreroll` / `oncheckpoint` | callbacks | | |

### `LanternScale`
The morning check-in, as a pulse reading: five ruled columns numbered 一 to 五 in brush (with the Arabic number underneath). Columns up to the reading take a vermilion wash; the chosen one is inked solid. Native radios, so arrow keys work. (The name is kept for API stability; there are no lanterns any more.)
Props: `value` (**bindable**), `labels = ENERGY_LABELS`, `legend`, `hideLegend`, `disabled`, `onchange`.

### `HerbLoader`
The wait while a `claude -p` job runs (`role="status"`). A round silk fan framing court women with pestles (搗練圖) that bob in rhythm. Messages escalate after 15s and 45s.
Props: `message`, `phases`, `size: 'sm' | 'md' | 'lg'`, `showElapsed`, `startedAt`.

### `SealStamp`
The vermilion chop. Animates only when `stamped` goes `false → true` while mounted. Glyphs: 済 done, 半 smaller version, 勝 weekly commission, 買 purchase.
Props: `stamped`, `kind`, `glyph`, `label` (accessible name, `role="img"`), `size`, `animate`, `ghost`, `haptic`, `onstamped`.

### `CoinBadge`
The silver-tael amount (a silver ingot icon). When `amount` changes, a "+20"/"−150" chip floats up and a polite live region announces it.
Props: `amount`, `size`, `kind: 'balance' | 'price' | 'reward'`, `muted`, `showDelta`, `showUnit`, `label`, `announce`.

### `Sticker`
A character reaction for an event, from `/stickers/manifest.json`. It tries each candidate file, then falls back to the event's SVG. Always `aria-hidden`. On Today it sits over the entry's margin column, never over the seal, the title or a button, and it has no floating caption (the live region announces the event).
Props: `event`, `seed`, `size`, `caption`, `tilt`, `frame: 'diecut' | 'round'`, `pop`, `manifestUrl`.

### `HerbRating`
Satisfaction 1–10 as leaves along a stem, on native radios.
Props: `value` (**bindable**), `max`, `legend`, `hideLegend`, `anchors`, `showAnchor`, `readonly`, `required`, `size`, `name`, `onchange`.

### `Photo`
A decor image (`<img>`) that swaps to an SVG fallback if the file is missing.
Props: `name: DecorPhoto` (`drawers`, `band-evening`, `band-garden`, `band-notes`, `hero-consorts`, `loader-pestle`), `fallback?`, `alt = ''`, `fit`, `position`, `loading`, `themed = true`, `class`.

### `Icon`
An SVG from `/decor` as a `currentColor` mask (category icons, fallbacks).
Props: `name: DecorSvg`, `size = '1.25em'`, `label?`, `class`.

## Tokens cheat-sheet

- Surfaces: `--bg` (page), `--surface` (a fresh leaf), `--surface-sunk`, `--desk` (the cover cloth behind the page and under the tabs)
- Text: `--ink`, `--ink-muted` (never use `--ink-faint`, `--rule` or `--gold` for text)
- Ruling: `--rule` (vermilion hairlines), `--rule-faint` (ledger lines), `--thread` (binding)
- Accents: `--accent` / `--on-accent` / `--accent-ink` / `--accent-soft` (Maomao's jade), `--seal` / `--on-seal` / `--seal-soft` (vermilion), `--boss` / `--boss-soft` (Jinshi's violet), `--coin` / `--coin-ink` / `--coin-soft` (silver)
- Type: `--font-display` (Mincho), `--font-note` (Maomao's notes), `--font-body` (UI), `--font-brush` (margin labels; `.qj-brush` sets it vertical)
- Heatmap: `--garden-1..5` + `--garden-ink-1..5`; categories: `--cat-<slug>`
- Images: `--qj-img-<name>` (paintings), `--qj-decor-<name>` (SVGs)
- Motion: `--dur-*`, `--ease-*` (collapsed under reduced motion), `qj-ink-in` keyframes
- Layout: `--sp-1..8`, `--gutter`, `--tap`, `--content-max`, `--margin-col`, `--r-*`, `--shadow-*`

## Preview

There's no static mock-up any more: look at the real app on demo data, which never touches `~/quest-data`.

```sh
bun run seed:demo /tmp/qj-demo --today 2026-10-26
bun run build:web
DATA_DIR=/tmp/qj-demo PORT=4399 SERVE_WEB=true AI_ENABLED=false GIT_ENABLED=false bun server/src/index.ts
# http://localhost:4399  (Profile → theme switches Paper / Night)
```
