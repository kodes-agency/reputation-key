import { describe, expect, it } from 'vitest'
import {
  normalisePrintFinalWords,
  printFinalKickerRepeated,
} from './portal-print-final-kicker'

describe('normalisePrintFinalWords (spec 5.9)', () => {
  it('lower-cases, drops accents and punctuation, and collapses spaces', () => {
    expect(normalisePrintFinalWords('  Évaluez   VOTRE visite !')).toBe(
      'evaluez votre visite',
    )
    expect(normalisePrintFinalWords('Votre avis sur nous ?')).toBe('votre avis sur nous')
    expect(normalisePrintFinalWords('Chair 3 · Sala 12')).toBe('chair 3 sala 12')
  })

  it('keeps letters and digits of every script', () => {
    expect(normalisePrintFinalWords('Как беше при нас?')).toBe('как беше при нас')
  })
})

describe('printFinalKickerRepeated', () => {
  it('is true when the headline is the kicker plus punctuation or in another case', () => {
    expect(printFinalKickerRepeated('Review us on Google', 'Review us on Google')).toBe(
      true,
    )
    expect(printFinalKickerRepeated('Review us on Google', 'Review us on Google!')).toBe(
      true,
    )
    expect(printFinalKickerRepeated('RATE YOUR VISIT', 'Rate your visit')).toBe(true)
    expect(printFinalKickerRepeated('Évaluez votre visite', 'Evaluez votre visite')).toBe(
      true,
    )
  })

  it('is false for different words, so the kicker stays', () => {
    expect(printFinalKickerRepeated('Review us on Google', 'How did we do?')).toBe(false)
    expect(printFinalKickerRepeated('Rate your visit', 'Rate your visit today')).toBe(
      false,
    )
  })

  it('never hides a kicker that says nothing, or an empty headline against one', () => {
    expect(printFinalKickerRepeated('', '')).toBe(false)
    expect(printFinalKickerRepeated('Reception', '')).toBe(false)
  })
})
