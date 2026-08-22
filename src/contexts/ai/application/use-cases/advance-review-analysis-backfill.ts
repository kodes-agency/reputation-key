import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import type {
  ReviewAnalysisBackfillContext,
  ReviewAnalysisBackfillRun,
  ReviewAnalysisBackfillSession,
  ReviewAnalysisBackfillStorePort,
} from '../ports/ai-review-analysis-backfill.port'
import type { AiPropertyAggregateStorePort } from '../ports/ai-property-aggregate-store.port'
import type { AiReviewEventStorePort } from '../ports/ai-review-event-store.port'
import type { PropertyProcessingProfilePort } from '../ports/property-processing-profile.port'
import { AI_ANALYSIS_OPERATION_HORIZON_MILLIS } from './analyze-review-event'

/**
 * Drive an open `ops:ai-reanalyze` run one review further.
 *
 * ── Why a run advances one review at a time ──
 *
 * `storeAnalysis` refuses unless `review_ai_analysis_heads.head_sequence` still
 * EQUALS the sequence being stored: the analysis plane must be caught up with
 * the allocator before an analysis may be written. A batch that allocates
 * `H+1 … H+N` in one transaction moves the head to `H+N` before the first event
 * is ever consumed, so `H+1 … H+N-1` can never be stored — they answer
 * `generation_changed`, the dispatcher writes an `obsolete` receipt, redelivery
 * stops, and the operation is left `executing` with the provider already paid.
 * That is exactly what `--batch-size 5` did on the closed beta: five provider
 * calls, one analysis, four stranded operations.
 *
 * So the next sequence is allocated only once its predecessor has settled. One
 * event is in flight per property at any moment, which makes ORDERED DELIVERY
 * structural instead of a promise the dispatcher cannot keep: there is nothing
 * to interleave, no `gap` to retry through, and `head_sequence` always equals
 * the sequence being stored.
 *
 * ── Why this cannot be a loop in the ops command ──
 *
 * The whole batch must land inside ONE `review_analysis_epoch`.
 * `ai_property_aggregate_heads` and `ai_property_daily_aggregates` are
 * epoch-keyed and reads pin to the enablement's CURRENT epoch, so N sequential
 * one-review invocations would bump the epoch N times and leave N-1 epochs of
 * analyses that no read can ever reach. The run row carries the epoch, so every
 * item it emits lands in the epoch the command opened.
 *
 * ── Termination ──
 *
 * Every branch below either advances the run or closes it. A run is never left
 * waiting on something that cannot arrive:
 *   - the in-flight item settles (`ready` or `terminal_no_result`) — the normal
 *     case, including a legitimate terminal settle (no text, expired,
 *     `policy_disabled`), which advances the run exactly like a stored analysis;
 *   - provider rate limiting keeps the item `pending` and the run WAITING, which
 *     is correct: the dispatcher is still retrying it, and the domain's own
 *     15-minute operation horizon terminal-settles it if it never succeeds;
 *   - an item still `pending` past the recovery horizon is unreachable — its
 *     redelivery has stopped — so this terminal-settles it, counts it, and moves
 *     on rather than halting the run at a review that can never answer;
 *   - the fence (property, enablement, epoch, watermark) moving under the run
 *     closes it `superseded`, because replaying into a generation nothing reads
 *     is worse than stopping.
 */
export type AdvanceReviewAnalysisBackfillOutcome =
  /** No run is open on this property. */
  | 'idle'
  /** The in-flight item has not settled yet; nothing to do. */
  | 'waiting'
  /** The next item was allocated and emitted. */
  | 'emitted'
  /** A pinned review was no longer eligible and cost the run no sequence. */
  | 'skipped'
  /** An unreachable item was terminal-settled so the run could proceed. */
  | 'recovered'
  | 'completed'
  | 'superseded'
  /** The in-flight item never reached the cursor, so the run cannot step past it. */
  | 'stalled'

/**
 * How long an emitted item may sit `pending` before it is treated as
 * unreachable. Twice the domain's own operation horizon: `analyze-review-event`
 * terminal-settles at the horizon on any redelivery, and (with the corrected
 * predicate) the execution reaper fences an abandoned execution on the same
 * clock — so past 2x nothing legitimate is still working on this sequence, and
 * the only reason it is still `pending` is that redelivery has stopped.
 */
