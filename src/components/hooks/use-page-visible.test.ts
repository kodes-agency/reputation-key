import { describe, expect, it } from 'vitest'
import { pageVisible } from './use-page-visible'

const documentWith = (
  visibilityState: DocumentVisibilityState,
  hasFocus: boolean,
): Document => ({ visibilityState, hasFocus: () => hasFocus }) as unknown as Document

describe('pageVisible', () => {
  it('keeps a visible page active while its window is not focused', () => {
    // The regression: this predicate used to AND `document.hasFocus()`, so a
    // window sitting behind another application stopped renewing the 30-second
    // provider-authorization lease. The Google import wizard then wiped the
    // account choice, the ticked locations and the half-typed country/timezone
    // form, and the property performance panel replaced its chart with
    // "Authorization changed" - all while the content was still on screen.
    expect(pageVisible(documentWith('visible', false))).toBe(true)
  })

  it('goes inactive once the page is hidden', () => {
    expect(pageVisible(documentWith('hidden', true))).toBe(false)
  })
})
