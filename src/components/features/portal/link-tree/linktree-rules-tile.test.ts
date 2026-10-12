// The tile's two small rules: which languages its phone chip names, and which
// arrow key its move buttons answer to.

import { describe, expect, it } from 'vitest'
import { describeMissingLanguages, moveDirectionForKey } from './linktree-rules'

describe('moveDirectionForKey', () => {
  it('moves a tile up and down with the arrow keys, from either move button', () => {
    expect(moveDirectionForKey('ArrowUp')).toBe('up')
    expect(moveDirectionForKey('ArrowDown')).toBe('down')
  })

  it('leaves every other key alone, so Tab, Enter and Space still work on the buttons', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'Tab', 'Enter', ' ', 'a']) {
      expect(moveDirectionForKey(key)).toBeNull()
    }
  })
})

describe('describeMissingLanguages', () => {
  const chips = (missing: readonly boolean[]) =>
    ['en', 'es', 'bg', 'de'].slice(0, missing.length).map((locale, index) => ({
      locale: locale as 'en',
      chip: locale.toUpperCase(),
      name: locale,
      isMissing: missing[index] === true,
    }))

  it('says nothing when every language is written', () => {
    expect(describeMissingLanguages(chips([false, false]))).toBeNull()
  })

  it('names the one language that is missing, as the board does: "DE missing"', () => {
    expect(describeMissingLanguages(chips([false, false, false, true]))).toBe(
      'DE missing',
    )
  })

  it('lists two missing languages by their chips', () => {
    expect(describeMissingLanguages(chips([false, true, false, true]))).toBe(
      'ES, DE missing',
    )
  })

  it('counts them when three or more are missing, so the chip stays one short word', () => {
    expect(describeMissingLanguages(chips([false, true, true, true]))).toBe('3 missing')
  })

  it('says nothing for a tile in a portal with one language', () => {
    expect(describeMissingLanguages(chips([false]))).toBeNull()
  })
})
