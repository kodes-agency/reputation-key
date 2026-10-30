import { describe, expect, it } from 'vitest'
import { REVIEW_CAUSE_PHRASE_PATTERN } from './review-analysis-v3'
import { REVIEW_GENERIC_THING_WORDS, isGenericThingWord } from './review-generic-things'

describe('the generic thing words', () => {
  const all = Object.values(REVIEW_GENERIC_THING_WORDS).flat()

  it('are single lowercase words that fit the cause phrase contract, each listed once', () => {
    expect(all.length).toBeGreaterThan(20)
    expect(new Set(all).size).toBe(all.length)
    for (const word of all) {
      expect(REVIEW_CAUSE_PHRASE_PATTERN.test(word), word).toBe(true)
      expect(word, word).toMatch(/^[a-z]+$/u)
    }
  })

  it('name the business, the visit, the people and the topic, as the guide does', () => {
    for (const word of [
      'place',
      'staff',
      'team',
      'welcome',
      'visit',
      'price',
      'location',
    ]) {
      expect(isGenericThingWord(word), word).toBe(true)
    }
  })

  it('leave every part and item a thing', () => {
    for (const word of [
      'room',
      'bed',
      'drinks',
      'engine',
      'front desk',
      'check-in',
      'hotel restaurant',
      'room service',
      'bar price',
      'parking',
      'music',
    ]) {
      expect(isGenericThingWord(word), word).toBe(false)
    }
    expect(isGenericThingWord(null)).toBe(false)
  })

  it('are frozen', () => {
    expect(Object.isFrozen(REVIEW_GENERIC_THING_WORDS)).toBe(true)
    for (const group of Object.values(REVIEW_GENERIC_THING_WORDS)) {
      expect(Object.isFrozen(group)).toBe(true)
    }
  })
})
