// Google moderates owner replies and documents two output fields on the review
// reply: `reviewReplyState` and `policyViolation` (set only when REJECTED). The
// adapter reads them into a closed RepKey type and counts them per read, so the
// behaviour decision that follows is designed from what Google really sends. A
// value it has never seen must never fail a page, and nothing it logs may carry
// reply text.

import { describe, expect, it, vi, type Mock } from 'vitest'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import type { GoogleProviderCallAuthorization } from '../../application/google-provider-contract'
import type { GoogleReviewCursorStore } from '../google-review-cursor-store'
import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
} from '../../../../../test-fixtures/generated/google-provider-identifiers-v1'
import { createGoogleReviewApiAdapter } from './google-review-api.adapter'

const ORG_ID = organizationId('0UM0PoDLJNJ3yGCeBMERaQkQyxer9BuC')
const PROPERTY_ID = propertyId('00000000-0000-4000-8000-000000000002')
const CONNECTION_ID = googleConnectionId('00000000-0000-4000-8000-000000000003')
const RUN_ID = '00000000-0000-4000-8000-000000000004'
const REPLY_TEXT = 'Thank you for staying with us, come again soon.'
const REPLY_TIME = '2026-09-09T09:01:28.000Z'
const authorization = Object.freeze({
  capability: 'property.connect_gbp',
  organizationId: ORG_ID,
  propertyId: PROPERTY_ID,
  connectionId: CONNECTION_ID,
  initiatorUserId: null,
  expectedCredentialGeneration: 3,
  authorizationVector: Object.freeze({ generation: 3, propertySourceEpoch: 17 }),
}) satisfies GoogleProviderCallAuthorization

const connection = {
  status: 'active',
  credentialUseState: 'active',
  lifecycleVersion: 7,
  accessVersion: 11,
  credentialGeneration: 3,
}

function cursorStore(): GoogleReviewCursorStore {
  return {
    redeem: vi.fn(async () => ({
      ok: true as const,
      value: { pageToken: 'provider-page-token' },
    })),
    release: vi.fn(async () => ({ ok: true as const, value: null })),
    publishNext: vi.fn(async () => ({
      ok: true as const,
      value: { nextCursorRef: `v1.${'a'.repeat(43)}` },
    })),
    discardRun: vi.fn(async () => true),
    startedAtMs: vi.fn(async () => null),
  }
}

function providerReview(
  reviewReply?: unknown,
  name: string = GOOGLE_REVIEW_PRIMARY_RESOURCE,
) {
  return {
    name,
    starRating: 'FIVE',
    comment: 'Excellent stay',
    reviewer: { displayName: 'Guest' },
    createTime: '2026-08-01T10:00:00.000Z',
    ...(reviewReply === undefined ? {} : { reviewReply }),
  }
}

function reply(extra: Record<string, unknown> = {}) {
  return { comment: REPLY_TEXT, updateTime: REPLY_TIME, ...extra }
}

function jsonAnswer(body: unknown): Mock {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: {
      contentType: 'application/json; charset=utf-8',
      cacheControl: null,
      retryAfter: null,
    },
    body: new TextEncoder().encode(JSON.stringify(body)),
  })
}

function reviewsPage(reviews: readonly unknown[]): Mock {
  return jsonAnswer({ reviews, totalReviewCount: reviews.length, averageRating: 5 })
}

function createAdapter(execute: Mock) {
  const info = vi.fn()
  const warn = vi.fn()
  const api = createGoogleReviewApiAdapter({
    connectionRepo: { findById: vi.fn().mockResolvedValue(connection) } as never,
    logger: { info, warn } as never,
    cursorStore: cursorStore(),
    executor: { execute },
    authorizeReviewSyncProviderCall: vi.fn().mockResolvedValue({
      accessToken: 'access-token',
      authorization,
    }),
    authorizeReplyPublicationProviderCall: vi.fn(),
    nowMs: () => Date.parse('2026-08-12T12:00:00.000Z'),
  })
  return { api, info, warn }
}

const listInput = {
  organizationId: ORG_ID,
  propertyId: PROPERTY_ID,
  connectionId: CONNECTION_ID,
  sourceEpoch: 17,
  locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
  runId: RUN_ID,
  phase: 'main' as const,
  pageIndex: 0,
  cursorRef: null,
}

const getInput = {
  organizationId: ORG_ID,
  propertyId: PROPERTY_ID,
  connectionId: CONNECTION_ID,
  sourceEpoch: 17,
  locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
  reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
}

async function moderationOf(reviewReply: unknown) {
  const { api, info, warn } = createAdapter(reviewsPage([providerReview(reviewReply)]))
  const page = await api.listReviewsPage(listInput)
  return { moderation: page.reviews[0]?.replyModeration, info, warn }
}

