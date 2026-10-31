import { describe, expect, it } from 'vitest'
import { CURRENT_MERCHANT_AI_CAPABILITIES } from '#/shared/domain/merchant-ai-capability'
import { materiallyChangedMerchantAiCapabilities } from '#/shared/merchant-ai-notice-change'
import { MERCHANT_AI_NOTICE_CHANGES } from '#/shared/merchant-ai-notice-contract'
import { nextMerchantAiCapabilityEpochs } from './merchant-ai-capability-epochs'
import type { MerchantAiSnapshot } from './merchant-ai-authorization'

const current: MerchantAiSnapshot = {
  organizationId: 'org',
  propertyId: 'property',
  state: 'enabled',
  authorizationLineageId: 'lineage',
  capabilities: CURRENT_MERCHANT_AI_CAPABILITIES,
  capabilityRuntimeProfileVersions: {},
  capabilityEpochs: { review_analysis: 3, reply_drafting: 5, property_trends: 7 },
  authorizedSourceEpoch: 2,
  analysisStartSequence: 12,
  stateVersion: 4,
  noticeVersion: 'notice-before',
  noticeDigest: 'a'.repeat(64),
  sourcePolicyId: 'policy',
  routingPolicyVersion: 1,
  processingRegion: 'global',
  providerDeploymentProfileVersion: 'private-beta-global-v1',
  redactionProfileFamily: 'redaction',
}
const input = {
  ...current,
  operation: 'change',
  capabilities: CURRENT_MERCHANT_AI_CAPABILITIES,
} as const
const next = { noticeVersion: 'notice-after', noticeDigest: 'b'.repeat(64) }

const draftingOnly = [
  { ...next, replaces: current, materiallyChanges: ['reply_drafting'] as const },
]

describe('capability-specific merchant AI consent epochs', () => {
  it('bumps drafting alone for a drafting-only notice, preserving analysis and trends', () => {
    const changes = materiallyChangedMerchantAiCapabilities(current, next, draftingOnly)
    expect(changes).toEqual(['reply_drafting'])
    expect(nextMerchantAiCapabilityEpochs(current, input, false, changes)).toEqual({
      review_analysis: 3,
      reply_drafting: 6,
      property_trends: 7,
    })
  })
  it('does not bump for a technical execution refresh or immaterial notice change', () => {
    expect(nextMerchantAiCapabilityEpochs(current, input, false, [])).toEqual(
      current.capabilityEpochs,
    )
    expect(
      materiallyChangedMerchantAiCapabilities(current, next, [
        { ...next, replaces: current, materiallyChanges: [] },
      ]),
    ).toEqual([])
  })
  it.each([
    { sourcePolicyId: 'changed-source-policy' },
    { routingPolicyVersion: 2 },
    { redactionProfileFamily: 'changed-redaction-family' },
  ])('bumps every enabled capability for a data-use policy change: %j', (policy) => {
    expect(
      nextMerchantAiCapabilityEpochs(current, { ...input, ...policy }, false, []),
    ).toEqual({ review_analysis: 4, reply_drafting: 6, property_trends: 8 })
  })
  it('preserves the epochs of capabilities absent on both sides of a policy change', () => {
    expect(
      nextMerchantAiCapabilityEpochs(
        { ...current, capabilities: ['reply_drafting'] },
        { ...input, capabilities: ['reply_drafting'], routingPolicyVersion: 2 },
        false,
        [],
      ),
    ).toEqual({ review_analysis: 3, reply_drafting: 6, property_trends: 7 })
  })
  it('still fences source changes, removal, revoke and re-enable', () => {
    const allBumped = { review_analysis: 4, reply_drafting: 6, property_trends: 8 }
    expect(nextMerchantAiCapabilityEpochs(current, input, true, [])).toEqual(allBumped)
    for (const operation of ['enable', 'revoke'] as const) {
      expect(
        nextMerchantAiCapabilityEpochs(current, { ...input, operation }, false, []),
      ).toEqual(allBumped)
    }
    expect(
      nextMerchantAiCapabilityEpochs(
        current,
        { ...input, capabilities: ['reply_drafting'] },
        false,
        [],
      ),
    ).toEqual({ review_analysis: 4, reply_drafting: 5, property_trends: 8 })
  })
  it('accumulates skipped notice changes and treats unknown ancestry or digests conservatively', () => {
    const later = { noticeVersion: 'notice-later', noticeDigest: 'c'.repeat(64) }
    const changes = [
      ...draftingOnly,
      { ...later, replaces: next, materiallyChanges: ['review_analysis'] as const },
    ]
    expect(materiallyChangedMerchantAiCapabilities(current, later, changes)).toEqual([
      'review_analysis',
      'reply_drafting',
    ])
    expect(
      materiallyChangedMerchantAiCapabilities(
        current,
        { ...next, noticeDigest: 'unknown' },
        changes,
      ),
    ).toEqual(CURRENT_MERCHANT_AI_CAPABILITIES)
    expect(materiallyChangedMerchantAiCapabilities(current, next, [])).toEqual(
      CURRENT_MERCHANT_AI_CAPABILITIES,
    )
  })
  it('records the material scope of the existing switch-on notice', () => {
    const notice = MERCHANT_AI_NOTICE_CHANGES[0]!
    expect(materiallyChangedMerchantAiCapabilities(notice.replaces!, notice)).toEqual(
      CURRENT_MERCHANT_AI_CAPABILITIES,
    )
  })
})
