<!--
  PhotoStrip: thumbnails + add + remove for one photo target (the boss card, one boss checkpoint, the ledger's
  Highlight or Notes). Photos are stored on the laptop under DATA_DIR/media (never committed) and referenced by path.
  - Add: the OS picker (camera or gallery: no `capture` attribute), several at once. Each photo is resized and
    re-encoded on the device first (photoPrepare.ts: ≤1600 px JPEG, EXIF/GPS stripped), then uploaded one by one.
    The parent gets the new full list through `onchange` and saves it (optimistic patch / evening form).
  - Remove: × → an inline "Remove this photo?" (no confirm()), also from the viewer.
  - View: tap a thumbnail → a full-size viewer in the shared BottomSheet (focus trap, Esc closes, focus returns),
    portalled to <body> so no card's stacking context can cover it.
  `disabled` (a sealed ledger page) hides add/remove but keeps viewing: thumbnails are links, which a disabled
  fieldset doesn't disable. `compact` (checkpoints): only a small camera button until there are photos.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { api, ApiError } from '../api';
  import { COPY } from '../copy';
  import { failureCopy } from '../http';
  import { PhotoDecodeError, preparePhoto } from '../photoPrepare';
  import { MAX_PHOTOS, photosOf, photoUrl, slotsLeft } from '../photos';
  import { portal } from '../portal';
  import { showToast } from '../toast.svelte';
  import BottomSheet from './BottomSheet.svelte';

  interface Props {
    /** Stored photo paths (`media/<YYYY-MM>/<id>.jpg`). */
    photos: readonly string[] | undefined;
    /** What these photos belong to, e.g. "Photos for the highlight" (group label, alt text, viewer). */
    label: string;
    /** Called with the whole new list after an add or a confirmed remove. May be async (the parent saves). */
    onchange: (next: string[]) => void | Promise<void>;
    /** Read-only (sealed page, closed week): view only. */
    disabled?: boolean;
    /** The parent is saving: add/remove wait. */
    busy?: boolean;
    /** Checkpoint mode: a small camera button, thumbnails only once there are photos. */
    compact?: boolean;
    max?: number;
  }
  let { photos, label, onchange, disabled = false, busy = false, compact = false, max = MAX_PHOTOS }: Props = $props();

  const list = $derived(photosOf(photos));
  const canEdit = $derived(!disabled);
  const full = $derived(list.length >= max);
  let uploading = $state<{ n: number; total: number } | null>(null);
  const working = $derived(busy || uploading !== null);
  /** Index whose × was tapped (inline confirm), or null. */
  let asking = $state<number | null>(null);
  /** Index open in the viewer, or null. */
  let viewing = $state<number | null>(null);
  let broken = $state<Record<string, boolean>>({});
  let root = $state<HTMLElement | null>(null);
  let input = $state<HTMLInputElement | null>(null);

  const uid = `qj-photos-${Math.random().toString(36).slice(2, 9)}`;

  async function picked() {
    const files = Array.from(input?.files ?? []);
    if (input) input.value = ''; // picking the same photo again still fires `change`
    if (files.length === 0 || working) return;
    const room = slotsLeft(list.length, max);
    if (files.length > room) showToast(COPY.photoLimit(max));
    const take = files.slice(0, room);
    if (take.length === 0) return;
    const added: string[] = [];
    let unreadable = false;
    let tooLarge = false;
    try {
      for (const [i, f] of take.entries()) {
        uploading = { n: i + 1, total: take.length };
        try {
          // Resized + re-encoded on the device; the original file (with its EXIF/GPS) is never sent.
          const res = await api.uploadPhoto(await preparePhoto(f));
          added.push(res.data.path);
        } catch (e) {
          if (e instanceof PhotoDecodeError || (e instanceof ApiError && e.code === 'unsupported_image')) unreadable = true;
          else if (e instanceof ApiError && e.status === 413) tooLarge = true;
          else {
            showToast(failureCopy(e));
            break;
          }
        }
      }
    } finally {
      uploading = null;
    }
    if (unreadable) showToast(COPY.photoUnreadable, 6000);
    else if (tooLarge) showToast(COPY.photoTooLarge);
    if (added.length) await onchange([...photosOf(photos), ...added].slice(0, max));
  }

  async function ask(i: number) {
    asking = i;
    await tick();
    root?.querySelector<HTMLElement>('[data-keep]')?.focus();
  }

  async function keep() {
    const i = asking;
    asking = null;
    await tick();
    if (i !== null) root?.querySelector<HTMLElement>(`[data-remove="${i}"]`)?.focus();
  }

  async function remove(i: number) {
    const path = list[i];
    asking = null;
    viewing = null;
    if (path === undefined) return;
    await onchange(list.filter((_, j) => j !== i));
    await tick();
    root?.querySelector<HTMLElement>('[data-add] input, [data-thumb]')?.focus();
  }

  function open(e: MouseEvent, i: number) {
    // Plain clicks open the viewer; a modified click (new tab) keeps the link's own behaviour.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    asking = null;
    viewing = i;
  }

  function step(d: number) {
    if (viewing === null || list.length === 0) return;
    viewing = (viewing + d + list.length) % list.length;
  }

  function viewerKey(e: KeyboardEvent) {
    if (viewing === null) return;
    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  }

  // A photo removed elsewhere while the viewer is open: keep the index in range.
  $effect(() => {
    if (viewing !== null && viewing >= list.length) viewing = list.length ? list.length - 1 : null;
  });
