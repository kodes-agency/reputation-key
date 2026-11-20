// The goal card frame as the server draws it. The Google rating goal passes the
// frame everything it takes, so the branches below are the ones a goal that
// passes less (no title, no pill) will take; and a branch no test names would
// change under it unseen.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GoalCardActions, GoalCardColumns, GoalCardFrame } from './goal-card-frame'
import { GOAL_PACE_STATUS } from './goal-pace-status'

/** The two columns of the card's body, from a card 48rem wide: the story, then 15rem for the side. */
const TWO_COLUMNS = '@3xl:grid-cols-[minmax(0,1fr)_15rem]'

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

const columns = () =>
  renderToStaticMarkup(
    createElement(GoalCardColumns, {
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
  it('lays the story and the side in two columns from a card 48rem wide', () => {
    expect(columns()).toContain(TWO_COLUMNS)
  })

  it('stacks the side under the story below that width, with no column of its own', () => {
    const html = columns()

    expect(html).not.toMatch(/(?<!@3xl:)grid-cols-/u)
    expect(html).not.toContain('@2xl:')
  })

  it('lays the story before the side', () => {
    const html = columns()

    expect(html.indexOf('the story')).toBeLessThan(html.indexOf('the side'))
  })

  it('draws a rule between the two from 48rem, and none above the side when it is stacked', () => {
    const html = columns()

    expect(html).toContain('@3xl:border-l')
    expect(html).toContain('@3xl:pl-6')
    expect(html).not.toMatch(/class="[^"]*(?<!@3xl:)border-l/u)
  })

  it('lets either column shrink, so a long line cannot widen the card', () => {
    expect(columns().match(/min-w-0/gu)).toHaveLength(2)
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
