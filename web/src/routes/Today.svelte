<!--
  Today: "Prescriptions" (designer screens.md §1). Check-in → pool quests + weekly boss → outcomes.
  The server owns the date; this page never computes "today" itself (architect risk 8). It only uses the
  server's tz/rollover to notice that the day has turned and *refetch* (lib/dayRollover.ts).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { BossJson, Job, JobKind, QuestJson, TodayResponse } from '../../../server/src/api-types';
  import { api, ApiError, NetworkError, TimeoutError } from '../lib/api';
  import { failureCopy } from '../lib/http';
  import BalanceBadge from '../lib/components/BalanceBadge.svelte';
  import OfflineCard from '../lib/components/OfflineCard.svelte';
  import PhotoStrip from '../lib/components/PhotoStrip.svelte';
  import Quarantine from '../lib/components/Quarantine.svelte';
  import { ledger, setEconomy } from '../lib/economy.svelte';
  import { infoLineFor } from '../lib/ledgerRules';
  import { getInfoDismissed, setInfoDismissed } from '../lib/infoDismissed';
  import { COPY, fallbackNote, LET_GO_REASONS, type LetGoReason } from '../lib/copy';
  import { activeJob, jobStartedAt, onJobSettled, trackJob } from '../lib/jobs.svelte';
  import { bossFirst, toQuestView } from '../lib/questView';
  import {
    ENERGY_LABELS,
    Icon,
    HerbLoader,
    LanternScale,
    LOADING,
    FolioHeader,
    QuestCard,
    ScrollCard,
    Sticker,
    type Feedback,
    type QuestStatus,
    type RerollReason,
    type StickerEvent
  } from '../lib/theme';
  import { showToast } from '../lib/toast.svelte';
  import { notes } from '../lib/notes.svelte';
  import { dayHasRolled, formatUntil, nextRolloverAt, ROLLOVER_CHECK_MS } from '../lib/dayRollover';
  import { getCountdown } from '../lib/settings';

  let data = $state<TodayResponse | null>(null);
  /** Wall clock for the next-page line; ticks every COUNTDOWN_TICK_MS (it shows seconds). */
  let nowMs = $state(Date.now());
  const COUNTDOWN_TICK_MS = 1_000;
  const showCountdown = getCountdown() === 'on';
  const nextPageLine = $derived.by(() => {
    if (!showCountdown || !data) return null;
    const now = new Date(nowMs);
    if (dayHasRolled(data, now)) return COPY.freshPage; // turned over; the refetch is on its way
    const at = nextRolloverAt(now, data.tz, data.rollover_hour);
    return at ? COPY.countdownLine(data.rollover_hour, formatUntil(at.getTime() - nowMs)) : null;
  });
  let loading = $state(true);
  /** The first load couldn't reach the laptop (network failure or timeout): show the one offline card (H1 #299). */
  let unreachable = $state(false);
  /** `"<date>:<kind>"` of the dismissed info line (H1 #228), read once from the device. */
  let dismissed = $state<string | null>(getInfoDismissed());
  let energy = $state<number | null>(null);
  let submitting = $state(false);
  let busy = $state<Record<string, boolean>>({});
  /** Quest ids whose "let go" reason chips are open (psychologist-AC7). */
  let askReason = $state<Record<string, boolean>>({});
  let sticker = $state<{ event: StickerEvent; seed: string; caption: boolean } | null>(null);
  let stickerTimer: ReturnType<typeof setTimeout> | null = null;
  /** The daily quest whose swap job is running (in-card loader only, designer-AC12). */
  let rerollingId = $state<string | null>(null);
  /** Polite live-region text: announced once per event, never per poll (designer-AC2/4). */
  let live = $state('');

  const day = $derived(data?.day ?? null);
  const quests = $derived(day?.quests ?? []);
  const boss = $derived(data?.week?.boss ?? null);
  const genJob = $derived(activeJob('generate_day'));
  const generating = $derived(genJob !== null || (data?.jobs.some((j) => j.kind === 'generate_day') ?? false));
  const settledCount = $derived(quests.filter((q) => q.status !== 'open').length);
  const stampedCount = $derived(quests.filter((q) => q.status === 'done' || q.status === 'partial').length);
  const allSettled = $derived(quests.length > 0 && settledCount === quests.length);
  const weekLabel = $derived(data ? `Week ${Number(data.week_id.slice(6))}` : '');
  const energyLabel = $derived(day?.energy ? (ENERGY_LABELS[day.energy - 1] ?? '') : '');
  /** The banner shows only when AI was tried and the shelf stood in (designer-AC9), never on pool-by-design days. */
  const fellBack = $derived(typeof day?.generation?.fallback_reason === 'string');
  const canReroll = $derived((data?.rerolls_left ?? 0) > 0 && rerollingId === null && activeJob('reroll') === null);
  const bossPending = $derived(data?.boss_pending === true);
  const cpDone = $derived(boss?.checkpoints?.filter((c) => c.done).length ?? 0);
  const cpTotal = $derived(boss?.checkpoints?.length ?? 0);
  const econ = $derived(ledger.economy);
  /** One quiet info line at most, gone once today counts or once dismissed today (ledgerRules.infoLineFor, H1 #237). */
  const infoLine = $derived(
    data ? infoLineFor({ date: data.date, welcomeBack: data.welcome_back === true, day: data.day, econ, dismissed }) : null
  );

  function dismissInfo(key: string) {
    dismissed = key;
    setInfoDismissed(key);
  }

  async function load() {
    try {
      const res = await api.today();
      data = res.data;
      setEconomy(res.data.economy, res.data.date);
      notes.pending = res.data.pending_proposals;
      notes.profileEmpty = res.data.profile_empty;
      for (const j of res.data.jobs) trackJob(j);
      if (rerollingId && !res.data.jobs.some((j) => j.kind === 'reroll') && !activeJob('reroll')) rerollingId = null;
      unreachable = false;
    } catch (e) {
      if (e instanceof NetworkError) unreachable = data === null;
      else console.warn('[today] load', e);
    } finally {
      loading = false;
    }
  }

  function onSettled(job: Job | null, kind: JobKind) {
    if (kind === 'generate_day' && job?.status === 'succeeded') live = COPY.ready;
    if (kind === 'reroll') {
      const result = (job?.result ?? {}) as { result?: string; quest_id?: string; title?: string };
      if (job?.status === 'succeeded' && result.result === 'written' && result.quest_id) {
        flashSticker('reroll', result.quest_id);
        live = COPY.newPrescription(result.title ?? '');
      } else if (job?.status === 'failed') {
        showToast(COPY.rerollEmpty);
      }
      rerollingId = null;
    }
    void load();
  }

  onMount(() => {
    void load();
    const off = onJobSettled(onSettled);
    // A tab left open across 04:00 shows the new day when it comes back (architect-AC23); polling resumes.
    const vis = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', vis);
    // A page that stays open AND visible across the rollover never gets a visibilitychange: check the clock
    // every minute, and on focus / bfcache restore (iOS home-screen PWA), and refetch once the day turns.
    const checkRollover = () => {
      nowMs = Date.now();
      if (document.visibilityState === 'visible' && !loading && dayHasRolled(data, new Date())) void load();
    };
    const tick = setInterval(checkRollover, ROLLOVER_CHECK_MS);
    const countdownTick = setInterval(() => (nowMs = Date.now()), COUNTDOWN_TICK_MS);
    window.addEventListener('focus', checkRollover);
    window.addEventListener('pageshow', checkRollover);
    return () => {
      off();
      clearInterval(tick);
      clearInterval(countdownTick);
      window.removeEventListener('focus', checkRollover);
      window.removeEventListener('pageshow', checkRollover);
      document.removeEventListener('visibilitychange', vis);
      if (stickerTimer) clearTimeout(stickerTimer);
    };
  });

  function flashSticker(event: StickerEvent, seed: string, caption = false) {
    sticker = { event, seed, caption };
    if (stickerTimer) clearTimeout(stickerTimer);
    stickerTimer = setTimeout(() => (sticker = null), 4000);
  }

  async function handleMutationError(e: unknown) {
    if (e instanceof ApiError && ['not_today', 'not_this_week', 'not_found', 'generating'].includes(e.code)) {
      await load();
      return;
    }
    showToast(failureCopy(e));
    // A timed-out write may have landed: re-read so the cards show what's really on disk (H1 #273).
    if (e instanceof TimeoutError) void load();
  }

  async function checkin() {
    if (energy === null || submitting) return;
    submitting = true;
    try {
      const res = await api.checkin(energy);
      if (data) data.day = res.data.day;
      if (res.data.job) trackJob(res.data.job);
      await load();
    } catch (e) {
      await handleMutationError(e);
    } finally {
      submitting = false;
    }
  }

  async function retryGenerate() {
    submitting = true;
    try {
      const res = await api.generate();
      trackJob(res.data.job);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'already_generated') await load();
      else await handleMutationError(e);
    } finally {
      submitting = false;
    }
  }

  async function reroll(q: QuestJson, reason: RerollReason | null) {
    if (!canReroll) return;
    rerollingId = q.id;
    try {
      const res = await api.reroll(q.id, reason);
      trackJob(res.data.job);
    } catch (e) {
      rerollingId = null;
      if (e instanceof ApiError && e.status === 409) {
        await load();
        if (e.code !== 'generating') showToast(COPY.rerollEmpty);
      } else {
        await handleMutationError(e);
      }
    }
  }

  /**
   * Optimistic update of a daily quest or the boss; reverts on failure (designer impl-6). `photos` / `checkpointPhotos`
   * (boss only) send the target's whole photo list; the files were already uploaded by PhotoStrip.
   */
  async function patch(
    target: QuestJson | BossJson,
    change: {
      status?: QuestStatus;
      feedback?: Feedback;
      reason?: LetGoReason | null;
      checkpoint?: [number, boolean];
      photos?: string[];
      checkpointPhotos?: [number, string[]];
    }
  ) {
    if (!data) return;
    const id = target.id;
    const isBoss = id.endsWith('-boss');
    const snapshot = $state.snapshot(target) as QuestJson | BossJson;
    const target2 = isBoss ? data.week?.boss : data.day?.quests.find((q) => q.id === id);
    if (!target2) return;
    const status = change.status === 'failed' ? 'let_go' : change.status;
    if (status !== undefined) target2.status = status;
    if (change.feedback !== undefined) target2.feedback = change.feedback;
    if (change.checkpoint && 'checkpoints' in target2 && target2.checkpoints) {
      const cp = target2.checkpoints[change.checkpoint[0]];
      if (cp) cp.done = change.checkpoint[1];
    }
    if (isBoss && change.photos !== undefined) (target2 as BossJson).photos = [...change.photos];
    if (change.checkpointPhotos && 'checkpoints' in target2 && target2.checkpoints) {
      const cp = target2.checkpoints[change.checkpointPhotos[0]];
      if (cp) cp.photos = [...change.checkpointPhotos[1]];
    }
    if (status === 'done') flashSticker(isBoss ? 'boss_done' : 'quest_done', id, isBoss);
    if (status === 'let_go' && !isBoss) askReason[id] = true;
    if (status !== undefined && status !== 'let_go') askReason[id] = false;

    busy[id] = true;
    try {
      const checkpoints = [
        ...(change.checkpoint ? [{ index: change.checkpoint[0], done: change.checkpoint[1] }] : []),
        ...(change.checkpointPhotos ? [{ index: change.checkpointPhotos[0], photos: change.checkpointPhotos[1] }] : [])
      ];
      const body = {
        ...(status !== undefined ? { status } : {}),
        ...(change.feedback !== undefined ? { feedback: change.feedback } : {}),
        ...(change.reason !== undefined ? { reason: change.reason } : {}),
        ...(change.photos !== undefined ? { photos: change.photos } : {}),
        ...(checkpoints.length ? { checkpoints } : {})
      };
      const before = ledger.economy?.balance ?? null;
      const res = await api.patchQuest(id, body);
      const bonus = setEconomy(res.data.economy, data?.date);
      if (res.data.changed) react(res.data.quest, status, change.checkpoint, before, res.data.economy.balance, bonus);
      else if (sticker?.seed === id) sticker = null; // a duplicate/retried request never replays a reaction
      if (data) {
        data.earned_today = res.data.earned_today;
        if (isBoss && data.week) data.week.boss = res.data.quest as BossJson;
        else if (data.day) {
          const i = data.day.quests.findIndex((q) => q.id === id);
          if (i >= 0) data.day.quests[i] = res.data.quest as QuestJson;
        }
      }
    } catch (e) {
      // Revert to what the card showed before the tap.
      if (data) {
        if (isBoss && data.week) data.week.boss = snapshot as BossJson;
        else if (data.day) {
          const i = data.day.quests.findIndex((q) => q.id === id);
          if (i >= 0) data.day.quests[i] = snapshot as QuestJson;
        }
      }
      if (status === 'let_go') askReason[id] = false;
      await handleMutationError(e);
    } finally {
      busy[id] = false;
    }
  }

  /**
   * One reaction per action (psychologist-AC20/21): the number announced is the server's. Priority: streak
   * bonus > boss done > quest done. Only for `changed:true` responses (architect-AC4).
   */
  function react(
    q: QuestJson | BossJson,
    status: QuestStatus | undefined,
    checkpoint: [number, boolean] | undefined,
    before: number | null,
    after: number | null,
    bonus: boolean
  ) {
    const earned = typeof q.earned === 'number' ? q.earned : 0;
    const isBoss = q.id.endsWith('-boss');
    if (status === 'done') live = isBoss ? COPY.bossSealed(earned) : COPY.questDone(earned);
    else if (status === 'partial' && !isBoss) live = COPY.questPartial(earned);
    else if (checkpoint?.[1] && before !== null && after !== null && after > before) live = COPY.checkpointEarned(after - before);
    if (bonus && econ) {
      showToast(COPY.streakBonus(econ.bonus_today));
      flashSticker('streak', q.id);
    }
  }

  async function chooseReason(q: QuestJson, reason: LetGoReason) {
    askReason[q.id] = false;
    await patch(q, { reason });
  }
