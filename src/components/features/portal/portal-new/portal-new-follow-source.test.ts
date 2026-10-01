import { describe, expect, it } from 'vitest'
import { languagesAfterChange } from './portal-new-follow-source'
import type { PortalNewSource } from './portal-new-types'

const options = { defaultGuestLocales: ['en'] as const }
const sources: PortalNewSource[] = [
  { portalId: 'a', name: 'A', primaryGuestLocale: 'bg', additionalGuestLocales: ['en'] },
  { portalId: 'b', name: 'B', primaryGuestLocale: 'de', additionalGuestLocales: [] },
]

describe('languagesAfterChange', () => {
  it('brings the languages of the portal being copied', () => {
    expect(languagesAfterChange(options, sources, 'portal', 'a')).toEqual(['bg', 'en'])
  })

  it('brings the Property languages back when starting from the Property wording', () => {
    expect(languagesAfterChange(options, sources, 'property', 'a')).toEqual(['en'])
  })

  it('keeps the Property languages until a portal is chosen', () => {
    expect(languagesAfterChange(options, sources, 'portal', '')).toEqual(['en'])
  })

  it('keeps the Property languages when the copied portal has none that are offered yet', () => {
    expect(languagesAfterChange(options, sources, 'portal', 'b')).toEqual(['en'])
  })
})
