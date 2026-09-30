import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Fact, FACT_ATTRIBUTE } from './fact'

function render(props: Parameters<typeof Fact>[0]): string {
  return renderToStaticMarkup(createElement(Fact, props))
}

describe('Fact', () => {
  it('marks itself so a neighbouring control can restore its own edge', () => {
    // Arrange / Act
    const html = render({ children: 'Open' })

    // Assert
    expect(html).toContain(`${FACT_ATTRIBUTE}=""`)
    expect(html).toContain('Open')
  })

  it('takes the box off the button-group text it is built on', () => {
    const html = render({ children: 'Open' })

    expect(html).toContain('border-0')
    expect(html).toContain('bg-transparent')
    expect(html).toContain('shadow-none')
    expect(html).toContain('text-[13px]')
  })

  it('lets the caller add classes without losing the fact look', () => {
    const html = render({ children: 'Escalated', className: 'text-negative' })

    expect(html).toContain('text-negative')
    expect(html).toContain('bg-transparent')
  })

  it('forwards attributes such as an id for aria-describedby', () => {
    const html = render({ children: 'Escalated', id: 'escalated-fact' })

    expect(html).toContain('id="escalated-fact"')
  })
})
