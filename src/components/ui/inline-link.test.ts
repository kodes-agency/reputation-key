// InlineLink (UI consistency scan: ACT-13, FORM-18).
//
// A link set in a sentence ("Forgot password?", "set in Profile", the Beta
// Agreement) was typed by hand in every route as `font-medium text-link
// underline-offset-4 hover:underline`, in three spellings. It is one component
// now; a Button link is for an action that reads as a link, not for a sentence.
import { describe, expect, it } from 'vitest'
import { inlineLinkClass } from './inline-link'

describe('inlineLinkClass', () => {
  it('is the accent ink, medium weight, underlined on hover by default', () => {
    const classes = inlineLinkClass().split(' ')

    expect(classes).toEqual(
      expect.arrayContaining(['font-medium', 'text-link', 'underline-offset-4']),
    )
    expect(classes).toContain('hover:underline')
    expect(classes).not.toContain('underline')
  })

  it('can stay underlined, for a link that must read as one without a pointer', () => {
    const classes = inlineLinkClass({ underline: 'always' }).split(' ')

    expect(classes).toContain('underline')
    expect(classes).not.toContain('hover:underline')
  })

  it('takes the caller size and spacing, and lets it win a conflict', () => {
    const classes = inlineLinkClass({ className: 'text-sm font-semibold' }).split(' ')

    expect(classes).toContain('text-sm')
    expect(classes).toContain('font-semibold')
    expect(classes).not.toContain('font-medium')
  })
})
