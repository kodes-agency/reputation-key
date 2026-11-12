import { describe, expect, it } from 'vitest'
import { normalisePrintWords, printKickerRepeated } from './portal-print-kicker'

describe('normalisePrintWords (spec 5.9)', () => {
  it('lower-cases, drops accents and punctuation, and collapses spaces', () => {
    expect(normalisePrintWords('  Évaluez   VOTRE visite !')).toBe('evaluez votre visite')
    expect(normalisePrintWords('Votre avis sur nous ?')).toBe('votre avis sur nous')
    expect(normalisePrintWords('Chair 3 · Sala 12')).toBe('chair 3 sala 12')
  })

  it('keeps letters and digits of every script', () => {
    expect(normalisePrintWords('Как беше при нас?')).toBe('как беше при нас')
  })
})

describe('printKickerRepeated', () => {
  it('is true when the headline is the kicker plus punctuation or in another case', () => {
    expect(printKickerRepeated('Review us on Google', 'Review us on Google')).toBe(true)
    expect(printKickerRepeated('Review us on Google', 'Review us on Google!')).toBe(true)
    expect(printKickerRepeated('RATE YOUR VISIT', 'Rate your visit')).toBe(true)
    expect(printKickerRepeated('Évaluez votre visite', 'Evaluez votre visite')).toBe(true)
  })

  it('is false for different words, so the kicker stays', () => {
    expect(printKickerRepeated('Review us on Google', 'How did we do?')).toBe(false)
    expect(printKickerRepeated('Rate your visit', 'Rate your visit today')).toBe(false)
  })

  it('never hides a kicker that says nothing, or an empty headline against one', () => {
    expect(printKickerRepeated('', '')).toBe(false)
    expect(printKickerRepeated('Reception', '')).toBe(false)
  })
})
