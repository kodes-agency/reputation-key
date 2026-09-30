// A form that keeps an explicit Save is remounted whenever the saved values
// change, and that remount is what makes a saved form read clean. The keys are
// the whole mechanism, so what goes INTO one decides whether typing survives:
// a key that included a value the person is autosaving would remount the field
// under their hands when the save lands.

import { describe, expect, it } from 'vitest'
import {
  portalBrandDraftKey,
  portalLocaleDraftKey,
  portalPropertyContentDraftKey,
} from './portal-draft-keys'
import type { PortalExperienceSettings } from '../portal-settings/portal-experience-settings-types'

const experience: PortalExperienceSettings = {
  profile: {
    displayName: 'Avela Resort',
    primaryColor: '#111111',
    backgroundColor: '#ffffff',
    textColor: '#222222',
  },
  content: [{ locale: 'en', title: 'Welcome', shortDescription: 'Hello', version: 1 }],
  overrides: [{ locale: 'en', title: 'Pool', shortDescription: null, version: 1 }],
  canManagePropertyBrand: true,
}

describe('portalBrandDraftKey', () => {
  it('changes when a saved colour or the display name changes', () => {
    const base = portalBrandDraftKey(experience)
    expect(
      portalBrandDraftKey({
        ...experience,
        profile: { ...experience.profile!, primaryColor: '#333333' },
      }),
    ).not.toBe(base)
    expect(
      portalBrandDraftKey({
        ...experience,
        profile: { ...experience.profile!, displayName: 'Avela' },
      }),
    ).not.toBe(base)
  })

  it('falls back to the defaults for a property with no brand profile', () => {
    expect(portalBrandDraftKey({ ...experience, profile: null })).toBe(
      JSON.stringify(['', '#2563EB', '#FFFFFF', '#111827']),
    )
  })
})

describe('portalPropertyContentDraftKey', () => {
  it('changes when the property fallback wording for that locale changes', () => {
    const base = portalPropertyContentDraftKey(experience, 'en')
    expect(
      portalPropertyContentDraftKey(
        {
          ...experience,
          content: [{ locale: 'en', title: 'Hi', shortDescription: 'Hello', version: 2 }],
        },
        'en',
      ),
    ).not.toBe(base)
  })

  it('does not change when this portal’s own override changes, which autosave writes as it is typed', () => {
    const base = portalPropertyContentDraftKey(experience, 'en')
    expect(
      portalPropertyContentDraftKey(
        {
          ...experience,
          overrides: [
            { locale: 'en', title: 'Pool 2', shortDescription: 'x', version: 2 },
          ],
        },
        'en',
      ),
    ).toBe(base)
  })

  it('names the locale, so two locales never share a form', () => {
    expect(portalPropertyContentDraftKey(experience, 'en')).not.toBe(
      portalPropertyContentDraftKey(experience, 'bg'),
    )
  })
})

describe('portalLocaleDraftKey', () => {
  it('is the effective primary and whether the optional language is on', () => {
    expect(
      portalLocaleDraftKey({ primaryGuestLocale: 'bg', additionalGuestLocales: ['en'] }),
    ).toBe(JSON.stringify(['bg', true]))
    expect(portalLocaleDraftKey({})).toBe(JSON.stringify(['en', false]))
  })
})
