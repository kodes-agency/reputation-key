import { describe, expect, it } from 'vitest'
import { AI_PROVIDER_IDS } from '#/shared/ai-provider-ids'
import { OPERATOR_PROVIDER_SELECTION } from './operator-provider-selection'
import { createAiProviderRegistry, selectAiProvider } from './provider-selection'

// Anthropic is configured (attested, named by the deployment profile, tested) and not
// selectable: until the Anthropic date review analysis runs on OpenAI alone, and only a
// reviewed change to the code below can move it.

describe('the operator provider selection', () => {
  it('names OpenAI for every capability that names a provider, and no one else', () => {
    expect(OPERATOR_PROVIDER_SELECTION).toEqual({
      review_analysis: 'openai',
      reply_drafting: 'openai',
    })
    expect(Object.isFrozen(OPERATOR_PROVIDER_SELECTION)).toBe(true)
    expect(Object.values(OPERATOR_PROVIDER_SELECTION)).not.toContain('anthropic')
    // The closed set still has the second provider: it is configured, not removed.
    expect(AI_PROVIDER_IDS).toContain('anthropic')
  })

  it('serves a profile attested for both providers by OpenAI, and by nothing else if it is missing', () => {
    const openai = { providerId: 'openai' as const }
    const anthropic = { providerId: 'anthropic' as const }
    const both = createAiProviderRegistry(
      [openai, anthropic],
      OPERATOR_PROVIDER_SELECTION,
    )
    expect(
      selectAiProvider(both, {
        capability: 'review_analysis',
        eligible: ['openai', 'anthropic'],
      }),
    ).toBe(openai)

    // With no OpenAI adapter the answer is a refusal; the other provider is never tried.
    const onlyAnthropic = createAiProviderRegistry(
      [anthropic],
      OPERATOR_PROVIDER_SELECTION,
    )
    expect(() =>
      selectAiProvider(onlyAnthropic, {
        capability: 'review_analysis',
        eligible: ['openai', 'anthropic'],
      }),
    ).toThrow('selected_not_registered')
  })
})
