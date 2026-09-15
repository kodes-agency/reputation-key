import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ReplyPublicationCheckOutcome,
  ReplyPublicationCheckResult,
} from '#/contexts/review/application/public-api'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { organizationId, replyId, reviewId } from '#/shared/domain/ids'
import { GENERIC_ACTION_ERROR_MESSAGE } from '#/components/hooks/use-action-mutation'
import {
  formatCheckTime,
  REPLY_CHECK_COPY,
  replyCheckErrorMessage,
  replyCheckFeedback,
  replyCheckLineKey,
  replyCheckMutationOptions,
} from './reply-check-feedback'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: vi.fn() }),
  createSerializationAdapter: (adapter: unknown) => adapter,
}))

afterEach(() => {
  vi.clearAllMocks()
})

const CHECKED_AT = new Date('2026-09-14T14:05:00.000Z')
const NEXT_CHECK_AT = new Date('2026-09-14T14:35:00.000Z')

/** A formatter that makes the time's slot visible without depending on locale. */
const at = (value: Date | string) => `<${new Date(value).toISOString()}>`

type CheckedReply = ReplyPublicationCheckResult['reply']

function checkedReply(overrides: Partial<CheckedReply> = {}): CheckedReply {
  return {
    id: replyId('reply-1'),
    reviewId: reviewId('review-1'),
    organizationId: organizationId('org-1'),
    text: 'Thank you for staying with us.',
    templateId: null,
    templateVersion: null,
    status: 'publish_failed',
    source: 'internal',
    createdBy: null,
    approvedBy: null,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    stateRevision: 3,
    submittedAt: CHECKED_AT,
    approvedAt: CHECKED_AT,
    publishedAt: null,
    publicationState: 'ambiguous',
    publicationCycle: 1,
    publicationAttempts: 1,
    publicationLastErrorClass: 'ambiguous',
    reconcileDueAt: NEXT_CHECK_AT,
    createdAt: CHECKED_AT,
    updatedAt: CHECKED_AT,
    ...overrides,
  }
}

function result(
  outcome: ReplyPublicationCheckOutcome,
  overrides: Partial<ReplyPublicationCheckResult> = {},
): ReplyPublicationCheckResult {
  return {
    reply: checkedReply(),
    outcome,
    checkedAt: CHECKED_AT,
    nextAutomaticCheckAt: NEXT_CHECK_AT,
    ...overrides,
  }
}

describe('replyCheckFeedback', () => {
  it('says when Google was checked and that RepKey checks again automatically', () => {
    expect(replyCheckFeedback(result('not_on_google'), at)).toEqual({
      kind: 'status',
      message: `Checked Google at ${at(CHECKED_AT)}. This reply isn't showing there. RepKey checks again automatically.`,
    })
  })

  it('promises no automatic check once the automatic checks have ended', () => {
    const feedback = replyCheckFeedback(
      result('not_on_google', { nextAutomaticCheckAt: null }),
      at,
    )
    expect(feedback).toEqual({
      kind: 'status',
      message: `Checked Google at ${at(CHECKED_AT)}. This reply isn't showing there.`,
    })
  })

  it('reads the check time from the wire string a server function may deliver', () => {
    const wire = result('not_on_google', {
      checkedAt: CHECKED_AT.toISOString() as unknown as Date,
    })
    expect(replyCheckFeedback(wire, at)).toEqual(
      replyCheckFeedback(result('not_on_google'), at),
    )
  })

  it('names an unreadable Google reply and keeps the time', () => {
    expect(replyCheckFeedback(result('unreadable_on_google'), at)).toEqual({
      kind: 'status',
      message: `Checked Google at ${at(CHECKED_AT)}. Google shows a reply RepKey can't read, so it will keep checking.`,
    })
  })

  it('promises no further check for an unreadable reply once automatic checks have ended', () => {
    // Terminal ambiguity: the use case reschedules nothing for `unreadable`
    // (check-reply-publication.ts resultFor → reply.reconcileDueAt, null here),
    // and the description above the line already says checks have stopped.
    const feedback = replyCheckFeedback(
      result('unreadable_on_google', {
        reply: checkedReply({ publicationState: 'terminal', reconcileDueAt: null }),
        nextAutomaticCheckAt: null,
      }),
      at,
    )
    expect(feedback).toEqual({
      kind: 'status',
      message: `Checked Google at ${at(CHECKED_AT)}. Google shows a reply RepKey can't read, so RepKey can't confirm this one. Look at the review on Google.`,
    })
  })

  it.each([
    [
      'different_reply_on_google',
      'Google shows a different reply on this review, so RepKey stopped publishing this one.',
    ],
    ['review_missing_on_google', 'Google no longer returns this review.'],
    ['cancelled', 'Publishing was cancelled.'],
  ] as const)('puts %s on the status line', (outcome, message) => {
    expect(replyCheckFeedback(result(outcome), at)).toEqual({ kind: 'status', message })
  })

  it.each([
    ['live_on_google', 'Your reply is live on Google.'],
    ['never_sent', "This reply never reached Google. It's safe to publish it again."],
  ] as const)('announces %s as a success toast', (outcome, message) => {
    expect(replyCheckFeedback(result(outcome), at)).toEqual({
      kind: 'toast',
      tone: 'success',
      message,
    })
  })

  it('toasts a status sentence when the check returned the reply to the composer', () => {
    // A superseded or cancelled publication goes back to `draft`, which the
    // thread does not render — there are no actions left to sit under.
    const feedback = replyCheckFeedback(
      result('different_reply_on_google', {
        reply: checkedReply({ status: 'draft', publicationState: 'cancelled' }),
        nextAutomaticCheckAt: null,
      }),
      at,
    )
    expect(feedback).toEqual({
      kind: 'toast',
      tone: 'info',
      message: REPLY_CHECK_COPY.differentReply,
    })
  })
})

