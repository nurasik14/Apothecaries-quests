<!--
  Onboarding: "Entering the Inner Court" (designer screens §6, designer-AC1–7, psychologist-AC1–5).
  Full screen, no tab bar. One question per screen; every question is skippable. Claude drafts the notes,
  the user edits them as PLAIN TEXT and saves. The job never writes profile.md; only "Save my notes" does,
  with the ETag loaded before the quiz started (a hand edit meanwhile → 412, never a silent overwrite).
-->
<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import type { Job, OnboardingResult } from '../../../server/src/api-types';
  import { api, ApiError, NetworkError } from '../lib/api';
  import { COPY, ONBOARDING_QUESTIONS, PROFILE_TEMPLATE } from '../lib/copy';
  import { failureCopy } from '../lib/http';
  import { jobStartedAt, jobs, onJobSettled, trackJob } from '../lib/jobs.svelte';
  import { notes } from '../lib/notes.svelte';
  import {
    answerPairs,
    clearOnboarding,
    freshState,
    loadOnboarding,
    ownKey,
    saveOnboarding,
    type OnboardingState
  } from '../lib/onboarding.svelte';
  import { router } from '../lib/router.svelte';
  import { HerbLoader, LOADING, PAGE_KANJI, PageTitle, Photo, ScrollCard, Sticker } from '../lib/theme';
  import { showToast } from '../lib/toast.svelte';

  const QS = ONBOARDING_QUESTIONS;
  let st = $state<OnboardingState>(loadOnboarding());
  let saving = $state(false);
  let stale = $state(false);
  let unreachable = $state(false);
  let h2 = $state<HTMLElement | null>(null);
  let staleEl = $state<HTMLElement | null>(null);

  const q = $derived(QS[Math.min(st.step, QS.length - 1)]!);
  const last = $derived(st.step >= QS.length - 1);
  const draftJob = $derived(jobs.byKind.onboarding ?? null);

  // Persist every change (one key, cleared on save / start over).
  $effect(() => {
    saveOnboarding($state.snapshot(st) as OnboardingState);
  });

  async function loadBase() {
    if (st.baseEtag !== null) return;
    try {
      const r = await api.profile();
      st.baseEtag = r.etag ?? r.data.etag;
      st.hadProfile = !r.data.empty;
    } catch (e) {
      unreachable = e instanceof NetworkError;
    }
  }

  function settle(job: Job | null) {
    if (st.mode !== 'drafting') return;
    if (job && job.id !== st.jobId) return;
    if (job?.status === 'succeeded') {
      const res = job.result as OnboardingResult | undefined;
      st.draft = res?.draft ?? PROFILE_TEMPLATE;
      st.mode = 'editing';
      st.jobId = null;
    } else {
      // failed, or gone after a server restart (404): answers stay, offer Try again / write it myself
      st.mode = 'failed';
      st.jobId = null;
    }
  }

  const off = onJobSettled((job, kind) => {
    if (kind === 'onboarding') settle(job);
  });
  onDestroy(off);

  onMount(() => {
    void loadBase();
    // Resume a draft job after navigation or a reload (keyed on the job id, designer-AC5).
    if (st.mode === 'drafting' && st.jobId) {
      const known = jobs.byKind.onboarding;
      if (known && known.id === st.jobId) {
        if (known.status === 'succeeded' || known.status === 'failed') settle(known);
      } else {
        api.job(st.jobId).then(
          (r) => trackJob(r.data),
          () => settle(null)
        );
      }
    }
    void focusHeading();
  });

  async function focusHeading() {
    await tick();
    h2?.focus({ preventScroll: true });
  }

  function go(delta: number) {
    st.step = Math.max(0, Math.min(QS.length - 1, st.step + delta));
    void focusHeading();
  }

  function next() {
    if (last) void ask();
    else go(1);
  }

  function skip() {
    delete st.answers[q.id];
    delete st.answers[ownKey(q.id)];
    next();
  }

  function setText(v: string) {
    st.answers[q.id] = v;
  }
  function toggleMulti(opt: string) {
    const cur = Array.isArray(st.answers[q.id]) ? (st.answers[q.id] as string[]) : [];
    st.answers[q.id] = cur.includes(opt) ? cur.filter((o) => o !== opt) : [...cur, opt];
  }

  async function ask() {
    st.mode = 'drafting';
    try {
      const r = await api.onboardingDraft(answerPairs(QS, $state.snapshot(st.answers) as Record<string, string | string[]>));
      st.jobId = r.data.job.id;
      trackJob(r.data.job);
    } catch {
      st.mode = 'failed';
    }
  }

  function writeMyself() {
    st.draft = PROFILE_TEMPLATE;
    st.mode = 'editing';
  }

  function startOver() {
    clearOnboarding();
    st = freshState();
    stale = false;
    void loadBase();
    void focusHeading();
  }

  async function save() {
    if (saving || st.draft === null) return;
    saving = true;
    try {
      await api.saveProfile(st.draft, st.baseEtag ?? '*');
      clearOnboarding();
      notes.profileEmpty = false;
      showToast(COPY.draftSaved);
      router.go('/');
    } catch (e) {
      if (e instanceof ApiError && e.status === 412) {
        // Keep the text; the next tap replaces the newer page on purpose (same pattern as Evening).
        const cur = e.details.current_etag;
        st.baseEtag = typeof cur === 'string' ? cur : '*';
        st.hadProfile = true;
        stale = true;
        await tick();
        staleEl?.scrollIntoView({ block: 'start' });
        staleEl?.focus({ preventScroll: true });
      } else {
        showToast(failureCopy(e));
      }
    } finally {
      saving = false;
    }
  }

  const value = $derived(st.answers[q.id]);
  const own = $derived(st.answers[ownKey(q.id)]);
