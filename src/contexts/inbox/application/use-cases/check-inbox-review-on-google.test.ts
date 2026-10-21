import { describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_CHECK_ORGANIZATION_LIMIT,
  GOOGLE_CHECK_REVIEW_LIMIT,
  checkInboxReviewOnGoogle,
} from './check-inbox-review-on-google'
import {
  inboxItemId,
  organizationId,
  propertyId,
  replyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'
import { isInboxError } from '../../domain/errors'
import type { InboxRepository } from '../ports/inbox.repository'
import type {
  GoogleReviewCheckOutcome,
  GoogleReviewCheckPort,
} from '../ports/google-review-check.port'
import type {
  GoogleCheckRateLimitDecision,
  GoogleCheckRateLimitPort,
} from '../ports/google-check-rate-limit.port'
import type { GoogleReplyHead, ReplyLookupPort } from '../ports/reply-lookup.port'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { createMockLogger } from '#/shared/testing/mock-logger'

const NOW = new Date('2026-10-21T10:00:00.000Z')
const ORG = organizationId('org-1')
const OTHER_ORG = organizationId('org-2')
const PROPERTY = propertyId('prop-1')
const OTHER_PROPERTY = propertyId('prop-2')
const REVIEW = reviewId('rev-1')
const USER = userId('user-1')

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: inboxItemId('ii-1'),
    organizationId: ORG,
    propertyId: PROPERTY,
    sourceType: 'review',
    sourceId: REVIEW,
    status: 'open',
    rating: null,
    sourceDate: NOW,
    platform: 'google',
    snippet: null,
    assignedTo: null,
    reviewerName: null,
    propertyName: null,
    isEscalated: false,
    escalatedAt: null,
    escalatedBy: null,
    escalationResolvedAt: null,
    escalationResolvedBy: null,
    closedAt: null,
    firstReplySubmittedAt: null,
    firstReplyPublishedAt: null,
    commandRevision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

const head = (overrides: Partial<GoogleReplyHead> = {}): GoogleReplyHead => ({
  reviewId: REVIEW,
  propertyId: PROPERTY,
  observationRevision: 3,
  sourceEpoch: 1,
  materialReviewRevision: 1,
  state: 'live',
  change: 'added',
  resolution: 'external_current_live',
  provenance: 'external_or_unknown',
  matchedReplyId: null,
  matchedPublicationCycle: null,
  observedAt: NOW,
  ...overrides,
})

const ctxWith = (...permissions: Permission[]): AuthContext =>
  createScopedAuthContext({
    organizationId: ORG,
    userId: USER,
    permissions: permissions.map((permission) => [permission, 'organization'] as const),
  })

const MANAGER = ctxWith('inbox.read', 'review.read')

type Options = Readonly<{
  item?: InboxItem | null
  accessible?: ReadonlyArray<string> | null
  check?: GoogleReviewCheckOutcome | Error
  heads?: ReadonlyMap<string, GoogleReplyHead> | Error
  limits?: (key: string) => GoogleCheckRateLimitDecision
}>

function setup(options: Options = {}) {
  const item = options.item === undefined ? makeItem() : options.item
  const bySource = vi.fn(async (_type, sourceId: string, orgId) =>
    item !== null && item.sourceId === sourceId && item.organizationId === orgId
      ? item
      : null,
  )
  const repo = { findBySource: bySource } as unknown as Pick<
    InboxRepository,
    'findBySource'
  >
  const staffPublicApi: StaffPublicApi = {
    getAccessiblePropertyIds: async () =>
      options.accessible === undefined || options.accessible === null
        ? null
        : options.accessible.map(propertyId),
    getAssignedPortals: async () => [],
  }
  const check = vi.fn(async (): Promise<GoogleReviewCheckOutcome> => {
    const outcome = options.check ?? { status: 'read' }
    if (outcome instanceof Error) throw outcome
    return outcome
  })
  const googleReviewCheck: GoogleReviewCheckPort = { check }
  const getHeads = vi.fn(async () => {
    const heads = options.heads ?? new Map<string, GoogleReplyHead>()
    if (heads instanceof Error) throw heads
    return heads
  })
  const replyLookup = { getGoogleReplyHeadsByReviewIds: getHeads } as Pick<
    ReplyLookupPort,
    'getGoogleReplyHeadsByReviewIds'
  >
  const keys: string[] = []
  const consume = vi.fn(async (key: string) => {
    keys.push(key)
    return options.limits?.(key) ?? 'allowed'
  })
  const rateLimit: GoogleCheckRateLimitPort = { consume }
  const logs: Array<Record<string, unknown>> = []
  const logger: LoggerPort = {
    ...createMockLogger(),
    info: ((fields: unknown) => {
      logs.push(fields as Record<string, unknown>)
    }) as LoggerPort['info'],
  }
  const useCase = checkInboxReviewOnGoogle({
    repo,
    staffPublicApi,
    googleReviewCheck,
    replyLookup,
    rateLimit,
    logger,
  })
  return { useCase, bySource, check, getHeads, consume, keys, logs }
}

const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    if (isInboxError(error)) return error.code
    throw error
  }
  return null
}