describe('replyCheckLineKey', () => {
  const key = (overrides: Partial<CheckedReply> = {}) =>
    replyCheckLineKey(checkedReply(overrides))

  it('holds while the reply is where the line found it, whatever its next due time', () => {
    expect(key({ reconcileDueAt: new Date('2026-09-14T16:05:00.000Z') })).toBe(key())
    expect(key({ reconcileDueAt: NEXT_CHECK_AT.toISOString() as unknown as Date })).toBe(
      key(),
    )
  })

  it('changes when a poll confirms the reply, ends the checks, or shows another reply', () => {
    expect(key({ status: 'published', publicationState: 'published' })).not.toBe(key())
    expect(key({ publicationState: 'terminal', reconcileDueAt: null })).not.toBe(key())
    expect(key({ reconcileDueAt: null })).not.toBe(key())
    expect(key({ id: replyId('reply-2') })).not.toBe(key())
  })
})

describe('formatCheckTime', () => {
  it("formats in the viewer's locale at short time style", () => {
    expect(formatCheckTime(CHECKED_AT, 'en-US')).toBe(
      new Intl.DateTimeFormat('en-US', { timeStyle: 'short' }).format(CHECKED_AT),
    )
    expect(formatCheckTime(CHECKED_AT.toISOString(), 'en-US')).toBe(
      formatCheckTime(CHECKED_AT, 'en-US'),
    )
    // Short time style carries hours and minutes only.
    expect(formatCheckTime(CHECKED_AT, 'en-US')).not.toMatch(/:\d\d:\d\d/u)
  })
})

describe('replyCheckErrorMessage', () => {
  it("shows the check's own sentence for an unreachable Google, though it is a 500", () => {
    const unreachable = new ServerFunctionError(
      'ReviewError',
      "RepKey couldn't reach Google to check this reply. Try again in a minute.",
      'sync_failed',
      500,
    )
    expect(replyCheckErrorMessage(unreachable)).toBe(
      "RepKey couldn't reach Google to check this reply. Try again in a minute.",
    )
  })

  it('shows a refusal and hides any other server failure', () => {
    const refusal = new ServerFunctionError(
      'ReviewError',
      'This reply has nothing to check on Google.',
      'invalid_transition',
      400,
    )
    const failure = new ServerFunctionError(
      'InternalError',
      'connection terminated',
      'internal_error',
      500,
    )
    expect(replyCheckErrorMessage(refusal)).toBe(
      'This reply has nothing to check on Google.',
    )
    expect(replyCheckErrorMessage(failure)).toBe(GENERIC_ACTION_ERROR_MESSAGE)
    expect(replyCheckErrorMessage(new Error('boom'))).toBe(GENERIC_ACTION_ERROR_MESSAGE)
  })
})

describe('replyCheckMutationOptions', () => {
  const optionsFor = (openReviewId = 'review-1') => {
    const onReplyChanged = vi.fn()
    const onCheckFailed = vi.fn()
    const options = replyCheckMutationOptions({
      reviewId: openReviewId,
      onReplyChanged,
      onCheckFailed,
    })
    return { options, onReplyChanged, onCheckFailed }
  }

  it('hands the returned reply to the cache and toasts a confirmed reply', async () => {
    const { options, onReplyChanged } = optionsFor()
    const live = result('live_on_google', {
      reply: checkedReply({ status: 'published', publicationState: 'published' }),
    })

    await options.onSuccess?.(live, { data: { reviewId: 'review-1' } })

    expect(onReplyChanged).toHaveBeenCalledWith({
      kind: 'state_changed',
      reply: live.reply,
      reviewId: 'review-1',
    })
    expect(toast.success).toHaveBeenCalledWith('Your reply is live on Google.')
    expect(options.errorMessage).toBe(replyCheckErrorMessage)
  })

  it('leaves a status-line outcome to the line, with no toast', async () => {
    const { options, onReplyChanged } = optionsFor()
    const notShowing = result('not_on_google')

    await options.onSuccess?.(notShowing, { data: { reviewId: 'review-1' } })

    expect(onReplyChanged).toHaveBeenCalledWith({
      kind: 'state_changed',
      reply: notShowing.reply,
      reviewId: 'review-1',
    })
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('names the checked review, and says nothing once another review is open', async () => {
    // The options of the item open at settle time; the input is the check's.
    const { options, onReplyChanged } = optionsFor('review-2')
    const neverSent = result('never_sent', {
      reply: checkedReply({ publicationState: 'terminal', reconcileDueAt: null }),
    })

    await options.onSuccess?.(neverSent, { data: { reviewId: 'review-1' } })

    expect(onReplyChanged).toHaveBeenCalledWith(
      expect.objectContaining({ reviewId: 'review-1' }),
    )
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('reports a failed check for the review it was issued for', () => {
    const { options, onCheckFailed } = optionsFor('review-2')

    options.onError?.(new Error('refused'), { data: { reviewId: 'review-1' } })

    expect(onCheckFailed).toHaveBeenCalledWith('review-1')
  })
})
