import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RadioGroup, RadioGroupItem } from './radio-group'

describe('RadioGroup', () => {
  it('renders a radio group whose items are radios and only the chosen one is checked', () => {
    const html = renderToStaticMarkup(
      createElement(
        RadioGroup,
        { 'aria-label': 'Start from', value: 'blank' },
        createElement(RadioGroupItem, { value: 'blank', id: 'blank' }),
        createElement(RadioGroupItem, { value: 'copy', id: 'copy' }),
      ),
    )

    expect(html).toContain('role="radiogroup"')
    expect(html.match(/role="radio"/g)).toHaveLength(2)
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1)
    expect(html).toContain('data-slot="radio-group"')
  })
})
