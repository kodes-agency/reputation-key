// Inbox context — check one Google review from the Inbox, on demand.
//
// A manager who has answered a review on Google, or who wants to know whether
// someone else has, asks RepKey to look at Google now instead of waiting for
// the next reconciliation (about every 6 h). The read itself is Review's
// "check a review on Google" capability, the same one the reminder pre-check
// uses: it records what Google shows through the observation writer, so a
// reply written on Google closes the Inbox item along the normal event path.
// This use case adds only what a person-triggered read needs: the same
// authorization as viewing the item, a budget so a held-down button cannot
// become a Google read loop, and an answer in the manager's terms.
//
// Content-free throughout: the answer and the log line carry a verdict (the log
// no ids either, which the observability schema forbids), the rate-limit keys
// carry ids, and none carries review or reply text.

import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { ReviewId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { canForContext } from '#/shared/domain/permissions'
import { inboxError } from '../../domain/errors'
import { isAnsweringGoogleReply } from '../../domain/rules'
import { assertInboxSourcePropertyAccessible, canReadInboxSource } from '../inbox-access'
import type {
  GoogleCheckRateLimit,
  GoogleCheckRateLimitPort,
} from '../ports/google-check-rate-limit.port'
import type { GoogleReviewCheckPort } from '../ports/google-review-check.port'
import type { InboxRepository } from '../ports/inbox.repository'
import type { ReplyLookupPort } from '../ports/reply-lookup.port'

/** One check per review per minute: a second click is told to wait. */
export const GOOGLE_CHECK_REVIEW_LIMIT: GoogleCheckRateLimit = Object.freeze({
  maxRequests: 1,
  windowSeconds: 60,
})

/** All managers of one Organization together: 30 checks a minute. */
export const GOOGLE_CHECK_ORGANIZATION_LIMIT: GoogleCheckRateLimit = Object.freeze({
  maxRequests: 30,
  windowSeconds: 60,
})

export type CheckInboxReviewOnGoogleInput = Readonly<{
  reviewId: ReviewId
}>

/**
 * What the manager is told.
 * - `reply_found`: Google shows a reply that answers the review; the item is
 *   closing through the event path.
 * - `no_reply`: Google was read and shows none.
 * - `unavailable`: Google could not be read right now (or the answer could not
 *   be recovered); trying again later may work.
 * - `not_checkable`: this review cannot be read from Google at all (no
 *   connection, expired content, not a Google review); asking again will not
 *   change that.
 * - `rate_limited`: asked too often for this review or this Organization.
 */
export type InboxGoogleCheckOutcome =
  'reply_found' | 'no_reply' | 'unavailable' | 'not_checkable' | 'rate_limited'

export type CheckInboxReviewOnGoogleResult = Readonly<{
  outcome: InboxGoogleCheckOutcome
}>

export type CheckInboxReviewOnGoogleDeps = Readonly<{
  repo: Pick<InboxRepository, 'findBySource'>
  staffPublicApi: StaffPublicApi
  googleReviewCheck: GoogleReviewCheckPort
  replyLookup: Pick<ReplyLookupPort, 'getGoogleReplyHeadsByReviewIds'>
  rateLimit: GoogleCheckRateLimitPort
  logger: Pick<LoggerPort, 'info'>
}>

type Logged = Readonly<{
  outcome: InboxGoogleCheckOutcome
  /** Why a review was not checkable, when Review said. */
  reason?: string
}>

const GOOGLE_PLATFORM = 'google'

export const checkInboxReviewOnGoogle =
  (deps: CheckInboxReviewOnGoogleDeps) =>
  async (
    input: CheckInboxReviewOnGoogleInput,
    ctx: AuthContext,
  ): Promise<CheckInboxReviewOnGoogleResult> => {
    // Authorized exactly as viewing the item (`getInboxItemDetail`): the Inbox
    // read right, the review source right, and the item's Property.
    if (!canForContext(ctx, 'inbox.read') || !canReadInboxSource(ctx, 'review')) {
      throw inboxError('forbidden', 'No access to this inbox source')
    }
    const item = await deps.repo.findBySource(
      'review',
      input.reviewId,
      ctx.organizationId,
    )
    if (!item) {
      throw inboxError('not_found', 'Inbox item not found')
    }
    await assertInboxSourcePropertyAccessible(
      deps.staffPublicApi,
      ctx,
      'read',
      'review',
      item.propertyId,
    )

    // No ids: the observability schema bans organization, property and review
    // ids as log keys, and the request's own correlation (`tracedHandler`) ties
    // the line to the call. Outcome and reason only.
    const log = (logged: Logged) =>
      deps.logger.info(
        { stage: 'inbox_check_review_on_google', ...logged },
        'Inbox check of a review on Google',
      )
    const finish = (logged: Logged): CheckInboxReviewOnGoogleResult => {
      log(logged)
      return { outcome: logged.outcome }
    }

    // Only Google reviews have a Google to read; nothing is spent on others.
    if (item.platform !== GOOGLE_PLATFORM) {
      return finish({ outcome: 'not_checkable', reason: 'not_a_google_review' })
    }

    const budget = await spendBudget(deps.rateLimit, ctx, input.reviewId)
    if (budget !== 'allowed') {
      return finish({ outcome: budget === 'limited' ? 'rate_limited' : 'unavailable' })
    }

    const outcome = await readGoogle(deps, {
      organizationId: ctx.organizationId,
      propertyId: item.propertyId,
      reviewId: input.reviewId,
    })
    return finish(outcome)
  }

export type CheckInboxReviewOnGoogle = ReturnType<typeof checkInboxReviewOnGoogle>

/**
 * The per-review slot first, so a manager who keeps clicking one review is
 * refused by the narrow budget without using up the Organization's.
 */
const spendBudget = async (
  rateLimit: GoogleCheckRateLimitPort,
  ctx: AuthContext,
  reviewId: ReviewId,
): Promise<'allowed' | 'limited' | 'unavailable'> => {
  const perReview = await rateLimit.consume(
    `inbox:google-check:review:${ctx.organizationId}:${reviewId}`,
    GOOGLE_CHECK_REVIEW_LIMIT,
  )
  if (perReview !== 'allowed') return perReview
  return rateLimit.consume(
    `inbox:google-check:organization:${ctx.organizationId}`,
    GOOGLE_CHECK_ORGANIZATION_LIMIT,
  )
}

/** Read Google once, then ask Review whether the head it now holds answers the review. */
const readGoogle = async (
  deps: CheckInboxReviewOnGoogleDeps,
  request: Parameters<GoogleReviewCheckPort['check']>[0],
): Promise<Logged> => {
  let read
  try {
    read = await deps.googleReviewCheck.check(request)
  } catch {
    // The port promises not to throw; a thrown one is a failed read.
    return { outcome: 'unavailable', reason: 'check_threw' }
  }
  switch (read.status) {
    case 'not_checkable':
      return { outcome: 'not_checkable', reason: read.reason }
    case 'review_missing':
      return { outcome: 'not_checkable', reason: 'review_missing' }
    case 'unavailable':
      return { outcome: 'unavailable', reason: `retry_${read.retry}` }
    case 'reply_unreadable':
      // Google shows a reply whose text could not be recovered: nothing was
      // recorded, so nothing will close. "No reply" would be untrue.
      return { outcome: 'unavailable', reason: 'reply_unreadable' }
    case 'read':
      return answerFromHead(deps, request)
  }
}

const answerFromHead = async (
  deps: CheckInboxReviewOnGoogleDeps,
  request: Parameters<GoogleReviewCheckPort['check']>[0],
): Promise<Logged> => {
  try {
    const heads = await deps.replyLookup.getGoogleReplyHeadsByReviewIds(
      [request.reviewId],
      request.organizationId,
    )
    const head = heads.get(request.reviewId)
    return head !== undefined && isAnsweringGoogleReply(head)
      ? { outcome: 'reply_found' }
      : { outcome: 'no_reply' }
  } catch {
    return { outcome: 'unavailable', reason: 'head_unreadable' }
  }
}