describe('checkInboxReviewOnGoogle authorization', () => {
  it('refuses a caller without inbox.read, and reads nothing', async () => {
    const { useCase, check, consume } = setup()
    const code = await refusal(useCase({ reviewId: REVIEW }, ctxWith('review.read')))
    expect(code).toBe('forbidden')
    expect(check).not.toHaveBeenCalled()
    expect(consume).not.toHaveBeenCalled()
  })

  it('refuses a caller who may not read review sources', async () => {
    const { useCase, check } = setup()
    const code = await refusal(useCase({ reviewId: REVIEW }, ctxWith('inbox.read')))
    expect(code).toBe('forbidden')
    expect(check).not.toHaveBeenCalled()
  })

  it("refuses a caller with no access to the item's Property", async () => {
    const { useCase, check, consume } = setup({ accessible: [OTHER_PROPERTY] })
    const ctx = createScopedAuthContext({
      organizationId: ORG,
      userId: USER,
      permissions: [
        ['inbox.read', 'assigned-properties'],
        ['review.read', 'assigned-properties'],
      ],
    })
    const code = await refusal(useCase({ reviewId: REVIEW }, ctx))
    expect(code).toBe('forbidden')
    expect(check).not.toHaveBeenCalled()
    expect(consume).not.toHaveBeenCalled()
  })

  it('answers not_found for a review with no Inbox item', async () => {
    const { useCase, check } = setup({ item: null })
    expect(await refusal(useCase({ reviewId: REVIEW }, MANAGER))).toBe('not_found')
    expect(check).not.toHaveBeenCalled()
  })

  it("answers not_found for another Organization's review, as if it did not exist", async () => {
    const { useCase, check } = setup({ item: makeItem({ organizationId: OTHER_ORG }) })
    expect(await refusal(useCase({ reviewId: REVIEW }, MANAGER))).toBe('not_found')
    expect(check).not.toHaveBeenCalled()
  })
})

describe('checkInboxReviewOnGoogle outcomes', () => {
  it('reports reply_found when the read shows a reply that answers the review', async () => {
    const { useCase, check } = setup({
      heads: new Map([[REVIEW, head()]]),
    })
    expect(await useCase({ reviewId: REVIEW }, MANAGER)).toEqual({
      outcome: 'reply_found',
    })
    expect(check).toHaveBeenCalledWith({
      organizationId: ORG,
      propertyId: PROPERTY,
      reviewId: REVIEW,
    })
  })

  it('reports a reply RepKey confirmed on Google as reply_found', async () => {
    const { useCase } = setup({
      heads: new Map([
        [
          REVIEW,
          head({
            resolution: 'confirmed_on_google',
            provenance: 'repkey_confirmed',
            matchedReplyId: replyId('reply-1'),
          }),
        ],
      ]),
    })
    expect((await useCase({ reviewId: REVIEW }, MANAGER)).outcome).toBe('reply_found')
  })

  it('reports no_reply when the read shows no reply head', async () => {
    const { useCase } = setup({ heads: new Map() })
    expect((await useCase({ reviewId: REVIEW }, MANAGER)).outcome).toBe('no_reply')
  })

  it('reports no_reply when the head says Google shows no reply', async () => {
    const { useCase } = setup({
      heads: new Map([
        [REVIEW, head({ state: 'absent', resolution: 'absent', change: 'deleted' })],
      ]),
    })
    expect((await useCase({ reviewId: REVIEW }, MANAGER)).outcome).toBe('no_reply')
  })

  it('does not call a diverged reading a reply that closes the item', async () => {
    const { useCase } = setup({
      heads: new Map([[REVIEW, head({ resolution: 'diverged' })]]),
    })
    expect((await useCase({ reviewId: REVIEW }, MANAGER)).outcome).toBe('no_reply')
  })

  it('reports unavailable when Google could not be read, transient or permanent', async () => {
    for (const retry of ['later', 'never'] as const) {
      const { useCase, getHeads } = setup({ check: { status: 'unavailable', retry } })
      expect((await useCase({ reviewId: REVIEW }, MANAGER)).outcome).toBe('unavailable')
      expect(getHeads).not.toHaveBeenCalled()
    }
  })

  it('reports unavailable when the Google reply cannot be recovered', async () => {
    const { useCase } = setup({ check: { status: 'reply_unreadable' } })
    expect((await useCase({ reviewId: REVIEW }, MANAGER)).outcome).toBe('unavailable')
  })

  it('reports unavailable, not an error, when the check port throws', async () => {
    const { useCase } = setup({ check: new Error('boom') })
    expect((await useCase({ reviewId: REVIEW }, MANAGER)).outcome).toBe('unavailable')
  })

  it('reports unavailable when the reply head cannot be read after the read', async () => {
    const { useCase } = setup({ heads: new Error('db down') })
    expect((await useCase({ reviewId: REVIEW }, MANAGER)).outcome).toBe('unavailable')
  })

  it('reports not_checkable when the review cannot be read from Google at all', async () => {
    const { useCase, getHeads } = setup({
      check: { status: 'not_checkable', reason: 'content_expired' },
    })
    expect((await useCase({ reviewId: REVIEW }, MANAGER)).outcome).toBe('not_checkable')
    expect(getHeads).not.toHaveBeenCalled()
  })

  it('reports not_checkable when Google no longer has the review', async () => {
    const { useCase } = setup({ check: { status: 'review_missing' } })
    expect((await useCase({ reviewId: REVIEW }, MANAGER)).outcome).toBe('not_checkable')
  })

  it('reports not_checkable for an item that is not a Google review, and reads nothing', async () => {
    const { useCase, check, consume } = setup({ item: makeItem({ platform: null }) })
    expect((await useCase({ reviewId: REVIEW }, MANAGER)).outcome).toBe('not_checkable')
    expect(check).not.toHaveBeenCalled()
    expect(consume).not.toHaveBeenCalled()
  })
})

