import { describe, expect, it } from 'vitest'
import {
  PHOTO_DESCRIPTION_MAX,
  canUsePhoto,
  changedDescriptions,
  descriptionFields,
  descriptionProblem,
  focalMoved,
  photoDialogTitle,
  savedDescriptions,
  photoButtonLabel,
  type PhotoDialogState,
} from './property-photo-rules'

describe('savedDescriptions', () => {
  it('keeps the written descriptions by language and leaves out empty ones and languages that are not offered', () => {
    expect(
      savedDescriptions([
        { locale: 'en', heroAltText: ' Evening on the sea terrace ' },
        { locale: 'bg', heroAltText: null },
        { locale: 'de', heroAltText: '   ' },
        { locale: 'xx', heroAltText: 'Unknown language' },
      ]),
    ).toEqual({ en: 'Evening on the sea terrace' })
  })
})

describe('descriptionFields', () => {
  it('asks "Describe the photo" for a Property with one language', () => {
    expect(descriptionFields(['en'], { en: 'Terrace' })).toEqual([
      { locale: 'en', label: 'Describe the photo', value: 'Terrace' },
    ])
  })

  it('names the language when there are several, the primary first, an unwritten one empty', () => {
    expect(descriptionFields(['bg', 'en'], { en: 'Terrace' })).toEqual([
      { locale: 'bg', label: 'Describe the photo in Bulgarian', value: '' },
      { locale: 'en', label: 'Describe the photo in English', value: 'Terrace' },
    ])
  })
})

describe('changedDescriptions', () => {
  it('names only the languages that differ from what is saved, a cleared one as null', () => {
    expect(
      changedDescriptions(
        ['en', 'bg'],
        { en: ' Terrace at dusk ', bg: '' },
        { en: 'Terrace', bg: 'Тераса' },
      ),
    ).toEqual([
      { locale: 'en', text: 'Terrace at dusk' },
      { locale: 'bg', text: null },
    ])
  })

  it('is empty when nothing changed, including a trailing space', () => {
    expect(changedDescriptions(['en'], { en: 'Terrace ' }, { en: 'Terrace' })).toEqual([])
    expect(changedDescriptions(['en'], {}, {})).toEqual([])
  })

  it('ignores a language that is no longer offered', () => {
    expect(changedDescriptions(['en'], { en: 'A', bg: 'Б' }, { en: 'A' })).toEqual([])
  })
})

describe('descriptionProblem', () => {
  it('is null within the limit and a sentence past it', () => {
    expect(descriptionProblem({ en: 'x'.repeat(PHOTO_DESCRIPTION_MAX) })).toBeNull()
    expect(descriptionProblem({ en: `${'x'.repeat(PHOTO_DESCRIPTION_MAX)}y` })).toBe(
      'A description can be at most 160 characters',
    )
  })
})

const state = (overrides: Partial<PhotoDialogState> = {}): PhotoDialogState => ({
  hasPhoto: false,
  hasFile: false,
  isFileUsable: false,
  isRightsConfirmed: false,
  isFocalChanged: false,
  isDescriptionChanged: false,
  isDescriptionValid: true,
  isBusy: false,
  ...overrides,
})

describe('canUsePhoto', () => {
  it('needs a usable new file and the confirmed rights', () => {
    const chosen = { hasFile: true, isFileUsable: true }
    expect(canUsePhoto(state(chosen))).toBe(false)
    expect(canUsePhoto(state({ ...chosen, isRightsConfirmed: true }))).toBe(true)
    expect(
      canUsePhoto(state({ hasFile: true, isFileUsable: false, isRightsConfirmed: true })),
    ).toBe(false)
  })

  it('lets the photograph in place be saved once its focal point or description changed', () => {
    expect(canUsePhoto(state({ hasPhoto: true }))).toBe(false)
    expect(canUsePhoto(state({ hasPhoto: true, isFocalChanged: true }))).toBe(true)
    expect(canUsePhoto(state({ hasPhoto: true, isDescriptionChanged: true }))).toBe(true)
  })

  it('has nothing to save with no photograph and no file', () => {
    expect(canUsePhoto(state({ isFocalChanged: true, isDescriptionChanged: true }))).toBe(
      false,
    )
  })

  it('is off while something is on its way, and for a description that is too long', () => {
    const ready = { hasFile: true, isFileUsable: true, isRightsConfirmed: true }
    expect(canUsePhoto(state({ ...ready, isBusy: true }))).toBe(false)
    expect(canUsePhoto(state({ ...ready, isDescriptionValid: false }))).toBe(false)
  })
})

describe('the dialog wording', () => {
  it('says what the primary button does', () => {
    expect(photoButtonLabel(true, false)).toBe('Use photo')
    expect(photoButtonLabel(false, false)).toBe('Save')
    expect(photoButtonLabel(true, true)).toBe('Uploading…')
    expect(photoButtonLabel(false, true)).toBe('Saving…')
  })

  it('titles the dialog by whether there is a photograph to replace', () => {
    expect(photoDialogTitle(true)).toBe('Replace photo')
    expect(photoDialogTitle(false)).toBe('Add a photo')
  })

  it('counts a first photograph as a moved focal point', () => {
    expect(focalMoved(null, { x: 0.5, y: 0.5 })).toBe(true)
    expect(focalMoved({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 })).toBe(false)
    expect(focalMoved({ x: 0.5, y: 0.5 }, { x: 0.4, y: 0.5 })).toBe(true)
  })
})
