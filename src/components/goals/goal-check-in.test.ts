// The check-in strip as the server draws it. The Google rating goal passes the
// strip a headline, a line, its choices and a refusal; the branches below are the
// ones a goal that passes less (no headline, a pending choice, no refusal to
// draw) takes, and a branch no test names would change under it unseen.
import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GoalCheckIn, GoalWithCheckIn } from './goal-check-in'

const noop = () => undefined

const strip = (props: Partial<Parameters<typeof GoalCheckIn>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(GoalCheckIn, {
      slot: 'a-goal-check-in',
      label: 'For next time',
      headline: 'How it went',
      sub: 'What is offered',
      choices: [
        { key: 'take', label: 'Take it', primary: true, onPress: noop },
        { key: 'leave', label: 'Leave it', onPress: noop },
      ],
      busy: false,
      note: 'Nothing changes unless you choose.',
      ...props,
    }),
  )

/** The attributes a button is drawn with, not the classes that style them. */
const DISABLED = /\sdisabled=""/u
const BUSY = /\saria-busy="true"/u

/** The button with this label, as drawn: its opening tag and what is inside it. */
const buttonOf = (html: string, label: string) => {
  const found = html.match(
    new RegExp(
      `<button[^>]*>(?:(?!</button>).)*${label}(?:(?!</button>).)*</button>`,
      'u',
    ),
  )
  return found?.[0] ?? ''
}

describe('GoalCheckIn', () => {
  it('is a region named by its title, with the slot it was given', () => {
    const html = strip()
    const titleId = html.match(/data-slot="alert-title"[^>]* id="([^"]+)"/u)?.[1]

    expect(html).toContain('data-slot="a-goal-check-in"')
    expect(html).toContain('role="region"')
    expect(titleId).toBeDefined()
    expect(html).toContain(`aria-labelledby="${titleId}"`)
    expect(html).toContain('>For next time</div>')
  })

  it('says the headline, the line, the choices and the note, in that order', () => {
    const html = strip()
    const order = [
      'How it went',
      'What is offered',
      'Take it',
      'Leave it',
      'Nothing changes unless you choose.',
    ].map((text) => html.indexOf(text))

    expect(order.every((at) => at >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('draws no headline line for a goal with nothing to say of the last stretch', () => {
    const html = strip({ headline: null })

    expect(html).not.toContain('text-base font-semibold')
    expect(html).toContain('What is offered')
    expect(strip()).toContain('text-base font-semibold')
  })

  it('takes a line that holds more than text, such as a way to see how it was worked out', () => {
    const html = strip({
      sub: createElement('span', null, 'Offered, ', createElement('a', null, 'see how')),
    })

    expect(html).toContain('<p><span>Offered, <a>see how</a></span></p>')
  })

  it('fills the one to take and outlines the others, each a tap target', () => {
    const html = strip()

    expect(buttonOf(html, 'Take it')).toContain('data-variant="default"')
    expect(buttonOf(html, 'Leave it')).toContain('data-variant="outline"')
    expect(buttonOf(html, 'Take it')).toContain('max-md:min-h-(--control-touch)')
    expect(buttonOf(html, 'Leave it')).toContain('max-md:min-h-(--control-touch)')
  })

  it('lays the choices in a wrapping row', () => {
    expect(strip()).toContain('<div class="flex flex-wrap gap-2"><button')
  })

  it('disables every choice while one is on its way, and none otherwise', () => {
    const idle = strip()
    const busy = strip({ busy: true })

    expect(buttonOf(idle, 'Take it')).not.toMatch(DISABLED)
    expect(buttonOf(idle, 'Leave it')).not.toMatch(DISABLED)
    expect(buttonOf(busy, 'Take it')).toMatch(DISABLED)
    expect(buttonOf(busy, 'Leave it')).toMatch(DISABLED)
  })

  it('shows the choice that is on its way as saving, busy and unavailable', () => {
    const html = strip({
      busy: true,
      choices: [
        { key: 'take', label: 'Take it', primary: true, pending: true, onPress: noop },
        { key: 'leave', label: 'Leave it', onPress: noop },
      ],
    })

    expect(html).toContain('Saving…')
    expect(html).not.toContain('Take it')
    expect(html).toMatch(BUSY)
    expect(html.match(/\saria-busy="true"/gu)).toHaveLength(1)
    expect(buttonOf(html, 'Leave it')).not.toMatch(BUSY)
    expect(buttonOf(html, 'Leave it')).toMatch(DISABLED)
  })

  it('draws a refusal in the strip only when the goal passes one', () => {
    expect(strip({ error: 'It could not be saved.' })).toContain('It could not be saved.')
    expect(strip({ error: null })).not.toContain('Unable to complete this action')
    expect(strip()).not.toContain('Unable to complete this action')
  })
})

describe('GoalWithCheckIn', () => {
  const card = createElement('section', null, 'the card')
  const withStrip = (checkIn: Parameters<typeof GoalWithCheckIn>[0]['checkIn']) =>
    renderToStaticMarkup(createElement(GoalWithCheckIn, { checkIn, children: card }))

  it('puts the strip above the card, apart from it', () => {
    const html = withStrip(createElement('aside', null, 'the strip'))

    expect(html).toBe(
      '<div class="flex flex-col gap-3"><aside>the strip</aside><section>the card</section></div>',
    )
  })

  it('draws the card alone, in no wrapper, when no strip is due', () => {
    expect(withStrip(null)).toBe('<section>the card</section>')
  })

  // The keep-mounted contract: a goal whose strip comes and goes while its card
  // is read again passes an empty fragment, not null, so the wrapper stays and
  // the card is not re-created when the strip is answered (a title that held the
  // focus would otherwise be dropped with the old tree).
  it('keeps the wrapper, and the card in it, when the strip is an empty fragment', () => {
    expect(withStrip(createElement(Fragment))).toBe(
      '<div class="flex flex-col gap-3"><section>the card</section></div>',
    )
  })
})