describe('checkInboxReviewOnGoogle rate limits', () => {
  it('spends one slot per review and one per Organization, review first', async () => {
    const { useCase, consume, keys } = setup()
    await useCase({ reviewId: REVIEW }, MANAGER)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toContain(REVIEW)
    expect(keys[0]).toContain(ORG)
    expect(keys[1]).toContain(ORG)
    expect(keys[1]).not.toContain(REVIEW)
    expect(consume).toHaveBeenNthCalledWith(1, keys[0], GOOGLE_CHECK_REVIEW_LIMIT)
    expect(consume).toHaveBeenNthCalledWith(2, keys[1], GOOGLE_CHECK_ORGANIZATION_LIMIT)
  })

  it('allows one call per review per 60 seconds and 30 per Organization per minute', () => {
    expect(GOOGLE_CHECK_REVIEW_LIMIT).toEqual({ maxRequests: 1, windowSeconds: 60 })
    expect(GOOGLE_CHECK_ORGANIZATION_LIMIT).toEqual({
      maxRequests: 30,
      windowSeconds: 60,
    })
  })

  it('answers rate_limited, without reading Google, when the review budget is spent', async () => {
    const { useCase, check, consume } = setup({
      limits: (key) => (key.includes(REVIEW) ? 'limited' : 'allowed'),
    })
    expect(await useCase({ reviewId: REVIEW }, MANAGER)).toEqual({
      outcome: 'rate_limited',
    })
    expect(check).not.toHaveBeenCalled()
    // The Organization budget is not spent by a call the review budget refused.
    expect(consume).toHaveBeenCalledTimes(1)
  })

  it('answers rate_limited, without reading Google, when the Organization budget is spent', async () => {
    const { useCase, check } = setup({
      limits: (key) => (key.includes(REVIEW) ? 'allowed' : 'limited'),
    })
    expect((await useCase({ reviewId: REVIEW }, MANAGER)).outcome).toBe('rate_limited')
    expect(check).not.toHaveBeenCalled()
  })

  it('answers unavailable, without reading Google, when the limiter cannot answer', async () => {
    const { useCase, check } = setup({ limits: () => 'unavailable' })
    expect((await useCase({ reviewId: REVIEW }, MANAGER)).outcome).toBe('unavailable')
    expect(check).not.toHaveBeenCalled()
  })

  it('does not spend a slot on a refused caller', async () => {
    const { useCase, consume } = setup()
    await refusal(useCase({ reviewId: REVIEW }, ctxWith('review.read')))
    expect(consume).not.toHaveBeenCalled()
  })
})

describe('checkInboxReviewOnGoogle logging', () => {
  it('logs the outcome and nothing else: no ids, no review or reply content', async () => {
    const { useCase, logs } = setup({ heads: new Map([[REVIEW, head()]]) })
    await useCase({ reviewId: REVIEW }, MANAGER)
    expect(logs).toEqual([
      { stage: 'inbox_check_review_on_google', outcome: 'reply_found' },
    ])
  })

  it('logs the reason a review was not checkable', async () => {
    const { useCase, logs } = setup({
      check: { status: 'not_checkable', reason: 'property_not_bound' },
    })
    await useCase({ reviewId: REVIEW }, MANAGER)
    expect(logs[0]).toMatchObject({
      outcome: 'not_checkable',
      reason: 'property_not_bound',
    })
  })

  it('logs a rate-limited call', async () => {
    const { useCase, logs } = setup({ limits: () => 'limited' })
    await useCase({ reviewId: REVIEW }, MANAGER)
    expect(logs[0]).toMatchObject({ outcome: 'rate_limited' })
  })
})
