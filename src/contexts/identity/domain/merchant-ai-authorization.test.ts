import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearEventSchemas, validateEventPayload } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  CURRENT_MERCHANT_AI_CAPABILITIES,
  planMerchantAiConsentTransition,
  type MerchantAiDesiredGrant,
  type MerchantAiSnapshot,
} from './merchant-ai-authorization'

const ALL_RUNTIME_PROFILES = {
  review_analysis: 'review-analysis-runtime-v1',
  reply_drafting: 'reply-drafting-runtime-v1',
  property_trends: 'property-trends-runtime-v1',
} as const

const DESIRED: MerchantAiDesiredGrant = {
  capabilities: CURRENT_MERCHANT_AI_CAPABILITIES,
  capabilityRuntimeProfileVersions: ALL_RUNTIME_PROFILES,
  authorizedSourceEpoch: 3,
  noticeVersion: 'merchant-ai-notice-2026-09-15.v1',
  noticeDigest: 'b'.repeat(64),
  sourcePolicyId: 'google-business-profile-source-policy-v1',
  routingPolicyVersion: 1,
  providerDeploymentProfileVersion: 'private-beta-global-v1',
  redactionProfileFamily: 'gbp-review-global-v1',
}

const ENABLED: MerchantAiSnapshot = {
  organizationId: 'org-1',
  propertyId: '10000000-0000-4000-8000-000000000001',
  state: 'enabled',
  authorizationLineageId: '20000000-0000-4000-8000-000000000001',
  capabilities: CURRENT_MERCHANT_AI_CAPABILITIES,
  capabilityRuntimeProfileVersions: ALL_RUNTIME_PROFILES,
  capabilityEpochs: { review_analysis: 1, reply_drafting: 1, property_trends: 1 },
  authorizedSourceEpoch: 3,
  analysisStartSequence: 7,
  stateVersion: 1,
  noticeVersion: DESIRED.noticeVersion,
  noticeDigest: DESIRED.noticeDigest,
  sourcePolicyId: DESIRED.sourcePolicyId,
  routingPolicyVersion: DESIRED.routingPolicyVersion,
  processingRegion: 'global',
  providerDeploymentProfileVersion: DESIRED.providerDeploymentProfileVersion,
  redactionProfileFamily: DESIRED.redactionProfileFamily,
}

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

describe('Merchant AI consent ceremony plan', () => {
  it('enables a Property with no grant, or a disabled or revoked one', () => {
    expect(planMerchantAiConsentTransition(null, DESIRED)).toEqual({ kind: 'enable' })
    for (const state of ['disabled', 'revoked'] as const) {
      expect(
        planMerchantAiConsentTransition(
          { ...ENABLED, state, capabilities: [], capabilityRuntimeProfileVersions: {} },
          DESIRED,
        ),
      ).toEqual({ kind: 'enable' })
    }
  })

  it('leaves an identical enabled grant unchanged', () => {
    expect(planMerchantAiConsentTransition(ENABLED, DESIRED)).toEqual({
      kind: 'unchanged',
      current: ENABLED,
    })
  })

  it('re-grants an enabled grant that differs in any recorded term', () => {
    const drifted: ReadonlyArray<Partial<MerchantAiSnapshot>> = [
      { noticeVersion: 'merchant-ai-notice-2026-09-09.v1' },
      { noticeDigest: 'c'.repeat(64) },
      {
        capabilities: ['review_analysis'],
        capabilityRuntimeProfileVersions: {
          review_analysis: ALL_RUNTIME_PROFILES.review_analysis,
        },
      },
      {
        capabilityRuntimeProfileVersions: {
          ...ALL_RUNTIME_PROFILES,
          reply_drafting: 'reply-drafting-runtime-v0',
        },
      },
      { authorizedSourceEpoch: 2 },
      { sourcePolicyId: 'google-business-profile-source-policy-v0' },
      { routingPolicyVersion: 2 },
      { redactionProfileFamily: 'gbp-review-en-v1' },
    ]
    for (const difference of drifted) {
      expect(
        planMerchantAiConsentTransition({ ...ENABLED, ...difference }, DESIRED),
      ).toEqual({ kind: 'change' })
    }
  })
})
