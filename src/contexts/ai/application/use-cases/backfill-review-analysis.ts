import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type {
  PropertyAuthorityLookup,
  ReviewAnalysisBackfillContext,
  ReviewAnalysisBackfillStorePort,
  ReviewAnalysisConsentActor,
} from '../ports/ai-review-analysis-backfill.port'
import { emitRunItem } from './advance-review-analysis-backfill'

/**
 * Audited operator re-analysis of reviews already stored for a property
 * (`ops:ai-reanalyze`).
 *
 * `analysis_start_sequence` is a deliberate watermark: enabling AI skips
 * everything the property held at that moment, so history is never analysed by
 * accident. Until now the only way to reprocess it was to delete the property
 * and reimport it — destroying the reviews to re-derive their analysis. This
 * makes the defeat explicit, audited, and gap-free.
 *
 * ── Why a fresh epoch, and why the watermark moves with it ──
 *
 * Re-analysing a review does not collide at the contribution level —
 * `ai_property_aggregate_contributions_pk` carries `analysis_sequence` but NOT
 * `review_analysis_epoch`, so a fresh sequence simply yields a second row and
 * both coexist. What separates the runs is one level up: aggregate heads and
 * daily rows are epoch-keyed (`ai_property_aggregate_heads` /
 * `ai_property_daily_aggregates`), a head is created at revision 0 with
 * `terminal_analysis_sequence = cursor.analysis_start_sequence`, and the read
 * path pins the epoch to the enablement's current one. So bumping the epoch
 * starts a FRESH aggregate series that reads then follow exclusively — which is
 * also why a backfill makes any pre-existing series for the old epoch
 * historical, and why the plan reports how many daily rows that is.
 *
 * The new epoch's cursor is created lazily by `consume_ai_review_event_v1` at
 * whatever `analysis_start_sequence` the enablement carries, and that value is
 * immutable once the cursor row exists. Bumping the epoch WITHOUT moving the
 * watermark would create the cursor at the old start and leave it waiting
 * forever for sequences that already flowed under the previous epoch. So the
 * two moves are one atomic act: epoch + 1, start = current head `H`.
 *
 * ── Why contiguity is structural, not checked ──
 *
 * `consume_ai_review_event_v1` accepts only `consumed_sequence + 1` and answers
 * `gap` to anything else, and a `gap` writes no outcome row — the cursor stops
 * there and never moves again. One hole is therefore permanent, and worse than
 * the watermark this command exists to defeat.
 *
 * A review's STORED `analysis_sequence` is not a safe source for that: it holds
 * only the sequence of its LAST analysis event, so a review upserted twice
 * consumed two sequences while storing one, and a review that predates the
 * allocator can hold `0`, which the allocator can never emit. Whether a given
 * property's stored sequences happen to be contiguous today is not something
 * this command may depend on.
 *
 * So nothing here reads a stored sequence. Every event carries a sequence
 * freshly allocated from `lock_review_ai_analysis_head_v1`, the one authority,
 * under a property lock held for the whole session — the same row lock the
 * allocator itself takes, so no concurrent review upsert can interleave.
 * `H + 1 … H + n`, one event each, is the only reachable outcome; the assertion
 * below turns any future violation into a rollback rather than a stalled cursor.
 */
export type BackfillReviewAnalysisInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  /** Hard cap on reviews replayed in this run. */
  limit: number
  /** Report only. Nothing is written and no provider call is ever made. */
  dryRun: boolean
  reasonCode: string
  /** Fences a retried operator invocation to one watermark reposition. */
  idempotencyKey: string
  requestHash: string
  correlationId: string
  occurredAt: Date
}>

export type BackfillRefusal =
  | 'property_inactive'
  | 'authorization_absent'
  | 'authorization_not_enabled'
  | 'review_analysis_not_authorized'
  | 'authorized_source_epoch_stale'
  | 'consent_actor_absent'
  | 'consent_actor_unauthorized'
  | 'no_eligible_reviews'
  | 'backfill_already_running'

