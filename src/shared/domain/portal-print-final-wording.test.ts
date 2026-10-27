import { describe, expect, it } from 'vitest'
import {
  PRINT_FINAL_DEFAULT_WORDING,
  printFinalOpeningWording,
  printFinalSameOwnWords,
  printFinalWordingIsSaved,
  printFinalWordingSaveProblem,
  printFinalWordingToSave,
  type PrintFinalSavedWording,
} from './portal-print-final-wording'

const own = { headline: 'Thanks for staying', subline: 'Tell us more' }

describe('printFinalOpeningWording', () => {
  const saved: PrintFinalSavedWording = { callToAction: 'rate_visit', customWords: null }
  const last: PrintFinalSavedWording = {
    callToAction: 'how_was_visit',
    customWords: { en: own },
  }

  it('opens on the saved wording first', () => {
    expect(printFinalOpeningWording(saved, last)).toBe(saved)
  })

  it('opens on the last print’s wording when nothing was saved', () => {
    expect(printFinalOpeningWording(null, last)).toBe(last)
  })

  it('opens on the default wording when nothing was saved or printed', () => {
    expect(printFinalOpeningWording(null, null)).toBe(PRINT_FINAL_DEFAULT_WORDING)
    expect(PRINT_FINAL_DEFAULT_WORDING).toEqual({
      callToAction: 'how_did_we_do',
      customWords: null,
    })
  })
})

describe('printFinalWordingToSave', () => {
  it('keeps own words only for the languages of the print that differ from the copy, normalised', () => {
    expect(
      printFinalWordingToSave(
        {
          preset: 'how_was_stay',
          custom: {
            en: { headline: '  Thanks   for staying ', subline: 'Tell us more' },
            bg: { headline: 'Благодарим', subline: '' },
          },
        },
        ['en'],
      ),
    ).toEqual({
      callToAction: 'how_was_stay',
      customWords: { en: { headline: 'Thanks for staying', subline: 'Tell us more' } },
    })
  })

  it('saves null when every field is the wording’s copy', () => {
    expect(
      printFinalWordingToSave(
        {
          preset: 'how_was_stay',
          custom: {
            en: { headline: 'How was your stay?', subline: 'Share your experience' },
          },
        },
        ['en'],
      ),
    ).toEqual({ callToAction: 'how_was_stay', customWords: null })
    expect(printFinalWordingToSave({ preset: 'rate_visit' }, ['en'])).toEqual({
      callToAction: 'rate_visit',
      customWords: null,
    })
  })
})

describe('printFinalWordingIsSaved', () => {
  const saved: PrintFinalSavedWording = {
    callToAction: 'how_was_stay',
    customWords: { en: own },
  }

  it('is saved when the wording and the normalised own words are the same', () => {
    expect(
      printFinalWordingIsSaved(
        {
          preset: 'how_was_stay',
          custom: { en: { headline: ' Thanks for staying', subline: 'Tell us more ' } },
        },
        ['en'],
        saved,
      ),
    ).toBe(true)
  })

  it('is unsaved when the wording, a headline or a sub-line differs', () => {
    const words = { preset: 'how_was_stay' as const, custom: { en: own } }
    expect(
      printFinalWordingIsSaved({ ...words, preset: 'rate_visit' }, ['en'], saved),
    ).toBe(false)
    expect(
      printFinalWordingIsSaved(
        { ...words, custom: { en: { ...own, headline: 'Thanks' } } },
        ['en'],
        saved,
      ),
    ).toBe(false)
    expect(
      printFinalWordingIsSaved(
        { ...words, custom: { en: { ...own, subline: '' } } },
        ['en'],
        saved,
      ),
    ).toBe(false)
  })

  it('compares only the languages of the print: a saved language it does not carry is not compared', () => {
    const both: PrintFinalSavedWording = {
      callToAction: 'how_was_stay',
      customWords: { en: own, bg: { headline: 'Благодарим', subline: '' } },
    }
    expect(
      printFinalWordingIsSaved(
        { preset: 'how_was_stay', custom: { en: own } },
        ['en'],
        both,
      ),
    ).toBe(true)
  })

  it('treats a picked wording as the same as its copy written out unchanged', () => {
    expect(
      printFinalWordingIsSaved({ preset: 'rate_visit', custom: null }, ['en'], {
        callToAction: 'rate_visit',
        customWords: null,
      }),
    ).toBe(true)
  })
})

describe('printFinalSameOwnWords', () => {
  it('ignores the order the languages were stored in', () => {
    const bg = { headline: 'Благодарим', subline: '' }
    expect(printFinalSameOwnWords({ en: own, bg }, { bg, en: own })).toBe(true)
    expect(printFinalSameOwnWords(null, {})).toBe(true)
    expect(printFinalSameOwnWords({ en: own }, null)).toBe(false)
  })
})

describe('printFinalWordingSaveProblem', () => {
  it('names a language with no headline, and an offer, and lets everything else save', () => {
    expect(
      printFinalWordingSaveProblem(
        { preset: 'how_did_we_do', custom: { en: { headline: ' ', subline: '' } } },
        ['en'],
      ),
    ).toBe('empty_headline')
    expect(
      printFinalWordingSaveProblem(
        {
          preset: 'how_did_we_do',
          custom: { en: { headline: 'Get 10% off', subline: '' } },
        },
        ['en'],
      ),
    ).toBe('offer')
    expect(printFinalWordingSaveProblem({ preset: 'how_did_we_do' }, ['en'])).toBeNull()
    // Too long for a print is the download's to refuse, not the save's.
    expect(
      printFinalWordingSaveProblem(
        {
          preset: 'how_did_we_do',
          custom: { en: { headline: 'W'.repeat(60), subline: 'W'.repeat(60) } },
        },
        ['en'],
      ),
    ).toBeNull()
  })
})
