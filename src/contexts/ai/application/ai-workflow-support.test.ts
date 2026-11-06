import { describe, expect, it } from 'vitest'
import { CURRENT_MERCHANT_AI_CAPABILITIES } from '#/shared/domain/merchant-ai-capability'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { isAiAuthorizationUnderServedContract } from './ai-workflow-support'

const servedNotice = {
  noticeVersion: MERCHANT_AI_NOTICE_VERSION,
  noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
}

describe('served AI authorization', () => {
  it.each(CURRENT_MERCHANT_AI_CAPABILITIES)(
    'admits %s only while it has a served runtime, regardless of recorded deployment',
    (capability) => {
      for (const providerDeploymentProfileVersion of [
        'private-beta-global-v1',
        'private-beta-global-v3',
      ]) {
        expect(
          isAiAuthorizationUnderServedContract(
            { ...servedNotice, providerDeploymentProfileVersion },
            capability,
          ),
        ).toBe(capability !== 'property_trends')
      }
    },
  )

  it.each(CURRENT_MERCHANT_AI_CAPABILITIES)(
    'refuses %s under a lapsed notice',
    (capability) => {
      expect(
        isAiAuthorizationUnderServedContract(
          {
            noticeVersion: 'merchant-ai-notice-2026-10-17.v1',
            noticeDigest:
              '2bcd2be15cbb81f324f9a9390ad00baff3ffbb25a6c0db8bff71fbb2b1b0975e',
            providerDeploymentProfileVersion: 'private-beta-global-v1',
          },
          capability,
        ),
      ).toBe(false)
    },
  )

  it.each(CURRENT_MERCHANT_AI_CAPABILITIES)(
    'refuses %s when the served notice digest does not match',
    (capability) => {
      expect(
        isAiAuthorizationUnderServedContract(
          {
            ...servedNotice,
            noticeDigest: '0'.repeat(64),
            providerDeploymentProfileVersion: 'private-beta-global-v3',
          },
          capability,
        ),
      ).toBe(false)
    },
  )
})