</script>

<svelte:head><title>Today · Quest Journal</title></svelte:head>

{#if data}
  <FolioHeader date={data.date} week={weekLabel} eyebrow={`${data.weekday}'s prescriptions`}>
    {#snippet trailing()}
      <BalanceBadge announce={null} />
    {/snippet}
    {#if nextPageLine}<p class="next-page">{nextPageLine}</p>{/if}
  </FolioHeader>
  {#if data.profile_empty && !notes.inviteDismissed}
    <!-- One quiet, dismissible line; never a modal or a redirect (designer-AC8, autonomy). -->
    <p class="invite small">
      <span>{COPY.inviteLine}</span>
      <a class="qj-textlink" href="/onboarding">→ {COPY.inviteLink}</a>
      <button type="button" class="qj-btn qj-btn--quiet qj-btn--sm" onclick={() => (notes.inviteDismissed = true)}>{COPY.inviteDismiss}</button>
    </p>
  {/if}
  {#if infoLine}
    {@const key = infoLine.key}
    <p class="qj-banner qj-banner--info info-line">
      <span>{infoLine.text}</span>
      <button type="button" class="qj-btn qj-btn--quiet qj-btn--sm" onclick={() => dismissInfo(key)}>{COPY.dismiss}</button>
    </p>
  {/if}
  {#if econ && !data.welcome_back && econ.days_logged > 0}
    <!-- Count-up numbers first; the streak only from 2, never a 0 or a countdown (psychologist-AC12, designer-AC7). -->
    <div class="ledger-lines">
      <p class="ledger-line">
        <Icon name="plum-blossom" size="1em" />
        <span>{COPY.countUp(econ.quests_done, econ.days_logged)}</span>
      </p>
      {#if econ.streak >= 2}
        <p class="ledger-line streak">
          <span>{COPY.streakLine(econ.streak)}</span>
          {#if econ.freeze_tokens > 0}
            <span class="herbs" role="img" aria-label={COPY.herbs(econ.freeze_tokens)} title={COPY.herbsHint}>
              {#each Array.from({ length: econ.freeze_tokens }, (_, i) => i) as i (i)}<Icon name="herb-sprig" size="1em" />{/each}
            </span>
          {/if}
        </p>
      {/if}
    </div>
  {/if}
{:else if unreachable && !loading}
  <!-- No date without the server: a plain header, then the one offline card (H1 #299). -->
  <h1 class="offline-title" tabindex="-1">{COPY.todayTitle}</h1>
{:else}
  <h1 class="qj-sr-only" tabindex="-1">Today</h1>
{/if}

<!-- The event sticker sits in the right gutter of the card that triggered it, never over buttons (designer M3/M5). -->
{#snippet anchored(id: string)}
  {#if sticker && sticker.seed === id}
    <div class="sticker" aria-hidden="true">
      {#key sticker.seed + sticker.event}
        <Sticker event={sticker.event} seed={sticker.seed} size={48} caption={false} />
      {/key}
    </div>
  {/if}
{/snippet}

{#snippet bossCard()}
  {#if bossPending}
    <!-- The AI may still replace this week's untouched placeholder: never swap a card under the thumb (G23). -->
    <section class="boss" aria-label="Weekly prescription">
      <ScrollCard variant="boss" rods>
        <HerbLoader size="sm" message={LOADING.boss} phases={[]} />
      </ScrollCard>
    </section>
  {:else if boss}
    <section class="boss" aria-label="Weekly prescription">
      {@render anchored(boss.id)}
      <QuestCard
        quest={toQuestView(boss)}
        headingLevel={2}
        allowPartial
        letGoStatus="let_go"
        busy={busy[boss.id] ?? false}
        onstatus={(s) => boss && patch(boss, { status: s })}
        onfeedback={(f) => boss && patch(boss, { feedback: f })}
        oncheckpoint={(i, done) => boss && patch(boss, { checkpoint: [i, done] })}
      >
        {#snippet extra()}
          <!-- Proof / progress photos for the whole week (stored on the laptop only, never committed). -->
          <PhotoStrip
            photos={boss?.photos}
            label={COPY.photosBoss}
            busy={boss ? (busy[boss.id] ?? false) : false}
            onchange={(next) => (boss ? patch(boss, { photos: next }) : undefined)}
          />
        {/snippet}
        {#snippet checkpointExtra(i: number)}
          <!-- Optional, unobtrusive: a small camera button; thumbnails only once the checkpoint has photos. -->
          <PhotoStrip
            compact
            photos={boss?.checkpoints?.[i]?.photos}
            label={COPY.photosCheckpoint(boss?.checkpoints?.[i]?.text ?? '')}
            busy={boss ? (busy[boss.id] ?? false) : false}
            onchange={(next) => (boss ? patch(boss, { checkpointPhotos: [i, next] }) : undefined)}
          />
        {/snippet}
        {#snippet note()}
          {#if day?.energy === 1 && boss?.status === 'open'}<p class="paused">{COPY.bossPaused}</p>{/if}
          {#if cpTotal > 0}<p>{COPY.bossProgress(cpDone, cpTotal)}</p>{/if}
          {#if boss?.status === 'open' && cpTotal > 0 && cpDone === cpTotal}
            <p class="seal-offer">
              {COPY.bossSealOffer(cpTotal)}
              <button
                class="qj-btn qj-btn--sm"
                type="button"
                disabled={busy[boss.id] ?? false}
                onclick={() => boss && patch(boss, { status: 'done' })}>{COPY.bossSealButton}</button
              >
            </p>
          {/if}
          {#if boss?.status === 'done'}<p>{COPY.bossSealed(boss.earned ?? 100)}</p>{/if}
        {/snippet}
      </QuestCard>
    </section>
  {:else if data?.week_error}
    <Quarantine problem={data.week_error} />
  {/if}
{/snippet}

{#if unreachable && !data && !loading}
  <OfflineCard
    busy={loading}
    onretry={() => {
      loading = true;
      void load();
    }}
  />
{:else if loading && !data}
  <div class="ghosts" aria-hidden="true">
    {#each [1, 2, 3] as i (i)}
      <ScrollCard variant="quiet" rods={false}><div class="bar"></div><div class="bar short"></div></ScrollCard>
    {/each}
  </div>
{:else if data}
  {#if data.day_error}
    <Quarantine problem={data.day_error} />
    {@render bossCard()}
  {:else if data.needs_checkin}
    <ScrollCard unroll>
      {#snippet heading()}<h2>{COPY.checkinHeading}</h2>{/snippet}
      <LanternScale bind:value={energy} legend={COPY.checkinPrompt} disabled={submitting} />
      <button
        class="qj-btn qj-btn--primary qj-btn--block"
        type="button"
        disabled={energy === null || submitting}
        onclick={checkin}>{COPY.checkinButton}</button
      >
    </ScrollCard>
    {@render bossCard()}
  {:else if generating}
    <ScrollCard>
      {#key genJob?.id ?? 'pending'}
        <HerbLoader message={LOADING.generate} startedAt={jobStartedAt(genJob)} />
      {/key}
      {#if energyLabel}<p class="muted">{COPY.energyShown(energyLabel)}</p>{/if}
      <div class="sticker-sm"><Sticker event="loading" seed={data.date} size={72} /></div>
    </ScrollCard>
    <div class="ghosts" aria-hidden="true">
      {#each [1, 2, 3] as i (i)}
        <ScrollCard variant="quiet" rods={false}><div class="bar"></div><div class="bar short"></div></ScrollCard>
      {/each}
    </div>
    {@render bossCard()}
  {:else if data.needs_generation}
    <ScrollCard variant="alert">
      {#snippet heading()}<h2>{COPY.noQuestsTitle}</h2>{/snippet}
      <p class="muted">{COPY.noQuestsDetail}</p>
      <button class="qj-btn qj-btn--primary" type="button" disabled={submitting} onclick={retryGenerate}>{COPY.tryAgain}</button>
    </ScrollCard>
    {@render bossCard()}
  {:else}
    {#if bossFirst(data.weekday)}{@render bossCard()}{/if}

    {#if fellBack}<p class="qj-banner qj-banner--fallback">{fallbackNote(String(day?.generation?.fallback_reason))}</p>{/if}

    <div class="list-wrap">
      <ol class="quests" aria-label="Today's prescriptions">
        {#each quests as q, qi (q.id)}
          <li class="quest-item">
            {@render anchored(q.id)}
            <QuestCard
              quest={toQuestView(q)}
              index={qi}
              allowPartial
              letGoStatus="let_go"
              busy={busy[q.id] ?? false}
              showCoins={q.status !== 'let_go'}
              canReroll={canReroll && q.status === 'open'}
              rerolling={rerollingId === q.id}
              onstatus={(s) => patch(q, { status: s })}
              onfeedback={(f) => patch(q, { feedback: f })}
              onreroll={(r) => reroll(q, r)}
            />
            {#if q.status === 'let_go' && askReason[q.id]}
              <div class="reasons" role="group" aria-label={COPY.letGoWhy}>
                <p class="small">{COPY.letGoAfter} <span class="muted">{COPY.letGoWhy}</span></p>
                {#each LET_GO_REASONS as r (r.id)}
                  <button class="qj-chip" type="button" onclick={() => chooseReason(q, r.id)}>{r.label}</button>
                {/each}
                <button class="qj-btn qj-btn--quiet qj-btn--sm" type="button" onclick={() => (askReason[q.id] = false)}>Skip</button>
              </div>
            {/if}
          </li>
        {/each}
      </ol>
    </div>

    {#if allSettled}
      <ScrollCard variant="quiet" rods={false}>
        <p>{COPY.allSettled}</p>
        <a class="qj-btn qj-btn--primary" href="/evening">{COPY.toEvening}</a>
      </ScrollCard>
    {/if}

    {#if !bossFirst(data.weekday)}{@render bossCard()}{/if}
  {/if}

  <p class="qj-sr-only" aria-live="polite">{live}</p>

  <footer class="day-footer">
    {#if stampedCount > 0}<p>{COPY.stampedToday(stampedCount)}{#if (econ?.earned_today ?? 0) > 0} · <span class="tabular">{COPY.earnedToday(econ?.earned_today ?? 0)}</span>{/if}</p>{/if}
    {#if !allSettled}<a class="footer-link" href="/evening">{COPY.eveningLink}</a>{/if}
  </footer>
{/if}

<style>
  .next-page {
    margin: var(--sp-1) 0 0;
    color: var(--ink-muted);
    font-size: var(--fs-sm);
    font-variant-numeric: tabular-nums;
  }
  .offline-title {
    margin: 0 0 var(--sp-3);
  }
  .invite {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-1) var(--sp-2);
    margin: 0;
    color: var(--ink-muted);
    font-size: var(--fs-sm);
  }
  .quests {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: var(--sp-4);
  }
  .list-wrap {
    position: relative;
  }
  .quest-item {
    position: relative;
  }
  /* over the entry's margin column (decorative brush labels), never over the 済 seal, text or buttons */
  .sticker {
    position: absolute;
    top: var(--sp-8);
    left: -14px;
    z-index: var(--z-seal);
    pointer-events: none;
  }
  .boss {
    position: relative;
  }
  .ledger-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-1) var(--sp-2);
    margin: 0;
    color: var(--ink-muted);
    font-size: var(--fs-sm);
    font-variant-numeric: tabular-nums;
  }
  .ledger-lines {
    display: grid;
    gap: 2px;
  }
  .ledger-line.streak {
    padding-left: calc(1em + var(--sp-2));
    font-size: var(--fs-xs);
  }
  .herbs {
    display: inline-flex;
    gap: 2px;
    color: var(--jade);
  }
  .info-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
  }
  .sticker-sm {
    display: flex;
    justify-content: flex-end;
  }
  .boss {
    display: grid;
    gap: var(--sp-2);
  }
  .seal-offer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2);
    color: var(--ink);
  }
  .paused {
    margin: 0;
    padding: var(--sp-2) var(--sp-3);
    border-radius: var(--r-md);
    background: var(--surface-sunk);
    color: var(--ink);
    font-size: var(--fs-sm);
  }
  .reasons {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2);
    margin-top: var(--sp-2);
    padding: var(--sp-3);
    border-radius: var(--r-md);
    background: var(--surface-sunk);
  }
  .reasons p {
    width: 100%;
  }
  .ghosts {
    display: grid;
    gap: var(--sp-4);
  }
  .bar {
    height: 14px;
    border-radius: var(--r-sm);
    background: var(--surface-sunk);
  }
  .bar.short {
    width: 60%;
  }
  .day-footer {
    display: grid;
    gap: var(--sp-2);
    justify-items: start;
    color: var(--ink-muted);
  }
  /* M2 BUG-5: the brief's ≥44 px tap target for the inline link. */
  .footer-link {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding-inline: var(--sp-1);
    margin-inline: calc(-1 * var(--sp-1));
  }
  .muted {
    color: var(--ink-muted);
  }
  .small {
    font-size: var(--fs-sm);
  }
</style>
