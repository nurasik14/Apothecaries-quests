<!--
  Evening ledger: "Seal the day" (designer screens.md §2, psychologist-AC13–18).
  Order: rating → mood → highlight → notes → gratitude. The rating alone is a valid save.
  No other day's rating is ever shown here (anchoring, psychologist-AC15).
  Unsaved text lives only in memory (no localStorage: privacy, architect risk 11).
-->
<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import type { DayJson, FileProblem, Job, JobKind, ProposalJson, ReflectResult, SpentSuggestion } from '../../../server/src/api-types';
  import BalanceBadge from '../lib/components/BalanceBadge.svelte';
  import OfflineCard from '../lib/components/OfflineCard.svelte';
  import PhotoStrip from '../lib/components/PhotoStrip.svelte';
  import ProposalList from '../lib/components/ProposalList.svelte';
  import { photosOf } from '../lib/photos';
  import { jobs as jobState, jobStartedAt, onJobSettled, trackJob } from '../lib/jobs.svelte';
  import { api, ApiError, NetworkError } from '../lib/api';
  import Quarantine from '../lib/components/Quarantine.svelte';
  import { COPY, FIELD_NAMES, money } from '../lib/copy';
  import {
    changedKeys,
    emptyForm,
    matchSpentSuggestions,
    parseAmount,
    rebaseForm,
    saveBody,
    SPEND_CATEGORIES,
    spentRows,
    spentTotal,
    type EveningForm as Form,
    type FormKey
  } from '../lib/eveningForm';
  import { clearDraft, keepDraft, takeDraft } from '../lib/eveningDraft.svelte';
  import { gratitudeDay, prettyDate, shiftDate, toQuestView, weekdayOf } from '../lib/questView';
  import { HerbLoader, HerbRating, LatticeFrame, LOADING, MOOD_TAGS, PAGE_KANJI, PageTitle, QuestCard, ScrollCard, SealStamp, Sticker } from '../lib/theme';
  import { showToast } from '../lib/toast.svelte';
  import { setEconomy } from '../lib/economy.svelte';
  import { sealedToast } from '../lib/ledgerRules';
  import { failureCopy } from '../lib/http';

  interface Props {
    /** null = the server's logical today */
    date: string | null;
  }
  let { date: routeDate }: Props = $props();


  let today = $state<string | null>(null);
  let date = $state<string | null>(null);
  let loading = $state(true);
  let unreachable = $state(false);
  let notOpenYet = $state(false);
  let problem = $state<FileProblem | null>(null);
  let day = $state<DayJson | null>(null);
  let etag = $state<string>('*');
  let form = $state<Form>(emptyForm());
  let loaded = $state<Form>(emptyForm());
  let saving = $state(false);
  let savedOnce = $state(false);
  let stamped = $state(false);
  let lowRatingSticker = $state(false);
  /** H1 #227: the week's streak bonus landed on this save → the streak sticker beside the header seal, 4 s. */
  let bonusSticker = $state(false);
  let bonusTimer: ReturnType<typeof setTimeout> | null = null;
  onDestroy(() => {
    if (bonusTimer) clearTimeout(bonusTimer);
  });
  /** The on-disk version after a 412; shown next to the user's own text (psychologist-AC18). */
  let theirs = $state<Form | null>(null);
  let gratitudeOpen = $state(false);
  /** Reflection block (designer-AC9): hidden on private and past pages; never shown before the rating is sealed. */
  type ReflectView = 'hidden' | 'loading' | 'ready' | 'none' | 'failed' | 'care';
  let reflectView = $state<ReflectView>('hidden');
  let reflectProposal = $state<ProposalJson | null>(null);
  let reflectEl = $state<HTMLElement | null>(null);
  let customTag = $state('');
  /** The money row being typed (not in the form until "Add", Enter, or the seal). */
  let newAmount = $state('');
  let newNote = $state('');
  let newCategory = $state<Form['spent'][number]['category']>('other');
  let amountError = $state(false);
  const pendingSpent = $derived(newAmount.trim() !== '');
  /** Past notes for the "What for" autocomplete (GET /api/spent/suggestions); empty when unreachable. */
  let suggestions = $state<SpentSuggestion[]>([]);
  let suggestOpen = $state(false);
  /** Highlighted suggestion (arrow keys); -1 = none, so a plain Enter still adds the row. */
  let suggestActive = $state(-1);
  const suggestMatches = $derived(suggestOpen ? matchSpentSuggestions(suggestions, newNote) : []);
  let suggestEl = $state<HTMLElement | null>(null);
  /** Open upward when the space under the box (above the tab bar / phone keyboard) is too small. */
  let suggestUp = $state(false);
  let suggestMax = $state(256);
  $effect(() => {
    const rows = suggestMatches.length;
    if (!suggestEl || rows === 0) return;
    const box = document.getElementById('spent-note')?.getBoundingClientRect();
    if (!box) return;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const navTop = document.querySelector('nav')?.getBoundingClientRect().top ?? vh;
    const below = Math.min(vh, navTop) - box.bottom - 8;
    const above = box.top - 8;
    const want = Math.min(256, rows * 44 + 8);
    suggestUp = below < want && above > below;
    suggestMax = Math.max(96, Math.min(256, suggestUp ? above : below));
  });

  const weekday = $derived(date ? weekdayOf(date) : '');
  const isPast = $derived(date !== null && today !== null && date < today);
  const dirty = $derived(JSON.stringify(form) !== JSON.stringify(loaded));
  /** The page on disk already holds an evening entry and nothing here differs from it. */
  const sealedOnDisk = $derived(
    day !== null &&
      (loaded.satisfaction !== null ||
        loaded.mood.length > 0 ||
        loaded.spent.length > 0 ||
        (loaded.highlight_photos?.length ?? 0) > 0 ||
        (loaded.notes_photos?.length ?? 0) > 0 ||
        [loaded.highlight, loaded.notes, loaded.gratitude].some((t) => t.trim() !== ''))
  );
  /** Tapped "Edit" on a sealed page: the fields open again until the next seal. */
  let editing = $state(false);
  /** Sealed and untouched: fields read-only, the seal button turns grey and offers "Edit". */
  const locked = $derived(sealedOnDisk && !dirty && !theirs && !editing && !saving && !pendingSpent);
  const canSave = $derived(!saving && (dirty || pendingSpent) && !problem);
  const showGratitude = $derived(gratitudeOpen || gratitudeDay(weekday) || loaded.gratitude !== '' || form.gratitude !== '');
  const reflectAllowed = $derived(
    date !== null && today !== null && (date === today || date === shiftDate(today, -1)) && day?.private !== true
  );
  const reflectJob = $derived(jobState.byKind.reflect ?? null);
  const extraTags = $derived(form.mood.filter((m) => !(MOOD_TAGS as readonly string[]).includes(m)));
  /** After a 412: fields edited both here and on disk (M2 R-BUG-3), and untouched fields adopted from disk. */
  let staleFields = $state<FormKey[]>([]);
  let staleUpdated = $state<FormKey[]>([]);
  let staleEl = $state<HTMLElement | null>(null);
  /** Set once load() has finished, so the draft effect never saves the empty pre-load form. */
  let ready = $state(false);

  // Keep the unsaved draft in memory while the user types (G26). Cleared on a successful save.
  $effect(() => {
    if (!ready || !date) return;
    const f = $state.snapshot(form);
    const l = $state.snapshot(loaded);
    if (changedKeys(f, l).length === 0 && theirs === null) {
      clearDraft(date);
      return;
    }
    keepDraft({
      date,
      form: f,
      loaded: l,
      etag,
      theirs: theirs ? $state.snapshot(theirs) : null,
      staleFields: [...staleFields],
      staleUpdated: [...staleUpdated]
    });
  });

  // A reload or closed tab would drop the in-memory draft: ask first while there's unsaved text.
  $effect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  });

  function formOf(d: DayJson | null): Form {
    if (!d) return emptyForm();
    return {
      satisfaction: d.satisfaction,
      mood: [...d.mood],
      highlight: d.highlight,
      notes: d.notes,
      gratitude: d.gratitude,
      spent: spentRows(d.spent),
      highlight_photos: photosOf(d.highlight_photos),
      notes_photos: photosOf(d.notes_photos)
    };
  }

  function problemFrom(e: ApiError): FileProblem {
    const d = e.details;
    const issues = Array.isArray(d.issues) ? (d.issues as { path?: string }[]) : [];
    return {
      code: e.code,
      file: typeof d.file === 'string' ? d.file : '',
      ...(typeof d.line === 'number' ? { line: d.line } : {}),
      ...(issues[0]?.path ? { field: issues[0].path } : {}),
      ...(typeof d.raw === 'string' ? { raw: d.raw } : {})
    };
  }

  /** Read the day file: 200 → form + ETag, 404 → empty page (If-Match: *), 422 → calm quarantine. */
  async function readDay(d: string): Promise<{ day: DayJson | null; etag: string } | null> {
    try {
      const res = await api.day(d);
      return { day: res.data, etag: res.etag ?? res.data.etag };
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return { day: null, etag: '*' };
      if (e instanceof ApiError && e.status === 422) {
        problem = problemFrom(e);
        return null;
      }
      throw e;
    }
  }

  async function showProposalFor(d: string, quiet: boolean) {
    try {
      const r = await api.proposal(d);
      if (r.data.ops.some((o) => o.decision === null) || !quiet) {
        reflectProposal = r.data;
        reflectView = 'ready';
        return true;
      }
    } catch {
      /* 404: nothing proposed for this page */
    }
    return false;
  }

  async function scrollToReflect() {
    await tick();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    reflectEl?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }

  function onReflectSettled(job: Job | null, kind: JobKind) {
    if (kind !== 'reflect' || !date) return;
    if (job && job.key !== `reflect:${date}`) return;
    if (!job || job.status === 'failed') {
      reflectView = 'failed';
      return;
    }
    const res = job.result as ReflectResult | undefined;
    if (!res) return;
    if (res.outcome === 'proposed') {
      reflectProposal = res.proposal;
      reflectView = 'ready';
    } else if (res.outcome === 'care') {
      reflectView = 'care';
      lowRatingSticker = false;
    } else if (res.outcome === 'private') {
      reflectView = 'hidden';
    } else if (res.outcome === 'superseded') {
      void showProposalFor(date, false).then((ok) => {
        if (!ok) reflectView = 'none';
      });
    } else {
      reflectView = 'none';
    }
  }
  const offReflect = onJobSettled(onReflectSettled);
  onDestroy(offReflect);

  async function retryReflect() {
    if (!date) return;
    reflectView = 'loading';
    try {
      const r = await api.reflect(date);
      trackJob(r.data.job);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'already_decided') {
        if (!(await showProposalFor(date, false))) reflectView = 'none';
      } else {
        reflectView = 'failed';
      }
    }
  }

  /** On (re)visit: a running reflect job keeps its loader; a pending suggestion for this page shows up. */
  async function restoreReflect() {
    if (!date || !reflectAllowed) return;
    const j = jobState.byKind.reflect;
    if (j && j.key === `reflect:${date}`) {
      if (j.status === 'queued' || j.status === 'running') {
        reflectView = 'loading';
        return;
      }
    }
    await showProposalFor(date, true);
  }

  async function load() {
    loading = true;
    unreachable = false;
    try {
      const t = await api.today();
      today = t.data.date;
      // Seeds the once-only bonus memory (H1 #227), so a bonus landing on this page's save is told here, once.
      setEconomy(t.data.economy, t.data.date);
      date = routeDate ?? t.data.date;
      if (date > t.data.date) {
        notOpenYet = true;
        return;
      }
      const r = await readDay(date);
      if (r) {
        day = r.day;
        etag = r.etag;
        form = formOf(r.day);
        loaded = formOf(r.day);
        // Unsaved text from before a navigation comes back with its own baseline + ETag, so a newer disk
        // version still triggers the normal 412 → rebase path instead of being silently overwritten.
        const kept = takeDraft(date);
        if (kept) {
          form = kept.form;
          loaded = kept.loaded;
          etag = kept.etag;
          theirs = kept.theirs;
          staleFields = kept.staleFields;
          staleUpdated = kept.staleUpdated;
          if (kept.form.gratitude) gratitudeOpen = true;
        }
      }
    } catch (e) {
      unreachable = e instanceof NetworkError;
      if (!unreachable) console.warn('[evening] load', e);
    } finally {
      loading = false;
      ready = true;
    }
    void restoreReflect();
  }

  onMount(() => {
    void load();
    void loadSuggestions();
  });

  async function loadSuggestions() {
    try {
      suggestions = (await api.spentSuggestions()).data.suggestions ?? [];
    } catch {
      // Optional helper: an older server or offline just means no suggestions.
    }
  }

  function closeSuggest() {
    suggestOpen = false;
    suggestActive = -1;
  }

  /** Fill the row the way this note was last written: its text and type, and the amount if none is typed yet. */
  async function pickSuggestion(s: SpentSuggestion) {
    newNote = s.note;
    newCategory = s.category;
    closeSuggest();
    if (newAmount.trim() === '') {
      newAmount = String(s.amount);
      amountError = false;
      await tick();
      const el = document.getElementById('spent-amount') as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }
  }

  function noteKeydown(e: KeyboardEvent) {
    const n = suggestMatches.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!suggestOpen) suggestOpen = true;
      const m = matchSpentSuggestions(suggestions, newNote).length;
      if (m === 0) return;
      e.preventDefault();
      suggestActive = e.key === 'ArrowDown' ? (suggestActive + 1) % m : suggestActive <= 0 ? m - 1 : suggestActive - 1;
    } else if (e.key === 'Escape' && n > 0) {
      e.preventDefault();
      closeSuggest();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const s = suggestActive >= 0 ? suggestMatches[suggestActive] : undefined;
      if (s) void pickSuggestion(s);
      else if (addSpent()) document.getElementById('spent-amount')?.focus();
    }
  }

  function toggleMood(tag: string) {
    form.mood = form.mood.includes(tag) ? form.mood.filter((m) => m !== tag) : [...form.mood, tag];
  }

  function addCustom() {
    const t = customTag.trim().toLowerCase().slice(0, 24);
    if (t && !form.mood.some((m) => m.toLowerCase() === t)) form.mood = [...form.mood, t];
    customTag = '';
  }

  /** Move the typed amount into the list. false = the amount box doesn't hold a usable number. */
  function addSpent(): boolean {
    const amount = parseAmount(newAmount);
    if (amount === null) {
      amountError = newAmount.trim() !== '';
      return newAmount.trim() === '';
    }
    form.spent = [...form.spent, { amount, note: newNote.trim().slice(0, 80), category: newCategory }];
    newAmount = '';
    newNote = '';
    newCategory = 'other';
    amountError = false;
    closeSuggest();
    return true;
  }

  function removeSpent(i: number) {
    form.spent = form.spent.filter((_, j) => j !== i);
  }

  async function save() {
    if (!date || !canSave) return;
    // A typed-but-not-added amount goes in with the seal, so it's never lost.
    if (pendingSpent && !addSpent()) {
      document.getElementById('spent-amount')?.focus();
      return;
    }
    if (!dirty) return;
    saving = true;
    // M2 BUG-1: send only what the user changed, so untouched fields can't overwrite newer hand edits.
    const body = saveBody($state.snapshot(form), $state.snapshot(loaded));
    try {
      const res = await api.saveEvening(date, body, etag);
      // Every economy-input mutation returns the ledger (architect-AC22): a rating can land a streak bonus. Told
      // here, in ONE toast (H1 #227); Today never replays it (the same once-per-date memory).
      const bonus = today ? setEconomy(res.data.economy, today) : setEconomy(res.data.economy);
      day = res.data.day;
      etag = res.etag ?? res.data.day.etag;
      loaded = formOf(res.data.day);
      form = formOf(res.data.day);
      theirs = null;
      staleFields = [];
      staleUpdated = [];
      clearDraft(date);
      void loadSuggestions();
      savedOnce = true;
      editing = false;
      stamped = false;
      queueMicrotask(() => (stamped = true));
      lowRatingSticker = res.data.day.satisfaction !== null && res.data.day.satisfaction <= 4;
      showToast(sealedToast(bonus, res.data.economy?.bonus_today ?? 0));
      if (bonus) {
        bonusSticker = true;
        if (bonusTimer) clearTimeout(bonusTimer);
        bonusTimer = setTimeout(() => (bonusSticker = false), 4000);
      }
      // Reflection (sprint goal 3/21): only after the rating is sealed, directly under the header.
      if (res.data.reflect_job) {
        reflectView = 'loading';
        trackJob(res.data.reflect_job);
        void scrollToReflect();
      } else if (res.data.reflect_skip === 'care') {
        reflectView = 'care';
        lowRatingSticker = false; // one quiet card, no sticker (designer-AC13)
        void scrollToReflect();
      } else if (res.data.reflect_skip === 'exists' && date) {
        if (await showProposalFor(date, true)) void scrollToReflect();
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 412) {
        // Keep the user's text in the form; fetch the newer version and show it alongside (never discard).
        try {
          const r = await readDay(date);
          if (r) {
            // The on-disk version becomes the baseline: untouched fields adopt it, the user's edits stay,
            // and the panel shows the on-disk text only for fields the user also changed (M2 BUG-1).
            const disk = formOf(r.day);
            const rebased = rebaseForm($state.snapshot(form), $state.snapshot(loaded), disk);
            etag = r.etag;
            form = rebased.form;
            staleFields = rebased.conflicts;
            staleUpdated = rebased.updated;
            loaded = disk;
            theirs = disk;
            day = r.day;
            // Make the 412 impossible to miss on a phone (designer-AC17, tester R2-BUG-1): un-stamp the
            // header seal, bring the panel into view, focus it, and say so.
            stamped = false;
            showToast(COPY.staleToast);
            await tick();
            const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
            staleEl?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
            staleEl?.focus({ preventScroll: true });
          }
        } catch {
          showToast(COPY.saveRetry);
        }
      } else if (e instanceof ApiError && e.status === 422) {
        problem = problemFrom(e);
      } else {
        showToast(failureCopy(e));
      }
    } finally {
      saving = false;
    }
  }

  function moodText(v: Form['mood'] | undefined) {
    return v && v.length ? v.join(', ') : '—';
  }

  function spentText(v: Form['spent'] | undefined) {
    return v && v.length
      ? v.map((e) => `${money(e.amount)}${e.note ? ` ${e.note}` : ''} (${COPY.spendCategory[e.category] ?? e.category})`).join(', ')
      : '—';
  }
