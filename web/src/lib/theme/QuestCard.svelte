<!--
  QuestCard: one prescription entry on today's leaf (daily or Jinshi's weekly commission).
    [ margin ]  vertical brush labels, as a woodblock herbal heads each formula: 第一方 (the entry's
                number) and the category's materia-medica heading (安神, 本草…), behind a vermilion rule.
                Decorative: the same facts are in the English meta line.
    [ body ]    category · dose · taels, the title, Maomao's note in a reading Mincho, checkpoints,
                actions. Done stamps a vermilion 済 chop over the corner.
  All AI text is rendered as plain text (never {@html}). Callbacks only: the parent does the API calls
  and passes `busy` while they run.
-->
<script lang="ts">
  import CoinBadge from './CoinBadge.svelte';
  import HerbLoader from './HerbLoader.svelte';
  import Icon from './Icon.svelte';
  import ScrollCard from './ScrollCard.svelte';
  import SealStamp from './SealStamp.svelte';
  import type { Snippet } from 'svelte';
  import { CATEGORY_KANJI, entryLabel } from './folio';
  import type { Feedback, QuestStatus, QuestView, RerollReason } from './types';
  import { DIFFICULTY, LOADING, REROLL_REASONS, STATUS, categoryInfo } from './vocab';

  interface Props {
    quest: QuestView;
    /** Position on the page (0-based): shown as 第一方, 第二方… in the margin */
    index?: number;
    /** Can the status change? (false for past days / archive) */
    editable?: boolean;
    /** Show the Swap (reroll) action */
    canReroll?: boolean;
    /** Offer "Smaller version" (needs server support for `partial`) */
    allowPartial?: boolean;
    /** Status the server uses for "let go" ('failed' in the current API) */
    letGoStatus?: 'let_go' | 'failed';
    /** A request for this card is in flight */
    busy?: boolean;
    /** A reroll job for this card is running */
    rerolling?: boolean;
    headingLevel?: 2 | 3;
    onstatus?: (status: QuestStatus) => void;
    onfeedback?: (feedback: Feedback) => void;
    onreroll?: (reason: RerollReason | null) => void;
    oncheckpoint?: (index: number, done: boolean) => void;
    /** Show the coin chip: false for let-go dailies, so nothing reads like a lost payment. */
    showCoins?: boolean;
    /** Extra micro-copy rendered inside the card, under the why/checkpoints. */
    note?: Snippet;
    /** Optional extra content per checkpoint row (the boss card's photo button), after the label; wraps when wide. */
    checkpointExtra?: Snippet<[number]>;
    /** Content between the why/checkpoints and the note (the boss card's photo strip). */
    extra?: Snippet;
    class?: string;
  }

  let {
    quest,
    index,
    editable = true,
    canReroll = false,
    allowPartial = true,
    letGoStatus = 'failed',
    busy = false,
    rerolling = false,
    headingLevel = 3,
    onstatus,
    onfeedback,
    onreroll,
    oncheckpoint,
    note,
    checkpointExtra,
    extra,
    showCoins = true,
    class: className = ''
  }: Props = $props();

  const isBoss = $derived(quest.difficulty === 'boss');
  const cat = $derived(categoryInfo(quest.category));
  const catKanji = $derived(CATEGORY_KANJI[quest.category] ?? '');
  const status = $derived<QuestStatus>(quest.status === 'failed' ? 'let_go' : quest.status);
  const titleId = $derived(`quest-${quest.id}-title`);
  const sealed = $derived(status === 'done' || status === 'partial');

  let askingReason = $state(false);

  function setStatus(s: QuestStatus) {
    if (!busy) onstatus?.(s);
  }
  function toggleFeedback(f: 'up' | 'down') {
    if (!busy) onfeedback?.(quest.feedback === f ? null : f);
  }
  function reroll(reason: RerollReason | null) {
    askingReason = false;
    onreroll?.(reason);
  }
</script>

<ScrollCard
  tag="article"
  variant={isBoss ? 'boss' : 'default'}
  rods={isBoss}
  class={['qj-quest', className]}
  data-status={status}
  aria-labelledby={titleId}
  aria-busy={busy || rerolling}
  style="--_cat: var({cat.colorVar})"
