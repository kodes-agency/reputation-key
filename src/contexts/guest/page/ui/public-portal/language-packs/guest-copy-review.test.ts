// The copy added with the guest page review: the privacy link says the notice
// is in English, the removed-response page can start over, a rating that cannot
// be sent no longer claims the whole page is unavailable, and the unavailable
// page can try again. The rest of the pack contract is in `guest-copy.test.ts`.

import { describe, expect, it } from 'vitest'
import { bgCopy } from './bg'
import { deCopy } from './de'
import { enCopy } from './en'
import { esCopy } from './es'
import { frCopy } from './fr'
import { itCopy } from './it'

const PACKS = [
  { locale: 'en', pack: enCopy },
  { locale: 'bg', pack: bgCopy },
  { locale: 'es', pack: esCopy },
  { locale: 'it', pack: itCopy },
  { locale: 'fr', pack: frCopy },
  { locale: 'de', pack: deCopy },
] as const

describe('the privacy notice link', () => {
  it('says in each language that the privacy notice is in English', () => {
    expect(enCopy.copy.privacyNoticeLinkInEnglish).toBe('Privacy notice (in English)')
    expect(bgCopy.copy.privacyNoticeLinkInEnglish).toMatch(/английски/)
    expect(esCopy.copy.privacyNoticeLinkInEnglish).toMatch(/inglés/)
    expect(itCopy.copy.privacyNoticeLinkInEnglish).toMatch(/inglese/)
    expect(frCopy.copy.privacyNoticeLinkInEnglish).toMatch(/anglais/)
    expect(deCopy.copy.privacyNoticeLinkInEnglish).toMatch(/Englisch/)
  })

  it.each(PACKS)('keeps the plain link text inside it in $locale', ({ pack }) => {
    expect(pack.copy.privacyNoticeLinkInEnglish).toContain(pack.copy.privacyNoticeLink)
  })
})

describe('starting over after a removal', () => {
  it.each(PACKS)(
    'opens the fresh page with the first sentence of any start over, and promises no saved response ($locale)',
    ({ pack }) => {
      expect(
        pack.copy.startOverDone.startsWith(pack.copy.startOverDoneAfterRemoval),
      ).toBe(true)
      expect(pack.copy.startOverDoneAfterRemoval.length).toBeLessThan(
        pack.copy.startOverDone.length,
      )
    },
  )

  it('is "Ready for the next guest." in English', () => {
    expect(enCopy.copy.startOverDoneAfterRemoval).toBe('Ready for the next guest.')
  })
})

describe('a rating that cannot be sent', () => {
  it.each(PACKS)(
    'is worded differently from the page that is gone ($locale)',
    ({ pack }) => {
      expect(pack.copy.ratingUnavailableTitle).not.toBe(pack.copy.unavailableTitle)
      expect(pack.copy.ratingUnavailableBody.length).toBeGreaterThan(0)
    },
  )

  it('says in English that it is the ratings that cannot be sent, not the page', () => {
    expect(enCopy.copy.ratingUnavailableTitle).toBe(
      'Ratings can’t be sent from here right now.',
    )
    expect(enCopy.copy.ratingUnavailableBody).toBe('Please try again later.')
  })
})

describe('the unavailable page', () => {
  it('has a retry label in every language', () => {
    expect(enCopy.copy.unavailableRetry).toBe('Try again')
    for (const { pack } of PACKS) {
      expect(pack.copy.unavailableRetry.length).toBeGreaterThan(0)
    }
  })
})