describe('GoogleReviewApiAdapter reply moderation', () => {
  it.each([
    ['PENDING', 'pending'],
    ['APPROVED', 'approved'],
    ['REJECTED', 'rejected'],
    ['REVIEW_REPLY_STATE_UNSPECIFIED', 'unspecified'],
  ])('reads reviewReplyState %s as %s', async (wire, state) => {
    const { moderation, warn } = await moderationOf(reply({ reviewReplyState: wire }))

    expect(moderation?.state).toBe(state)
    expect(warn).not.toHaveBeenCalled()
  })

  it('reads a reply that carries no state as absent, keeping what else it carries', async () => {
    const { moderation } = await moderationOf(reply())

    expect(moderation).toEqual({
      state: 'absent',
      policyViolation: null,
      commentPresent: true,
      commentEmpty: false,
      updateTimePresent: true,
      updateTimeEmpty: false,
    })
  })

  it('reads a review with no reply as absent with nothing present', async () => {
    const { moderation, info } = await moderationOf(undefined)

    expect(moderation).toEqual({
      state: 'absent',
      policyViolation: null,
      commentPresent: false,
      commentEmpty: false,
      updateTimePresent: false,
      updateTimeEmpty: false,
    })
    expect(info).not.toHaveBeenCalled()
  })

  it.each([
    ['a value Google has not documented', 'SUSPENDED'],
    ['a lower-case spelling', 'pending'],
    ['a number', 7],
    ['an object', { value: 'PENDING' }],
  ])('reads %s as unspecified and counts it without its value', async (_case, wire) => {
    const { moderation, warn } = await moderationOf(reply({ reviewReplyState: wire }))

    expect(moderation?.state).toBe('unspecified')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'reviews_reply_moderation_unknown',
        operation: 'reviews.list',
        unknownState: 1,
        unknownPolicyViolation: 0,
      }),
      expect.any(String),
    )
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SUSPENDED')
  })

  it('reads a null state as absent, not as an unknown value', async () => {
    const { moderation, warn } = await moderationOf(reply({ reviewReplyState: null }))

    expect(moderation?.state).toBe('absent')
    expect(warn).not.toHaveBeenCalled()
  })

  it('keeps the policy code only when the reply is REJECTED', async () => {
    const rejected = await moderationOf(
      reply({ reviewReplyState: 'REJECTED', policyViolation: 'SPAM' }),
    )
    const pending = await moderationOf(
      reply({ reviewReplyState: 'PENDING', policyViolation: 'SPAM' }),
    )
    const approved = await moderationOf(
      reply({ reviewReplyState: 'APPROVED', policyViolation: 'SPAM' }),
    )

    expect(rejected.moderation?.policyViolation).toBe('SPAM')
    expect(pending.moderation?.policyViolation).toBeNull()
    expect(approved.moderation?.policyViolation).toBeNull()
  })

  it('keeps a rejected reply with no policy code as null', async () => {
    const { moderation } = await moderationOf(reply({ reviewReplyState: 'REJECTED' }))

    expect(moderation?.policyViolation).toBeNull()
  })

  it.each([
    ['a value that is not a code', 'it was rude to the guest'],
    ['an empty string', ''],
    ['a number', 12],
    ['an object', { code: 'SPAM' }],
    ['a code over 64 characters', 'A'.repeat(65)],
  ])(
    'keeps UNKNOWN for %s on a REJECTED reply, never rejecting the page',
    async (_case, wire) => {
      const { moderation, warn } = await moderationOf(
        reply({ reviewReplyState: 'REJECTED', policyViolation: wire }),
      )

      expect(moderation?.state).toBe('rejected')
      expect(moderation?.policyViolation).toBe('UNKNOWN')
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ unknownState: 0, unknownPolicyViolation: 1 }),
        expect.any(String),
      )
      expect(JSON.stringify(warn.mock.calls)).not.toContain('rude')
    },
  )

  it('reports a REJECTED reply with no comment and no update time as such', async () => {
    const { moderation } = await moderationOf({
      reviewReplyState: 'REJECTED',
      policyViolation: 'SPAM',
    })

    expect(moderation).toEqual({
      state: 'rejected',
      policyViolation: 'SPAM',
      commentPresent: false,
      commentEmpty: false,
      updateTimePresent: false,
      updateTimeEmpty: false,
    })
  })

  it('tells an empty comment and update time from missing ones', async () => {
    const empty = await moderationOf({
      comment: '',
      updateTime: '',
      reviewReplyState: 'PENDING',
    })
    const missing = await moderationOf({ reviewReplyState: 'PENDING' })

    expect(empty.moderation).toMatchObject({
      commentPresent: false,
      commentEmpty: true,
      updateTimePresent: false,
      updateTimeEmpty: true,
    })
    expect(missing.moderation).toMatchObject({
      commentPresent: false,
      commentEmpty: false,
      updateTimePresent: false,
      updateTimeEmpty: false,
    })
  })

  it.each(['PENDING', 'APPROVED', 'SUSPENDED', undefined])(
    'counts a policy code sent with state %s without its value',
    async (state) => {
      const { moderation, warn } = await moderationOf(
        reply({ reviewReplyState: state, policyViolation: 'SPAM' }),
      )

      expect(moderation?.policyViolation).toBeNull()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'reviews_reply_moderation_unknown',
          policyViolationWithoutRejected: 1,
        }),
        expect.any(String),
      )
      expect(JSON.stringify(warn.mock.calls)).not.toContain('SPAM')
    },
  )

  it('does not count a policy code sent with a REJECTED reply as unexpected', async () => {
    const { warn } = await moderationOf(
      reply({ reviewReplyState: 'REJECTED', policyViolation: 'SPAM' }),
    )

    expect(warn).not.toHaveBeenCalled()
  })

  it('reads the state of a reply whose original text cannot be recovered', async () => {
    const { api } = createAdapter(
      reviewsPage([
        providerReview(
          reply({
            comment: '(Translated by Google) Thank you.',
            reviewReplyState: 'PENDING',
          }),
        ),
      ]),
    )

    const page = await api.listReviewsPage(listInput)

    expect(page.reviews[0]).toMatchObject({
      replyUnreadable: true,
      replyText: null,
      replyModeration: { state: 'pending', commentPresent: true },
    })
  })

  it('leaves the reply text, its time and the unreadable flag as they were', async () => {
    const withState = await moderationOfReview(reply({ reviewReplyState: 'PENDING' }))
    const without = await moderationOfReview(reply())

    expect(withState).toMatchObject({
      replyText: without?.replyText,
      replyUpdatedAt: without?.replyUpdatedAt,
      replyUnreadable: without?.replyUnreadable,
    })
    expect(withState?.replyText).toBe(REPLY_TEXT)
  })

  it('counts the states of one page in one content-free line', async () => {
    const second = GOOGLE_REVIEW_PRIMARY_RESOURCE.replace(/0001$/u, '0002')
    const third = GOOGLE_REVIEW_PRIMARY_RESOURCE.replace(/0001$/u, '0003')
    const fourth = GOOGLE_REVIEW_PRIMARY_RESOURCE.replace(/0001$/u, '0004')
    const { api, info } = createAdapter(
      reviewsPage([
        providerReview(reply({ reviewReplyState: 'PENDING' })),
        providerReview(reply({ reviewReplyState: 'APPROVED' }), second),
        providerReview(
          reply({ reviewReplyState: 'REJECTED', policyViolation: 'SPAM' }),
          third,
        ),
        providerReview(undefined, fourth),
      ]),
    )

    await api.listReviewsPage(listInput)

    expect(info).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith(
      {
        event: 'reviews_reply_moderation',
        operation: 'reviews.list',
        reviews: 4,
        replies: 3,
        pending: 1,
        approved: 1,
        rejected: 1,
        unspecified: 0,
        stateAbsent: 0,
      },
      'Google reply moderation states read',
    )
    expect(JSON.stringify(info.mock.calls)).not.toContain(REPLY_TEXT)
    expect(JSON.stringify(info.mock.calls)).not.toContain('SPAM')
  })

  it('counts replies that arrive without a state, so a field Google never sends shows', async () => {
    const { info } = await moderationOf(reply())

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ replies: 1, stateAbsent: 1, approved: 0 }),
      expect.any(String),
    )
  })

  it('logs the same counts for a targeted read of one review', async () => {
    const { api, info } = createAdapter(
      jsonAnswer(providerReview(reply({ reviewReplyState: 'PENDING' }))),
    )

    const result = await api.getReview(getInput)

    expect(result).toMatchObject({
      status: 'found',
      review: { replyModeration: { state: 'pending' } },
    })
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'reviews_reply_moderation',
        operation: 'reviews.get',
        reviews: 1,
        replies: 1,
        pending: 1,
      }),
      'Google reply moderation states read',
    )
  })
})

async function moderationOfReview(reviewReply: unknown) {
  const { api } = createAdapter(reviewsPage([providerReview(reviewReply)]))
  const page = await api.listReviewsPage(listInput)
  return page.reviews[0]
}
