import { describe, expect, it } from 'vitest'
import {
  reconcileDraft,
  shownText,
  typeIntoDraft,
  type SearchDraft,
} from './search-field-draft'

/** Types each key into the draft while the committed value stays where it was. */
function typeKeys(committed: string, keys: readonly string[]): SearchDraft | null {
  return keys.reduce<SearchDraft | null>(
    (draft, text) => typeIntoDraft(draft, committed, text),
    null,
  )
}

const BOUNDED = ['B', 'Bo', 'Bou', 'Boun', 'Bound', 'Bounde', 'Bounded']

describe('search field draft', () => {
  it('shows the committed value when nothing was typed', () => {
    expect(shownText(null, 'cafe')).toBe('cafe')
  })

  it('keeps all seven characters of seven fast keys while the page commits late', () => {
    // Arrange: the page has committed nothing yet.
    const draft = typeKeys('', BOUNDED)

    // Act
    const settled = reconcileDraft(draft, '')

    // Assert
    expect(shownText(settled, '')).toBe('Bounded')
  })

  it('does not let a stale echo of an earlier key overwrite the newer text', () => {
    const draft = typeKeys('', BOUNDED)

    const afterFirstEcho = reconcileDraft(draft, 'B')
    const afterThirdEcho = reconcileDraft(afterFirstEcho, 'Bou')

    expect(shownText(afterFirstEcho, 'B')).toBe('Bounded')
    expect(shownText(afterThirdEcho, 'Bou')).toBe('Bounded')
  })

  it('is done once the page has caught up with the text', () => {
    const draft = typeKeys('', BOUNDED)
    const nearly = reconcileDraft(draft, 'Bounde')

    expect(reconcileDraft(nearly, 'Bounded')).toBeNull()
  })

  it('takes a change the person did not type, such as Clear all or Back', () => {
    const draft = typeKeys('', BOUNDED)
    const echoed = reconcileDraft(draft, 'Bo')

    expect(reconcileDraft(echoed, 'Grand')).toBeNull()
    expect(reconcileDraft(echoed, '')).toBeNull()
  })

  it('returns the same draft when the committed value did not move', () => {
    const draft = typeKeys('cafe', ['cafes'])

    expect(reconcileDraft(draft, 'cafe')).toBe(draft)
  })

  it('starts the next word on the text on screen, not on an older search', () => {
    // The person typed "Bou", the page committed "B", and the next key is "Boun".
    const draft = reconcileDraft(typeKeys('', ['B', 'Bo', 'Bou']), 'B')
    const next = typeIntoDraft(draft, 'B', 'Boun')

    expect(next.text).toBe('Boun')
    expect(next.typed).toEqual(['Bo', 'Bou', 'Boun'])
  })

  it('treats the clear button as one more keystroke that the page must echo', () => {
    const draft = typeIntoDraft(typeKeys('', ['a', 'ab']), '', '')

    expect(shownText(reconcileDraft(draft, 'a'), 'a')).toBe('')
    expect(reconcileDraft(draft, '')).toBe(draft)
  })

  it('a deleted-to-empty search is the empty draft, not the committed value', () => {
    const draft = typeKeys('rila', [''])

    expect(shownText(draft, 'rila')).toBe('')
  })
})
