// Field help text and the optional marker (UI consistency scan: FORM-05).
//
// Help under a control was a `<p>` in four sizes and two inks, wired to the control by
// hand in some places and not at all in others, and "optional" was spelled three ways
// (a suffix in the label text, a muted span, and nothing on genuinely optional
// fields). `FieldDescription` is the one line of help; `optional` on a `FieldLabel` is
// the one marker, inside the label so the control's name carries it.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FieldDescription, FieldLabel } from './field'

describe('FieldDescription', () => {
  it('is a muted line of the form text size, named for what it is', () => {
    const html = renderToStaticMarkup(
      createElement(FieldDescription, { id: 'name-description' }, 'Shown to guests.'),
    )

    expect(html).toContain('data-slot="field-description"')
    expect(html).toContain('id="name-description"')
    expect(html).toContain('text-sm')
    expect(html).toContain('text-muted-foreground')
    expect(html).toContain('>Shown to guests.</p>')
  })

  it('is not the invalid ink a Field turns its text into', () => {
    const html = renderToStaticMarkup(createElement(FieldDescription, null, 'Help'))

    // A Field in an invalid state sets its own ink on everything inside it; the
    // help keeps its muted one so a hint never reads as an error.
    expect(html).toContain('text-muted-foreground')
  })
})

describe('FieldLabel optional', () => {
  it('adds a muted "Optional" inside the label, where the control takes its name from', () => {
    const html = renderToStaticMarkup(
      createElement(FieldLabel, { htmlFor: 'note', optional: true }, 'Note'),
    )

    expect(html).toMatch(/<label[^>]*>Note <span[^>]*data-slot="field-optional"/u)
    expect(html).toContain('>Optional</span></label>')
    expect(html).toContain('text-muted-foreground')
    expect(html).toContain('font-normal')
  })

  it('marks nothing unless it is told the field is optional', () => {
    const html = renderToStaticMarkup(createElement(FieldLabel, { htmlFor: 'n' }, 'Name'))

    expect(html).not.toContain('Optional')
    expect(html).not.toContain('field-optional')
  })
})
