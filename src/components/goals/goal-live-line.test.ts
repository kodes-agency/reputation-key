// The live line of a Goals row, drawn: the words always, a bar only for a count
// with one subject, and no verdict colour anywhere except the one quiet amber
// "below pace" of a count that is (it counts, and nudges only when behind).
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { GoalListProgress } from '#/contexts/reporting/application/public-api'
import { GoalLiveLine, GoalLiveLinePending } from './goal-live-line'

const goal = (patch: Partial<GoalListProgress> = {}): GoalListProgress => ({
  programId: 'program-1',
  metric: 'qualified_scans',
  subjectCount: 1,
  daysLeft: 14,
  month: { reading: { kind: 'live', value: 64, sampleCount: 64 }, targetValue: 120 },
  belowPace: null,
  ...patch,
})

const render = (live: GoalListProgress) =>
  renderToStaticMarkup(createElement(GoalLiveLine, { goal: live }))

describe('GoalLiveLine', () => {
  it('draws a count with one subject as words and an accessible neutral bar', () => {
    const html = render(goal())

    expect(html).toContain('data-slot="goal-live-line"')
    expect(html).toContain('64 of 120 so far · 14 days left')
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-valuenow="64"')
    expect(html).toContain('aria-valuemin="0"')
    expect(html).toContain('aria-valuemax="120"')
    expect(html).toContain('aria-valuetext="64 of 120 so far"')
    expect(html).toContain('aria-label="Qualified scans so far this month"')
    expect(html).toContain('data-tone="neutral"')
  })

  it('draws an average with one subject as words alone', () => {
    const html = render(
      goal({
        metric: 'portal_rating_average',
        month: {
          reading: { kind: 'live', value: 4.62, sampleCount: 31 },
          targetValue: 4.5,
        },
      }),
    )

    expect(html).toContain('4.6 so far · target 4.5 · 14 days left')
    expect(html).not.toContain('progressbar')
  })

  it('draws an average below its minimum sample as a request for more ratings', () => {
    const html = render(
      goal({
        metric: 'portal_rating_average',
        month: {
          reading: { kind: 'too_few', sampleCount: 4, minimumSample: 10 },
          targetValue: 4.5,
        },
      }),
    )

    expect(html).toContain('More ratings needed')
    expect(html).not.toContain('progressbar')
  })

  it('draws several subjects as words alone', () => {
    const html = render(goal({ subjectCount: 3, month: null, belowPace: 2 }))

    expect(html).toContain('3 subjects · 2 below pace')
    expect(html).not.toContain('progressbar')
  })

  it('says a figure that cannot be read, with no bar and no zero', () => {
    const html = render(
      goal({ month: { reading: { kind: 'unavailable' }, targetValue: 120 } }),
    )

    expect(html).toContain('can’t be read right now')
    expect(html).not.toContain('progressbar')
    expect(html).not.toContain('0 of 120')
  })

  it('draws no verdict colour for a count that keeps up, or was not judged', () => {
    for (const live of [
      goal({ belowPace: 0 }),
      goal({ belowPace: null }),
      goal({ subjectCount: 3, month: null, belowPace: 2 }),
    ]) {
      expect(render(live)).not.toMatch(
        /text-(?:positive|negative|warn)|bg-(?:positive|negative|warn)/u,
      )
    }
  })

  it('draws nothing for a goal with one subject and no month to show', () => {
    expect(render(goal({ month: null }))).toBe('')
  })
})

describe('GoalLiveLine below pace', () => {
  const belowPace = () => render(goal({ belowPace: 1 }))
  const textOf = (html: string) => html.replace(/<[^>]*>/gu, '')

  it('says "below pace" after the days left, in one sentence with the figure', () => {
    expect(textOf(belowPace())).toBe('64 of 120 so far · 14 days left · below pace')
  })

  it('draws only those words in quiet amber, not the figure and not the bar', () => {
    const html = belowPace()

    expect(html).toMatch(
      /<span data-slot="goal-live-pace" class="text-warn whitespace-nowrap">below pace<\/span>/u,
    )
    expect(html.match(/text-warn/gu)).toHaveLength(1)
    expect(html).toContain('data-tone="neutral"')
    expect(html).not.toMatch(/bg-warn|bg-positive|bg-negative|text-negative/u)
  })

  it('keeps the bar as it was: the same figure, range and words', () => {
    const html = belowPace()

    expect(html).toContain('aria-valuenow="64"')
    expect(html).toContain('aria-valuemax="120"')
    expect(html).toContain('aria-valuetext="64 of 120 so far"')
  })

  it('says it on the last day, and with a thousands figure', () => {
    expect(textOf(render(goal({ belowPace: 1, daysLeft: 0 })))).toBe(
      '64 of 120 so far · last day · below pace',
    )
    expect(
      textOf(
        render(
          goal({
            belowPace: 1,
            metric: 'portal_rating_count',
            month: {
              reading: { kind: 'live', value: 1234, sampleCount: 1234 },
              targetValue: 2500,
            },
          }),
        ),
      ),
    ).toBe('1,234 of 2,500 so far · 14 days left · below pace')
  })

  it('says it for no average and for no figure that cannot be read', () => {
    const average = goal({
      belowPace: 1,
      metric: 'portal_rating_average',
      month: { reading: { kind: 'live', value: 3.2, sampleCount: 31 }, targetValue: 4.5 },
    })
    const unreadable = goal({
      belowPace: 1,
      month: { reading: { kind: 'unavailable' }, targetValue: 120 },
    })

    expect(render(average)).not.toContain('below pace')
    expect(render(unreadable)).not.toContain('below pace')
  })
})

describe('GoalLiveLinePending', () => {
  const pending = (shape: 'line' | 'line_and_bar') =>
    renderToStaticMarkup(createElement(GoalLiveLinePending, { shape }))
  const blocks = (html: string) => html.match(/data-slot="skeleton"/gu)?.length ?? 0

  it('keeps room for a line and a bar while a count is read', () => {
    const html = pending('line_and_bar')

    expect(html).toContain('data-slot="goal-live-line-pending"')
    expect(blocks(html)).toBe(2)
  })

  it('keeps room for a line alone while an average, or a goal of several subjects, is read', () => {
    expect(blocks(pending('line'))).toBe(1)
  })

  it('is hidden from assistive technology and is no progress bar', () => {
    const html = pending('line_and_bar')

    expect(html).toContain('aria-hidden="true"')
    expect(html).not.toContain('progressbar')
    expect(html).not.toMatch(/so far|days left/u)
  })

  it('sits where the live line sits, with the same margin and gap', () => {
    const slot = (html: string) => /class="([^"]*)"/u.exec(html)?.[1]

    expect(slot(pending('line_and_bar'))).toBe(slot(render(goal())))
  })
})
