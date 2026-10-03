// Button (UI consistency scan: ACT-03, ACT-05, ACT-13, FORM-15, FORM-18).
//
// The primitive owns two things every caller used to re-derive:
//   - the pending state: a spinner, aria-busy, disabled, and an optional label
//     swap, so a click is acknowledged the same way everywhere;
//   - the touch density: 44px below `md`, 36px inside a `data-density="compact"`
//     workspace (the Inbox), the desktop heights unchanged.
//
// The heights are CSS, so the checks read the class list and the stylesheet's
// density tokens; the geometry itself is measured in Storybook's phone metrics.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button } from './button'

const STYLES = readFileSync(join(import.meta.dirname, '..', '..', 'styles.css'), 'utf8')

type Props = Parameters<typeof Button>[0]

function render(props: Props, label = 'Save'): string {
  return renderToStaticMarkup(createElement(Button, props, label))
}

describe('Button pending', () => {
  it('is idle by default: no spinner, not busy, enabled', () => {
    const html = render({})

    expect(html).not.toContain('<svg')
    expect(html).not.toContain('aria-busy')
    expect(html).not.toContain('disabled=')
  })

  it('is busy, disabled and shows a spinner that a screen reader skips', () => {
    const html = render({ pending: true })

    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('disabled=""')
    expect(html).toContain('<svg')
    expect(html).toContain('aria-hidden="true"')
  })

  it('stops the spinner for a person who asked for less motion', () => {
    const html = render({ pending: true })

    expect(html).toContain('animate-spin')
    expect(html).toContain('motion-reduce:animate-none')
  })

  it('keeps its label while pending, so the name a screen reader hears does not move', () => {
    const html = render({ pending: true })

    expect(html).toContain('>Save<')
  })

  it('swaps its label for pendingLabel while pending, and only then', () => {
    expect(render({ pending: true, pendingLabel: 'Saving…' })).toContain('Saving…')
    expect(render({ pending: true, pendingLabel: 'Saving…' })).not.toContain('>Save<')
    expect(render({ pendingLabel: 'Saving…' })).toContain('>Save<')
    expect(render({ pendingLabel: 'Saving…' })).not.toContain('Saving…')
  })

  it('stays disabled when the caller disabled it, pending or not', () => {
    expect(render({ disabled: true })).toContain('disabled=""')
    expect(render({ disabled: true, pending: true })).toContain('disabled=""')
  })

  it('is a spinner the size of the button text, never a second recipe', () => {
    // The Button already sizes a bare svg; the spinner must not repeat it.
    expect(render({ pending: true })).not.toMatch(/(?:h|w)-4/u)
  })
})

describe('Button density', () => {
  it.each(['default', 'sm', 'lg'] as const)(
    'gives size %s the touch height below md, from the density token',
    (size) => {
      expect(render({ size })).toContain('max-md:min-h-(--control-touch)')
    },
  )

  it.each(['icon', 'icon-sm', 'icon-lg'] as const)(
    'gives size %s a square touch target below md, from the density token',
    (size) => {
      expect(render({ size })).toContain('max-md:min-w-(--control-touch)')
    },
  )

  it.each(['xs', 'icon-xs'] as const)(
    'leaves size %s alone: a text-sized control, not a tap target',
    (size) => {
      expect(render({ size })).not.toContain('--control-touch')
    },
  )

  it('leaves the desktop heights where they were', () => {
    expect(render({ size: 'default' })).toContain(' h-9 ')
    expect(render({ size: 'sm' })).toContain(' h-8 ')
    expect(render({ size: 'icon' })).toContain(' size-9 ')
    expect(render({ size: 'icon-sm' })).toContain(' size-8 ')
  })

  it('is a minimum, so a control that is taller on purpose keeps its own height', () => {
    const html = render({ className: 'h-11' })

    expect(html).toContain('h-11')
    expect(html).not.toContain(' h-9 ')
    expect(html).toContain('max-md:min-h-(--control-touch)')
  })

  it('lets a caller drop the touch minimum without fighting the primitive', () => {
    const html = render({ className: 'max-md:min-h-11' })

    expect(html).toContain('max-md:min-h-11')
    expect(html).not.toContain('max-md:min-h-(--control-touch)')
  })

  it('lets a label wrap: a caller sets h-auto and the touch minimum still holds', () => {
    const html = render({ className: 'h-auto whitespace-normal' })

    expect(html).toContain('h-auto')
    expect(html).toContain('max-md:min-h-(--control-touch)')
  })
})

describe('Button states the primitive styles', () => {
  it('dims a button that is blocked but still focusable (aria-disabled)', () => {
    expect(render({})).toContain('aria-disabled:opacity-50')
  })
})

describe('Button inline size', () => {
  it('is a text-sized link with no padding or height of its own', () => {
    const html = render({ variant: 'link', size: 'inline' })

    expect(html).toContain('h-auto')
    expect(html).toContain('p-0')
    expect(html).not.toContain('--control-touch')
  })
})

describe('density tokens', () => {
  const root = /:root\s*\{[^}]*?--control-touch:\s*([\d.]+)rem/u.exec(STYLES)
  const compact =
    /\[data-density=['"]compact['"]\]\s*\{[^}]*?--control-touch:\s*([\d.]+)rem/u.exec(
      STYLES,
    )

  it('is 44px below md by default', () => {
    expect(Number(root?.[1])).toBe(2.75)
  })

  it('is 36px in a compact workspace', () => {
    expect(Number(compact?.[1])).toBe(2.25)
  })
})
