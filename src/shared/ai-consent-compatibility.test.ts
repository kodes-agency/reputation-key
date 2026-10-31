import { describe, expect, it } from 'vitest'
import {
  AI_RUNTIME_CAPABILITIES_V1,
  getAiRuntimeCapability,
  isExecutionCompatibleWithConsent,
  type AiConsentCompatibility,
  type AiConsentExecution,
} from './ai-runtime-capability-contract'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
  type MerchantAiNoticeReference,
} from './merchant-ai-notice-contract'

const acknowledgedNotice = {
  noticeVersion: MERCHANT_AI_NOTICE_VERSION,
  noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
}
const capability = 'reply_drafting'
const servedExecution = getAiRuntimeCapability(capability)
const allows = (
  execution: AiConsentExecution = servedExecution,
  notice: MerchantAiNoticeReference = acknowledgedNotice,
) =>
  isExecutionCompatibleWithConsent({
    capability,
    acknowledgedNotice: notice,
    servedExecution: execution,
  })

describe('execution compatibility with merchant consent', () => {
  it('does not authorize settlement of the retired v2 analysis execution', () => {
    expect(
      isExecutionCompatibleWithConsent({
        capability: 'review_analysis',
        acknowledgedNotice,
        servedExecution: {
          runtimeProfileVersion: 'review-analysis-runtime-v1',
          operationProfileVersion: 'review-analysis-v2',
          providerDeploymentProfileVersion: 'private-beta-global-v2',
        },
      }),
    ).toBe(false)
  })

  it('explicitly admits every served execution under the notice in force', () => {
    for (const entry of AI_RUNTIME_CAPABILITIES_V1) {
      expect(
        isExecutionCompatibleWithConsent({
          capability: entry.capability,
          acknowledgedNotice,
          servedExecution: entry,
        }),
      ).toBe(true)
    }
  })

  it('admits a different runtime, operation and deployment only when explicitly listed for the same notice', () => {
    // Synthetic future execution only; no new production runtime is introduced.
    const refreshed: AiConsentCompatibility = {
      capability,
      runtimeProfileVersion: 'synthetic-compatible-runtime',
      operationProfileVersion: 'synthetic-compatible-operation',
      providerDeploymentProfileVersion: 'synthetic-compatible-deployment',
      noticesInForce: [acknowledgedNotice],
    }
    const input = { capability, acknowledgedNotice, servedExecution: refreshed } as const
    expect(isExecutionCompatibleWithConsent(input, [refreshed])).toBe(true)
    expect(isExecutionCompatibleWithConsent(input)).toBe(false)
    expect(
      isExecutionCompatibleWithConsent({ ...input, capability: 'review_analysis' }, [
        refreshed,
      ]),
    ).toBe(false)
  })

  it('fails closed for unknown or mismatched execution triples and notice digests', () => {
    expect(allows()).toBe(true)
    expect(
      allows({
        ...servedExecution,
        providerDeploymentProfileVersion: 'private-beta-global-v1',
      }),
    ).toBe(false)
    for (const field of [
      'runtimeProfileVersion',
      'operationProfileVersion',
      'providerDeploymentProfileVersion',
    ] as const) {
      expect(allows({ ...servedExecution, [field]: 'unknown' })).toBe(false)
    }
    expect(
      allows(servedExecution, { ...acknowledgedNotice, noticeDigest: 'f'.repeat(64) }),
    ).toBe(false)
    expect(
      allows(servedExecution, { ...acknowledgedNotice, noticeVersion: 'unknown' }),
    ).toBe(false)
    expect(
      isExecutionCompatibleWithConsent(
        { capability, acknowledgedNotice, servedExecution },
        [],
      ),
    ).toBe(false)
  })

  it('refuses an out-of-force notice even when a catalogue entry lists it', () => {
    const expired = {
      noticeVersion: 'merchant-ai-notice-2026-10-17.v1',
      noticeDigest: '2bcd2be15cbb81f324f9a9390ad00baff3ffbb25a6c0db8bff71fbb2b1b0975e',
    }
    expect(
      isExecutionCompatibleWithConsent(
        { capability, acknowledgedNotice: expired, servedExecution },
        [{ ...servedExecution, noticesInForce: [expired] }],
      ),
    ).toBe(false)
  })
})