export type BackfillPlan = Readonly<{
  sourceEpoch: number
  /** `H` — the review-analysis head before this run. */
  headSequence: number
  eligibleReviewCount: number
  selectedReviewCount: number
  /** True when `--batch-size` capped the run below the eligible count. */
  capped: boolean
  /** `H + 1`, or null when nothing is selected — the run's FIRST sequence. */
  firstAnalysisSequence: number | null
  /**
   * `H + n`, or null when nothing is selected. The sequence the run will reach
   * if every selected review stays eligible; later sequences are allocated one
   * at a time, as each predecessor settles, so a skipped review lowers it.
   */
  lastAnalysisSequence: number | null
  currentReviewAnalysisEpoch: number
  nextReviewAnalysisEpoch: number
  currentAnalysisStartSequence: number
  nextAnalysisStartSequence: number
  /**
   * Daily aggregate rows built under the LIVE epoch. Reads follow the
   * enablement's epoch, so the new series replaces these in every read the
   * moment the backfill applies — and it only refills the days its selected
   * reviews cover.
   */
  supersededDailyAggregateRows: number
}>

export type BackfillReviewAnalysisResult =
  | Readonly<{ status: 'refused'; refusal: BackfillRefusal; message: string }>
  | Readonly<{ status: 'planned'; plan: BackfillPlan }>
  | Readonly<{
      status: 'applied'
      plan: BackfillPlan
      /** The durable run this command opened; the sweep drives it to the end. */
      runId: string
      /**
       * The ONE sequence this command emitted. The rest are allocated as each
       * predecessor settles — see the run's own doc for why a batch may never
       * allocate ahead of itself.
       */
      firstAnalysisSequence: number
      /** Reviews pinned to the run, including the one already emitted. */
      pinnedReviewCount: number
      reviewAnalysisEpoch: number
      analysisStartSequence: number
      stateVersion: number
      /**
       * The accountable member the consent ledger recorded — carried forward
       * from the consent this run replays, never the operator who ran it.
       */
      consentActorUserId: string
    }>

export type BackfillReviewAnalysisDependencies = Readonly<{
  backfillStore: ReviewAnalysisBackfillStorePort
  /**
   * Identity-owned current authority decision. It resolves effective
   * `ai.manage`, its scope, and an active property grant where required.
   */
  propertyAuthority: PropertyAuthorityLookup
}>

/**
 * Ask Identity for the actor's current effective authority over this property.
 * The legacy role copied into consent context is diagnostic attribution only.
 *
 * Advisory only, and deliberately outside the property lock: it exists to name
 * the problem for an operator BEFORE anything is written. The authoritative
 * check is `reposition_merchant_ai_analysis_watermark_v1`, which re-derives the
 * actor inside the transaction under the lock and raises
 * `merchant_ai_backfill_consent_actor_denied`. If the two ever disagree — a
 * grant revoked in the gap — the SQL wins and the transaction aborts.
 */
async function hasPropertyAuthority(
  actor: ReviewAnalysisConsentActor,
  input: BackfillReviewAnalysisInput,
  propertyAuthority: PropertyAuthorityLookup,
): Promise<boolean> {
  return propertyAuthority(input.organizationId, input.propertyId, actor.userId)
}

/**
 * The precondition the context fails, if any. Named refusals, never a silent
 * fix: this command reprocesses what the merchant ALREADY authorized, so it
 * must refuse rather than enable anything on their behalf. Their consent is
 * taken on the AI data-use surface, with a password, and this must not become
 * a way around that.
 */
