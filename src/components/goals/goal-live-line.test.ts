// The live line of a Goals row, drawn: the words always, a bar only for a count
// with one subject, and no verdict colour anywhere (it counts and does not judge).
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { GoalListProgress } from '#/contexts/reporting/application/public-api'
import { GoalLiveLine } from './goal-live-line'

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

  it('draws no verdict colour: it counts and does not judge', () => {
    for (const live of [goal(), goal({ subjectCount: 3, month: null, belowPace: 2 })]) {
      expect(render(live)).not.toMatch(
        /text-(?:positive|negative|warn)|bg-(?:positive|negative|warn)/u,
      )
    }
  })

  it('draws nothing for a goal with one subject and no month to show', () => {
    expect(render(goal({ month: null }))).toBe('')
  })
})
