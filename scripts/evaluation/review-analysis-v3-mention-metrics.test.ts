import { describe, expect, it } from 'vitest'
import {
  alignMentions,
  phraseTokenF1,
  scoreMentions,
} from './review-analysis-v3-mention-metrics'
import { mention, simpleCauseKey } from './review-analysis-v3.test-fixtures'

describe('phraseTokenF1', () => {
  it('compares phrases by their words', () => {
    expect(phraseTokenF1('not working', 'not working')).toBe(1)
    expect(phraseTokenF1('not working', 'working')).toBeCloseTo(2 / 3, 12)
    expect(phraseTokenF1('wrong shade', 'cold')).toBe(0)
  })

  it('lets two absent phrases agree and one absent phrase disagree', () => {
    expect(phraseTokenF1(null, null)).toBe(1)
    expect(phraseTokenF1(null, 'slow')).toBe(0)
    expect(phraseTokenF1('slow', null)).toBe(0)
  })

  it('splits on hyphens', () => {
    expect(phraseTokenF1('check-in', 'check in')).toBe(1)
  })
})

describe('alignMentions', () => {
  it('pairs the mentions of one topic by how much they resemble each other', () => {
    const goldRude = mention({
      topic: 'staff_service',
      polarity: 'negative',
      thing: 'waiter',
      sentences: [1],
    })
    const goldLovely = mention({
      topic: 'staff_service',
      polarity: 'positive',
      thing: 'host',
      sentences: [2],
    })
    const predictedLovely = mention({
      topic: 'staff_service',
      polarity: 'positive',
      thing: 'host',
      sentences: [2],
    })
    const predictedRude = mention({
      topic: 'staff_service',
      polarity: 'negative',
      thing: 'waiter',
      sentences: [1],
    })

    const alignment = alignMentions(
      [goldRude, goldLovely],
      [predictedLovely, predictedRude],
      simpleCauseKey,
    )

    expect(alignment.pairs).toEqual([
      { gold: goldRude, predicted: predictedRude },
      { gold: goldLovely, predicted: predictedLovely },
    ])
    expect(alignment.unmatchedGold).toBe(0)
    expect(alignment.unmatchedPredicted).toBe(0)
  })

  it('never pairs mentions of different topics', () => {
    const alignment = alignMentions(
      [mention({ topic: 'cleanliness' })],
      [mention({ topic: 'price_billing' })],
      simpleCauseKey,
    )

    expect(alignment.pairs).toEqual([])
    expect(alignment.unmatchedGold).toBe(1)
    expect(alignment.unmatchedPredicted).toBe(1)
  })

  it('pairs a lone mention of a topic even when nothing else agrees', () => {
    const alignment = alignMentions(
      [mention({ polarity: 'negative', thing: 'heating', sentences: [1] })],
      [mention({ polarity: 'positive', thing: 'lift', sentences: [4] })],
      simpleCauseKey,
    )

    expect(alignment.pairs).toHaveLength(1)
  })

  it('leaves the extra mention of a topic unmatched, earlier mentions first', () => {
    const first = mention({ thing: 'heating', sentences: [1] })
    const second = mention({ thing: 'lift', sentences: [2] })
    const only = mention({ thing: 'heating', sentences: [1] })

    const alignment = alignMentions([first, second], [only], simpleCauseKey)

    expect(alignment.pairs).toEqual([{ gold: first, predicted: only }])
    expect(alignment.unmatchedGold).toBe(1)
  })
})

describe('scoreMentions', () => {
  // One review. The answer finds both topics, names the staff thing differently,
  // spells the air conditioning as "ac", and misses the person's name.
  const goldStaff = mention({
    topic: 'staff_service',
    polarity: 'positive',
    strength: 'strong',
    thing: 'front desk',
    issue: 'helpful',
    sentences: [3],
    names_person: 'team_member',
  })
  const goldAir = mention({
    thing: 'air conditioning',
    issue: 'not working',
    sentences: [2],
  })
  const predictedStaff = mention({
    topic: 'staff_service',
    polarity: 'positive',
    strength: 'clear',
    thing: 'reception',
    issue: 'helpful',
    sentences: [3],
    names_person: null,
  })
  const predictedAir = mention({ thing: 'ac', issue: 'broken', sentences: [2, 3] })

  const scores = scoreMentions(
    [
      {
        itemId: 'cx-0001',
        gold: [goldStaff, goldAir],
        predicted: [predictedStaff, predictedAir],
      },
    ],
    simpleCauseKey,
  )

  it('counts the pairs', () => {
    expect(scores.pairs).toBe(2)
    expect(scores.unmatchedGold).toBe(0)
    expect(scores.unmatchedPredicted).toBe(0)
  })

  it('scores polarity and strength after topic matching', () => {
    expect(scores.polarityAccuracy).toBe(1)
    expect(scores.strengthAccuracy).toBe(0.5)
    expect(scores.strengthWithinOne).toBe(1)
  })

  it('compares the thing after normalisation', () => {
    expect(scores.causes.thingAgreement).toBe(0.5)
    expect(scores.causes.issueExact).toBe(0.5)
    expect(scores.causes.issueTokenF1).toBe(0.5)
    expect(scores.causes.fullAgreement).toBe(0)
  })

  it('scores the things a review names as a set, found or not', () => {
    // Gold: front desk, air conditioning. Answer: reception, air conditioning (as ac).
    expect(scores.causes.thingF1).toBe(0.5)
  })

  it('scores the evidence sentences of the pairs', () => {
    expect(scores.evidence).toMatchObject({ tp: 2, fp: 1, fn: 0 })
    expect(scores.evidence.precision).toBeCloseTo(2 / 3, 12)
    expect(scores.evidence.recall).toBe(1)
  })

  it('counts a named person the answer missed as a privacy-critical miss', () => {
    expect(scores.names.privacyCriticalMisses).toBe(1)
    expect(scores.names.needlessSuppressions).toBe(0)
    expect(scores.names.teamMember.recall).toBe(0)
  })

  it('counts a name the answer invented as a needless suppression', () => {
    const invented = scoreMentions(
      [
        {
          itemId: 'cx-0002',
          gold: [mention({ names_person: null })],
          predicted: [mention({ names_person: 'other' })],
        },
      ],
      simpleCauseKey,
    )

    expect(invented.names.needlessSuppressions).toBe(1)
    expect(invented.names.other.precision).toBe(0)
  })

  it('has no rates when nothing was paired', () => {
    const empty = scoreMentions(
      [{ itemId: 'cx-0003', gold: [mention()], predicted: [] }],
      simpleCauseKey,
    )

    expect(empty.pairs).toBe(0)
    expect(empty.unmatchedGold).toBe(1)
    expect(empty.polarityAccuracy).toBeNull()
    expect(empty.causes.thingAgreement).toBeNull()
  })
})
