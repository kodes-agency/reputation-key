import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearEventSchemas, validateEventPayload } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { CURRENT_MERCHANT_AI_CAPABILITIES } from './merchant-ai-authorization'

beforeEach(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})

afterEach(() => clearEventSchemas())

describe('Merchant AI authorization contract', () => {
  it('freezes the current opt-in capability set', () => {
    expect(CURRENT_MERCHANT_AI_CAPABILITIES).toEqual([
      'review_analysis',
      'reply_drafting',
      'property_trends',
    ])
  })

  it('registers a strict identifier-only change event with exact authorization fences', () => {
    const payload = {
      organizationId: 'org-1',
      propertyId: '10000000-0000-4000-8000-000000000001',
      authorizationLineageId: '20000000-0000-4000-8000-000000000001',
      state: 'enabled',
      reviewAnalysisEpoch: 1,
      replyDraftingEpoch: 1,
      propertyTrendsEpoch: 1,
      authorizedSourceEpoch: 3,
      analysisStartSequence: 7,
      stateVersion: 1,
      occurredAt: '2026-08-15T12:00:00.000Z',
    }

    expect(() =>
      validateEventPayload('identity.merchant_ai.changed', 1, payload),
    ).not.toThrow()
    expect(() =>
      validateEventPayload('identity.merchant_ai.changed', 1, {
        ...payload,
        authorizationLineageId: undefined,
      }),
    ).toThrow(/authorizationLineageId/)
    expect(() =>
      validateEventPayload('identity.merchant_ai.changed', 1, {
        ...payload,
        reviewerName: 'must never leave the identity context',
      }),
    ).toThrow(/reviewerName/)
    for (const field of [
      'reviewAnalysisEpoch',
      'replyDraftingEpoch',
      'propertyTrendsEpoch',
      'authorizedSourceEpoch',
      'analysisStartSequence',
      'stateVersion',
    ] as const) {
      expect(() =>
        validateEventPayload('identity.merchant_ai.changed', 1, {
          ...payload,
          [field]: Number.MAX_SAFE_INTEGER + 1,
        }),
      ).toThrow(new RegExp(field))
    }
  })
})