</script>

<svelte:head><title>Evening ledger · Quest Journal</title></svelte:head>

<ScrollCard unroll band="var(--qj-img-band-evening)">
  {#snippet heading()}
    <div class="head">
      <PageTitle kanji={PAGE_KANJI.evening}>
        <h1 tabindex="-1">{COPY.eveningTitle}</h1>
        {#if date}<p class="sub">{prettyDate(date)}{#if isPast} · <span class="chip-later">{COPY.writtenLater}</span>{/if}</p>{/if}
      </PageTitle>
      <div class="head-end">
        <BalanceBadge />
        {#if bonusSticker}<span class="bonus-sticker" aria-hidden="true"><Sticker event="streak" seed={date ?? 'evening'} size={72} /></span>{/if}
        {#if savedOnce}<SealStamp stamped={stamped} kind="done" size={72} />{/if}
      </div>
    </div>
  {/snippet}
  {#if today && date}
    <p class="small">
      {#if isPast}
        <a class="qj-textlink" href="/evening">{COPY.todayLink}</a>
      {:else}
        <a class="qj-textlink" href={`/evening/${shiftDate(today, -1)}`}>{COPY.yesterdayLink}</a>
      {/if}
    </p>
  {/if}
</ScrollCard>

{#if reflectAllowed && reflectView !== 'hidden'}
  <section class="reflect" bind:this={reflectEl} aria-labelledby="reflect-h">
    <ScrollCard>
      {#snippet heading()}<h2 id="reflect-h">{COPY.reflectHeading}</h2>{/snippet}
      {#if reflectView === 'loading'}
        {#key reflectJob?.id}
          <HerbLoader size="sm" message={LOADING.reflect} phases={[{ afterMs: 15_000, text: LOADING.slow }]} startedAt={jobStartedAt(reflectJob)} />
        {/key}
        <p class="small muted">{COPY.reflectLeave}</p>
      {:else if reflectView === 'ready' && reflectProposal}
        {#key reflectProposal.etag}
          <ProposalList proposal={reflectProposal} onchange={(p) => (reflectProposal = p)} />
        {/key}
      {:else if reflectView === 'none'}
        <p class="small muted">{COPY.reflectNone}</p>
      {:else if reflectView === 'failed'}
        <p>{COPY.reflectFailed}</p>
        <button type="button" class="qj-btn qj-btn--quiet qj-btn--sm" onclick={retryReflect}>{COPY.reflectTryAgain}</button>
      {:else if reflectView === 'care'}
        <p>{COPY.careNote}</p>
      {/if}
    </ScrollCard>
  </section>
{/if}

{#if loading}
  <LatticeFrame pattern="ice">
    <HerbRating value={null} readonly legend={COPY.eveningLegend} showAnchor={false} />
  </LatticeFrame>
  <div class="bar" aria-hidden="true"></div>
  <div class="bar" aria-hidden="true"></div>
{:else if unreachable}
  <OfflineCard onretry={() => void load()} />
{:else if notOpenYet}
  <p class="qj-banner qj-banner--info">{COPY.noDay}</p>
{:else if problem}
  <Quarantine {problem} />
{:else}
  {#if theirs}
    <section class="qj-banner qj-banner--info stale" aria-live="polite" tabindex="-1" bind:this={staleEl}>
      <div class="stale-body">
        <p><strong>{COPY.stale}</strong></p>
        {#if staleUpdated.length}
          <p class="small">{COPY.staleUpdated(staleUpdated.map((k) => FIELD_NAMES[k]))}</p>
        {/if}
        {#if staleFields.length}
          <details open>
            <summary>{COPY.staleTheirs}</summary>
            <dl>
              {#each staleFields as k (k)}
                <dt>{COPY.staleField(FIELD_NAMES[k])}</dt>
                <dd>
                  {#if k === 'mood'}{moodText(theirs.mood)}{:else if k === 'satisfaction'}{theirs.satisfaction ?? '—'}{:else if k === 'spent'}{spentText(
                      theirs.spent
                    )}{:else if k === 'highlight_photos' || k === 'notes_photos'}{COPY.photoCount(theirs[k]?.length ?? 0)}{:else}<pre
                      class="theirs">{theirs[k] || '—'}</pre>{/if}
                </dd>
              {/each}
            </dl>
          </details>
        {/if}
      </div>
    </section>
  {/if}

  <form
    class="ledger"
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
  >
    <fieldset class="fields" disabled={locked}>
    <LatticeFrame pattern="ice">
      <HerbRating bind:value={form.satisfaction} legend={COPY.eveningLegend} />
      {#if form.satisfaction === null}
        <p class="small muted" id="rating-hint">{COPY.eveningEmpty}</p>
      {:else}
        <button class="qj-btn qj-btn--quiet qj-btn--sm" type="button" onclick={() => (form.satisfaction = null)}>
          {COPY.clearRating}
        </button>
      {/if}
    </LatticeFrame>

    <fieldset class="moods">
      <legend class="qj-label">{COPY.moodLegend}</legend>
      <div class="chips">
        {#each MOOD_TAGS as tag (tag)}
          <button class="qj-chip" type="button" aria-pressed={form.mood.includes(tag)} onclick={() => toggleMood(tag)}>{tag}</button>
        {/each}
        {#each extraTags as tag (tag)}
          <button class="qj-chip" type="button" aria-pressed="true" onclick={() => toggleMood(tag)}>{tag}</button>
        {/each}
      </div>
      <div class="custom">
        <label class="qj-sr-only" for="mood-custom">{COPY.moodCustomLabel}</label>
        <input
          id="mood-custom"
          class="qj-input"
          maxlength="24"
          placeholder={COPY.moodCustomLabel}
          bind:value={customTag}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustom();
            }
          }}
        />
        <button class="qj-btn qj-btn--sm" type="button" disabled={customTag.trim() === ''} onclick={addCustom}>
          {COPY.moodCustomButton}
        </button>
      </div>
    </fieldset>

    <div class="qj-field">
      <label class="qj-label" for="highlight">{COPY.highlightLabel}</label>
      <span class="qj-hint" id="highlight-hint">{COPY.highlightHint}</span>
      <input id="highlight" class="qj-input" maxlength="300" aria-describedby="highlight-hint" bind:value={form.highlight} />
      <!-- Photos are part of the form: they make it dirty, the Seal saves them, a sealed page shows them read-only. -->
      <PhotoStrip
        photos={form.highlight_photos}
        label={COPY.photosHighlight}
        disabled={locked}
        busy={saving}
        onchange={(next) => {
          form.highlight_photos = next;
        }}
      />
    </div>

    <div class="qj-field">
      <label class="qj-label" for="notes">{COPY.notesLabel}</label>
      <textarea id="notes" class="qj-textarea" rows="6" maxlength="10000" bind:value={form.notes}></textarea>
      <PhotoStrip
        photos={form.notes_photos}
        label={COPY.photosNotes}
        disabled={locked}
        busy={saving}
        onchange={(next) => {
          form.notes_photos = next;
        }}
      />
    </div>

    {#if showGratitude}
      <div class="qj-field">
        <label class="qj-label" for="gratitude">{COPY.gratitudeLabel}</label>
        <textarea id="gratitude" class="qj-textarea" rows="3" maxlength="10000" bind:value={form.gratitude}></textarea>
      </div>
    {:else}
      <button class="qj-btn qj-btn--quiet add-grat" type="button" onclick={() => (gratitudeOpen = true)}>{COPY.gratitudeAdd}</button>
    {/if}

    </fieldset>

    <!-- Money (outside the sealed fieldset): a new amount can be noted on a sealed page straight away. -->
    <fieldset class="spent" class:suggesting={suggestMatches.length > 0}>
      <legend class="qj-label">{isPast ? COPY.spentLegendPast : COPY.spentLegend}</legend>
      <span class="qj-hint" id="spent-hint">{COPY.spentHint}</span>
      {#if form.spent.length}
        <ul class="spent-list">
          {#each form.spent as e, i (i)}
            <li>
              <span class="spent-what">
                <span class="spent-note" class:muted={!e.note}>{e.note || COPY.spentNoNote}</span>
                <select
                  class="spent-cat-row"
                  aria-label={COPY.spentCategoryOf(`${money(e.amount)}${e.note ? ` ${e.note}` : ''}`)}
                  bind:value={form.spent[i]!.category}
                >
                  {#each SPEND_CATEGORIES as c (c)}<option value={c}>{COPY.spendCategory[c]}</option>{/each}
                </select>
              </span>
              <span class="spent-amt">{money(e.amount)}</span>
              <button
                class="qj-btn qj-btn--quiet qj-btn--sm spent-x"
                type="button"
                aria-label={COPY.spentRemove(`${money(e.amount)}${e.note ? ` ${e.note}` : ''}`)}
                onclick={() => removeSpent(i)}>×</button
              >
            </li>
          {/each}
        </ul>
        <p class="spent-total" aria-live="polite">{COPY.spentTotal(money(spentTotal(form.spent)))}</p>
      {:else}
        <p class="small muted">{COPY.spentNone}</p>
      {/if}
      <div class="spent-add">
        <label class="qj-sr-only" for="spent-amount">{COPY.spentAmountLabel}</label>
        <input
          id="spent-amount"
          class="qj-input spent-amount"
          inputmode="decimal"
          autocomplete="off"
          maxlength="14"
          placeholder={COPY.spentAmountLabel}
          aria-invalid={amountError}
          aria-describedby={amountError ? 'spent-error' : 'spent-hint'}
          bind:value={newAmount}
          oninput={() => (amountError = false)}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addSpent();
            }
          }}
        />
        <label class="qj-sr-only" for="spent-note">{COPY.spentNoteLabel}</label>
        <div class="spent-note-wrap">
          <input
            id="spent-note"
            class="qj-input spent-note-in"
            maxlength="80"
            autocomplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={suggestMatches.length > 0}
            aria-controls="spent-suggest"
            aria-activedescendant={suggestActive >= 0 && suggestMatches[suggestActive] ? `spent-suggest-${suggestActive}` : undefined}
            placeholder={COPY.spentNotePlaceholder}
            bind:value={newNote}
            oninput={() => {
              suggestOpen = true;
              suggestActive = -1;
            }}
            onblur={closeSuggest}
            onkeydown={noteKeydown}
          />
          {#if suggestMatches.length}
            <ul
              class="spent-suggest"
              class:up={suggestUp}
              style:max-height={`${suggestMax}px`}
              id="spent-suggest"
              role="listbox"
              bind:this={suggestEl} aria-label={COPY.spentSuggestLabel}>
              {#each suggestMatches as s, i (s.note)}
                <li
                  id={`spent-suggest-${i}`}
                  role="option"
                  aria-selected={i === suggestActive}
                  class:active={i === suggestActive}
                  onpointerdown={(e) => {
                    e.preventDefault();
                    void pickSuggestion(s);
                  }}
                >
                  <span class="spent-suggest-note">{s.note}</span>
                  <span class="spent-suggest-meta">{COPY.spendCategory[s.category] ?? s.category} · {money(s.amount)}</span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
        <label class="qj-sr-only" for="spent-category">{COPY.spentCategoryLabel}</label>
        <select id="spent-category" class="qj-input spent-cat-in" bind:value={newCategory}>
          {#each SPEND_CATEGORIES as c (c)}<option value={c}>{COPY.spendCategory[c]}</option>{/each}
        </select>
        <button class="qj-btn qj-btn--sm spent-add-btn" type="button" disabled={newAmount.trim() === ''} onclick={addSpent}>{COPY.spentAdd}</button>
      </div>
      {#if amountError}<p class="small spent-error" id="spent-error" role="alert">{COPY.spentBadAmount}</p>{/if}
    </fieldset>

    {#if day && day.extra_sections.length}
      <p class="small muted">{COPY.ownSectionsKept(day.extra_sections)}</p>
    {/if}

    {#if lowRatingSticker}
      <div class="low">
        <Sticker event="low_rating" seed={date ?? 'low'} size={88} />
        <p>{COPY.lowRating}</p>
      </div>
    {/if}

    {#if isPast && day && day.quests.length}
      <section class="past" aria-label="Quests on this day">
        <p class="small muted">{COPY.pastQuests}</p>
        {#each day.quests as q (q.id)}
          <QuestCard quest={toQuestView(q)} editable={false} showCoins={q.status !== 'let_go'} />
        {/each}
      </section>
    {/if}

    <div class="savebar" class:settled={(savedOnce || sealedOnDisk) && !dirty && !theirs}>
      {#if locked}
        <button
          class="qj-btn qj-btn--block sealed-btn"
          type="button"
          onclick={async () => {
            editing = true;
            await tick();
            document.getElementById('highlight')?.focus();
          }}
        >
          {isPast ? COPY.editPast : COPY.editToday}
        </button>
      {:else}
        <button
          class="qj-btn qj-btn--seal qj-btn--block"
          type="submit"
          disabled={!canSave}
          aria-describedby={form.satisfaction === null ? 'rating-hint' : undefined}
        >
          {saving ? COPY.sealing : isPast ? COPY.sealPast : COPY.sealButton}
        </button>
      {/if}
    </div>
  </form>
{/if}

<style>
  .head-end {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2) var(--sp-3);
  }
  .head :global(.qj-pagetitle) {
    flex: 1 1 13rem;
  }
  .sub {
    color: var(--ink-muted);
  }
  .chip-later {
    font-size: var(--fs-xs);
    padding: 0 var(--sp-2);
    border-radius: var(--r-pill);
    background: var(--surface-sunk);
  }
  .ledger {
    display: grid;
    gap: var(--sp-5);
  }
  .moods {
    margin: 0;
    padding: 0;
    border: 0;
    display: grid;
    gap: var(--sp-2);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }
  .custom {
    display: flex;
    gap: var(--sp-2);
  }
  .custom .qj-input {
    flex: 1;
    min-width: 0;
  }
  .add-grat {
    justify-self: start;
  }
  .spent {
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
    display: grid;
    gap: var(--sp-2);
  }
  /* The open suggestion list must float above the sticky Seal bar (each page child is its own z-index: 1
     stacking context), but stay under the tab bar. */
  .spent.suggesting {
    position: relative;
    z-index: calc(var(--z-sticky) + 1);
  }
  .spent-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--sp-1);
  }
  .spent-list li {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding-bottom: var(--sp-1);
    border-bottom: 1px dashed var(--line);
  }
  .spent-what {
    flex: 1;
    min-width: 0;
    display: grid;
    justify-items: start;
    gap: 2px;
  }
  .spent-note {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  /* The row's kind: a small chip-like picker, so an older entry can be sorted later. */
  .spent-cat-row {
    max-width: 100%;
    min-height: 32px;
    padding: 2px var(--sp-2);
    border: var(--bw-hair) solid var(--line-strong);
    border-radius: var(--r-sm);
    background: var(--surface);
    color: var(--ink-muted);
    font-size: var(--fs-sm);
  }
  .spent-amt {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .spent-x {
    min-width: 44px;
  }
  .spent-total {
    margin: 0;
    text-align: right;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  /* Amount · What for on the first line, Type · Add on the second (fits 320 px). */
  .spent-add {
    display: grid;
    grid-template-columns: 6.5rem minmax(0, 1fr) auto;
    grid-template-areas:
      'amt note note'
      'cat cat add';
    gap: var(--sp-2);
  }
  .spent-amount {
    grid-area: amt;
    min-width: 0;
  }
  .spent-note-wrap {
    grid-area: note;
    min-width: 0;
    position: relative;
  }
  .spent-note-in {
    width: 100%;
    min-width: 0;
  }
  /* Past notes matching the keyword (calendar-style autocomplete); tap or arrow + Enter picks one. */
  .spent-suggest {
    position: absolute;
    z-index: var(--z-sticky);
    top: calc(100% + 2px);
    left: 0;
    right: 0;
    margin: 0;
    padding: var(--sp-1) 0;
    list-style: none;
    background: var(--surface);
    border: var(--bw-hair) solid var(--line-strong);
    border-radius: var(--r-sm);
    box-shadow: var(--shadow-3);
    max-height: 16rem;
    overflow-y: auto;
  }
  .spent-suggest.up {
    top: auto;
    bottom: calc(100% + 2px);
  }
  .spent-suggest li {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--sp-2);
    min-height: 44px;
    padding: var(--sp-1) var(--sp-2);
    cursor: pointer;
  }
  .spent-suggest li:hover,
  .spent-suggest li.active {
    background: var(--bg);
  }
  .spent-suggest-note {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .spent-suggest-meta {
    flex: none;
    color: var(--ink-muted);
    font-size: var(--fs-sm);
    font-variant-numeric: tabular-nums;
  }
  .spent-cat-in {
    grid-area: cat;
    min-width: 0;
  }
  .spent-add-btn {
    grid-area: add;
  }
  .spent-error {
    margin: 0;
    color: var(--seal);
  }
  .savebar {
    position: sticky;
    bottom: calc(var(--nav-height) + env(safe-area-inset-bottom, 0px));
    z-index: var(--z-sticky);
    /* Paper backing so fields never show through the bar (designer SHOULD, M2-04). */
    margin-inline: calc(-1 * var(--gutter));
    padding: var(--sp-3) var(--gutter) var(--sp-2);
    background: linear-gradient(to bottom, transparent, var(--bg) 35%);
  }
  .fields {
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
    display: grid;
    gap: var(--sp-5);
  }
  /* Sealed and unchanged: a grey, pressed-in button that reopens the page for editing. */
  .sealed-btn {
    --_bg: var(--surface-sunk);
    --_fg: var(--ink-muted);
    --_bd: color-mix(in srgb, var(--ink-muted) 35%, transparent);
    box-shadow: inset 0 2px 4px color-mix(in srgb, var(--ink) 12%, transparent);
  }
  /* Once sealed and unchanged, the bar stops floating so it never covers the reflection actions (designer-AC11). */
  .savebar.settled {
    position: static;
    background: none;
  }
  .reflect {
    scroll-margin-top: var(--sp-3);
  }
  .ledger::after {
    content: '';
    display: block;
    height: var(--sp-4);
  }
  .stale:focus {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .low {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
  }
  .past {
    display: grid;
    gap: var(--sp-3);
  }
  .stale {
    align-items: flex-start;
  }
  .stale-body {
    display: grid;
    gap: var(--sp-2);
    min-width: 0;
    flex: 1;
  }
  dl {
    margin: var(--sp-2) 0 0;
    display: grid;
    gap: var(--sp-1);
  }
  dt {
    font-weight: var(--fw-bold);
  }
  dd {
    margin: 0 0 var(--sp-2);
  }
  .theirs {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-family: inherit;
    padding: var(--sp-2);
    background: var(--surface);
    border-radius: var(--r-sm);
    max-height: 12rem;
    overflow: auto;
  }
  .bar {
    height: 44px;
    border-radius: var(--r-md);
    background: var(--surface-sunk);
  }
  .muted {
    color: var(--ink-muted);
  }
  .small {
    font-size: var(--fs-sm);
  }
</style>
