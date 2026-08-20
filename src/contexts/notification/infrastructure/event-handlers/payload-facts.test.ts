import { describe, expect, it, vi } from 'vitest'
import {
  buildBadgePayload,
  buildGoalPayload,
  buildInboxItemPayload,
  type InboxPayloadDeps,
  type RecognitionPayloadDeps,
} from './payload-facts'
import {
  badgeId,
  goalId,
  inboxItemId,
  organizationId,
  portalGroupId,
  portalId,
  userId,
} from '#/shared/domain/ids'

const ORG = organizationId('org-1')
const ITEM = inboxItemId('item-1')
const ACTOR = userId('user-1')
const NOW = new Date('2026-06-01T12:00:00.000Z')

const logger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
})

const inboxDeps = (
  facts: unknown,
  role: string | null = 'property_manager',
): InboxPayloadDeps =>
  ({
    inboxItemLookup: {
      findInboxItemByReviewId: vi.fn(async () => null),
      findInboxItemFacts: vi.fn(async () => facts),
    },
    userLookup: { findActorRole: vi.fn(async () => role) },
    clock: () => NOW,
    logger: logger(),
  }) as unknown as InboxPayloadDeps

const reviewFacts = {
  propertyId: 'prop-1',
  propertyName: 'Riverside Hotel',
  rating: 2,
  sourceType: 'review',
  createdAt: new Date('2026-06-01T09:00:00.000Z'),
}

describe('buildInboxItemPayload', () => {
  it('maps the item facts onto allowlisted payload keys', async () => {
    const payload = await buildInboxItemPayload(inboxDeps(reviewFacts), {
      inboxItemId: ITEM,
      orgId: ORG,
    })

    expect(payload).toEqual({
      propertyName: 'Riverside Hotel',
      rating: 2,
      platform: 'google',
      waitingHours: 3,
    })
  })

  it('reads feedback as portal-sourced', async () => {
    const payload = await buildInboxItemPayload(
      inboxDeps({ ...reviewFacts, sourceType: 'feedback' }),
      { inboxItemId: ITEM, orgId: ORG },
    )

    expect(payload.platform).toBe('portal')
  })

  it('floors the waiting age and never goes negative', async () => {
    const future = await buildInboxItemPayload(
      inboxDeps({ ...reviewFacts, createdAt: new Date('2026-06-01T13:00:00.000Z') }),
      { inboxItemId: ITEM, orgId: ORG },
    )
    const partial = await buildInboxItemPayload(
      inboxDeps({ ...reviewFacts, createdAt: new Date('2026-06-01T10:30:00.000Z') }),
      { inboxItemId: ITEM, orgId: ORG },
    )

    expect(future.waitingHours).toBe(0)
    expect(partial.waitingHours).toBe(1)
  })

  it('omits the property name and rating the item does not have', async () => {
    const payload = await buildInboxItemPayload(
      inboxDeps({ ...reviewFacts, propertyName: null, rating: null }),
      { inboxItemId: ITEM, orgId: ORG },
    )

    expect(payload).toEqual({ platform: 'google', waitingHours: 3 })
  })

  it('resolves the actor as a role only when an actor is given', async () => {
    const withActor = await buildInboxItemPayload(inboxDeps(reviewFacts), {
      inboxItemId: ITEM,
      orgId: ORG,
      actorId: ACTOR,
    })
    const withoutActor = await buildInboxItemPayload(inboxDeps(reviewFacts), {
      inboxItemId: ITEM,
      orgId: ORG,
    })

    expect(withActor.actorRole).toBe('property_manager')
    expect(withoutActor.actorRole).toBeUndefined()
  })

  it('omits actorRole when the acting user holds an unmapped role', async () => {
    const payload = await buildInboxItemPayload(inboxDeps(reviewFacts, null), {
      inboxItemId: ITEM,
      orgId: ORG,
      actorId: ACTOR,
    })

    expect(payload.actorRole).toBeUndefined()
  })

  it('carries a staff-authored moderation reason, and drops an empty one', async () => {
    const withReason = await buildInboxItemPayload(inboxDeps(reviewFacts), {
      inboxItemId: ITEM,
      orgId: ORG,
      moderationReason: 'Tone too aggressive',
    })
    const withoutReason = await buildInboxItemPayload(inboxDeps(reviewFacts), {
      inboxItemId: ITEM,
      orgId: ORG,
      moderationReason: null,
    })

    expect(withReason.moderationReason).toBe('Tone too aggressive')
    expect(withoutReason.moderationReason).toBeUndefined()
  })

  it('degrades to an empty payload when the facts lookup throws', async () => {
    const deps = inboxDeps(reviewFacts)
    const boom = {
      ...deps,
      inboxItemLookup: {
        findInboxItemByReviewId: vi.fn(async () => null),
        findInboxItemFacts: vi.fn(async () => {
          throw new Error('DB down')
        }),
      },
    } as unknown as InboxPayloadDeps

    // A degraded lookup must shorten the copy, never lose the notification.
    await expect(
      buildInboxItemPayload(boom, { inboxItemId: ITEM, orgId: ORG }),
    ).resolves.toEqual({})
  })

  it('returns an empty payload when the item is gone', async () => {
    const payload = await buildInboxItemPayload(inboxDeps(null), {
      inboxItemId: ITEM,
      orgId: ORG,
    })

    expect(payload).toEqual({})
  })
})

