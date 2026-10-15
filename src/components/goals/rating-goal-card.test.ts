// The simple card of the Google rating goal as the server draws it: two numbers,
// one status, one bar, one pace line, one forecast and the way to the detail,
// and nothing else. A goal to keep has no bar, pace or forecast.
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
import {
  CARD,
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

/** The text a reader gets, tags dropped. */
const textOf = (html: string) => html.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ')

describe('RatingGoalCard', () => {
  it('leads with what Google shows and the goal, then one bar, one pace line and one forecast', () => {
    const html = render(CARD)
    const text = textOf(html)

    expect(html).toContain('<h2 data-slot="card-title"')
    expect(text).toContain('Google rating goal')
    expect(text).toContain('On pace')
    expect(text).toContain('Google shows 4.3 → your goal 4.5')
    expect(html.match(/role="progressbar"/gu)).toHaveLength(1)
    expect(html).toContain('aria-valuetext="Exact average 4.38 of 4.45"')
    expect(text).toContain('This week: 6 of 11 reviews')
    expect(text).toContain('Expected around Jul–Sep 2027')
    expect(html).toContain(
      `href="/properties/${FIXTURE_PROPERTY_ID}/goals/google-rating"`,
    )
    expect(text).toContain('View details')
  })

  it('says the average is about that, not exact, while it is Google’s own rounded figure', () => {
    const html = render({ ...CARD, exactAverage: 4.3, exactAverageSource: 'google' })

    expect(html).toContain('aria-valuetext="About 4.30 of 4.45"')
    expect(html).not.toContain('Exact average')
  })

  it('asks for a pace while the goal is new', () => {
    const text = textOf(render(CARD_JUST_SET))

    expect(text).toContain('Getting started')
    expect(text).toContain('Aim for about 11 new reviews a week')
    expect(text).not.toContain('This week:')
  })

  it('keeps a number with its status and no pace, bar or forecast', () => {
    const html = render(CARD_KEEP)
    const text = textOf(html)

    expect(text).toContain('Keeping 4.9 on Google')
    expect(text).toContain('Holding')
    expect(text).not.toContain('your goal')
    expect(html).not.toContain('progressbar')
    expect(text).not.toMatch(/a week|Expected around/u)
  })

  it('keeps Google’s last number with its date while it waits for Google', () => {
    const text = textOf(
      render({
        ...CARD,
        status: 'waiting_for_google',
        google: { ...CARD.google!, current: false, asOf: '2026-10-12T08:00:00.000Z' },
      }),
    )

    expect(text).toContain('Waiting for Google')
    // The date sits under the two numbers, so they never break apart around it.
    expect(text).toContain('Google shows 4.3 → your goal 4.5 as of Oct 12')
    expect(text).toContain('Waiting for Google’s latest numbers.')
    expect(text).not.toMatch(/GMT|Expected around/u)
  })

  it('keeps each number with its words, and the arrow with the first', () => {
    const html = render(CARD)

    expect(html).toMatch(
      /<span class="[^"]*whitespace-nowrap[^"]*"><span[^>]*>Google shows<\/span><span[^>]*>4\.3<\/span><span aria-hidden="true"[^>]*>→<\/span><\/span>/u,
    )
    expect(html).toContain('id="google-rating-goal-title"')
    expect(html).toContain('data-slot="button"')
  })

  it('prints a dash only when Google never sent a number', () => {
    const text = textOf(render({ ...CARD, status: 'waiting_for_google', google: null }))

    expect(text).toContain('Google shows – → your goal 4.5')
    expect(text).toContain('Waiting for Google’s numbers.')
  })
})
