// The Google rating goal card as the server draws it (round 5, PLAN-D D-1): the
// ladder, the new reviews to the next number with a square for each, when the
// goal arrives, this week, the first step and the ways on. A goal to keep keeps
// its quiet card.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import type { RatingGoalCardView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { RatingGoalCard } from './rating-goal-card'
import { RATING_GOAL_HEADING_ID } from './rating-goal-card-header'
import {
  CARD_FAR_GOAL,
  CARD_GOOGLE_SOURCE,
  CARD_HARBORLINE,
  CARD_LAGS,
  CARD_LAGS_MIDDLE,
  CARD_TOO_LOW,
  CARD_WAITING,
} from './rating-goal-tracking.stories.fixtures'
import {
  CARD_JUST_SET,
  CARD_KEEP,
  FIXTURE_NOW,
  FIXTURE_PROPERTY_ID,
  FIXTURE_TIMEZONE,
} from './rating-goal.stories.fixtures'

const permissions = vi.hoisted(() => ({ granted: new Set(['portal.read']) }))

vi.mock('#/shared/hooks/usePermissions', () => ({
  usePermissions: () => ({
    can: (permission: string) => permissions.granted.has(permission),
  }),
}))

function render(card: RatingGoalCardView): string {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return renderToStaticMarkup(
    createElement(RouterContextProvider, {
      router,
      children: createElement(RatingGoalCard, {
        card,
        propertyId: FIXTURE_PROPERTY_ID,
        timezone: FIXTURE_TIMEZONE,
        now: new Date(FIXTURE_NOW),
      }),
    }),
  )
}

/** The words a reader gets, tags dropped. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/ ([.,])/gu, '$1')

const squares = (html: string) =>
  (html.match(/border-dashed border-primary"><\/span>/gu) ?? []).length

describe('RatingGoalCard', () => {
  it('leads with the title, the chip and the new reviews to the next number', () => {
    const html = render(CARD_HARBORLINE)
    const text = textOf(html)

    expect(html).toContain(`<h2 data-slot="card-title"`)
    expect(html).toContain(`id="${RATING_GOAL_HEADING_ID}"`)
    expect(text).toContain('Google rating goal')
    expect(text).toContain('On pace')
    expect(text).toContain('18 new reviews to 4.1')
    expect(text).toContain('4.1 in about 3 weeks at your 1 a day, likely 2–4 weeks.')
    expect(text).toContain('4.2 is possible in about 3 months.')
  })

  it('draws the ladder as one picture, upright and across, with its words as its name', () => {
    const html = render(CARD_HARBORLINE)
    const label =
      'Started at 3.9. Google shows 4.0 now. Your goal is 4.1. 4.2 is possible after that.'

    expect(html.match(new RegExp(`role="img" aria-label="${label}"`, 'gu'))).toHaveLength(
      2,
    )
  })

  it('draws one empty square per review still needed, up to 30', () => {
    expect(squares(render(CARD_HARBORLINE))).toBe(18)
    expect(render(CARD_HARBORLINE)).toContain(
      'aria-label="18 empty squares, one for each new review still needed"',
    )
    expect(squares(render(CARD_FAR_GOAL))).toBe(0)
  })

  it('counts about, with no squares, while the exact average is Google’s own figure', () => {
    const html = render(CARD_GOOGLE_SOURCE)

    expect(textOf(html)).toContain('about 18 new reviews to 4.1')
    expect(squares(html)).toBe(0)
  })

  it('gives the goal’s own total when the headline counts to a nearer number', () => {
    const text = textOf(render(CARD_FAR_GOAL))

    expect(text).toContain('31 new reviews to 4.4')
    expect(text).toContain('212 new reviews to your goal, 4.5.')
  })

  it('counts past a tenth Google should show soon, never zero to it', () => {
    const text = textOf(render(CARD_LAGS_MIDDLE))

    expect(text).toContain('180 new reviews to 4.5')
    expect(text).toContain('Google should show 4.4 soon')
    expect(text).not.toContain('0 new reviews to 4.4')
  })

  it('says Google should show the goal soon, with no squares or time, once it is earned', () => {
    const html = render(CARD_LAGS)

    expect(textOf(html)).toContain('Google should show 4.1 soon')
    expect(squares(html)).toBe(0)
    expect(textOf(html)).not.toContain('likely')
  })

  it('counts this week against the plan, on its day, and tells the first step', () => {
    const html = render(CARD_HARBORLINE)
    const text = textOf(html)

    expect(html.match(/role="progressbar"/gu)).toHaveLength(1)
    expect(html).toContain('aria-valuetext="2 of 7 new reviews this week"')
    expect(text).toContain('This week 2 of 7')
    expect(text).toContain('It’s Tuesday')
    expect(text).toContain('Google shows 4.0 now, up from 3.9 when you started.')
  })

  it('asks for a pace a day while the goal is new', () => {
    const text = textOf(render(CARD_JUST_SET))

    expect(text).toContain('Getting started')
    expect(text).toContain('Aim for about 1.6 new reviews a day')
    expect(text).not.toContain('This week')
  })

  it('says why, with what helps, while new reviews are too low', () => {
    const html = render(CARD_TOO_LOW)
    const text = textOf(html)

    expect(text).toContain(
      'Since you set the goal, new reviews average below what 4.1 needs.',
    )
    expect(text).toContain('Asking every guest')
    expect(squares(html)).toBe(0)
    expect(text).not.toContain('likely')
  })

  it('keeps Google’s last number with its date while it waits for Google', () => {
    const html = render(CARD_WAITING)
    const text = textOf(html)

    expect(text).toContain('Waiting for Google')
    expect(text).toContain('as of Oct 12')
    expect(text).toContain('Waiting for Google’s latest numbers.')
    expect(squares(html)).toBe(0)
    expect(text).not.toMatch(/GMT|likely/u)
  })

  it('leads on to the detail and, with Portals in reach, to the Portals', () => {
    const html = render(CARD_HARBORLINE)

    expect(html).toContain(
      `href="/properties/${FIXTURE_PROPERTY_ID}/goals/google-rating"`,
    )
    expect(html).toContain(`href="/properties/${FIXTURE_PROPERTY_ID}/portals"`)
    expect(textOf(html)).toContain('View details')

    permissions.granted.delete('portal.read')
    expect(render(CARD_HARBORLINE)).not.toContain('Open Portals')
    permissions.granted.add('portal.read')
  })

  it('keeps a number with its status and no climb', () => {
    const html = render(CARD_KEEP)
    const text = textOf(html)

    expect(text).toContain('Keeping 4.9 on Google')
    expect(text).toContain('Holding')
    expect(text).toContain('Google shows 4.9')
    expect(text).not.toContain('your goal')
    expect(html).not.toContain('progressbar')
    expect(text).not.toMatch(/new reviews|likely|This week/u)
  })
})