</script>

<svelte:window onkeydown={viewerKey} />

{#snippet camera()}
  <svg class="cam" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M4 8h3l1.6-2.2h6.8L17 8h3v11H4z" />
    <circle cx="12" cy="13.4" r="3.6" />
  </svg>
{/snippet}

<div class="qj-photos" class:compact class:empty={list.length === 0} role="group" aria-label={label} bind:this={root}>
  {#if list.length}
    <ul class="thumbs">
      {#each list as p, i (p)}
        <li class="tile">
          <a class="thumb" class:broken={broken[p]} href={photoUrl(p)} data-thumb onclick={(e) => open(e, i)}>
            {#if broken[p]}
              <span class="missing">{COPY.photoMissing}</span>
            {:else}
              <img
                src={photoUrl(p)}
                alt={COPY.photoAlt(label, i + 1, list.length)}
                loading="lazy"
                decoding="async"
                width="72"
                height="72"
                onerror={() => (broken[p] = true)}
              />
            {/if}
          </a>
          {#if canEdit}
            <button
              class="x"
              type="button"
              data-remove={i}
              aria-label={COPY.photoRemove(i + 1)}
              aria-expanded={asking === i}
              disabled={working}
              onclick={() => ask(i)}>×</button
            >
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if canEdit && !full}
    <!-- A real (visually hidden) file input inside a label: the most reliable way to open the OS picker on iOS,
         keyboard-focusable, and announced as a button. No `capture`, so the phone offers camera AND gallery. -->
    <label class="add qj-btn qj-btn--quiet qj-btn--sm" class:compact class:working data-add title={compact ? COPY.photoAddTo(label) : undefined}>
      <input
        bind:this={input}
        id={`${uid}-input`}
        class="qj-sr-only"
        type="file"
        accept="image/*"
        multiple
        aria-label={COPY.photoAddTo(label)}
        disabled={working}
        onchange={picked}
      />
      {@render camera()}
      {#if !compact}<span aria-hidden="true">{COPY.photoAdd}</span>{/if}
    </label>
  {/if}

  {#if uploading}
    <p class="status" role="status">{COPY.photoAdding(uploading.n, uploading.total)}</p>
  {/if}

  {#if asking !== null && canEdit}
    <p class="confirm" role="group" aria-label={COPY.photoRemoveAsk}>
      <span>{COPY.photoRemoveAsk}</span>
      <button class="qj-btn qj-btn--sm" type="button" disabled={working} onclick={() => asking !== null && remove(asking)}>{COPY.photoRemoveYes}</button>
      <button class="qj-btn qj-btn--quiet qj-btn--sm" type="button" data-keep onclick={keep}>{COPY.photoRemoveNo}</button>
    </p>
  {/if}
</div>

{#if viewing !== null && list[viewing] !== undefined}
  {@const path = list[viewing] ?? ''}
  {@const n = viewing + 1}
  <div use:portal>
    <BottomSheet labelledby={`${uid}-viewer`} onclose={() => (viewing = null)}>
      <h2 id={`${uid}-viewer`} class="viewer-title">{COPY.photoViewerTitle(n, list.length)} <span class="viewer-of">· {label}</span></h2>
      <img class="full" src={photoUrl(path)} alt={COPY.photoAlt(label, n, list.length)} decoding="async" />
      <div class="viewer-actions">
        {#if list.length > 1}
          <button class="qj-btn qj-btn--quiet qj-btn--sm" type="button" onclick={() => step(-1)}>‹ {COPY.photoPrev}</button>
          <button class="qj-btn qj-btn--quiet qj-btn--sm" type="button" onclick={() => step(1)}>{COPY.photoNext} ›</button>
        {/if}
        <span class="spacer"></span>
        {#if canEdit}
          {#if asking === viewing}
            <span class="ask">{COPY.photoRemoveAsk}</span>
            <button class="qj-btn qj-btn--sm" type="button" disabled={working} onclick={() => viewing !== null && remove(viewing)}>{COPY.photoRemoveYes}</button>
            <button class="qj-btn qj-btn--quiet qj-btn--sm" type="button" onclick={() => (asking = null)}>{COPY.photoRemoveNo}</button>
          {:else}
            <button class="qj-btn qj-btn--quiet qj-btn--sm" type="button" disabled={working} onclick={() => (asking = viewing)}>{COPY.photoRemoveYes}…</button>
          {/if}
        {/if}
        <button class="qj-btn qj-btn--sm" type="button" onclick={() => (viewing = null)}>{COPY.photoClose}</button>
      </div>
    </BottomSheet>
  </div>
{/if}

<style>
  .qj-photos {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2);
    min-width: 0;
  }
  /* Room around each tile for its × target, which overhangs the corner. */
  .thumbs {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    margin: 0;
    padding: 10px 10px 0 0;
    list-style: none;
  }
  .tile {
    position: relative;
  }
  /* A checkpoint with photos: its strip takes the row under the label, indented past the tick circle. */
  .qj-photos.compact:not(.empty) {
    flex-basis: 100%;
    padding: 0 0 var(--sp-2) calc(24px + var(--sp-3));
  }
  .thumb {
    display: block;
    width: 72px;
    height: 72px;
    border-radius: var(--r-sm);
    overflow: hidden;
    border: var(--bw-hair) solid var(--line-strong);
    background: var(--surface-sunk);
  }
  .compact .thumb {
    width: 56px;
    height: 56px;
  }
  .thumb img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .thumb:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .missing {
    display: grid;
    place-items: center;
    height: 100%;
    padding: 2px;
    color: var(--ink-muted);
    font-size: 10px;
    line-height: 1.2;
    text-align: center;
  }
  /* The × keeps a 44 px target but draws a small round chip in the thumbnail's corner. */
  .x {
    position: absolute;
    z-index: 1;
    top: -14px;
    right: -14px;
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
  }
  .x::before {
    content: '';
    position: absolute;
    inset: 11px;
    border-radius: 50%;
    background: var(--surface);
    border: var(--bw-hair) solid var(--line-strong);
    box-shadow: var(--shadow-1, none);
    z-index: -1;
  }
  .x:focus-visible {
    outline: none;
  }
  .x:focus-visible::before {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .x:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .add {
    gap: var(--sp-1);
    cursor: pointer;
  }
  .add:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .add.working {
    opacity: 0.6;
    cursor: progress;
  }
  /* Checkpoint mode: a quiet 44 px square camera button. */
  .add.compact {
    width: var(--tap-min, 44px);
    min-width: var(--tap-min, 44px);
    padding: 0;
    justify-content: center;
    color: var(--ink-muted);
  }
  .cam {
    width: 1.25em;
    height: 1.25em;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linejoin: round;
  }
  .status,
  .confirm {
    flex-basis: 100%;
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--ink-muted);
  }
  .confirm {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2);
    color: var(--ink);
  }
  .viewer-title {
    margin: 0;
    font-size: var(--fs-md, 1.1rem);
  }
  .viewer-of {
    color: var(--ink-muted);
    font-weight: normal;
    font-size: var(--fs-sm);
  }
  .full {
    display: block;
    width: 100%;
    max-height: min(70dvh, 70vh);
    object-fit: contain;
    border-radius: var(--r-sm);
    background: var(--surface-sunk);
  }
  .viewer-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2);
  }
  .spacer {
    flex: 1;
  }
  .ask {
    font-size: var(--fs-sm);
  }
</style>
