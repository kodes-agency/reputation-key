// Alert tones (UI consistency scan: SURF-05).
//
// A warning, a success and an information notice were all squeezed into the one
// `default` Alert (or rebuilt by hand as a tinted box), and the same warning was
// drawn with a triangle, a circle, a lock or no icon at all. The tones and their
// one icon each live here now: a caller names the tone and writes the words.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Alert, AlertDescription, AlertTitle } from './alert'
import { TONE_ICON } from './tone'

type Variant = NonNullable<Parameters<typeof Alert>[0]['variant']>

// Spelled in pieces: Tailwind scans test files, and a whole class here would
// ship its rule in the stylesheet every page loads.
const FILL_GRADE_RED_TEXT = ['text', 'destructive'].join('-')

function render(variant?: Variant): string {
  return renderToStaticMarkup(
    createElement(
      Alert,
      { variant },
      createElement(AlertTitle, null, 'Title'),
      createElement(AlertDescription, null, 'Words'),
    ),
  )
}

/** The lucide class an icon draws, e.g. `lucide-triangle-alert`. */
function iconClass(icon: (typeof TONE_ICON)[keyof typeof TONE_ICON]): string {
  const html = renderToStaticMarkup(createElement(icon))
  return /lucide-[\w-]+/u.exec(html)![0]
}

const TONES = [
  ['destructive', 'negative'],
  ['warning', 'warn'],
  ['success', 'positive'],
  ['info', 'info'],
] as const

describe('Alert', () => {
  it.each(['destructive', 'warning'] as const)(
    'announces %s at once, as an alert',
    (variant) => {
      expect(render(variant)).toContain('role="alert"')
    },
  )

  it.each(['default', 'success', 'info'] as const)(
    'reads %s in turn, as a status, so a notice already on the page does not interrupt',
    (variant) => {
      const html = render(variant)

      expect(html).toContain('role="status"')
      expect(html).not.toContain('role="alert"')
    },
  )

  it('is a status when no variant is named', () => {
    expect(render()).toContain('role="status"')
  })

  it('leaves the icon of a plain notice to the caller', () => {
    expect(render()).not.toContain('<svg')
    expect(render('default')).not.toContain('<svg')
  })

  it.each(TONES)('draws one hidden icon for %s, the tone icon', (variant, tone) => {
    const html = render(variant)

    expect(html.match(/<svg/gu)).toHaveLength(1)
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain(iconClass(TONE_ICON[tone]))
  })

  it('gives each tone its own icon', () => {
    const icons = TONES.map(([, tone]) => iconClass(TONE_ICON[tone]))

    expect(new Set(icons).size).toBe(TONES.length)
  })

  it('puts the icon before the words so the grid reserves its column', () => {
    const html = render('warning')

    expect(html.indexOf('<svg')).toBeLessThan(html.indexOf('data-slot="alert-title"'))
  })

  it('keeps destructive on the card, in the text-grade red', () => {
    const html = render('destructive')

    expect(html).toContain('bg-card')
    expect(html).toContain('text-negative')
    expect(html).not.toContain(FILL_GRADE_RED_TEXT)
  })

  it('draws warning on the warn tokens', () => {
    const html = render('warning')

    expect(html).toContain('bg-warn-muted')
    expect(html).toContain('border-warn-line')
    expect(html).toContain('text-warn')
  })

  it('draws success on the positive tokens', () => {
    const html = render('success')

    expect(html).toContain('bg-positive-muted')
    expect(html).toContain('text-positive')
  })

  it('draws info on the accent tint, in the link ink', () => {
    const html = render('info')

    expect(html).toContain('bg-accent')
    expect(html).toContain('text-link')
  })

  it('keeps the description in the quiet ink on a tinted notice', () => {
    expect(render('warning')).toContain('text-muted-foreground')
    expect(render('warning')).not.toContain('alert-description]:text-warn')
  })

  it('names the variant for a test or a style hook', () => {
    expect(render('success')).toContain('data-variant="success"')
    expect(render()).toContain('data-variant="default"')
  })

  it('lets a caller choose the other role', () => {
    const politer = renderToStaticMarkup(
      createElement(Alert, { variant: 'warning', role: 'status' }, 'Words'),
    )
    const louder = renderToStaticMarkup(
      createElement(Alert, { variant: 'info', role: 'alert' }, 'Words'),
    )

    expect(politer).toContain('role="status"')
    expect(politer).not.toContain('role="alert"')
    expect(louder).toContain('role="alert"')
  })
})
