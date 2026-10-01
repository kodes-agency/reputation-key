import { describe, expect, it } from 'vitest'
import { hasPropertyWording } from './property-wording'

describe('hasPropertyWording', () => {
  it.each([
    ['no row', undefined, false],
    [
      'a row holding only a photograph description',
      { title: '', shortDescription: '' },
      false,
    ],
    ['a row of spaces', { title: '  ', shortDescription: ' ' }, false],
    ['a title alone', { title: 'Avela', shortDescription: '' }, true],
    ['a description alone', { title: '', shortDescription: 'By the sea' }, true],
  ])('for %s', (_label, row, expected) => {
    expect(hasPropertyWording(row)).toBe(expected)
  })
})