async function refuseFor(
  context: ReviewAnalysisBackfillContext,
  input: BackfillReviewAnalysisInput,
  propertyAuthority: PropertyAuthorityLookup,
): Promise<Readonly<{ refusal: BackfillRefusal; message: string }> | null> {
  if (!context.propertyActive) {
    return {
      refusal: 'property_inactive',
      message:
        'property is not active (deleted, not lifecycle-active, or its Google binding is not active)',
    }
  }
  const enablement = context.enablement
  if (enablement === null) {
    return {
      refusal: 'authorization_absent',
      message: 'no merchant AI authorization exists for this property',
    }
  }
  if (enablement.state !== 'enabled') {
    return {
      refusal: 'authorization_not_enabled',
      message: `merchant AI authorization state is '${enablement.state}', not 'enabled'`,
    }
  }
  if (!enablement.capabilities.includes('review_analysis')) {
    return {
      refusal: 'review_analysis_not_authorized',
      message: `merchant AI capabilities [${enablement.capabilities.join(', ')}] do not include 'review_analysis'`,
    }
  }
  if (enablement.authorizedSourceEpoch !== context.propertySourceEpoch) {
    return {
      refusal: 'authorized_source_epoch_stale',
      message:
        `authorized_source_epoch ${enablement.authorizedSourceEpoch} does not equal ` +
        `properties.source_epoch ${context.propertySourceEpoch} — the merchant must re-consent for the current source`,
    }
  }
  // The evidence row this backfill writes carries `actor_user_id`, and
  // `admit_ai_property_v1` resolves that column as a `member."userId"` for every
  // system-run operation. A backfill grants no new consent, so the accountable
  // actor is the member who consented — carried forward from the most recent
  // MERCHANT CONSENT DECISION in the lineage, never from an `analysis_backfill`
  // row, which records only that a replay happened. If that member cannot be
  // resolved, refuse: substituting the operator (not a member) or picking an
  // arbitrary owner would forge the consent record, and writing an unresolvable
  // actor denies every replayed operation `authorization_changed` after burning
  // an epoch.
  const consentActor = enablement.consentActor
  if (consentActor === null) {
    return {
      refusal: 'consent_actor_absent',
      message:
        `no merchant consent-decision row (enable, change, revoke, restore_reset) exists for ` +
        `authorization lineage ${enablement.authorizationLineageId} at or below state_version ${enablement.stateVersion}, ` +
        'so the member who consented cannot be carried forward — ' +
        'a backfill records their identity, never the operator who ran it',
    }
  }
  if (!(await hasPropertyAuthority(consentActor, input, propertyAuthority))) {
    return {
      refusal: 'consent_actor_unauthorized',
      message:
        `consent-evidence actor '${consentActor.userId}' for authorization lineage ${enablement.authorizationLineageId} ` +
        `at state_version ${consentActor.stateVersion} is not a member of this organization with authority over this property ` +
        `(effective ai.manage plus the required property scope; legacy member.role is ${consentActor.memberRole === null ? 'absent — no current member row was observed' : `'${consentActor.memberRole}'`}) — ` +
        'admission would deny every replayed review, so the merchant must re-consent under a member who still has authority',
    }
  }
  return null
}

