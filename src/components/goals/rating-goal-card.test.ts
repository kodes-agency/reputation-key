// The Google rating goal card as the server draws it (2026-11-01, ADR 0067): the new
// reviews to the next number, when the goal arrives, the ruler of how far along it
// is, this week against the plan and the way to the detail, and nothing else. A goal to
// keep has its quiet card.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import type { RatingGoalCardView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { RatingGoalCard } from './rating-goal-card'
import { RATING_GOAL_HEADING_ID } from './rating-goal-card-header'
import {
  CARD_FAR_GOAL,
  CARD_GOOGLE_SOURCE,
  CARD_HARBORLINE,
  CARD_HARBORLINE_JUST_SET,
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

/** The names of the pictures on the card (the ruler is its one). */
const picturesOf = (html: string) =>
  [...html.matchAll(/role="img" aria-label="([^"]*)"/gu)].map((match) => match[1])

describe('RatingGoalCard', () => {
  it('leads with the title, the chip, the new reviews to the next number and when the goal arrives', () => {
    const html = render(CARD_HARBORLINE)
    const text = textOf(html)

    expect(html).toContain(`<h2 data-slot="card-title"`)
    expect(html).toContain(`id="${RATING_GOAL_HEADING_ID}"`)
    expect(text).toContain('Google rating goal')
    expect(text).toContain('On pace')
    expect(text).toContain('18 new reviews to 4.1')
    expect(text).toContain('4.1 in about 3 weeks at your 1 a day, likely 2–4 weeks.')
  })

  it('says nothing of the number after the goal, nor of the first step: the ruler shows the way', () => {
    const text = textOf(render(CARD_HARBORLINE))

    expect(text).not.toContain('is possible')
    expect(text).not.toContain('up from 3.9 when you started')
  })

  it('draws where the goal stands as one ruler, named by its sentence', () => {
    const html = render(CARD_HARBORLINE)

    expect(picturesOf(html)).toEqual([
      'Started at 3.9. Google shows 4.0 now. Your goal is 4.1.',
    ])
    expect(html).toContain('data-slot="goal-ruler"')
  })

  it('writes the ruler’s ends and its tenth in Google’s numbers, never the exact average', () => {
    const text = textOf(render(CARD_HARBORLINE))

    expect(text).toContain('Today')
    expect(text).toContain('3.9 started')
    expect(text).toContain('4.0 reached')
    expect(text).toContain('4.1 your goal')
    expect(text).not.toContain('4.02')
  })

  it('draws one card for every width: the wide card puts the week beside the story, no part is for it alone', () => {
    const html = render(CARD_HARBORLINE)

    expect(html).toContain('@3xl:grid-cols-[minmax(0,1fr)_15rem]')
    expect(html).not.toContain('@3xl:hidden')
    expect(html).not.toMatch(/hidden @3xl:(block|flex)/u)
    expect(html).toMatch(/data-slot="rating-goal-this-week" class="flex flex-col/u)
  })

  it('counts to the next number and to the goal in a new goal’s first headline', () => {
    const text = textOf(render(CARD_HARBORLINE_JUST_SET))

    expect(text).toContain('19 new reviews to 4.0 81 new reviews to your goal, 4.1.')
  })

  it('counts about while the exact average is Google’s own figure, and still draws the ruler', () => {
    const html = render(CARD_GOOGLE_SOURCE)

    expect(textOf(html)).toContain('About 18 new reviews to 4.1')
    expect(picturesOf(html)).toHaveLength(1)
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

  it('says Google should show the goal soon, with no time, once it is earned', () => {
    const html = render(CARD_LAGS)

    expect(textOf(html)).toContain('Google should show 4.1 soon')
    expect(textOf(html)).not.toContain('likely')
    expect(picturesOf(html)).toHaveLength(1)
  })

  it('counts this week against the plan, on its day, at every width', () => {
    const html = render(CARD_HARBORLINE)
    const text = textOf(html)

    expect(html.match(/role="progressbar"/gu)).toHaveLength(1)
    expect(html).toContain('aria-valuetext="2 of 7 new reviews this week"')
    expect(text).toContain('This week 2 of 7')
    expect(text).toContain('It’s Tuesday')
  })

  it('asks for a pace a day while the goal is new, and draws a ruler that has not begun', () => {
    const html = render(CARD_JUST_SET)
    const text = textOf(html)

    expect(text).toContain('Getting started')
    expect(text).toContain('Aim for about 1.6 new reviews a day')
    expect(text).not.toContain('This week')
    expect(picturesOf(html)).toEqual(['Google shows 4.3 now. Your goal is 4.5.'])
  })

  it('says why, with what helps, while new reviews are too low, above a ruler still drawn', () => {
    const html = render(CARD_TOO_LOW)
    const text = textOf(html)

    expect(text).toContain(
      'Since you set the goal, new reviews average below what 4.1 needs.',
    )
    expect(text).toContain('Asking every guest')
    expect(text).not.toContain('likely')
    expect(picturesOf(html)).toHaveLength(1)
  })

  it('keeps Google’s last number with its date while it waits for Google, and the ruler says “last”', () => {
    const html = render(CARD_WAITING)
    const text = textOf(html)

    expect(text).toContain('Waiting for Google')
    expect(text).toContain('as of Oct 12')
    expect(text).toContain('Waiting for Google’s latest numbers.')
    expect(picturesOf(html)).toEqual([
      'Started at 3.9. Google showed 4.0 last. Your goal is 4.1.',
    ])
    expect(text).not.toMatch(/GMT|likely/u)
  })

  it('leads on to the detail, and to nowhere else', () => {
    const html = render(CARD_HARBORLINE)

    expect(html).toContain(
      `href="/properties/${FIXTURE_PROPERTY_ID}/goals/google-rating"`,
    )
    expect(textOf(html)).toContain('View details')
    expect(html.match(/href="/gu)).toHaveLength(1)
    expect(textOf(html)).not.toContain('Open Portals')
  })

  it('keeps a number with its status and no climb', () => {
    const html = render(CARD_KEEP)
    const text = textOf(html)

    expect(text).toContain('Keeping 4.9 on Google')
    expect(text).toContain('Holding')
    expect(text).toContain('Google shows 4.9')
    expect(text).not.toContain('your goal')
    expect(html).not.toContain('progressbar')
    expect(html).not.toContain('goal-ruler')
    expect(text).not.toMatch(/new reviews|likely|This week/u)
  })
})