>
  {#snippet heading()}
    <div class="margin" aria-hidden="true">
      <span class="qj-brush entry">{entryLabel(index, isBoss)}</span>
      {#if catKanji}<span class="qj-brush kind">{catKanji}</span>{/if}
      <span class="dot"></span>
    </div>
    <div class="meta">
      <span class="cat">
        <Icon name={cat.icon} size="1.05em" />
        {cat.label}
      </span>
      <span class="dose" title={DIFFICULTY[quest.difficulty].label}>
        <span class="qj-sr-only">{DIFFICULTY[quest.difficulty].label}</span>
        {#each Array.from({ length: DIFFICULTY[quest.difficulty].leaves }, (_, i) => i) as i (i)}
          <Icon name="leaf" size="0.9em" />
        {/each}
      </span>
      {#if showCoins}<CoinBadge amount={quest.coins} size="sm" kind="reward" showDelta={false} />{/if}
    </div>
    {#if isBoss}<p class="eyebrow">Weekly prescription</p>{/if}
    <svelte:element this={`h${headingLevel}`} id={titleId} class="title">{quest.title}</svelte:element>
  {/snippet}

  <div class="seal-slot">
    <SealStamp stamped={sealed} kind={isBoss ? 'boss' : status === 'partial' ? 'partial' : 'done'} size={isBoss ? 64 : 54} />
  </div>

  {#if quest.why}<p class="why">{quest.why}</p>{/if}

  {#if quest.checkpoints?.length}
    <ol class="checkpoints">
      {#each quest.checkpoints as cp, i (i)}
        <li class:with-extra={checkpointExtra !== undefined}>
          <label>
            <input
              type="checkbox"
              checked={cp.done}
              disabled={!editable}
              aria-disabled={busy || undefined}
              onchange={(e) => {
                // stays focusable while a save runs (disabling it would drop keyboard focus): ignore instead
                if (busy) {
                  e.currentTarget.checked = cp.done;
                  return;
                }
                oncheckpoint?.(i, e.currentTarget.checked);
              }}
            />
            <span>{cp.label}</span>
          </label>
          {#if checkpointExtra}{@render checkpointExtra(i)}{/if}
        </li>
      {/each}
    </ol>
  {/if}

  {#if extra}<div class="extra">{@render extra()}</div>{/if}

  {#if note}<div class="note">{@render note()}</div>{/if}

  {#if rerolling}
    <HerbLoader size="sm" message={LOADING.reroll} phases={[]} />
  {:else if editable}
    {#if status === 'open'}
      <div class="actions">
        <button class="qj-btn qj-btn--primary" type="button" disabled={busy} onclick={() => setStatus('done')}>
          Done
        </button>
        {#if allowPartial}
          <button class="qj-btn" type="button" disabled={busy} onclick={() => setStatus('partial')}>
            Smaller version
          </button>
        {/if}
        <button class="qj-btn qj-btn--quiet" type="button" disabled={busy} onclick={() => setStatus(letGoStatus)}>
          Let go
        </button>
        {#if canReroll && !isBoss}
          <button
            class="qj-btn qj-btn--quiet swap"
            type="button"
            disabled={busy}
            aria-expanded={askingReason}
            onclick={() => (askingReason = !askingReason)}
          >
            <Icon name="cat" size="1.1em" /> Swap
          </button>
        {/if}
      </div>
      {#if askingReason}
        <div class="reasons" role="group" aria-label="Why swap this one? (optional)">
          <span class="reasons-q">Why swap? <span class="opt">(optional)</span></span>
          {#each REROLL_REASONS as r (r.id)}
            <button class="qj-chip" type="button" onclick={() => reroll(r.id)}>{r.label}</button>
          {/each}
          <button class="qj-chip" type="button" onclick={() => reroll(null)}>Just swap</button>
        </div>
      {/if}
    {:else}
      <div class="settled">
        <p class="status-note">
          <strong>{STATUS[status].label}.</strong>
          {#if (status === 'done' || status === 'partial') && !isBoss}+{quest.coins} taels. {STATUS[status].note}{:else if status === 'done'}{STATUS.done.note}{:else}{STATUS[status].note}{/if}
        </p>
        <button class="qj-btn qj-btn--quiet qj-btn--sm" type="button" disabled={busy} onclick={() => setStatus('open')}>
          Undo
        </button>
      </div>
    {/if}
  {/if}

  {#if editable && !rerolling}
    <div class="feedback" role="group" aria-label="Was this a good prescription for you?">
      <button
        class="qj-chip"
        type="button"
        aria-pressed={quest.feedback === 'up'}
        aria-disabled={busy || undefined}
        onclick={() => toggleFeedback('up')}>Suits me</button
      >
      <button
        class="qj-chip"
        type="button"
        aria-pressed={quest.feedback === 'down'}
        aria-disabled={busy || undefined}
        onclick={() => toggleFeedback('down')}>Not for me</button
      >
      {#if quest.source === 'pool'}<span class="src">from the shelf</span>{/if}
    </div>
  {/if}
</ScrollCard>

<style>
  :global(.qj-quest) {
    position: relative;
  }
  /* room for the margin column on the left of the leaf (ScrollCard reads it) */
  :global(.qj-quest) {
    --leaf-pad-start: calc(var(--margin-col) + var(--sp-4));
  }

  .margin {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: var(--margin-col);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-3);
    padding-top: var(--sp-4);
    border-right: 1px solid var(--rule);
    box-shadow: 3px 0 0 -2px var(--rule);
    background: color-mix(in srgb, var(--surface-sunk) 45%, transparent);
    color: var(--ink);
  }
  :global(.qj-quest[data-variant='boss']) .margin {
    top: 6px;
    bottom: 6px;
    left: 6px;
    border-right-color: var(--boss);
    box-shadow: 3px 0 0 -2px var(--boss);
    background: transparent;
  }
  .entry {
    font-size: 1.05rem;
    color: var(--seal);
  }
  :global(.qj-quest[data-variant='boss']) .entry {
    color: var(--boss);
    font-size: 1.2rem;
  }
  .kind {
    font-size: 1.3rem;
  }
  .dot {
    width: 7px;
    height: 7px;
    background: var(--_cat);
    transform: rotate(45deg);
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-1) var(--sp-3);
    padding-right: 56px; /* room for the seal */
    font-size: var(--fs-sm);
  }
  .cat {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    color: var(--ink);
    font-weight: var(--fw-medium);
  }
  .cat :global(.qj-icon) {
    color: var(--_cat);
  }
  .dose {
    display: inline-flex;
    gap: 1px;
    color: var(--jade);
  }
  .eyebrow {
    margin: 0;
    font-size: var(--fs-xs);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--boss-ink);
    font-weight: var(--fw-bold);
  }
  .title {
    margin: 0;
    padding-right: 52px;
    font-family: var(--font-display);
    font-size: 1.25rem;
    font-weight: var(--fw-display);
    line-height: var(--lh-snug);
    color: var(--ink);
    overflow-wrap: anywhere;
  }
  :global(.qj-quest[data-variant='boss']) .title {
    font-size: 1.35rem;
  }
  .seal-slot {
    position: absolute;
    top: var(--sp-3);
    right: var(--sp-3);
    z-index: var(--z-seal);
    pointer-events: none;
  }
  /* Maomao's note: the voice of the page, set as reading text, not grey microcopy */
  .why {
    margin: 0;
    padding-left: var(--sp-3);
    border-left: 2px solid var(--rule-faint);
    font-family: var(--font-note);
    font-weight: var(--fw-medium);
    color: var(--ink);
    font-size: var(--fs-base);
    line-height: var(--lh-body);
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }
  .actions .qj-btn--primary {
    flex: 1 1 7rem;
  }
  .swap {
    margin-left: auto;
  }
  .reasons {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-3);
    border-radius: var(--r-sm);
    background: var(--surface-sunk);
    animation: qj-rise-in var(--dur-base) var(--ease-out) both;
  }
  .reasons-q {
    width: 100%;
    font-size: var(--fs-sm);
    color: var(--ink);
  }
  .opt {
    color: var(--ink-muted);
  }
  .settled {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
  }
  .note {
    font-size: var(--fs-sm);
    color: var(--ink-muted);
  }
  .note :global(p) {
    margin: 0;
  }
  .status-note {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--ink);
  }
  :global(.qj-quest[data-status='let_go']) .title {
    color: var(--ink-muted);
    text-decoration: line-through;
    text-decoration-color: var(--line-strong);
    text-decoration-thickness: 1px;
  }
  .feedback {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2);
  }
  .src {
    margin-left: auto;
    font-size: var(--fs-xs);
    color: var(--ink-muted);
  }

  /* Checkpoints: ruled lines; a ticked one gets the vermilion circle a reader inks beside a passage (圈點) */
  .checkpoints {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
  }
  .checkpoints li + li {
    border-top: 1px solid var(--rule-faint);
  }
  /* A row with extra content (photo button): label grows, the extra sits at the end and wraps under when wide. */
  .checkpoints li.with-extra {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: var(--sp-2);
  }
  .checkpoints li.with-extra label {
    flex: 1 1 10rem;
    min-width: 0;
  }
  .extra {
    min-width: 0;
  }
  .checkpoints label {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    min-height: var(--tap-min);
    padding-block: var(--sp-1);
    cursor: pointer;
    line-height: var(--lh-snug);
  }
  .checkpoints input {
    appearance: none;
    -webkit-appearance: none;
    flex: none;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    margin: 0;
    border: 1.5px solid var(--line-strong);
    border-radius: 50%;
    background: var(--surface);
    cursor: pointer;
    transition: background-color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
  }
  .checkpoints input::after {
    content: '';
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--on-seal);
    transform: scale(0);
    transition: transform var(--dur-fast) var(--ease-stamp);
  }
  .checkpoints input:checked {
    background: var(--seal);
    border-color: var(--seal);
  }
  .checkpoints input:checked::after {
    transform: scale(1);
  }
  .checkpoints input:checked + span {
    color: var(--ink-muted);
  }
  .checkpoints input:focus-visible {
    outline: 3px solid var(--focus-ring);
    outline-offset: 2px;
  }
  .checkpoints input:disabled {
    cursor: default;
    border-style: dashed;
  }
</style>
