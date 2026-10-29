import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import type { AiPropertyInsightsPresetReady } from '#/contexts/ai/application/public-api'
import { PropertyInsightsTopicTable } from './property-insights-aspect-table'
import { LARGE_PROPERTY, SMALL_PROPERTY } from './property-guest-voice-stories-data'
import { TOPIC_MIN_REVIEWS, topicRows } from './property-insights-topic-rows'

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111'

/** Links need a router to build their hrefs; none of its routes load. */
function renderWithRouter(node: ReturnType<typeof createElement>) {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return renderToStaticMarkup(
    createElement(RouterContextProvider, { router, children: node }),
  )
}

describe('PropertyInsightsTopicTable', () => {
  const render = (evidence: AiPropertyInsightsPresetReady) =>
    renderWithRouter(
      createElement(PropertyInsightsTopicTable, { propertyId: PROPERTY_ID, evidence }),
    )

  it('has the columns a manager can check against the reviews, and no Impact', () => {
    const markup = render(LARGE_PROPERTY)

    for (const head of [
      'Topic',
      'Reviews',
      'Praise and complaints',
      'Stars when mentioned',
    ]) {
      expect(markup).toContain(head)
    }
    expect(markup).not.toContain('Impact')
    expect(markup).not.toMatch(/[+−]\d+ mentions?/)
  })

  it('counts reviews of the reviews read for topics, with the stars of those that complain', () => {
    const markup = render(LARGE_PROPERTY)

    expect(markup).toContain('26 of 120')
    expect(markup).toContain('2.0★, the rest 4.2★')
    expect(markup).toContain('Complaints likely rising')
  })

  it('opens the reviews it counted: the topic, the polarity and the days of the window', () => {
    const markup = render(LARGE_PROPERTY)
    const link =
      /<a [^>]*aria-label="19 complaints for Service; open in inbox"[^>]*>/.exec(
        markup,
      )?.[0]

    expect(link).toBeDefined()
    expect(link).toContain('aspect=service')
    expect(link).toContain('polarity=negative')
    expect(link).toContain('since=2026-06-13')
    expect(link).toContain('until=2026-09-10')
    expect(link).toContain(`propertyId=${PROPERTY_ID}`)
  })

  it('does not link a count of none', () => {
    const markup = render(SMALL_PROPERTY)

    // Staff has praise and no complaints: the 0 is text, not a link to an empty list.
    expect(markup).toContain('0 complaints')
    expect(markup).not.toContain('aria-label="0 complaints')
  })

  it('names each link with the words it shows, so a voice command for them finds it', () => {
    // WCAG 2.5.3: the accessible name contains the visible text.
    const linksOf = (evidence: AiPropertyInsightsPresetReady) =>
      [
        ...render(evidence).matchAll(/<a [^>]*aria-label="([^"]*)"[^>]*>([^<]*)<\/a>/g),
      ].map(([, name, text]) => ({ name, text }))
    const large = linksOf(LARGE_PROPERTY)
    const small = linksOf(SMALL_PROPERTY)

    expect(large.length).toBeGreaterThan(10)
    for (const { name, text } of [...large, ...small]) {
      expect(name).toContain(text)
    }
    expect(large.map(({ name }) => name)).toContain(
      '19 complaints for Service; open in inbox',
    )
    expect(small.map(({ name }) => name)).toContain(
      '1 complaint for Parking; open in inbox',
    )
  })

  it('shows counts only where there are too few reviews to weigh', () => {
    const markup = render(SMALL_PROPERTY)

    expect(markup).toContain('too few')
    expect(markup).toContain('No complaints')
  })

  describe('the praise and complaints bar', () => {
    const BAR = 'data-slot="topic-bar"'
    /** The markup of one topic's row of the table. */
    function rowOf(markup: string, label: string): string {
      const row = markup.split('<tr').find((part) => part.includes(`>${label}</td>`))
      if (row === undefined) throw new Error(`No row for ${label}`)
      return row
    }

    it('is not drawn for a topic under three reviews: a proportion of one or two reviews', () => {
      const markup = render(SMALL_PROPERTY)

      // Parking: 1 review. Service: 2 reviews. Each shows its counts and nothing drawn.
      for (const [label, counts] of [
        ['Parking', '1 complaint'],
        ['Service', '2 complaints'],
      ] as const) {
        const row = rowOf(markup, label)
        expect(row).toContain(counts)
        expect(row).not.toContain(BAR)
      }
    })

    it('is drawn for a topic with three reviews or more', () => {
      const markup = render(SMALL_PROPERTY)

      // Room: 4 reviews; Staff: 14.
      expect(rowOf(markup, 'Room')).toContain(BAR)
      expect(rowOf(markup, 'Staff')).toContain(BAR)
    })

    it('starts where the stars column does: at three reviews', () => {
      expect(TOPIC_MIN_REVIEWS).toBe(3)
    })

    it('is drawn for every topic of a property whose topics all have reviews to weigh', () => {
      const markup = render(LARGE_PROPERTY)

      expect(markup.split(BAR).length - 1).toBe(topicRows(LARGE_PROPERTY).length)
    })
  })

  it('leaves out the Change column when no period was compared', () => {
    const markup = render({ ...LARGE_PROPERTY, provisional: true } as never)

    expect(markup).not.toContain('Complaints likely rising')
    expect(markup).not.toMatch(/<th[^>]*>[^<]*Change/)
  })

  it('draws the Change column when a topic moved', () => {
    expect(render(LARGE_PROPERTY)).toMatch(/<th[^>]*>.*Change/)
  })

  it('leaves out the Change column when a period was compared and no topic moved', () => {
    // A column that says nothing in every row is noise.
    const markup = render(SMALL_PROPERTY)

    expect(markup).not.toMatch(/<th[^>]*>.*Change/)
    expect(markup).not.toContain('likely rising')
    expect(markup).not.toContain('likely falling')
  })

  it('does not print the Change label over a row with nothing to say', () => {
    // Stacked on a phone each cell carries its column's name; an empty cell has none.
    const markup = render(LARGE_PROPERTY)

    // 13 topics; two moved. The label is printed twice in the table (once each) plus
    // once in the header row.
    const labels = markup.match(/@3xl:hidden[^>]*>(?:<button[^>]*>)?Change/g) ?? []
    expect(labels).toHaveLength(2)
  })
})
