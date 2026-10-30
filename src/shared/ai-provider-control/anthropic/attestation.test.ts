import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { AI_OPERATION_PROFILES } from '#/shared/ai-operation-profiles'
import { operationProviderPairing } from '#/shared/ai-operation-provider-pairings'
import { canonicalizeRfc8785 } from '#/shared/merchant-ai-notice-contract'
import {
  REVIEW_ANALYSIS_V3_ANTHROPIC_PAIRING,
  REVIEW_ANALYSIS_V3_LOGICAL_PROFILE,
} from '#/shared/review-analysis-v3-profile'
import { ANTHROPIC_PROVIDER_ATTESTATION_V1, anthropicPairingOf } from './attestation'
import { anthropicWireSchemaOf } from './schema-transform'

describe('Anthropic attestation and operation pairing', () => {
  it('pins the provider and v3 pairing digests', () => {
    expect(ANTHROPIC_PROVIDER_ATTESTATION_V1.digest).toBe(
      '92d66d958eef54038eff7e46116415a8ca114e3545757a2ca365f77b718b7a47',
    )
    expect(REVIEW_ANALYSIS_V3_ANTHROPIC_PAIRING.digest).toBe(
      '1e7e9c3779f626c5a8f22b18130a12a9667e50701c157c13a1bfb9953ff4d165',
    )
  })

  it('pairs the digest of the actual transformed v3 wire schema', () => {
    const wireSchema = anthropicWireSchemaOf(
      REVIEW_ANALYSIS_V3_LOGICAL_PROFILE.outputSchema,
    )
    const expected = createHash('sha256')
      .update('repkey-anthropic-wire-schema-v1\0')
      .update(canonicalizeRfc8785(wireSchema))
      .digest('hex')
    expect(REVIEW_ANALYSIS_V3_ANTHROPIC_PAIRING.schemaTransform.digest).toBe(expected)
    expect(anthropicPairingOf(REVIEW_ANALYSIS_V3_LOGICAL_PROFILE)).toEqual(
      REVIEW_ANALYSIS_V3_ANTHROPIC_PAIRING,
    )
  })

  // Anthropic is attested for review analysis v3 alone, and nothing selects it
  // (`operator-provider-selection.ts`): the reply, trend and canary profiles and the
  // retired v2 analysis profile have no Anthropic pairing at all.
  it('gives no live profile but review analysis v3 an Anthropic pairing', () => {
    for (const profile of AI_OPERATION_PROFILES) {
      const pairing = operationProviderPairing(profile.profileVersion, 'anthropic')
      if (profile.profileVersion === 'review-analysis-v3') {
        expect(pairing).not.toBeNull()
      } else {
        expect(pairing).toBeNull()
      }
    }
  })
})