export const AI_BACKFILL_ITEM_RECOVERY_MILLIS = 2 * AI_ANALYSIS_OPERATION_HORIZON_MILLIS

/** Runs the sweep drives per tick. */
export const AI_BACKFILL_SWEEP_BATCH_SIZE = 50

/**
 * Advances one property makes per sweep tick. Skipping ineligible reviews and
 * recovering an unreachable item are bookkeeping, not work, so a run whose tail
 * is all skips must not need one tick per skip — but the loop stays bounded so
 * one property can never monopolise the tick.
 */
const MAX_STEPS_PER_PROPERTY = 64

export type AdvanceReviewAnalysisBackfillDependencies = Readonly<{
  backfillStore: ReviewAnalysisBackfillStorePort
  reviewEvents: AiReviewEventStorePort
  aggregates: AiPropertyAggregateStorePort
  /**
   * The profile version the epoch's aggregate series is keyed by — the same
   * source `analyze-review-event` reads. A recovery settle must target the same
   * head the analyses did, or it would advance a series nothing reads.
   */
  processingProfiles: PropertyProcessingProfilePort
  nowEpochMillis: () => number
}>

export type AdvanceReviewAnalysisBackfillSweepResult = Readonly<{
  runsVisited: number
  itemsEmitted: number
  itemsSkipped: number
  itemsRecovered: number
  runsCompleted: number
  runsSuperseded: number
  runsStalled: number
  batchFull: boolean
}>

export type AdvanceReviewAnalysisBackfill = Readonly<{
  /** Drive the run on one property as far as one call safely can. */
  advanceProperty: (
    input: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
  ) => Promise<AdvanceReviewAnalysisBackfillOutcome>
  /** Bounded scan over every open run — the chain's safety net. */
  sweep: () => Promise<AdvanceReviewAnalysisBackfillSweepResult>
}>

/** The fence this run was opened against, or the reason it no longer holds. */
function supersessionReason(
  run: ReviewAnalysisBackfillRun,
  context: ReviewAnalysisBackfillContext,
): string | null {
  if (!context.propertyActive) return 'property_inactive'
  if (context.propertySourceEpoch !== run.sourceEpoch) return 'source_epoch_changed'
  const enablement = context.enablement
  if (enablement === null) return 'authorization_absent'
  if (enablement.state !== 'enabled') return 'authorization_not_enabled'
  if (!enablement.capabilities.includes('review_analysis')) {
    return 'review_analysis_not_authorized'
  }
  if (enablement.authorizedSourceEpoch !== context.propertySourceEpoch) {
    return 'authorized_source_epoch_stale'
  }
  if (enablement.reviewAnalysisEpoch !== run.reviewAnalysisEpoch) {
    // A later backfill, or a merchant consent change, opened a new epoch. Every
    // item this run still owes would land where no read follows.
    return 'review_analysis_epoch_changed'
  }
  if (enablement.analysisStartSequence !== run.analysisStartSequence) {
    return 'analysis_start_sequence_changed'
  }
  return null
}

/**
 * Allocate the next sequence, repoint the review and emit its event — the same
 * three-in-one-transaction step `ops:ai-reanalyze` performs for the first item.
 * Exported so the command and the sweep cannot drift apart.
 */
export async function emitRunItem(
  session: ReviewAnalysisBackfillSession,
  input: Readonly<{
    runId: string
    reviewId: ReviewId
    sourceEpoch: number
    sourceRevision: number
    correlationId: string
    occurredAt: Date
  }>,
): Promise<number> {
  const analysisSequence = await session.allocateAnalysisSequence()
  await session.emitBackfillEvent({
    reviewId: input.reviewId,
    sourceEpoch: input.sourceEpoch,
    sourceRevision: input.sourceRevision,
    analysisSequence,
    correlationId: input.correlationId,
    occurredAt: input.occurredAt,
  })
  await session.advanceRun({
    runId: input.runId,
    reviewId: input.reviewId,
    analysisSequence,
    occurredAt: input.occurredAt,
  })
  return analysisSequence
}

