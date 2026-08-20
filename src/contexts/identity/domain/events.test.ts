import { describe, it, expect } from 'vitest'

import {
  identityMemberInvited,
  identityMerchantAiChanged,
  identityOrganizationCreated,
} from './events'
import { organizationId, userId, invitationId } from '#/shared/domain/ids'
import { isDomainError } from '#/shared/domain/errors'
import type { Role } from '#/shared/domain/roles'

const ORG_ID = organizationId('org-1')
const USER_ID = userId('user-1')
const INV_ID = invitationId('inv-1')
const NOW = new Date('2026-06-01T12:00:00Z')

describe('identity events', () => {
  it('identityOrganizationCreated generates eventId and sets occurredAt', () => {
    const event = identityOrganizationCreated({
      organizationId: ORG_ID,
      organizationName: 'Test Org',
      slug: 'test-org',
      ownerId: USER_ID,
      occurredAt: NOW,
    })
    expect(event.eventId).toBeDefined()
    expect(event._tag).toBe('identity.organization.created')
    expect(event.occurredAt).toBe(NOW)
  })

  it('identityMemberInvited works', () => {
    const event = identityMemberInvited({
      organizationId: ORG_ID,
      userId: USER_ID,
      email: 'test@example.com',
      role: 'Staff' as Role,
      invitationId: INV_ID,
      occurredAt: NOW,
    })
    expect(event._tag).toBe('identity.member.invited')
  })

  it('throws/asserts for invalid occurredAt', () => {
    let caught: unknown
    try {
      identityOrganizationCreated({
        organizationId: ORG_ID,
        organizationName: 'Test',
        slug: 'test',
        ownerId: USER_ID,
        occurredAt: 'not-date' as unknown as Date,
      })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    if (isDomainError(caught)) {
      expect(caught.code).toBe('assertion_failed')
    } else {
      expect.fail('expected a DomainError')
    }
  })

  it('emits a versioned identifier-only merchant AI authorization change', () => {
    const valid = {
      organizationId: ORG_ID,
      propertyId: 'property-1',
      authorizationLineageId: 'lineage-1',
      state: 'enabled' as const,
      reviewAnalysisEpoch: 1,
      replyDraftingEpoch: 2,
      propertyTrendsEpoch: 3,
      authorizedSourceEpoch: 4,
      analysisStartSequence: 0,
      stateVersion: 5,
      occurredAt: NOW,
    }
    expect(identityMerchantAiChanged(valid)).toMatchObject({
      _tag: 'identity.merchant_ai.changed',
      correlationId: null,
      stateVersion: 5,
    })

    for (const [override, message] of [
      [{ authorizationLineageId: '' }, 'authorizationLineageId required'],
      [{ reviewAnalysisEpoch: 0 }, 'reviewAnalysisEpoch must be a positive safe integer'],
      [{ replyDraftingEpoch: 0 }, 'replyDraftingEpoch must be a positive safe integer'],
      [{ propertyTrendsEpoch: 0 }, 'propertyTrendsEpoch must be a positive safe integer'],
      [
        { authorizedSourceEpoch: -1 },
        'authorizedSourceEpoch must be a nonnegative safe integer',
      ],
      [
        { analysisStartSequence: -1 },
        'analysisStartSequence must be a nonnegative safe integer',
      ],
      [{ stateVersion: 0 }, 'stateVersion must be a positive safe integer'],
    ] as const) {
      expect(() => identityMerchantAiChanged({ ...valid, ...override })).toThrow(message)
    }
  })

  it('accepts the domain default source epoch of 0 for a merchant AI change', () => {
    // `properties.source_epoch` starts at 0, so enabling AI on a property that
    // has never been edited emits this event with 0. Asserting `>= 1` here was
    // one of nine places that rejected it (see drizzle/0060).
    expect(() =>
      identityMerchantAiChanged({
        organizationId: ORG_ID,
        propertyId: 'property-1',
        authorizationLineageId: 'lineage-1',
        state: 'enabled' as const,
        reviewAnalysisEpoch: 1,
        replyDraftingEpoch: 1,
        propertyTrendsEpoch: 1,
        authorizedSourceEpoch: 0,
        analysisStartSequence: 0,
        stateVersion: 1,
        occurredAt: NOW,
      }),
    ).not.toThrow()
  })
})
