import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RemovableChip } from './removable-chip'

const render = (props: Partial<Parameters<typeof RemovableChip>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(RemovableChip, {
      label: 'Reviews',
      removeLabel: 'Remove filter: Reviews',
      onRemove: () => undefined,
      ...props,
    }),
  )

describe('RemovableChip', () => {
  it('is one button: the whole chip is the thing you press to remove it', () => {
    const html = render()

    expect(html.match(/<button/g)).toHaveLength(1)
    expect(html).toContain('type="button"')
    expect(html).toContain('data-slot="removable-chip"')
  })

  it('is named for what pressing it does, not by its visible label alone', () => {
    expect(render()).toContain('aria-label="Remove filter: Reviews"')
  })

  it('shows the label and the X glyph, which is decoration', () => {
    const html = render()

    expect(html).toContain('Reviews')
    expect(html).toContain('lucide-x')
    expect(html).toContain('aria-hidden="true"')
  })

  it('is a pill with a border, a ring for the keyboard and a 32px height', () => {
    const html = render()

    expect(html).toContain('rounded-full')
    expect(html).toContain('border')
    expect(html).toContain('focus-ring')
    expect(html).toContain('h-8')
  })

  it('is a tap target below md: the touch height is its minimum, 36px in a compact workspace', () => {
    expect(render()).toContain('max-md:min-h-(--control-touch)')
  })

  it('passes a data attribute through, so a list can find its chips to move focus', () => {
    expect(render({ 'data-active-filter-chip': '' } as never)).toContain(
      'data-active-filter-chip=""',
    )
  })
})