export function createBackfillReviewAnalysis(
  dependencies: BackfillReviewAnalysisDependencies,
): (input: BackfillReviewAnalysisInput) => Promise<BackfillReviewAnalysisResult> {
  return async (input) =>
    dependencies.backfillStore.runExclusive(input, async (session) => {
      const context = await session.readContext()
      const refusal = await refuseFor(context, input, dependencies.propertyAuthority)
      if (refusal) return { status: 'refused', ...refusal }
      if ((await session.readActiveRun()) !== null) {
        // Two open runs would each bump the epoch and each strand the other's
        // analyses in a generation no read follows — the exact orphaning the
        // one-epoch rule exists to prevent. The unique partial index enforces
        // this too; refusing here names it instead of raising a constraint.
        return {
          status: 'refused',
          refusal: 'backfill_already_running',
          message:
            'a review-analysis backfill is still running on this property — wait for it to finish, or read its terminal state, before starting another',
        }
      }

      // Non-null: refuseFor rejects a null enablement above.
      const enablement = context.enablement!
      const candidates = await session.listCandidates(input.limit)
      const headSequence = context.analysisHeadSequence
      const plan: BackfillPlan = {
        sourceEpoch: context.propertySourceEpoch,
        headSequence,
        eligibleReviewCount: context.eligibleReviewCount,
        selectedReviewCount: candidates.length,
        capped: candidates.length < context.eligibleReviewCount,
        firstAnalysisSequence: candidates.length === 0 ? null : headSequence + 1,
        lastAnalysisSequence:
          candidates.length === 0 ? null : headSequence + candidates.length,
        currentReviewAnalysisEpoch: enablement.reviewAnalysisEpoch,
        nextReviewAnalysisEpoch: enablement.reviewAnalysisEpoch + 1,
        currentAnalysisStartSequence: enablement.analysisStartSequence,
        nextAnalysisStartSequence: headSequence,
        supersededDailyAggregateRows: context.existingDailyAggregateRowCount,
      }

      if (candidates.length === 0) {
        return {
          status: 'refused',
          refusal: 'no_eligible_reviews',
          message:
            'no review on this property is eligible for re-analysis (retained text within the current source epoch)',
        }
      }
      if (input.dryRun) return { status: 'planned', plan }

      // Non-null: refuseFor rejects an unresolvable consent actor above.
      const consentActorUserId = enablement.consentActor!.userId
      const repositioned = await session.repositionWatermark({
        reasonCode: input.reasonCode,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        occurredAt: input.occurredAt,
      })
      if (repositioned.analysisStartSequence !== headSequence) {
        throw new Error(
          `Review analysis watermark moved to ${repositioned.analysisStartSequence}, expected the observed head ${headSequence}`,
        )
      }
      if (repositioned.consentActorUserId !== consentActorUserId) {
        // The SQL derives the actor independently of this read. A disagreement
        // means the lineage head moved under the property lock, so the ledger
        // row would name someone whose authority was never checked — roll the
        // whole backfill back rather than leave an unaccountable consent record.
        throw new Error(
          `Review analysis backfill recorded consent actor '${repositioned.consentActorUserId}', expected the validated '${consentActorUserId}'`,
        )
      }

      const runId = await session.openRun({
        sourceEpoch: context.propertySourceEpoch,
        reviewAnalysisEpoch: repositioned.reviewAnalysisEpoch,
        analysisStartSequence: repositioned.analysisStartSequence,
        orderedReviewIds: candidates.map((candidate) => candidate.reviewId),
        reasonCode: input.reasonCode,
        correlationId: input.correlationId,
        occurredAt: input.occurredAt,
      })
      const firstMember = await session.readRunMember({ runId, ordinal: 0 })
      if (firstMember !== candidates[0]!.reviewId) {
        throw new Error(
          `Review analysis backfill membership changed while opening run ${runId}`,
        )
      }
      // ONE event, never N. `storeAnalysis` refuses unless
      // `review_ai_analysis_heads.head_sequence` still equals the sequence being
      // stored, so allocating the whole run up front makes every sequence but
      // the last permanently unstorable — five provider calls, one analysis, on
      // the closed beta. `advance-review-analysis-backfill` allocates and emits
      // the next item once this one has settled, inside the epoch just opened.
      const firstAnalysisSequence = await emitRunItem(session, {
        runId,
        reviewId: firstMember,
        sourceEpoch: context.propertySourceEpoch,
        sourceRevision: candidates[0]!.sourceRevision,
        correlationId: input.correlationId,
        occurredAt: input.occurredAt,
      })
      if (firstAnalysisSequence !== headSequence + 1) {
        // Unreachable while the property lock holds — and if it ever becomes
        // reachable, aborting rolls the whole backfill back. The new cursor is
        // created at `H` and accepts only `H+1`, so any other sequence stalls it
        // permanently.
        throw new Error(
          `Review analysis backfill allocated ${firstAnalysisSequence}, expected the head successor ${headSequence + 1}`,
        )
      }

      return {
        status: 'applied',
        plan,
        runId,
        firstAnalysisSequence,
        pinnedReviewCount: candidates.length,
        reviewAnalysisEpoch: repositioned.reviewAnalysisEpoch,
        analysisStartSequence: repositioned.analysisStartSequence,
        stateVersion: repositioned.stateVersion,
        consentActorUserId: repositioned.consentActorUserId,
      }
    })
}
