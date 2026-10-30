import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import type { IssueDrawer } from '#/contexts/ai/application/public-api'
import { GuestVoiceProvider } from './guest-voice-context'
import { PROPERTY_ID } from './guest-voice-fixtures-build'
import {
  FACILITIES_DRAWER,
  HIDDEN_DRAWER,
  SMALL_DRAWER,
  URGENT_DRAWER,
} from './guest-voice-fixtures-drawers'
import { GuestVoiceIssueDetails } from './guest-voice-issue-drawer'
import { GuestVoiceMonthBars } from './guest-voice-month-bars'

/** The real router Link needs a router to build its href; none of its routes load. */
function render(element: ReactElement, { notRight = true } = {}): string {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return renderToStaticMarkup(
    createElement(RouterContextProvider, {
      router,
      children: createElement(GuestVoiceProvider, {
        value: {
          propertyId: PROPERTY_ID,
          window: '90d',
          startLocalDate: '2026-07-31',
          endLocalDate: '2026-10-29',
          onOpenIssue: () => undefined,
          onNotRight: notRight ? () => undefined : undefined,
        },
        children: element,
      }),
    }),
  )
}

const details = (drawer: IssueDrawer, options?: { notRight?: boolean }) =>
  render(createElement(GuestVoiceIssueDetails, { drawer }), options)

describe('the drawer of an issue', () => {
  const markup = details(FACILITIES_DRAWER)

  it('leads with the figures, then the year, the causes and the guests’ words', () => {
    const order = [
      '19 of 128',
      'Reviews that name it, by month',
      'Air conditioning',
      'In guests’ own words',
      'See all 19 reviews',
    ].map((text) => markup.indexOf(text))

    expect(order.every((index) => index >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('names the causes with how many reviews name each, read as words as well', () => {
    expect(markup).toMatch(
      /Air conditioning<span[^>]*>7<span class="sr-only"> reviews<\/span>/u,
    )
    expect(markup).toContain('aria-label="Causes"')
    expect(markup.match(/<li><span[^>]*data-slot="badge"/gu)).toHaveLength(4)
  })

  it('underlines each cited sentence and opens each review in the Inbox', () => {
    expect(markup.match(/<mark /gu)).toHaveLength(3)
    const links = [...markup.matchAll(/href="(\/inbox\?[^"]*itemId=[^"]*)"/gu)].map(
      (match) => match[1],
    )

    expect(links).toHaveLength(3)
    for (const link of links) expect(link).toContain(`propertyId=${PROPERTY_ID}`)
  })

  it('says how many of the reviews it quotes, and why the rest are in the Inbox', () => {
    expect(markup).toContain('Showing 3 of 19 reviews.')
    expect(markup).toContain('a review that names a person is not quoted here')
  })

  it('has no such line where it quotes every review', () => {
    const every = details({
      ...URGENT_DRAWER,
      statistics: { ...URGENT_DRAWER.statistics, reviewCount: 1 },
    })

    expect(every).not.toContain('Showing')
    expect(every).toContain('See the review')
  })

  it('says so when none of its reviews can be quoted', () => {
    const none = details({ ...FACILITIES_DRAWER, liveEvidence: [] })

    expect(none).toContain('None of these reviews can be quoted here.')
    expect(none).not.toContain('Showing')
    expect(none).not.toContain('<figure data-slot="guest-voice-quote"')
  })

  it('says a hidden issue is off the page and where its reviews are', () => {
    const hidden = details(HIDDEN_DRAWER)

    expect(hidden).toContain('Hidden from the page')
    expect(hidden).toContain('Its reviews are still in the inbox.')
    expect(markup).not.toContain('Hidden from the page')
  })

  it('offers "Not right?" only where something will answer it', () => {
    expect(markup).toContain('Not right?')
    expect(details(FACILITIES_DRAWER, { notRight: false })).not.toContain('Not right?')
  })

  it('quotes a small property’s three reviews of five', () => {
    const small = details(SMALL_DRAWER)

    expect(small).toContain('Showing 3 of 5 reviews.')
    expect(small).toContain('See all 5 reviews')
  })
})

/** The height of each bar the markup draws, in px (a month with no review has none). */
const barHeights = (markup: string) =>
  [
    ...markup.matchAll(/class="w-full rounded-t-sm[^"]*" style="height:(\d+)(?:px)?"/gu),
  ].map((match) => Number(match[1]))

describe('the year in bars', () => {
  const bars = render(
    createElement(GuestVoiceMonthBars, { series: FACILITIES_DRAWER.twelveMonthSeries }),
  )

  it('draws a bar for each of the 12 months, the busiest the tallest', () => {
    const heights = barHeights(bars)

    expect(heights).toHaveLength(12)
    expect(Math.max(...heights)).toBe(64)
    // October has 8 reviews and is the peak; December has 1 and is an eighth of it.
    expect(heights.at(-1)).toBe(64)
    expect(heights[1]).toBe(8)
  })

  it('prints the count over each bar and the month under it', () => {
    expect(bars).toContain('>Nov<')
    expect(bars).toContain('>Oct<')
    expect(bars).toMatch(/tabular-nums">8<\/span>/u)
  })

  it('reads the same year out as a list for anyone who cannot see the bars', () => {
    expect(bars).toContain('October 2026: 8 of 44 reviews with text')
    expect(bars).toContain('November 2025: 2 of 38 reviews with text')
    // The drawn part is hidden from assistive technology, so nothing is said twice.
    expect(bars).toMatch(/aria-hidden="true"[^>]*><div class="flex items-end/u)
  })

  it('draws no bar and no count for a month with no review, but keeps its label', () => {
    const quiet = render(
      createElement(GuestVoiceMonthBars, { series: URGENT_DRAWER.twelveMonthSeries }),
    )
    const heights = barHeights(quiet)

    expect(heights.filter((height) => height > 0)).toEqual([64])
    expect(quiet.match(/>Jan</gu)).toHaveLength(1)
  })

  it('has nothing to scale a series of nothing by, and draws flat', () => {
    const flat = render(
      createElement(GuestVoiceMonthBars, {
        series: FACILITIES_DRAWER.twelveMonthSeries.map((month) => ({
          ...month,
          complaintReviews: 0,
        })),
      }),
    )

    expect(barHeights(flat)).toEqual(Array<number>(12).fill(0))
  })
})
