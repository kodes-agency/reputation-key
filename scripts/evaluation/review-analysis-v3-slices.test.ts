import { describe, expect, it } from 'vitest'
import { scoreSlices } from './review-analysis-v3-slices'
import {
  acceptedResult,
  answer,
  mention,
  scoredRun,
  simpleCauseKey,
} from './review-analysis-v3.test-fixtures'

const air = mention({ topic: 'facilities_equipment' })
const familyOf = (business: string) => (business === 'Hotel' ? 'lodging' : 'food-service')

function run(id: string, overrides: Parameters<typeof scoredRun>[3] = {}) {
  const stored = answer([air])
  return scoredRun(id, stored, acceptedResult(id, stored), overrides)
}

describe('scoreSlices', () => {
  const runs = [
    run('a', {
      language: 'en',
      business: 'Hotel',
      text: 'x'.repeat(10),
      tags: ['sarcasm'],
    }),
    run('b', { language: 'bg', business: 'Restaurant', text: 'x'.repeat(80), tags: [] }),
    run('c', {
      language: 'es',
      business: 'Hotel',
      text: 'x'.repeat(200),
      tags: ['sarcasm', 'multi_topic'],
    }),
    run('d', { language: 'de', business: 'Hotel', text: 'x'.repeat(500), tags: [] }),
    run('e', {
      language: 'mixed',
      business: 'Restaurant',
      text: 'x'.repeat(30),
      tags: [],
    }),
  ]

  const scores = scoreSlices(runs, simpleCauseKey, familyOf)

  it('scores the whole set and the three languages of the gates fully', () => {
    expect(scores.gating.all.items).toBe(5)
    expect(scores.gating.en.items).toBe(1)
    expect(scores.gating.bg.items).toBe(1)
    expect(scores.gating.es.items).toBe(1)
    expect(scores.gating.all.topics.micro.tp).toBe(5)
  })

  it('gathers the other languages in one context slice', () => {
    expect(scores.context['language:other']?.items).toBe(2)
  })

  it('reads each business family', () => {
    expect(scores.context['family:lodging']?.items).toBe(3)
    expect(scores.context['family:food-service']?.items).toBe(2)
  })

  it('reads the length of the text in the buckets of the quota', () => {
    expect(scores.context['length:under 50']?.items).toBe(2)
    expect(scores.context['length:50-149']?.items).toBe(1)
    expect(scores.context['length:150-399']?.items).toBe(1)
    expect(scores.context['length:400+']?.items).toBe(1)
  })

  it('reads the cases the set was written to test, a review in each of its tags', () => {
    expect(scores.context['tag:sarcasm']?.items).toBe(2)
    expect(scores.context['tag:multi_topic']?.items).toBe(1)
  })

  it('carries the headline numbers of a context slice', () => {
    expect(scores.context['tag:sarcasm']).toEqual({
      items: 2,
      sentimentAccuracy: 1,
      topicMicroF1: 1,
      thingAgreement: 1,
      urgentRecall: null,
      falseUrgentRate: 0,
    })
  })

  it('lists the context slices in order', () => {
    const names = Object.keys(scores.context)

    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })

  it('has empty gating slices, not missing ones, for a language that is absent', () => {
    const onlyEnglish = scoreSlices(
      [run('a', { language: 'en' })],
      simpleCauseKey,
      familyOf,
    )

    expect(onlyEnglish.gating.bg.items).toBe(0)
    expect(onlyEnglish.gating.bg.topics.micro.f1).toBeNull()
  })
})