</script>

<svelte:head><title>Welcome · Quest Journal</title></svelte:head>

<div class="ob">
  <header class="hero">
    <div class="photo" aria-hidden="true"><Photo name="hero-consorts" position="30% 30%" loading="eager" /></div>
    <div class="intro">
      <PageTitle kanji={PAGE_KANJI.onboarding}><h1 tabindex="-1">{COPY.onboardingTitle}</h1></PageTitle>
      <p>{COPY.onboardingIntro}</p>
    </div>
    {#if st.mode === 'quiz'}
      <div class="sticker"><Sticker event="idle" seed="onboarding" size={72} /></div>
    {/if}
  </header>

  {#if unreachable}<p class="qj-banner qj-banner--info">{COPY.offline}</p>{/if}

  {#if st.mode === 'quiz'}
    <ScrollCard>
      {#snippet heading()}
        <p class="progress small muted" role="progressbar" aria-valuemin="1" aria-valuemax={QS.length} aria-valuenow={st.step + 1}>
          {COPY.onboardingProgress(st.step + 1, QS.length)}
        </p>
        <h2 tabindex="-1" bind:this={h2} id="q-h">{q.text}</h2>
      {/snippet}
      {#key q.id}
        {#if q.kind === 'short'}
          <label class="qj-sr-only" for="q-in">{q.text}</label>
          <input id="q-in" class="qj-input" maxlength="1000" value={typeof value === 'string' ? value : ''} oninput={(e) => setText(e.currentTarget.value)} />
        {:else if q.kind === 'long'}
          <label class="qj-sr-only" for="q-in">{q.text}</label>
          <textarea id="q-in" class="qj-textarea" rows="5" maxlength="1000" value={typeof value === 'string' ? value : ''} oninput={(e) => setText(e.currentTarget.value)}
          ></textarea>
        {:else if q.kind === 'likert' || q.kind === 'choice'}
          <div class="chips" role="radiogroup" aria-labelledby="q-h">
            {#each q.options ?? COPY.likert as opt (opt)}
              <label class="qj-chip">
                <input class="qj-sr-only" type="radio" name={`q-${q.id}`} value={opt} checked={value === opt} onchange={() => setText(opt)} />
                {opt}
              </label>
            {/each}
          </div>
        {:else}
          <div class="chips" role="group" aria-labelledby="q-h">
            {#each q.options ?? [] as opt (opt)}
              <button type="button" class="qj-chip" aria-pressed={Array.isArray(value) && value.includes(opt)} onclick={() => toggleMulti(opt)}>{opt}</button>
            {/each}
          </div>
          <div class="qj-field own">
            <label class="qj-label" for="q-own">{COPY.onboardingOwn}</label>
            <input
              id="q-own"
              class="qj-input"
              maxlength="500"
              placeholder={COPY.onboardingOwnPlaceholder}
              value={typeof own === 'string' ? own : ''}
              oninput={(e) => {
                const v = e.currentTarget.value;
                if (v.trim()) st.answers[ownKey(q.id)] = v;
                else delete st.answers[ownKey(q.id)];
              }}
            />
          </div>
        {/if}
      {/key}
    </ScrollCard>
    <div class="spacer" aria-hidden="true"></div>
    <div class="footer">
      <button type="button" class="qj-btn qj-btn--quiet qj-btn--sm" disabled={st.step === 0} onclick={() => go(-1)}>{COPY.onboardingBack}</button>
      <button type="button" class="qj-btn qj-btn--quiet qj-btn--sm" onclick={skip}>{COPY.onboardingSkip}</button>
      {#if last}
        <button type="button" class="qj-btn qj-btn--seal" onclick={next}>{COPY.onboardingAsk}</button>
      {:else}
        <button type="button" class="qj-btn" onclick={next}>{COPY.onboardingNext}</button>
      {/if}
    </div>
    {#if Object.keys(st.answers).length}
      <p class="small"><button type="button" class="qj-btn qj-btn--quiet qj-btn--sm" onclick={startOver}>{COPY.onboardingStartOver}</button></p>
    {/if}
  {:else if st.mode === 'drafting'}
    {#key st.jobId}
      <HerbLoader
        message={LOADING.onboarding}
        phases={[{ afterMs: 15_000, text: LOADING.slow }]}
        startedAt={jobStartedAt(draftJob)}
      />
    {/key}
    <p class="small muted">{COPY.onboardingKeep}</p>
  {:else if st.mode === 'failed'}
    <ScrollCard>
      <p>{COPY.onboardingFailed}</p>
      <div class="row">
        <button type="button" class="qj-btn" onclick={ask}>{COPY.onboardingTryAgain}</button>
        <button type="button" class="qj-btn qj-btn--quiet" onclick={writeMyself}>{COPY.onboardingSelf}</button>
      </div>
      <p><button type="button" class="qj-btn qj-btn--quiet qj-btn--sm" onclick={() => ((st.mode = 'quiz'), void focusHeading())}>{COPY.draftBackToQuiz}</button></p>
    </ScrollCard>
  {:else}
    {#if stale}
      <section class="qj-banner qj-banner--info stale" tabindex="-1" bind:this={staleEl} aria-live="polite">
        <p>{COPY.draftStale}</p>
      </section>
    {/if}
    <div class="qj-field editor">
      <label class="qj-label" for="draft">{COPY.draftLabel}</label>
      <span class="qj-hint" id="draft-hint">{COPY.draftHint}</span>
      <textarea id="draft" class="qj-textarea" aria-describedby="draft-hint" maxlength="20000" bind:value={st.draft}></textarea>
    </div>
    <div class="spacer" aria-hidden="true"></div>
    <div class="footer footer--save">
      {#if st.hadProfile}<p class="small muted replaces">{COPY.draftReplaces}</p>{/if}
      <button type="button" class="qj-btn qj-btn--block" disabled={saving || !st.draft?.trim()} onclick={save}>
        {saving ? COPY.draftSaving : COPY.draftSave}
      </button>
    </div>
    <p class="small"><button type="button" class="qj-btn qj-btn--quiet qj-btn--sm" onclick={startOver}>{COPY.onboardingStartOver}</button></p>
  {/if}
</div>

<style>
  .ob {
    display: grid;
    gap: var(--sp-4);
    padding-bottom: var(--sp-4);
  }
  .hero {
    position: relative;
    display: grid;
    gap: var(--sp-3);
  }
  .photo {
    height: 9rem;
    border-radius: var(--r-md);
    overflow: hidden;
    background: var(--surface-sunk);
  }
  .photo :global(img),
  .photo :global(svg) {
    width: 100%;
    height: 100%;
  }
  .intro h1 {
    margin: 0;
  }
  .intro p {
    margin: var(--sp-1) 0 0;
  }
  .sticker {
    position: absolute;
    right: var(--sp-2);
    top: var(--sp-2);
    pointer-events: none;
  }
  .progress {
    margin: 0;
  }
  h2 {
    margin: var(--sp-1) 0 0;
    font-size: var(--fs-lg);
  }
  .chips,
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }
  .own {
    margin-top: var(--sp-3);
  }
  .footer {
    position: sticky;
    bottom: 0;
    z-index: var(--z-sticky);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
    margin-inline: calc(-1 * var(--gutter));
    padding: var(--sp-3) var(--gutter) calc(var(--sp-3) + env(safe-area-inset-bottom, 0px));
    background: linear-gradient(to bottom, transparent, var(--bg) 30%);
  }
  .footer .qj-btn {
    max-width: 100%;
  }
  .footer--save {
    display: grid;
  }
  .replaces {
    margin: 0;
  }
  .spacer {
    height: var(--sp-2);
  }
  .editor textarea {
    min-height: 55vh;
  }
  .stale:focus {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .small {
    font-size: var(--fs-sm);
  }
  .muted {
    color: var(--ink-muted);
  }
</style>
