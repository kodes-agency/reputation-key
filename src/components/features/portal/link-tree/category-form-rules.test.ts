// Category form error precedence — the rule the two inline forms share.
//
// The subtle part is the difference between "no error" and "an error carrying no
// words". Both forms decide whether to render the error line from this return
// value, so `null` MUST be the only no-render signal: if an `Error` with an
// empty message were folded in with the no-error case, a real failure would go
// completely silent, and if it fell back to the generic string the UI would
// invent a reason the server never gave. These pin both edges.

import { describe, it, expect } from 'vitest'
import { categoryFormErrorMessage } from './category-form-rules'

const FALLBACK = 'Failed to create category'

describe('categoryFormErrorMessage', () => {
  it('renders nothing when there is no error', () => {
    expect(categoryFormErrorMessage(undefined, FALLBACK)).toBeNull()
    expect(categoryFormErrorMessage(null, FALLBACK)).toBeNull()
  })

  it("lets a thrown Error's own message win over the fallback", () => {
    const error = new Error('A category with that title already exists')
    expect(categoryFormErrorMessage(error, FALLBACK)).toBe(
      'A category with that title already exists',
    )
  })

  it('keeps a message-less Error distinguishable from no error at all', () => {
    // Not null (the line still renders) and not the fallback (nothing invented).
    expect(categoryFormErrorMessage(new Error(''), FALLBACK)).toBe('')
  })

  it('falls back for shapes that carry no message of their own', () => {
    expect(categoryFormErrorMessage('a bare string', FALLBACK)).toBe(FALLBACK)
    expect(categoryFormErrorMessage({ code: 500 }, FALLBACK)).toBe(FALLBACK)
    expect(categoryFormErrorMessage(0, FALLBACK)).toBe(FALLBACK)
    expect(categoryFormErrorMessage(false, FALLBACK)).toBe(FALLBACK)
  })

  it('uses the caller-supplied fallback, so add and edit stay distinct', () => {
    expect(categoryFormErrorMessage({}, 'Failed to update category')).toBe(
      'Failed to update category',
    )
  })
})
