// Switching providers is an operator's act and nothing else (contract section 7.3,
// decision 7). These tests are the proof that nothing in the selection can choose
// for the operator: it returns the provider the operator named or it says why not,
// and no failure of the chosen provider is ever answered by another.

import { describe, expect, it } from 'vitest'
import { AI_PROVIDER_IDS } from '#/shared/ai-provider-ids'
import type { AiProviderId } from './provider-contracts'
import {
  AiProviderSelectionError,
  createAiProviderRegistry,
  selectAiProvider,
  type AiProviderSelectionConfig,
  type AiProviderSelectionRefusal,
} from './provider-selection'

type FakeAdapter = Readonly<{
  providerId: AiProviderId
  readiness?: () => boolean
  label: string
}>

const adapter = (providerId: AiProviderId, ready?: boolean): FakeAdapter => ({
  providerId,
  label: `adapter:${providerId}`,
  ...(ready === undefined ? {} : { readiness: () => ready }),
})

function refusal(action: () => unknown): AiProviderSelectionRefusal | 'selected' {
  try {
    action()
  } catch (error) {
    if (error instanceof AiProviderSelectionError) return error.code
    throw error
  }
  return 'selected'
}

describe('the registry', () => {
  it('holds one adapter per provider and refuses a second for the same provider', () => {
    const registry = createAiProviderRegistry([adapter('openai'), adapter('anthropic')], {
      review_analysis: 'anthropic',
    })

    expect([...registry.adapters.keys()]).toEqual(['openai', 'anthropic'])
    expect(registry.selection).toEqual({ review_analysis: 'anthropic' })
    expect(Object.isFrozen(registry)).toBe(true)
    expect(Object.isFrozen(registry.selection)).toBe(true)
    expect(() =>
      createAiProviderRegistry([
        adapter('openai'),
        { ...adapter('openai'), label: 'again' },
      ]),
    ).toThrow('provider openai is registered twice')
  })

  it('copies the operator choice it is given, so a later edit of the config reaches nothing', () => {
    const config: Record<string, AiProviderId> = { review_analysis: 'openai' }
    const registry = createAiProviderRegistry(
      [adapter('openai'), adapter('anthropic')],
      config as AiProviderSelectionConfig,
    )
    config.review_analysis = 'anthropic'

    expect(registry.selection.review_analysis).toBe('openai')
  })
})

describe('selecting the provider of a capability', () => {
  const both = createAiProviderRegistry([adapter('openai'), adapter('anthropic')], {
    review_analysis: 'anthropic',
  })

  it('serves a profile attested for one provider with that provider, whatever the operator chose', () => {
    expect(
      selectAiProvider(both, { capability: 'review_analysis', eligible: ['openai'] })
        .providerId,
    ).toBe('openai')
    expect(
      selectAiProvider(both, { capability: 'reply_drafting', eligible: ['openai'] })
        .providerId,
    ).toBe('openai')
    expect(
      selectAiProvider(both, { capability: null, eligible: ['anthropic'] }).providerId,
    ).toBe('anthropic')
  })

  it('does not ask a single-provider profile whether its adapter is ready, as before the seam', () => {
    const unready = createAiProviderRegistry([adapter('openai', false)])

    expect(
      selectAiProvider(unready, { capability: 'review_analysis', eligible: ['openai'] })
        .providerId,
    ).toBe('openai')
  })

  it('serves a profile attested for several with the provider the operator chose', () => {
    expect(
      selectAiProvider(both, {
        capability: 'review_analysis',
        eligible: ['openai', 'anthropic'],
      }).providerId,
    ).toBe('anthropic')
    const other = createAiProviderRegistry([adapter('openai'), adapter('anthropic')], {
      review_analysis: 'openai',
    })
    expect(
      selectAiProvider(other, {
        capability: 'review_analysis',
        eligible: ['anthropic', 'openai'],
      }).providerId,
    ).toBe('openai')
  })

  it('says why it cannot serve, with a closed reason', () => {
    const none = createAiProviderRegistry([adapter('openai'), adapter('anthropic')])
    const cases: ReadonlyArray<
      readonly [string, () => unknown, AiProviderSelectionRefusal]
    > = [
      [
        'a profile attested for no provider',
        () => selectAiProvider(both, { capability: 'review_analysis', eligible: [] }),
        'no_eligible_provider',
      ],
      [
        'several providers and no choice',
        () =>
          selectAiProvider(none, {
            capability: 'review_analysis',
            eligible: ['openai', 'anthropic'],
          }),
        'selection_required',
      ],
      [
        'several providers and a choice for another capability only',
        () =>
          selectAiProvider(both, {
            capability: 'reply_drafting',
            eligible: ['openai', 'anthropic'],
          }),
        'selection_required',
      ],
      [
        'several providers and no capability to read a choice for',
        () =>
          selectAiProvider(both, { capability: null, eligible: ['openai', 'anthropic'] }),
        'selection_required',
      ],
      [
        // The closed set has two providers, so a profile that excludes the chosen one
        // while naming several can only be spelled with a repeat: it stands in for the
        // third provider the set does not have yet.
        'a choice the profile does not attest',
        () =>
          selectAiProvider(
            createAiProviderRegistry([adapter('openai'), adapter('anthropic')], {
              review_analysis: 'anthropic',
            }),
            { capability: 'review_analysis', eligible: ['openai', 'openai'] },
          ),
        'selected_not_eligible',
      ],
      [
        'a single provider this process holds no adapter for',
        () =>
          selectAiProvider(createAiProviderRegistry([adapter('anthropic')]), {
            capability: 'review_analysis',
            eligible: ['openai'],
          }),
        'selected_not_registered',
      ],
      [
        'a chosen provider this process holds no adapter for',
        () =>
          selectAiProvider(
            createAiProviderRegistry([adapter('openai')], {
              review_analysis: 'anthropic',
            }),
            { capability: 'review_analysis', eligible: ['openai', 'anthropic'] },
          ),
        'selected_not_registered',
      ],
      [
        'a chosen provider whose adapter is not ready',
        () =>
          selectAiProvider(
            createAiProviderRegistry(
              [adapter('openai', true), adapter('anthropic', false)],
              {
                review_analysis: 'anthropic',
              },
            ),
            { capability: 'review_analysis', eligible: ['openai', 'anthropic'] },
          ),
        'selected_not_ready',
      ],
    ]

    for (const [name, action, code] of cases) {
      expect(refusal(action), name).toBe(code)
    }
  })

  it('treats only an adapter that says false as not ready', () => {
    const silent = createAiProviderRegistry([adapter('openai'), adapter('anthropic')], {
      review_analysis: 'anthropic',
    })
    const ready = createAiProviderRegistry(
      [adapter('openai'), adapter('anthropic', true)],
      {
        review_analysis: 'anthropic',
      },
    )

    for (const registry of [silent, ready]) {
      expect(
        selectAiProvider(registry, {
          capability: 'review_analysis',
          eligible: ['openai', 'anthropic'],
        }).providerId,
      ).toBe('anthropic')
    }
  })
})

