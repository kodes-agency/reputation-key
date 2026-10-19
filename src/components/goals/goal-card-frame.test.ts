// The goal card frame as the server draws it. The Google rating goal passes the
// frame everything it takes, so the branches below are the ones a goal that
// passes less (no title, no pill, no signature column) will take; the other
// goal's card moves onto them in the next slices, and a branch no test names
// would change under it unseen.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GoalCardActions, GoalCardColumns, GoalCardFrame } from './goal-card-frame'
import { GOAL_PACE_STATUS } from './goal-pace-status'

/** The grid column a card with a signature visual gives it, from a card 48rem wide. */
const SIGNATURE_COLUMN = '@3xl:grid-cols-[14rem_minmax(0,1fr)]'

const frame = (props: Partial<Parameters<typeof GoalCardFrame>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(GoalCardFrame, {
      slot: 'a-goal-card',
      title: 'A goal',
      children: createElement('p', null, 'the body'),
      ...props,
    }),
  )

/** The card's own opening tag: the header inside it names a container of its own. */
const cardTag = (html: string) => html.slice(0, html.indexOf('>') + 1)

const columns = (wide: boolean) =>
  renderToStaticMarkup(
    createElement(GoalCardColumns, {
      wide,
      signature: createElement('i', null, 'the signature'),
      story: createElement('b', null, 'the story'),
      side: createElement('u', null, 'the side'),
    }),
  )

describe('GoalCardFrame', () => {
  it('draws the title as an h2 that can take the focus, with the slot it was given', () => {
    const html = frame({ titleId: 'a-goal-title' })

    expect(html).toContain('data-slot="a-goal-card"')
    expect(html).toMatch(/<h2 data-slot="card-title"[^>]* id="a-goal-title"/u)
    expect(html).toContain('tabindex="-1"')
    expect(html).toContain('>A goal</h2>')
  })

  it('draws the title one level down when the page says so', () => {
    expect(frame({ titleAs: 'h3' })).toContain('<h3 data-slot="card-title"')
  })

  it('draws no header when the goal has no title, where the page names the card', () => {
    const html = frame({ title: null })

    expect(html).not.toContain('data-slot="card-header"')
    expect(html).not.toContain('data-slot="card-title"')
    expect(html).toContain('the body')
  })

  it('draws the one pill in the corner only when the goal has a pace to say', () => {
    const withPill = frame({ status: GOAL_PACE_STATUS.on_pace })
    const without = frame({ status: null })

    expect(withPill).toContain('data-slot="badge"')
    expect(withPill).toContain('On pace')
    expect(without).not.toContain('data-slot="badge"')
    expect(frame()).not.toContain('data-slot="badge"')
  })

  it('makes the card its own container only when asked, and states its state only when given', () => {
    expect(cardTag(frame({ container: true }))).toMatch(/\s@container\s/u)
    expect(cardTag(frame({ container: false }))).not.toContain('@container')
    expect(cardTag(frame())).not.toContain('@container')
    expect(frame({ dataState: 'running' })).toContain('data-state="running"')
    expect(frame()).not.toContain('data-state')
  })
})

describe('GoalCardColumns', () => {
  it('gives the signature visual a column of its own on a wide card', () => {
    expect(columns(true)).toContain(SIGNATURE_COLUMN)
  })

  it('keeps the plain two-column card for a goal with no signature visual', () => {
    // The Google goal with no rungs (waiting for Google, too few new reviews).
    expect(columns(false)).not.toContain(SIGNATURE_COLUMN)
    expect(columns(false)).toContain('@2xl:grid-cols-2')
  })

  it('lays the signature before the story and the story before the side', () => {
    const html = columns(true)

    expect(html.indexOf('the signature')).toBeLessThan(html.indexOf('the story'))
    expect(html.indexOf('the story')).toBeLessThan(html.indexOf('the side'))
  })
})

describe('GoalCardActions', () => {
  it('lays the actions in a wrapping row', () => {
    const html = renderToStaticMarkup(
      createElement(GoalCardActions, null, createElement('button', null, 'View details')),
    )

    expect(html).toBe(
      '<div class="flex flex-wrap gap-2"><button>View details</button></div>',
    )
  })
})
