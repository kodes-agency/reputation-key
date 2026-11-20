// The sheet's heading as the server draws it. The frame itself opens in a portal,
// which the server does not draw: its dialog, its phone sheet, its marker, its
// focus on opening and its render-prop children are read in the browser by the
// Google wizard's stories and the Monthly portal goal's sheet stories. The heading
// is the part with branches a goal that passes less takes (no ref, a phone).
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Dialog } from '#/components/ui/dialog'
import { GoalSheetHeader } from './goal-sheet-frame'

const header = (phone: boolean) =>
  renderToStaticMarkup(
    createElement(
      Dialog,
      { open: true },
      createElement(GoalSheetHeader, {
        title: 'A goal',
        description: 'What the screen is for.',
        phone,
      }),
    ),
  )

describe('GoalSheetHeader', () => {
  it('draws the title, then the line under it', () => {
    const html = header(false)

    expect(html.indexOf('>A goal<')).toBeGreaterThan(-1)
    expect(html.indexOf('>A goal<')).toBeLessThan(html.indexOf('What the screen is for.'))
  })

  it('lets the title take the focus by script, with no outline of its own', () => {
    const html = header(false)

    expect(html).toContain('tabindex="-1"')
    expect(html).toContain('outline-none')
  })

  it('keeps the title clear of the corner close on a phone, and only there', () => {
    expect(header(true)).toContain('pe-12')
    expect(header(false)).not.toContain('pe-12')
  })
})
