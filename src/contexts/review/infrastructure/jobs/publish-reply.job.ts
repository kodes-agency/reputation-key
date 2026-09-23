// Review context — BullMQ job handler for publishing replies to Google.
//
// BullMQ grants at most five executions (event-job-catalogue.ts publish-reply:
// `retryAttempts: 5`, `exponential:30000`; job-policy.ts adds 0.5 jitter, which
// BullMQ applies as 50-100% of each exponential delay, so the gaps are roughly
// 15-30 s, 30-60 s, 60-120 s and 120-240 s). Only a RETRYABLE failure spends
// them on further provider writes. A terminal rejection resolves on the attempt
// that saw it. An AMBIGUOUS failure gets one more execution, and that one never
// writes: it runs the uncertain-attempt check below and then leaves the row to
// the reconciliation sweep.
//
// BQC-3.3: provider outcomes are classified via the reply-publication saga
// (classifyPublicationFailure), from the dispatch the provider plane recorded
// (D2): `not_sent` is the only evidence that lets a failed write be retried.
// Every classified failure is logged as { attempt, failureClass,
// executionCode, dispatch, providerStatus, errorName, errorCode } and nothing
// else: the last two only when identifier-shaped, never the error message.
//
// BQC-3.8: the publication state machine is DURABLE (replies.publication_state,
// migration 0015). The handler:
//   1. CLAIMS the row — markPublicationSending (approved + authorized|sending
//      → sending, attempts+1). A null claim means the publication was
//      cancelled (disconnect/policy) or the row is no longer claimable:
//      the side effect must NOT run. The claim itself cancels (policy) a
//      cycle whose Property is not active at its source epoch.
//   2. a persisted `sending` state is uncertain, and nothing on this path
//      permits another provider write:
//        a. D4: no `reviews.reply` permit for this exact attempt once the
//           dispatch window has passed → settle it as not published
//           (publish_failed / retryable), without reading Google;
//        b. otherwise one targeted read. A live exact or different reply is
//           recorded and the observation authority confirms or supersedes;
//        c. D3: an absent reply, a failed read, a reply RepKey cannot read, or
//           a whitespace-only difference is not a result. Inside the 15-minute
//           propagation grace the row stays `sending` and is due again in one
//           minute (the sweep reads it next); past the grace it becomes
//           ambiguous, due at the next rung of the 72-hour read ladder.
//   3. POST-CALL RACE GUARD — re-reads the reply before the local ack:
//      row missing (purged by the disconnect cascade) or
//      publication_state='cancelled' (disconnect won the race) → return
//      WITHOUT marking. The local truth is cancelled; provider-side cleanup
//      of the orphaned Google-visible reply is out of scope.
//   4. successful write response → persist provider outcome as
//      pending_observation. It is never publication proof; only a later exact,
//      current provider read may publish the local Reply.
//   5. failure → RepKey's authorizer refused before sending because the
//      Property moved on after the claim (`stale_source`, not_sent) →
//      cancelPublications (policy), resolve: never a Google rejection.
//      Every other failure is classified:
//        terminal_rejection  → markPublicationTerminal, resolve (no retry burn);
//                              includes a request RepKey refused before
//                              sending (invalid input, compile refusal)
//        retryable non-final → markPublicationRetryQueued + rethrow
//        retryable final     → markPublicationTerminal + rethrow
//        ambiguous non-final → rethrow; the next attempt runs step 2 without
//                              repeating the write
//        ambiguous final     → markPublicationAmbiguous (reconcile_due_at set
//                              for the bounded reconciliation sweep) + rethrow

import type { Job } from 'bullmq'

