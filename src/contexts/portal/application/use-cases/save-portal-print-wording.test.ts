// Portal context — the input of the saved print wording: which wordings the menu
// offers, and the rules the own words are held to (the download's own).

import { describe, expect, it } from 'vitest'
import { savePortalPrintWordingInputSchema } from '../dto/portal-print-wording.dto'

describe('savePortalPrintWordingInputSchema', () => {
  const base = { portalId: 'p-1', callToAction: 'how_did_we_do' }
  const parse = (input: object) => savePortalPrintWordingInputSchema.safeParse(input)

  it('takes every wording of the menu, and no other', () => {
    for (const callToAction of [
      'how_did_we_do',
      'how_was_visit',
      'how_was_stay',
      'rate_visit',
      'got_30_seconds',
    ]) {
      expect(parse({ ...base, callToAction }).success).toBe(true)
    }
    expect(parse({ ...base, callToAction: 'rate' }).success).toBe(false)
    expect(parse({ ...base, portalId: '' }).success).toBe(false)
  })

  it('holds own words to the download’s rules', () => {
    const words = (copy: object) => parse({ ...base, customWords: { en: copy } })
    expect(words({ headline: 'Hi', subline: '' }).success).toBe(true)
    expect(words({ headline: '', subline: '' }).success).toBe(false)
    expect(words({ headline: 'x'.repeat(61), subline: '' }).success).toBe(false)
    expect(words({ headline: 'Hi', subline: 'x'.repeat(61) }).success).toBe(false)
    expect(words({ headline: 'Hi\u0007', subline: '' }).success).toBe(false)
    expect(
      parse({ ...base, customWords: { xx: { headline: 'Hi', subline: '' } } }).success,
    ).toBe(false)
  })
})
