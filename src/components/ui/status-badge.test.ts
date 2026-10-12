// StatusBadge (UI consistency scan: COLL-05).
//
// A domain status reached the screen as a raw token (`active`, `AccountAdmin`,
// `reauth_required`) in a badge whose colour was picked by the author. The
// badge now takes a labelled map, so the words are written once and the tone
// follows the status; a status the map does not know prints a neutral
// "Unknown", never the token.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StatusBadge, type StatusMap } from './status-badge'
import { TONE_ICON } from './tone'

type Goal = 'active' | 'paused' | 'ended' | 'failed'

const GOAL: StatusMap<Goal> = {
  active: { label: 'Active', tone: 'positive' },
  paused: { label: 'Paused', tone: 'warn' },
  ended: { label: 'Ended', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'negative' },
}

function render(status: string): string {
  return renderToStaticMarkup(createElement(StatusBadge, { status, map: GOAL }))
}

const iconClass = (html: string): string | undefined => /lucide-[\w-]+/u.exec(html)?.[0]

describe('StatusBadge', () => {
  it('prints the label, not the status token', () => {
    const html = render('active')

    expect(html).toContain('>Active<')
    expect(html).not.toContain('>active<')
  })

  it.each([
    ['active', 'positive'],
    ['paused', 'warn'],
    ['ended', 'neutral'],
    ['failed', 'negative'],
  ] as const)('draws %s in the %s tone', (status, tone) => {
    expect(render(status)).toContain(`data-variant="${tone}"`)
  })

  it('draws exactly one icon, hidden from the tree, the same for every status of a tone', () => {
    const html = render('active')

    expect(html.match(/<svg/gu)).toHaveLength(1)
    expect(html).toContain('aria-hidden="true"')
    expect(iconClass(render('active'))).toBe(
      iconClass(
        renderToStaticMarkup(
          createElement(StatusBadge, {
            tone: 'positive',
            label: 'Connected',
          }),
        ),
      ),
    )
  })

  it('gives each tone its own icon', () => {
    const icons = (['positive', 'warn', 'negative', 'neutral'] as const).map((tone) =>
      iconClass(renderToStaticMarkup(createElement(StatusBadge, { tone, label: 'x' }))),
    )

    expect(new Set(icons).size).toBe(4)
    expect(icons[0]).toBe(
      iconClass(renderToStaticMarkup(createElement(TONE_ICON.positive))),
    )
  })

  it('takes a tone and a label for a state that has no status enum', () => {
    const html = renderToStaticMarkup(
      createElement(StatusBadge, { tone: 'warn', label: 'Re-consent needed' }),
    )

    expect(html).toContain('>Re-consent needed<')
    expect(html).toContain('data-variant="warn"')
  })

  it('never prints a status the map does not know', () => {
    const html = render('reauth_required')

    expect(html).toContain('>Unknown<')
    expect(html).toContain('data-variant="neutral"')
    expect(html).not.toContain('reauth_required')
  })

  it('does not read a status off the prototype of the map', () => {
    const html = render('constructor')

    expect(html).toContain('>Unknown<')
    expect(html).not.toContain('constructor')
  })

  it('stays a one-line chip', () => {
    expect(render('active')).toContain('whitespace-nowrap')
  })
})