const recognitionDeps = (goal: unknown, badge: unknown): RecognitionPayloadDeps =>
  ({
    recognitionLookup: {
      findGoalFacts: vi.fn(async () => goal),
      findBadgeFacts: vi.fn(async () => badge),
    },
    logger: logger(),
  }) as unknown as RecognitionPayloadDeps

describe('buildGoalPayload', () => {
  it('carries the goal and property names', async () => {
    const payload = await buildGoalPayload(
      recognitionDeps(
        { goalName: 'Weekend response time', propertyName: 'Riverside' },
        null,
      ),
      { goalId: goalId('goal-1'), orgId: ORG },
    )

    expect(payload).toEqual({
      goalName: 'Weekend response time',
      propertyName: 'Riverside',
    })
  })

  it('omits the property name when the property row is gone', async () => {
    const payload = await buildGoalPayload(
      recognitionDeps({ goalName: 'Weekend response time', propertyName: null }, null),
      { goalId: goalId('goal-1'), orgId: ORG },
    )

    expect(payload).toEqual({ goalName: 'Weekend response time' })
  })

  it('returns an empty payload when the goal is gone', async () => {
    const payload = await buildGoalPayload(recognitionDeps(null, null), {
      goalId: goalId('goal-1'),
      orgId: ORG,
    })

    expect(payload).toEqual({})
  })
})

describe('buildBadgePayload', () => {
  it('carries the badge name and the recipient display name', async () => {
    const payload = await buildBadgePayload(
      recognitionDeps(null, { badgeName: 'Fast Responder', recipientName: 'Front desk' }),
      {
        badgeDefinitionId: badgeId('badge-1'),
        target: { kind: 'portal', id: portalId('portal-1') },
        orgId: ORG,
      },
    )

    expect(payload).toEqual({
      targetKind: 'portal',
      badgeName: 'Fast Responder',
      recipientName: 'Front desk',
    })
  })

  it('keeps the target kind when the badge lookup finds nothing', async () => {
    const payload = await buildBadgePayload(recognitionDeps(null, null), {
      badgeDefinitionId: badgeId('badge-1'),
      target: { kind: 'portal_group', id: portalGroupId('group-1') },
      orgId: ORG,
    })

    expect(payload).toEqual({ targetKind: 'portal_group' })
  })

  it('omits a recipient name the target no longer has', async () => {
    const payload = await buildBadgePayload(
      recognitionDeps(null, { badgeName: 'Fast Responder', recipientName: null }),
      {
        badgeDefinitionId: badgeId('badge-1'),
        target: { kind: 'portal', id: portalId('portal-1') },
        orgId: ORG,
      },
    )

    expect(payload).toEqual({ targetKind: 'portal', badgeName: 'Fast Responder' })
  })
})
