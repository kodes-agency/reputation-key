import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalizeRfc8785 } from '#/shared/merchant-ai-notice-contract'
import {
  ANTHROPIC_NORMALIZED_EVIDENCE_CLAIMS_DIGEST_V1,
  ANTHROPIC_NORMALIZED_EVIDENCE_CLAIMS_V1,
  ANTHROPIC_PROVIDER_PRIMARY_SOURCES_V1,
  ANTHROPIC_REASONING_EFFORT_MAPPING_V1,
  ANTHROPIC_REQUEST_SHAPE_V1,
  ANTHROPIC_REQUEST_SHAPE_V1_DIGEST,
  ANTHROPIC_STRUCTURED_OUTPUT_OVERHEAD_TOKENS,
} from './request-profile'

describe('Anthropic request profile', () => {
  it('pins the shared reasoning ladder to accepted Haiku settings', () => {
    expect(ANTHROPIC_REASONING_EFFORT_MAPPING_V1).toEqual({
      none: { thinking: { type: 'disabled' }, effort: 'low' },
      low: { thinking: { type: 'adaptive' }, effort: 'low' },
      medium: { thinking: { type: 'adaptive' }, effort: 'medium' },
      high: { thinking: { type: 'adaptive' }, effort: 'high' },
    })
    expect(Object.isFrozen(ANTHROPIC_REASONING_EFFORT_MAPPING_V1)).toBe(true)
  })

  it('seals every sent and absent field and carries the provisional overhead', () => {
    const expected = createHash('sha256')
      .update('repkey-anthropic-request-shape-v1\0')
      .update(canonicalizeRfc8785(ANTHROPIC_REQUEST_SHAPE_V1))
      .digest('hex')
    expect(ANTHROPIC_REQUEST_SHAPE_V1_DIGEST).toBe(
      '5fb6628984d8de0bce59b6b8a0af1846c446cbcc4550c68d76bfcbe2842d0dfd',
    )
    expect(ANTHROPIC_REQUEST_SHAPE_V1_DIGEST).toBe(expected)
    expect(ANTHROPIC_STRUCTURED_OUTPUT_OVERHEAD_TOKENS).toBe(1_024)
    expect(ANTHROPIC_NORMALIZED_EVIDENCE_CLAIMS_DIGEST_V1).toBe(
      '549fadfae9015dfbf966c0ad306f21c9d887ed227b0fe8e152db03ee27b2befd',
    )
    expect(ANTHROPIC_NORMALIZED_EVIDENCE_CLAIMS_V1).toMatchObject({
      provider: 'anthropic',
      store: false,
      sdkMaxRetries: 0,
    })
    expect(ANTHROPIC_PROVIDER_PRIMARY_SOURCES_V1.sdk).toBe(
      'https://github.com/anthropics/anthropic-sdk-typescript/tree/v1.3.0',
    )
    expect(ANTHROPIC_REQUEST_SHAPE_V1.absent).toContain('temperature')
    expect(ANTHROPIC_REQUEST_SHAPE_V1.absent).toContain('anthropic-beta')
  })
})