export const JOB_NAME = 'publish-reply' as const
import type { PublishReplyJobData } from '../../application/ports/reply-queue.port'
import type { ReplyRepository } from '../../application/ports/reply.repository'
import type { ReviewRepository } from '../../application/ports/review.repository'
import type { ReplyCommandStore } from '../../application/ports/reply-command-store.port'
import type { GoogleReviewApiPort } from '../../application/ports/google-review-api.port'
import type { GoogleReplyObservationStore } from '../../application/ports/google-reply-observation-store.port'
import type { ReplyPublicationDispatchEvidencePort } from '../../application/ports/reply-publication-dispatch-evidence.port'
import { attemptNeverDispatched } from './attempt-never-dispatched'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { Reply, Review } from '../../domain/types'
import { replyId, organizationId, propertyId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { trace } from '#/shared/observability/trace'
import {
  canDeferUncertainSend,
  classifyPublicationFailure,
  nextAmbiguousReconcileDueAt,
  publicationFailureCause,
  publicationFailureEvidence,
  UNCERTAIN_SEND_RECHECK_DELAY_MS,
  type PublicationFailureCause,
} from '../../domain/reply-publication-workflow'
import {
  reviewReplyPublicationCancelled,
  reviewReplyPublishFailed,
  type ReplyPublishFailureOutcome,
} from '../../domain/events'
import { sha256Hex } from '#/shared/domain/sha256'
import { contentExpiresAtFromFetch } from '#/shared/domain/source-content-policy'

const MAX_ATTEMPTS = 5

type PublishHandlerDeps = Readonly<{
  replyRepo: ReplyRepository
  reviewRepo: ReviewRepository
  googleReviewApi: GoogleReviewApiPort
  googleReplyObservationStore: GoogleReplyObservationStore
  /** BQC-3.3/3.8: atomic mark ops (guarded state + outbox fact in one tx). */
  replyCommandStore: ReplyCommandStore
  /** D4: the only input that may settle an uncertain attempt as never sent. */
  dispatchEvidence: ReplyPublicationDispatchEvidencePort
  clock: () => Date
  logger: Pick<LoggerPort, 'error' | 'info' | 'warn'>
  idGen: () => ReturnType<typeof replyId>
  // Job-only mark ops share ReplyDeps (which now carries staffPublicApi for the
  // user-facing reply ops). The mark ops don't perform access checks themselves
  // (no authenticated caller), but accept the field to satisfy the shared type.
  staffPublicApi: StaffPublicApi
}>

/** The publish_failed fact — identifier-only, propertyId from the parent review. */
function buildPublishFailedEvent(
  review: Review,
  reply: Reply,
  occurredAt: Date,
  outcome: ReplyPublishFailureOutcome,
  cause: PublicationFailureCause | null = null,
) {
  return reviewReplyPublishFailed({
    replyId: reply.id,
    reviewId: reply.reviewId,
    propertyId: review.propertyId,
    organizationId: reply.organizationId,
    authorId: reply.createdBy,
    outcome,
    ...(cause === null ? {} : { cause }),
    occurredAt,
  })
}

/** RPL-01: an authorization fence is current only when the job carries the full
 * provider-source coordinates the authorization was granted against. */
function hasCurrentAuthorizationFence(data: PublishReplyJobData): boolean {
  return (
    typeof data.propertyId === 'string' &&
    Number.isSafeInteger(data.sourceEpoch) &&
    data.sourceEpoch! >= 0 &&
    Number.isSafeInteger(data.materialReviewRevision) &&
    data.materialReviewRevision! > 0 &&
    Number.isSafeInteger(data.baseObservationRevision) &&
    data.baseObservationRevision! >= 0
  )
}

type PublishTarget = Readonly<{
  reply: Reply
  review: Review
  reviewName: string | null
}>

/**
 * Everything that must still hold before this job may claim the row: the Reply
 * exists and is approved, the job's publication cycle is still the current one,
 * and its authorization still names this Review's provider source. Any failed
 * check is logged and reported as "no target", which skips the job.
 */
async function loadPublishTarget(
  deps: PublishHandlerDeps,
  job: Job<PublishReplyJobData>,
  rId: ReturnType<typeof replyId>,
  orgId: ReturnType<typeof organizationId>,
): Promise<PublishTarget | null> {
  const logger = deps.logger
  const reply = await deps.replyRepo.findById(rId, orgId)
  if (!reply) {
    logger.error('Reply not found, skipping')
    return null
  }
  if (reply.status !== 'approved') {
    logger.warn({ status: reply.status }, 'Reply not in approved status, skipping')
    return null
  }

  // RPL-01: a durable intent or fast-path job may arrive after a later
  // approval/edit/retry cycle has become current. The explicit monotonic
  // cycle is the fence: stale work stops before it can claim the row or
  // reach the provider. A missing value is accepted only for a bounded
  // pre-RPL-01 job whose persisted row is still at legacy cycle zero.
  const requestedCycle = job.data.publicationCycle
  if (
    (requestedCycle === undefined && reply.publicationCycle !== 0) ||
    (requestedCycle !== undefined && requestedCycle !== reply.publicationCycle) ||
    (reply.publicationCycle > 0 && !hasCurrentAuthorizationFence(job.data))
  ) {
    logger.warn('Publication cycle superseded — skipping stale job')
    return null
  }

  const review = await deps.reviewRepo.findById(reply.reviewId, orgId)
  if (!review) {
    logger.error('Review not found for reply')
    return null
  }
  if (
    reply.publicationCycle > 0 &&
    (job.data.propertyId !== review.propertyId ||
      job.data.sourceEpoch !== review.sourceEpoch ||
      job.data.materialReviewRevision !== review.sourceRevision)
  ) {
    logger.warn('Publication authorization no longer matches the Review source')
    return null
  }

  const reviewName =
    review.externalLocationId && review.externalId
      ? `${review.externalLocationId}/reviews/${review.externalId}`
      : null
  return { reply, review, reviewName }
}

/**
 * BQC-3.8 POST-CALL RACE GUARD: the disconnect cascade (cancellation + purge)
 * or a re-authorization may have run while the Google call was in flight. In
 * every one of those cases the local truth wins and the provider result is not
 * acknowledged.
 */
async function localTruthStillOwnsCycle(
  deps: PublishHandlerDeps,
  rId: ReturnType<typeof replyId>,
  orgId: ReturnType<typeof organizationId>,
  jobCycle: number,
): Promise<boolean> {
  const logger = deps.logger
  const current = await deps.replyRepo.findById(rId, orgId)
  if (!current) {
    logger.error(
      'Reply purged during the Google call — provider-visible reply has no local evidence; NOT marking published (provider-side cleanup is out of scope)',
    )
    return false
  }
  if (current.publicationState === 'cancelled') {
    logger.warn(
      'Publication cancelled during the Google call — the local truth is cancelled; NOT marking published',
    )
    return false
  }
  if (current.publicationCycle !== jobCycle) {
    logger.warn(
      'Publication cycle changed during the Google call — NOT acknowledging the stale cycle',
    )
    return false
  }
  return true
}

export const createPublishReplyHandler = (deps: PublishHandlerDeps) => {
  return async (job: Job<PublishReplyJobData>) => {
    return trace('job.publishReply', async () => {
      const logger = deps.logger

      // BQC-3.2: capability authorization happens at dispatch in the delayed
      // execution gate — job handlers no longer re-check capabilities.

      const rId = replyId(job.data.replyId)
      const orgId = organizationId(job.data.organizationId)

      logger.info('Publishing reply to Google')

      const target = await loadPublishTarget(deps, job, rId, orgId)
      if (!target) return
      const { reply, review, reviewName } = target
      const jobCycle = job.data.publicationCycle ?? 0

      // A persisted `sending` row means a previous attempt may have reached
      // Google without its local outcome being committed. A targeted read can
      // confirm or supersede it, but no missing/error response permits another write.
      if (reply.publicationState === 'sending') {
        await reconcileUncertainAttempt(deps, job, reply, review, reviewName)
        return
      }

      // BQC-3.8: CLAIM a fresh publication (approved + authorized → sending,
      // attempts+1). A persisted sending row returned through the check-only
      // path above, so it can never be re-claimed into a second Google write.
      // Null = cancelled meanwhile (disconnect/policy) or no longer claimable.
      const claimed = await deps.replyCommandStore.markPublicationSending(reply, {
        providerOperationKey: `${String(job.id ?? reply.id)}:${job.attemptsMade + 1}`,
        propertyId: propertyId(job.data.propertyId ?? review.propertyId),
        sourceEpoch: job.data.sourceEpoch ?? review.sourceEpoch,
        materialReviewRevision: job.data.materialReviewRevision ?? review.sourceRevision,
        baseObservationRevision: job.data.baseObservationRevision ?? 0,
      })
      if (!claimed) {
        logger.warn('Publication claim lost — cancelled or no longer claimable, skipping')
        return
      }

      if (!review.googleConnectionId || !reviewName) {
        logger.error('Review has no current Google provider subject, cannot publish')
        await deps.replyCommandStore.markPublicationTerminal(
          claimed,
          'terminal_rejection',
          buildPublishFailedEvent(review, claimed, deps.clock(), 'refused'),
        )
        return
      }

      try {
        const providerOutcome = await deps.googleReviewApi.replyToReview({
          organizationId: orgId,
          propertyId: review.propertyId,
          connectionId: review.googleConnectionId,
          sourceEpoch: review.sourceEpoch,
          reviewId: review.id,
          materialReviewRevision: review.sourceRevision,
          replyId: claimed.id,
          publicationCycle: claimed.publicationCycle,
          attemptNumber: claimed.publicationAttempts,
          reviewName,
          text: claimed.text,
        })

        if (!(await localTruthStillOwnsCycle(deps, rId, orgId, jobCycle))) return

        const now = deps.clock()
        // Use the exact row claimed by THIS cycle. The store's status+cycle
        // compare-and-set is the final fence between the post-call read above
        // and this acknowledgement; a cancellation/re-authorization in that
        // narrow window cannot make the old provider result publish cycle N+1.
        const pending =
          await deps.replyCommandStore.markProviderOutcomePendingObservation(
            claimed,
            {
              providerCorrelationId: providerOutcome.providerCorrelationId,
              providerRespondedAt: now,
            },
            now,
          )
        if (!pending) {
          logger.warn(
            'Publication acknowledgement lost the state/cycle fence — NOT marking a newer cycle',
          )
          return
        }
        logger.info('Google write accepted; awaiting provider observation')
      } catch (err) {
        if (refusedForPropertySource(err)) {
          await cancelRefusedPublication(deps, claimed, review)
          return
        }
        await handlePublishFailure(deps, job, claimed, review, err)
      }
    })
  }
}

/**
 * RepKey's own authorizer refused the write before anything was sent because
 * the Property is no longer active at the cycle's source epoch: an Archive,
 * Restore or relink committed after this cycle was claimed. That is policy,
 * not Google's answer, and must never reach the author as "Google rejected
 * the reply".
 */
function refusedForPropertySource(err: unknown): boolean {
  const evidence = publicationFailureEvidence(err)
  return evidence.dispatch === 'not_sent' && evidence.executionCode === 'stale_source'
}

/** Cancel the claimed cycle as a policy cancellation, exactly as the archive
 * consumer and a failed claim do: the Reply returns to draft and one
 * `publication_cancelled` (cause 'policy') fact is recorded. */
async function cancelRefusedPublication(
  deps: PublishHandlerDeps,
  claimed: Reply,
  review: Review,
): Promise<void> {
  const now = deps.clock()
  const cancelled = await deps.replyCommandStore.cancelPublications([
    {
      reply: claimed,
      event: reviewReplyPublicationCancelled({
        replyId: claimed.id,
        reviewId: claimed.reviewId,
        propertyId: review.propertyId,
        organizationId: claimed.organizationId,
        authorId: claimed.createdBy,
        cause: 'policy',
        occurredAt: now,
      }),
      now,
    },
  ])
  deps.logger.warn(
    { cancelled: cancelled > 0 },
    'Reply publication refused before sending: its Property is no longer active at the cycle source epoch; cancelled as policy',
  )
}

type AttemptStart = Date | null

/** Why an uncertain attempt's read decided nothing (logged, content-free). */
type InconclusiveReason =
  'absent' | 'read_failed' | 'reply_unreadable' | 'whitespace_only_difference'

/** What one targeted read of an uncertain attempt established. */
type UncertainReadback =
  /** The observation authority confirmed or superseded the attempt. */
  | Readonly<{ kind: 'recorded' }>
  | Readonly<{ kind: 'review_missing' }>
  | Readonly<{ kind: 'inconclusive'; reason: InconclusiveReason; error?: unknown }>

async function markUncertainAttemptAmbiguous(
  deps: PublishHandlerDeps,
  reply: Reply,
  review: Review,
  attemptStartedAt: AttemptStart,
): Promise<void> {
  const now = deps.clock()
  // D3: due at the next ladder rung measured from the attempt start. Without a
  // start the store's default (now + 15 minutes) is never earlier than it.
  const dueAt = attemptStartedAt
    ? (nextAmbiguousReconcileDueAt({ attemptStartedAt, now }) ?? undefined)
    : undefined
  await deps.replyCommandStore.markPublicationAmbiguous(
    reply,
    buildPublishFailedEvent(review, reply, now, 'unconfirmed'),
    now,
    dueAt,
  )
}

/** D3: inside the grace an inconclusive read keeps the send waiting; past it
 * the send becomes ambiguous on the ladder. */
async function waitOrMarkAmbiguous(
  deps: PublishHandlerDeps,
  reply: Reply,
  review: Review,
  attemptStartedAt: AttemptStart,
  reason: InconclusiveReason,
): Promise<void> {
  const now = deps.clock()
  if (attemptStartedAt && canDeferUncertainSend({ attemptStartedAt, now })) {
    const deferred = await deps.replyCommandStore.deferUncertainSend(
      reply,
      new Date(now.getTime() + UNCERTAIN_SEND_RECHECK_DELAY_MS),
      now,
    )
    deps.logger.info(
      { reason, deferred: deferred !== null },
      'Uncertain reply attempt not confirmed on Google yet; checking again within the propagation grace',
    )
    return
  }
  deps.logger.info(
    { reason, attemptStartKnown: attemptStartedAt !== null },
    'Uncertain reply attempt still unconfirmed after the propagation grace; marking ambiguous',
  )
  await markUncertainAttemptAmbiguous(deps, reply, review, attemptStartedAt)
}

async function reconcileUncertainAttempt(
  deps: PublishHandlerDeps,
  job: Job<PublishReplyJobData>,
  reply: Reply,
  review: Review,
  reviewName: string | null,
): Promise<void> {
  const attemptStartedAt = await deps.replyRepo.findCurrentPublicationAttemptStartedAt({
    organizationId: reply.organizationId,
    reviewId: reply.reviewId,
    replyId: reply.id,
    publicationCycle: reply.publicationCycle,
    attemptNumber: reply.publicationAttempts,
  })

  const logEvidenceUnavailable = (err: unknown) =>
    deps.logger.warn(
      contentFreeErrorIdentity(err),
      'Reply dispatch evidence unavailable; reading Google instead',
    )
  if (
    attemptStartedAt &&
    (await attemptNeverDispatched(deps, reply, attemptStartedAt, logEvidenceUnavailable))
  ) {
    const now = deps.clock()
    const settled = await deps.replyCommandStore.settleNeverDispatchedAttempt(
      reply,
      buildPublishFailedEvent(review, reply, now, 'not_sent'),
      now,
    )
    deps.logger.info(
      { settled: settled !== null },
      'Uncertain reply attempt never reached Google; settled as not published',
    )
    return
  }

  if (!review.googleConnectionId || !reviewName) {
    // The previous write may have landed before the provider subject
    // disappeared. Loss of read access is not evidence that it did not.
    await markUncertainAttemptAmbiguous(deps, reply, review, attemptStartedAt)
    return
  }

  const readback = await readUncertainAttempt(deps, job, reply, review, reviewName)
  if (readback.kind === 'recorded') return
  if (readback.kind === 'review_missing') {
    await markUncertainAttemptAmbiguous(deps, reply, review, attemptStartedAt)
    return
  }
  await waitOrMarkAmbiguous(deps, reply, review, attemptStartedAt, readback.reason)
  // A failed read still fails the job, so BullMQ records why and its next
  // execution (if any) repeats this read-only check.
  if (readback.reason === 'read_failed') throw readback.error
}

async function readUncertainAttempt(
  deps: PublishHandlerDeps,
  job: Job<PublishReplyJobData>,
  reply: Reply,
  review: Review,
  reviewName: string,
): Promise<UncertainReadback> {
  if (!review.googleConnectionId) return { kind: 'review_missing' }
  let result
  try {
    result = await deps.googleReviewApi.getReview({
      organizationId: reply.organizationId,
      propertyId: review.propertyId,
      connectionId: review.googleConnectionId,
      sourceEpoch: review.sourceEpoch,
      locationName: review.externalLocationId,
      reviewName,
    })
  } catch (err) {
    return { kind: 'inconclusive', reason: 'read_failed', error: err }
  }
  if (result.status === 'not_found') return { kind: 'review_missing' }
  // D6: Google shows a reply whose original text is not recoverable. Recording
  // it would write `absent`, a false provider fact; record nothing.
  if (result.review.replyUnreadable === true) {
    return { kind: 'inconclusive', reason: 'reply_unreadable' }
  }

  // Allocate after acquiring the response: concurrent targeted reads are
  // ordered by the truth they actually received, not by request start time.
  let observation
  try {
    const readGeneration = await deps.googleReplyObservationStore.allocateReadGeneration()
    const observedAt = deps.clock()
    observation = await deps.googleReplyObservationStore.record({
      organizationId: reply.organizationId,
      propertyId: review.propertyId,
      reviewId: reply.reviewId,
      sourceEpoch: review.sourceEpoch,
      materialReviewRevision: review.sourceRevision,
      observationKey: sha256Hex(
        [
          'publish-readback-v2',
          String(job.id ?? ''),
          String(reply.id),
          String(reply.publicationCycle),
          String(reply.publicationAttempts),
          String(job.attemptsMade),
          String(review.sourceEpoch),
          String(review.sourceRevision),
          String(readGeneration),
          result.review.replyUpdatedAt?.toISOString() ?? 'none',
          result.review.replyText === null
            ? 'reply-state:absent'
            : `reply-state:live:${sha256Hex(result.review.replyText)}`,
        ].join('\0'),
      ),
      source: 'targeted_reconciliation',
      publicationTarget: {
        replyId: reply.id,
        publicationCycle: reply.publicationCycle,
        attemptNumber: reply.publicationAttempts,
      },
      readGeneration,
      observedText: result.review.replyText,
      providerUpdatedAt: result.review.replyUpdatedAt,
      observedAt,
      contentExpiresAt: contentExpiresAtFromFetch(observedAt),
    })
  } catch (err) {
    return { kind: 'inconclusive', reason: 'read_failed', error: err }
  }

  if (result.review.replyText === null) return { kind: 'inconclusive', reason: 'absent' }
  // D6: `diverged` is the authority's answer for live text that differs from
  // this attempt only by whitespace; it neither confirmed nor superseded it.
  if (observation.resolution === 'diverged') {
    return { kind: 'inconclusive', reason: 'whitespace_only_difference' }
  }
  return { kind: 'recorded' }
}

// Names are class-like identifiers (`DatabaseError`, `GoogleReviewApiError`);
// codes are closed-union words or SQLSTATEs (`provider_unavailable`, `40001`).
// Anything else is dropped rather than trusted: both fields come from an
// `unknown` rejection, and a free-form value could carry reply text.
const CONTENT_FREE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u
const CONTENT_FREE_ERROR_CODE = /^[A-Za-z0-9_]{1,64}$/u

function contentFreeErrorIdentity(
  err: unknown,
): Readonly<{ errorName: string | null; errorCode: string | null }> {
  if (!(err instanceof Error)) return { errorName: null, errorCode: null }
  const code: unknown = 'code' in err ? err.code : undefined
  const codeText =
    typeof code === 'number' && Number.isSafeInteger(code) ? String(code) : code
  return {
    errorName: CONTENT_FREE_ERROR_NAME.test(err.name) ? err.name : null,
    errorCode:
      typeof codeText === 'string' && CONTENT_FREE_ERROR_CODE.test(codeText)
        ? codeText
        : null,
  }
}

/** BQC-3.3/3.8: classified failure handling — see the header table. */
async function handlePublishFailure(
  deps: PublishHandlerDeps,
  job: Job<PublishReplyJobData>,
  claimed: Reply,
  review: Review,
  err: unknown,
): Promise<void> {
  const logger = deps.logger
  const failure = classifyPublicationFailure(err)
  const attempt = job.attemptsMade + 1
  const finalAttempt = attempt >= MAX_ATTEMPTS
  // Content-free by construction: codes, dispatch, status, and the error's own
  // identifier-shaped name and code — never its message. Before D2 the
  // incident's compile refusal logged no code at all, so "never reached Google"
  // and "may have reached Google" looked identical. The error identity is what
  // separates the failures that carry no dispatch evidence: a Postgres error
  // after Google's 200 (`DatabaseError`/`40001`) from a transport failure.
  const fields = {
    attempt,
    failureClass: failure,
    ...publicationFailureEvidence(err),
    ...contentFreeErrorIdentity(err),
  }

  if (failure === 'terminal_rejection') {
    // A 4xx answer, a gone connection/authorization, or a request RepKey
    // refused before sending it: retrying cannot succeed. Mark terminal and
    // resolve — remaining attempts must not burn.
    logger.error(
      fields,
      'Reply publish failed terminally — marked publish_failed without retry',
    )
    await deps.replyCommandStore.markPublicationTerminal(
      claimed,
      'terminal_rejection',
      buildPublishFailedEvent(
        review,
        claimed,
        deps.clock(),
        'refused',
        publicationFailureCause(err),
      ),
    )
    return
  }

  if (failure === 'retryable') {
    // Explicit pre-dispatch transients and provider rate-limit responses prove
    // this attempt did not publish. Let BullMQ retry within its finite budget;
    // after the last attempt, expose a terminal failure the operator can retry.
    logger.error(fields, 'Reply publish failed (retryable)')
    if (finalAttempt) {
      await deps.replyCommandStore.markPublicationTerminal(
        claimed,
        'retryable',
        buildPublishFailedEvent(review, claimed, deps.clock(), 'not_sent'),
      )
    } else {
      await deps.replyCommandStore.markPublicationRetryQueued(claimed)
    }
    throw err
  }

  if (finalAttempt) {
    // Ambiguous on the FINAL attempt (timeout/unknown AFTER the request may
    // have landed): the reply may exist on Google. Honest unknown →
    // publish_failed + publication_state='ambiguous' + reconcile_due_at; the
    // reconciliation sweep and operator control are both read-only.
    logger.error(
      fields,
      'Ambiguous publish outcome on final attempt — marked publish_failed for read-only reconciliation',
    )
    await deps.replyCommandStore.markPublicationAmbiguous(
      claimed,
      buildPublishFailedEvent(review, claimed, deps.clock(), 'unconfirmed'),
    )
    throw err
  }

  // Ambiguous on a non-final attempt: preserve `sending` and let BullMQ run
  // one targeted readback. That next execution may confirm/supersede the
  // attempt, but it never interprets a missing echo as permission for another
  // provider write.
  logger.error(fields, 'Reply publish outcome ambiguous — next attempt reads back only')
  throw err
}
