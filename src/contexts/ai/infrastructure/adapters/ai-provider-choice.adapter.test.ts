import { describe, expect, it } from 'vitest'
import { OPENAI_PROVIDER_ATTESTATION_V1 } from '#/shared/ai-openai-provider-attestation'
import { OPERATOR_PROVIDER_SELECTION } from '#/shared/ai-provider-control/operator-provider-selection'
import { createOperatorProviderChoice } from './ai-provider-choice.adapter'

describe('the operator provider choice', () => {
  it('claims a review analysis under OpenAI, as its attestation says, until the Anthropic date', async () => {
    const choice = await createOperatorProviderChoice().chooseForReviewAnalysis()

    expect(choice).toEqual({
      status: 'chosen',
      lineage: {
        providerId: 'openai',
        model: 'gpt-6-luna',
        requestProfileVersion: 'openai-responses-request-profile-v1',
        requestProfileDigest: OPENAI_PROVIDER_ATTESTATION_V1.digest,
      },
    })
    expect(OPERATOR_PROVIDER_SELECTION.review_analysis).toBe('openai')
  })

  it('waits for a choice rather than guess one', async () => {
    await expect(
      createOperatorProviderChoice({}).chooseForReviewAnalysis(),
    ).resolves.toEqual({ status: 'unavailable', code: 'provider_selection_required' })
  })

  it('waits when the choice names a provider this process has no adapter for, and tries no other', async () => {
    await expect(
      createOperatorProviderChoice({
        review_analysis: 'anthropic',
      }).chooseForReviewAnalysis(),
    ).resolves.toEqual({ status: 'unavailable', code: 'provider_unavailable' })
  })
})
