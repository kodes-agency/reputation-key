import { describe, expect, it } from 'vitest'
import {
  GOOGLE_PRIMARY_CATEGORY_MAX_LENGTH,
  normalizeGooglePrimaryCategory,
} from './google-primary-category'

describe('normalizeGooglePrimaryCategory', () => {
  it('keeps Google’s display name as it is', () => {
    expect(normalizeGooglePrimaryCategory('Hotel')).toBe('Hotel')
    expect(normalizeGooglePrimaryCategory('Bed & breakfast')).toBe('Bed & breakfast')
    expect(normalizeGooglePrimaryCategory('Italian restaurant')).toBe(
      'Italian restaurant',
    )
  })

  it('trims, folds compatibility forms and collapses whitespace', () => {
    expect(normalizeGooglePrimaryCategory('  Hair   salon \n')).toBe('Hair salon')
    expect(normalizeGooglePrimaryCategory('Ｈotel')).toBe('Hotel')
    expect(normalizeGooglePrimaryCategory('Barber\tshop')).toBe('Barber shop')
  })

  it('has no category for nothing', () => {
    for (const value of [null, undefined, '', '   ', '\n\t']) {
      expect(normalizeGooglePrimaryCategory(value)).toBeNull()
    }
  })

  it('drops a value that is not text instead of repairing it', () => {
    expect(normalizeGooglePrimaryCategory('Hotel\u0000')).toBeNull()
    expect(normalizeGooglePrimaryCategory('Ho\u200Btel')).toBeNull()
    expect(normalizeGooglePrimaryCategory('Hotel\uE000')).toBeNull()
  })

  it('holds the value to the column: 512 characters, counted as characters', () => {
    expect(
      normalizeGooglePrimaryCategory('h'.repeat(GOOGLE_PRIMARY_CATEGORY_MAX_LENGTH)),
    ).toBe('h'.repeat(GOOGLE_PRIMARY_CATEGORY_MAX_LENGTH))
    expect(
      normalizeGooglePrimaryCategory('h'.repeat(GOOGLE_PRIMARY_CATEGORY_MAX_LENGTH + 1)),
    ).toBeNull()
    // 512 astral characters are 1,024 UTF-16 units and still fit.
    expect(normalizeGooglePrimaryCategory('😀'.repeat(512))).toBe('😀'.repeat(512))
    expect(normalizeGooglePrimaryCategory('😀'.repeat(513))).toBeNull()
  })

  it('measures the length after normalization, which can lengthen a value', () => {
    // U+FB03 becomes "ffi" under NFKC.
    expect(normalizeGooglePrimaryCategory('\uFB03'.repeat(171))).toBeNull()
    expect(normalizeGooglePrimaryCategory('\uFB03'.repeat(170))).toBe('ffi'.repeat(170))
  })

  it('is idempotent', () => {
    for (const value of ['  Day   spa ', 'Ｈotel', 'Boat rental service', '😀 beach']) {
      const once = normalizeGooglePrimaryCategory(value)
      expect(normalizeGooglePrimaryCategory(once)).toBe(once)
    }
  })

  it('always satisfies the column check on a stored value', () => {
    for (const value of ['Hotel', ' padded ', 'a'.repeat(512)]) {
      const stored = normalizeGooglePrimaryCategory(value)
      expect(stored === null || stored === stored.trim()).toBe(true)
      expect(stored === null || [...stored].length <= 512).toBe(true)
    }
  })
})
