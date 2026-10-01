import { describe, expect, it } from 'vitest'
import { changedSettingEntries, hasPortalWorkingCopyPatch } from './portal-settings-edits'

const before = {
  name: 'Reception',
  slug: 'reception',
  description: null,
  heroImageUrl: null,
  theme: { primaryColor: '#0d9488', backgroundColor: '#ffffff' },
  privateFeedbackThreshold: 3,
  primaryGuestLocale: 'en',
  additionalGuestLocales: ['es', 'bg'],
}

describe('hasPortalWorkingCopyPatch', () => {
  it('is true for any page setting and false for a state change alone', () => {
    expect(hasPortalWorkingCopyPatch({ name: 'x' })).toBe(true)
    expect(hasPortalWorkingCopyPatch({ additionalGuestLocales: [] })).toBe(true)
    expect(hasPortalWorkingCopyPatch({ publicationState: 'published' })).toBe(false)
    expect(hasPortalWorkingCopyPatch({})).toBe(false)
  })
})

describe('changedSettingEntries', () => {
  it('names a changed name with its wording before and after', () => {
    expect(changedSettingEntries(before, { name: 'Front Desk' })).toEqual([
      { key: 'settings:name', previousText: 'Reception', newText: 'Front Desk' },
    ])
  })

  it('keeps wording for the description, including one that was cleared or never set', () => {
    expect(changedSettingEntries(before, { description: 'Scan to review' })).toEqual([
      { key: 'settings:description', previousText: null, newText: 'Scan to review' },
    ])
    expect(
      changedSettingEntries({ ...before, description: 'Old' }, { description: null }),
    ).toEqual([{ key: 'settings:description', previousText: 'Old', newText: null }])
  })

  it('names every other changed setting by its field alone, never with wording', () => {
    expect(
      changedSettingEntries(before, {
        slug: 'front-desk',
        heroImageUrl: 'https://example.test/hero.jpg',
        privateFeedbackThreshold: 2,
        primaryGuestLocale: 'bg',
        additionalGuestLocales: ['es'],
        theme: { primaryColor: '#e11d48', backgroundColor: '#ffffff' },
      }),
    ).toEqual([
      { key: 'settings:slug' },
      { key: 'settings:hero_image' },
      { key: 'settings:feedback_threshold' },
      { key: 'settings:primary_language' },
      { key: 'settings:additional_languages' },
      { key: 'settings:theme' },
    ])
  })

  it('leaves out a setting that was sent again unchanged, whatever its key order', () => {
    expect(
      changedSettingEntries(before, {
        name: 'Reception',
        theme: { backgroundColor: '#ffffff', primaryColor: '#0d9488' },
        additionalGuestLocales: ['es', 'bg'],
        privateFeedbackThreshold: 3,
      }),
    ).toEqual([])
  })

  it('ignores a patch key that is not a page setting', () => {
    expect(changedSettingEntries(before, { publicationState: 'published' })).toEqual([])
  })

  it('treats a list in a different order as a change', () => {
    expect(
      changedSettingEntries(before, { additionalGuestLocales: ['bg', 'es'] }),
    ).toEqual([{ key: 'settings:additional_languages' }])
  })
})
