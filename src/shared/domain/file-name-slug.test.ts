import { describe, expect, it } from 'vitest'
import { fileNameSlug } from './file-name-slug'

describe('fileNameSlug', () => {
  it('lowers the case and joins what is left with single hyphens', () => {
    expect(fileNameSlug('Pool & Terrace')).toBe('pool-terrace')
    expect(fileNameSlug('  Front desk  ')).toBe('front-desk')
  })

  it('keeps the letters and digits of any script, so a name is not lost', () => {
    expect(fileNameSlug('Бар на терасата')).toBe('бар-на-терасата')
    expect(fileNameSlug('Café Müller 2')).toBe('café-müller-2')
  })

  it('writes an accent the same way however it was typed', () => {
    expect(fileNameSlug('Café')).toBe(fileNameSlug('Café'))
  })

  it('never lets a name break out of a file name', () => {
    expect(fileNameSlug('../../etc/passwd')).toBe('etc-passwd')
  })

  it('is empty when nothing but punctuation is left', () => {
    expect(fileNameSlug('***')).toBe('')
    expect(fileNameSlug('')).toBe('')
  })

  it('stops at 60 characters without ending on a hyphen', () => {
    expect(fileNameSlug('a'.repeat(200))).toHaveLength(60)
    expect(fileNameSlug(`${'a'.repeat(59)} b`)).toBe('a'.repeat(59))
  })
})