describe('no fallback, over every case the selection can meet', () => {
  const subsets: readonly (readonly AiProviderId[])[] = [
    [],
    ['openai'],
    ['anthropic'],
    ['openai', 'anthropic'],
  ]
  const choices: readonly (AiProviderId | undefined)[] = [undefined, ...AI_PROVIDER_IDS]
  const readiness: readonly (boolean | undefined)[] = [undefined, true, false]

  it('returns the one provider the profile names or the one the operator chose, and never another', () => {
    let selected = 0
    let refused = 0
    for (const eligible of subsets) {
      for (const registered of subsets) {
        for (const chosen of choices) {
          for (const openAiReady of readiness) {
            for (const anthropicReady of readiness) {
              const adapters = registered.map((providerId) =>
                adapter(
                  providerId,
                  providerId === 'openai' ? openAiReady : anthropicReady,
                ),
              )
              const registry = createAiProviderRegistry(
                adapters,
                chosen === undefined ? {} : { review_analysis: chosen },
              )
              const where = JSON.stringify({
                eligible,
                registered,
                chosen,
                openAiReady,
                anthropicReady,
              })
              let result: FakeAdapter | null = null
              try {
                result = selectAiProvider(registry, {
                  capability: 'review_analysis',
                  eligible,
                })
              } catch (error) {
                expect(error, where).toBeInstanceOf(AiProviderSelectionError)
              }
              if (result === null) {
                refused += 1
                continue
              }
              selected += 1
              // Whatever was returned is a provider the profile is attested for ...
              expect(eligible, where).toContain(result.providerId)
              // ... that this process holds an adapter for ...
              expect(registered, where).toContain(result.providerId)
              // ... and when the operator had a say it is the provider they named.
              if (eligible.length > 1) {
                expect(result.providerId, where).toBe(chosen)
                expect(result.readiness?.() ?? true, where).toBe(true)
              } else {
                expect(result.providerId, where).toBe(eligible[0])
              }
            }
          }
        }
      }
    }
    expect(selected).toBeGreaterThan(0)
    expect(refused).toBeGreaterThan(0)
  })

  it('answers the same refusal whichever adapters it also holds', () => {
    // The chosen provider is down. Holding a perfectly healthy adapter for the other
    // one changes nothing: there is no "next".
    const withHealthyOther = createAiProviderRegistry(
      [adapter('openai', true), adapter('anthropic', false)],
      { review_analysis: 'anthropic' },
    )
    const alone = createAiProviderRegistry([adapter('anthropic', false)], {
      review_analysis: 'anthropic',
    })
    const eligible = ['openai', 'anthropic'] as const

    expect(
      refusal(() =>
        selectAiProvider(withHealthyOther, { capability: 'review_analysis', eligible }),
      ),
    ).toBe('selected_not_ready')
    expect(
      refusal(() => selectAiProvider(alone, { capability: 'review_analysis', eligible })),
    ).toBe('selected_not_ready')
  })
})
