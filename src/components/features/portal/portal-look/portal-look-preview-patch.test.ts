// What the editor's phone shows of a look edit before the draft is read again.
import { describe, expect, it } from 'vitest'
import {
  coloursPatchOf,
  focalPatchOf,
  patchedBrand,
  withBrandPatch,
  wordmarkPatchOf,
  type PreviewBrand,
} from './portal-look-preview-patch'

const BRAND: PreviewBrand = {
  displayName: 'Avela Resort',
  wordmark: 'AVELA',
  logo: null,
  hero: { url: '/photo.jpg', width: 1600, height: 1000, focalX: 0.5, focalY: 0.42 },
  accentColour: '#EAD6A8',
  fieldColour: '#15110D',
}

describe('the colours drawn for a draft', () => {
  it('draws the accent and the field the page would paint with it', () => {
    const patch = coloursPatchOf({
      accent: '#9AD6C8',
      backgroundMode: 'manual',
      field: '#102A26',
    })

    expect(patch?.(BRAND)).toEqual({
      ...BRAND,
      accentColour: '#9AD6C8',
      fieldColour: '#102A26',
    })
  })

  it('derives the field from the accent while the background is automatic', () => {
    const drawn = coloursPatchOf({
      accent: '#9AD6C8',
      backgroundMode: 'auto',
      field: '#000000',
    })?.(BRAND)

    expect(drawn?.accentColour).toBe('#9AD6C8')
    expect(drawn?.fieldColour).not.toBe(BRAND.fieldColour)
    expect(drawn?.fieldColour).not.toBe('#000000')
  })

  it('draws nothing for a colour that is not finished, so the saved one stays', () => {
    expect(
      coloursPatchOf({ accent: '#9AD6', backgroundMode: 'auto', field: '#102A26' }),
    ).toBeNull()
    expect(
      coloursPatchOf({ accent: '#9AD6C8', backgroundMode: 'manual', field: '#10' }),
    ).toBeNull()
  })
})

describe('the wordmark drawn for what is typed', () => {
  it('draws it trimmed', () => {
    expect(wordmarkPatchOf('  POOL BAR ')(BRAND).wordmark).toBe('POOL BAR')
  })

  it('draws the display name once it is emptied', () => {
    expect(wordmarkPatchOf('   ')(BRAND).wordmark).toBeNull()
  })
})

describe('the photograph drawn with the circle where it is', () => {
  it('moves the crop and keeps the photograph', () => {
    expect(focalPatchOf({ x: 0.3, y: 0.6 })(BRAND).hero).toEqual({
      ...BRAND.hero,
      focalX: 0.3,
      focalY: 0.6,
    })
  })

  it('leaves a page with no photograph as it is', () => {
    const bare = { ...BRAND, hero: null }

    expect(focalPatchOf({ x: 0.3, y: 0.6 })(bare)).toBe(bare)
  })
})

describe('the edits in flight', () => {
  it('lays every edit over the brand, and the brand itself when there are none', () => {
    expect(patchedBrand(BRAND, {})).toBe(BRAND)
    const drawn = patchedBrand(BRAND, {
      wordmark: wordmarkPatchOf('POOL'),
      focal: focalPatchOf({ x: 0.1, y: 0.2 }),
    })

    expect(drawn.wordmark).toBe('POOL')
    expect(drawn.hero?.focalX).toBe(0.1)
    expect(drawn.accentColour).toBe(BRAND.accentColour)
  })

  it('keeps one edit of each kind: a new one replaces the last', () => {
    const first = withBrandPatch({}, 'wordmark', wordmarkPatchOf('POOL'))
    const second = withBrandPatch(first, 'wordmark', wordmarkPatchOf('POOL BAR'))

    expect(patchedBrand(BRAND, second).wordmark).toBe('POOL BAR')
    expect(Object.keys(second)).toEqual(['wordmark'])
  })

  it('takes one edit off without touching the others, and changes nothing it was given', () => {
    const both = withBrandPatch(
      withBrandPatch({}, 'wordmark', wordmarkPatchOf('POOL')),
      'focal',
      focalPatchOf({ x: 0.1, y: 0.2 }),
    )
    const without = withBrandPatch(both, 'wordmark', null)

    expect(Object.keys(without)).toEqual(['focal'])
    expect(Object.keys(both).sort()).toEqual(['focal', 'wordmark'])
  })
})