export function createAdvanceReviewAnalysisBackfill(
  dependencies: AdvanceReviewAnalysisBackfillDependencies,
): AdvanceReviewAnalysisBackfill {
  /**
   * Terminal-settle an emitted item whose redelivery has stopped, exactly as
   * the domain would have at its own horizon: `terminal_no_result` +
   * `policy_disabled`, which is the only generic terminal disposition the
   * outcome CHECK admits. Deliberately NOT a retry — the provider may already
   * have been charged for this sequence, and re-running it would bill the
   * merchant twice for one review. Runs OUTSIDE the exclusive session: both
   * stores take their own property-scoped locks.
   */
  async function recoverUnreachableItem(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      run: ReviewAnalysisBackfillRun
      analysisSequence: number
      propertyProfileVersion: number
    }>,
  ): Promise<void> {
    const settled = await dependencies.reviewEvents.settleOutcome({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      sourceEpoch: input.run.sourceEpoch,
      reviewAnalysisEpoch: input.run.reviewAnalysisEpoch,
      analysisSequence: input.analysisSequence,
      state: 'terminal_no_result',
      operationId: null,
      dispositionCode: 'policy_disabled',
    })
    // Null means a redelivery settled it first — the outcome this wanted, by
    // the better route. The aggregate advance below is idempotent either way.
    if (settled === null) return
    await dependencies.aggregates.advanceWithoutAnalysis({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      sourceEpoch: input.run.sourceEpoch,
      analysisSequence: input.analysisSequence,
      reviewAnalysisEpoch: input.run.reviewAnalysisEpoch,
      propertyProfileVersion: input.propertyProfileVersion,
      dispositionCode: 'policy_disabled',
    })
  }

  /** One indivisible step, taken under the property's exclusive lock. */
  async function step(
    input: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
  ): Promise<
    | Readonly<{ outcome: AdvanceReviewAnalysisBackfillOutcome }>
    | Readonly<{
        outcome: 'recover'
        run: ReviewAnalysisBackfillRun
        analysisSequence: number
      }>
  > {
    return dependencies.backfillStore.runExclusive(input, async (session) => {
      const run = await session.readActiveRun()
      if (run === null) return { outcome: 'idle' as const }
      const context = await session.readContext()
      const superseded = supersessionReason(run, context)
      if (superseded !== null) {
        await session.closeRun({
          runId: run.id,
          state: 'superseded',
          terminalReason: superseded,
          occurredAt: new Date(dependencies.nowEpochMillis()),
        })
        return { outcome: 'superseded' as const }
      }

      if (run.currentAnalysisSequence !== null) {
        const outcomeState = await session.readOutcomeState({
          reviewAnalysisEpoch: run.reviewAnalysisEpoch,
          analysisSequence: run.currentAnalysisSequence,
        })
        if (outcomeState === null || outcomeState === 'pending') {
          const emittedAt = run.currentEmittedAtEpochMillis ?? 0
          if (
            dependencies.nowEpochMillis() - emittedAt <
            AI_BACKFILL_ITEM_RECOVERY_MILLIS
          ) {
            // Still the dispatcher's work: a `gap` retry, provider rate
            // limiting, or a provider call in flight. Waiting is the whole
            // point — the run must not run ahead of its own cursor.
            return { outcome: 'waiting' as const }
          }
          if (outcomeState === null) {
            // The event never reached `consume_ai_review_event_v1` at all — it
            // was quarantined, or lost before the cursor saw it. The cursor
            // still expects this sequence, so stepping past it would emit
            // `S+1` into a permanent `gap`. Stop, loudly, naming the sequence:
            // an operator can requeue the quarantined event and the run
            // resumes, which is strictly better than a run that looks alive
            // while every later item stalls behind a hole.
            await session.closeRun({
              runId: run.id,
              state: 'stalled',
              terminalReason: 'item_never_consumed',
              occurredAt: new Date(dependencies.nowEpochMillis()),
            })
            return { outcome: 'stalled' as const }
          }
          return {
            outcome: 'recover' as const,
            run,
            analysisSequence: run.currentAnalysisSequence,
          }
        }
      }

      const nextIndex = run.emittedReviewCount + run.skippedReviewCount
      if (nextIndex >= run.reviewIds.length) {
        await session.closeRun({
          runId: run.id,
          state: 'completed',
          terminalReason: 'run_exhausted',
          occurredAt: new Date(dependencies.nowEpochMillis()),
        })
        return { outcome: 'completed' as const }
      }

      const occurredAt = new Date(dependencies.nowEpochMillis())
      const candidate = await session.readEligibleCandidate(run.reviewIds[nextIndex]!)
      if (candidate === null) {
        // Expired, repointed or deleted since the run pinned it. Spending a
        // sequence on it would only produce a terminal settle with no analysis,
        // so the run steps past it and reports the skip.
        await session.skipRunCandidate({ runId: run.id, occurredAt })
        return { outcome: 'skipped' as const }
      }
      await emitRunItem(session, {
        runId: run.id,
        reviewId: candidate.reviewId,
        sourceEpoch: run.sourceEpoch,
        sourceRevision: candidate.sourceRevision,
        correlationId: run.correlationId,
        occurredAt,
      })
      return { outcome: 'emitted' as const }
    })
  }

  /**
   * Drive one property until it can go no further, reporting EVERY step it
   * took. The terminal outcome alone would hide the interesting ones: a
   * recovery is always followed by an emit, so a run that had to terminal-settle
   * a stranded review would report `emitted` and the recovery — the one count an
   * operator needs — would never be logged.
   */
  async function driveProperty(
    input: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
  ): Promise<
    Readonly<{
      outcome: AdvanceReviewAnalysisBackfillOutcome
      recovered: number
      skipped: number
    }>
  > {
    let recovered = 0
    let skipped = 0
    let last: AdvanceReviewAnalysisBackfillOutcome = 'idle'
    for (let taken = 0; taken < MAX_STEPS_PER_PROPERTY; taken++) {
      const result = await step(input)
      if (result.outcome === 'recover') {
        // The aggregate head is keyed by the property profile version, so the
        // recovery settle has to name the same one the epoch's analyses used.
        // A profile that cannot be read is not a licence to guess: leave the
        // item alone and let the next tick try again.
        const profile = await dependencies.processingProfiles.readForAi(input)
        if (profile.status !== 'available')
          return { outcome: 'waiting', recovered, skipped }
        await recoverUnreachableItem({
          ...input,
          run: result.run,
          analysisSequence: result.analysisSequence,
          propertyProfileVersion: profile.profile.profileVersion,
        })
        await dependencies.backfillStore.runExclusive(input, (session) =>
          session.recordRunRecovery({
            runId: result.run.id,
            occurredAt: new Date(dependencies.nowEpochMillis()),
          }),
        )
        recovered += 1
        last = 'recovered'
        continue
      }
      // A skip is bookkeeping, so the run keeps stepping; anything else is
      // either progress that must now wait on the consumer, or terminal.
      if (result.outcome === 'skipped') {
        skipped += 1
        last = 'skipped'
        continue
      }
      return { outcome: result.outcome, recovered, skipped }
    }
    return { outcome: last, recovered, skipped }
  }

  return Object.freeze({
    advanceProperty: async (input) => (await driveProperty(input)).outcome,
    sweep: async () => {
      const runs = await dependencies.backfillStore.listRunningRuns(
        AI_BACKFILL_SWEEP_BATCH_SIZE,
      )
      let itemsEmitted = 0
      let itemsSkipped = 0
      let itemsRecovered = 0
      let runsCompleted = 0
      let runsSuperseded = 0
      let runsStalled = 0
      for (const run of runs) {
        const driven = await driveProperty(run)
        itemsSkipped += driven.skipped
        itemsRecovered += driven.recovered
        if (driven.outcome === 'emitted') itemsEmitted += 1
        if (driven.outcome === 'completed') runsCompleted += 1
        if (driven.outcome === 'superseded') runsSuperseded += 1
        if (driven.outcome === 'stalled') runsStalled += 1
      }
      return Object.freeze({
        runsVisited: runs.length,
        itemsEmitted,
        itemsSkipped,
        itemsRecovered,
        runsCompleted,
        runsSuperseded,
        runsStalled,
        batchFull: runs.length >= AI_BACKFILL_SWEEP_BATCH_SIZE,
      })
    },
  })
}
