import { describe, expect, it } from 'vitest'
import { replyLibraryFixture } from './reply-library.stories.fixtures'
import { initialVoiceDraft, voiceDraftChanged, voiceSaveInput } from './reply-voice-model'

const PROPERTY_ID = '10000000-0000-4000-8000-000000000101'
const library = replyLibraryFixture()
const saved = initialVoiceDraft(library.voice)

describe('voiceSaveInput', () => {
  it('sends no resolved fields or hidden-language lists when nothing changed', () => {
    expect(voiceSaveInput(PROPERTY_ID, 'account', saved, saved, library)).toEqual({
      propertyId: PROPERTY_ID,
      scope: 'account',
      set: {},
      reset: [],
      expectedVersion: 0,
    })
  })

  it('sends only the scalar field that changed', () => {
    const draft = { ...saved, useFirstName: !saved.useFirstName }
    expect(voiceSaveInput(PROPERTY_ID, 'property', draft, saved, library)).toEqual({
      propertyId: PROPERTY_ID,
      scope: 'property',
      set: { useFirstName: !saved.useFirstName },
      reset: [],
      expectedVersion: 0,
    })
  })

  it('writes a cleared optional field as an explicit blank, so a property never inherits it back', () => {
    const previous = { ...saved, contact: 'manager@example.test' }
    const draft = { ...previous, contact: '  ' }
    expect(
      voiceSaveInput(PROPERTY_ID, 'property', draft, previous, library),
    ).toMatchObject({
      set: { contact: null },
      reset: [],
    })
  })

  it('sends only the localized list that changed and never copies Bulgarian values', () => {
    const draft = {
      ...saved,
      lists: {
        ...saved.lists,
        'en-Latn': {
          ...saved.lists['en-Latn'],
          positiveText: 'Thank you for sharing this.',
        },
      },
    }
    expect(
      voiceSaveInput(PROPERTY_ID, 'account', draft, saved, library).localized,
    ).toEqual({
      'en-Latn': { closings: { positiveText: ['Thank you for sharing this.'] } },
    })
  })

  it('does not submit an oversized emoji set while emoji are off', () => {
    const previous = { ...saved, emojiMode: 'positive' as const, emojiSet: '✨ 💛' }
    const draft = { ...previous, emojiMode: 'off' as const, emojiSet: '1 2 3 4 5 6' }
    expect(voiceSaveInput(PROPERTY_ID, 'account', draft, previous, library).set).toEqual({
      emojiMode: 'off',
    })
  })
})

describe('voiceDraftChanged', () => {
  it('ignores the preview language but detects a voice edit', () => {
    expect(voiceDraftChanged({ ...saved, language: 'es-Latn' }, saved)).toBe(false)
    expect(voiceDraftChanged({ ...saved, privacyMode: !saved.privacyMode }, saved)).toBe(
      true,
    )
  })
})
