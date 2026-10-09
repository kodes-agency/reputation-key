// The copy added with the guest page review: the privacy link says the notice
// is in English, the removed-response page can start over, a rating that cannot
// be sent no longer claims the whole page is unavailable, and the unavailable
// page can try again. The rest of the pack contract is in `guest-copy-v2.test.ts`.

import { describe, expect, it } from 'vitest'
import { bgV2 } from './bg-v2'
import { deV2 } from './de-v2'
import { enV2 } from './en-v2'
import { esV2 } from './es-v2'
import { frV2 } from './fr-v2'
import { itV2 } from './it-v2'

const PACKS = [
  { locale: 'en', pack: enV2 },
  { locale: 'bg', pack: bgV2 },
  { locale: 'es', pack: esV2 },
  { locale: 'it', pack: itV2 },
  { locale: 'fr', pack: frV2 },
  { locale: 'de', pack: deV2 },
] as const

describe('the privacy notice link', () => {
  it('says in each language that the privacy notice is in English', () => {
    expect(enV2.copy.privacyNoticeLinkInEnglish).toBe('Privacy notice (in English)')
    expect(bgV2.copy.privacyNoticeLinkInEnglish).toMatch(/английски/)
    expect(esV2.copy.privacyNoticeLinkInEnglish).toMatch(/inglés/)
    expect(itV2.copy.privacyNoticeLinkInEnglish).toMatch(/inglese/)
    expect(frV2.copy.privacyNoticeLinkInEnglish).toMatch(/anglais/)
    expect(deV2.copy.privacyNoticeLinkInEnglish).toMatch(/Englisch/)
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
    expect(enV2.copy.startOverDoneAfterRemoval).toBe('Ready for the next guest.')
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
    expect(enV2.copy.ratingUnavailableTitle).toBe(
      'Ratings can’t be sent from here right now.',
    )
    expect(enV2.copy.ratingUnavailableBody).toBe('Please try again later.')
  })
})

describe('the unavailable page', () => {
  it('has a retry label in every language', () => {
    expect(enV2.copy.unavailableRetry).toBe('Try again')
    for (const { pack } of PACKS) {
      expect(pack.copy.unavailableRetry.length).toBeGreaterThan(0)
    }
  })
})
