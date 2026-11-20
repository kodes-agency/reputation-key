// The live line of a Goals row, drawn: the words always, a bar only for a count
// with one subject, and the one place a verdict shows is the shared pace pill of
// a count the rule judged ("On pace" or "Below pace"); the words and the bar
// stay neutral.
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
    expect(html).toContain('64 of 120 so far · 15 days left')
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-valuenow="64"')
    expect(html).toContain('aria-valuemin="0"')
    expect(html).toContain('aria-valuemax="120"')
    expect(html).toContain('aria-valuetext="64 of 120 so far"')
    expect(html).toContain('aria-label="Scans so far this month"')
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

    expect(html).toContain('4.6 so far · target 4.5 · 15 days left')
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

  it('draws no verdict colour in the words or the bar of any row', () => {
    for (const live of [
      goal({ belowPace: 0 }),
      goal({ belowPace: 1 }),
      goal({ belowPace: null }),
    ]) {
      const html = render(live)
      const sentence = /<p[^>]*>.*?<\/p>/u.exec(html)?.[0] ?? ''
      const bar = /<div[^>]*role="progressbar"[^>]*>/u.exec(html)?.[0] ?? ''

      expect(sentence).not.toMatch(/text-(?:positive|negative|warn)/u)
      expect(bar).toContain('data-tone="neutral"')
    }
  })

  it('draws no verdict at all for several subjects, an average or a month not judged', () => {
    for (const live of [
      goal({ subjectCount: 3, month: null, belowPace: 2 }),
      goal({ subjectCount: 3, month: null, belowPace: 0 }),
      goal({
        belowPace: null,
        metric: 'portal_rating_average',
        month: {
          reading: { kind: 'live', value: 4.62, sampleCount: 31 },
          targetValue: 4.5,
        },
      }),
      goal({ belowPace: null }),
    ]) {
      expect(render(live)).not.toMatch(
        /data-slot="badge"|text-(?:positive|negative|warn)/u,
      )
    }
  })

  it('draws nothing for a goal with one subject and no month to show', () => {
    expect(render(goal({ month: null }))).toBe('')
  })
})

describe('GoalLiveLine pace pill', () => {
  const judged = (belowPace: number | null, patch: Partial<GoalListProgress> = {}) =>
    render(goal({ belowPace, ...patch }))
  const textOf = (html: string) => html.replace(/<[^>]*>/gu, '')
  const sentenceOf = (html: string) => textOf(/<p[^>]*>.*?<\/p>/u.exec(html)?.[0] ?? '')
  const pillOf = (html: string) =>
    /<span data-slot="badge"[^>]*>.*?<\/span>/u.exec(html)?.[0]
  const at = (html: string, needle: string) => html.indexOf(needle)

  it('keeps the figure sentence as it was and says "Below pace" in a pill of its own', () => {
    const html = judged(1)

    expect(sentenceOf(html)).toBe('64 of 120 so far · 15 days left')
    expect(textOf(pillOf(html) ?? '')).toBe('Below pace')
    expect(pillOf(html)).toContain('data-variant="warn"')
  })

  it('says "On pace" in the same pill for a count that keeps up', () => {
    const html = judged(0)

    expect(sentenceOf(html)).toBe('64 of 120 so far · 15 days left')
    expect(textOf(pillOf(html) ?? '')).toBe('On pace')
    expect(pillOf(html)).toContain('data-variant="positive"')
  })

  it('draws exactly one pill, in the slot a test can find, with its icon hidden from a reader', () => {
    for (const html of [judged(1), judged(0)]) {
      expect(html.match(/data-slot="badge"/gu)).toHaveLength(1)
      expect(html).toMatch(
        /<span data-slot="goal-live-pace"[^>]*><span data-slot="badge"/u,
      )
      expect(pillOf(html)).toContain('<svg')
      expect(pillOf(html)).toContain('aria-hidden="true"')
    }
  })

  it('puts no separator in the words, so a wrapped pill can never leave one dangling', () => {
    expect(textOf(judged(1))).toBe('64 of 120 so far · 15 days leftBelow pace')
    expect(textOf(judged(0))).toBe('64 of 120 so far · 15 days leftOn pace')
  })

  it('reads the sentence, then the pill, then the bar', () => {
    const html = judged(1)

    expect(at(html, '<p')).toBeLessThan(at(html, 'data-slot="goal-live-pace"'))
    expect(at(html, 'data-slot="goal-live-pace"')).toBeLessThan(
      at(html, 'role="progressbar"'),
    )
  })

  it('draws the verdict in the pill only, not in the figure and not in the bar', () => {
    const html = judged(1)
    const withoutPill = html.replace(
      /<span data-slot="goal-live-pace".*?<\/span><\/span>/u,
      '',
    )

    expect(withoutPill).toContain('data-tone="neutral"')
    expect(withoutPill).not.toMatch(
      /text-(?:positive|negative|warn)|bg-(?:positive|negative|warn)/u,
    )
  })

  it('keeps the bar as it was: the same figure, range and words', () => {
    for (const html of [judged(1), judged(0), judged(null)]) {
      expect(html).toContain('aria-valuenow="64"')
      expect(html).toContain('aria-valuemax="120"')
      expect(html).toContain('aria-valuetext="64 of 120 so far"')
    }
  })

  it('is its own container, so the pill finds its place by the cell and not the window', () => {
    for (const html of [judged(1), judged(0), judged(null)]) {
      expect(html).toMatch(/data-slot="goal-live-line"[^>]*class="[^"]*@container/u)
    }
  })

  it('gives the pill the row it sits in: beside the bar when narrow, on the sentence line from 24 rem', () => {
    const place = /<span data-slot="goal-live-pace" class="([^"]*)"/u.exec(judged(1))?.[1]

    expect(place?.split(' ')).toEqual(
      expect.arrayContaining(['col-start-2', 'row-start-2', '@sm:row-start-1']),
    )
  })

  it('draws no pill for a month the rule did not judge: the first days, or too few expected', () => {
    const html = judged(null)

    expect(html).not.toContain('goal-live-pace')
    expect(html).not.toContain('data-slot="badge"')
    expect(textOf(html)).toBe('64 of 120 so far · 15 days left')
  })

  it('lets the bar take the whole row when there is no pill to share it with', () => {
    const barClass = (html: string) =>
      /<div[^>]*class="([^"]*)"[^>]*role="progressbar"/u.exec(html)?.[1] ??
      /role="progressbar"[^>]*class="([^"]*)"/u.exec(html)?.[1]

    expect(barClass(judged(null))?.split(' ')).toContain('col-span-2')
    expect(barClass(judged(1))?.split(' ')).not.toContain('col-span-2')
  })

  it('says it on the last day, and with a thousands figure', () => {
    expect(textOf(pillOf(judged(1, { daysLeft: 0 })) ?? '')).toBe('Below pace')
    expect(sentenceOf(judged(1, { daysLeft: 0 }))).toBe('64 of 120 so far · last day')
    expect(
      sentenceOf(
        judged(1, {
          metric: 'portal_rating_count',
          month: {
            reading: { kind: 'live', value: 1234, sampleCount: 1234 },
            targetValue: 2500,
          },
        }),
      ),
    ).toBe('1,234 of 2,500 so far · 15 days left')
  })

  it('says nothing for an average, or for a figure that cannot be read, even when belowPace is 1', () => {
    const average = goal({
      belowPace: 1,
      metric: 'portal_rating_average',
      month: { reading: { kind: 'live', value: 3.2, sampleCount: 31 }, targetValue: 4.5 },
    })
    const unreadable = goal({
      belowPace: 1,
      month: { reading: { kind: 'unavailable' }, targetValue: 120 },
    })

    for (const live of [average, unreadable]) {
      expect(render(live)).not.toContain('data-slot="badge"')
      expect(render(live)).not.toMatch(/(?:Below|On) pace/u)
    }
  })

  it('says nothing beside the words of a goal with several subjects', () => {
    const html = render(goal({ subjectCount: 3, month: null, belowPace: 0 }))

    expect(textOf(html)).toBe('3 subjects · none below pace')
    expect(html).not.toContain('data-slot="badge"')
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

  it('sits where the live line sits, with the same margin, gap and container', () => {
    const slot = (html: string) => /class="([^"]*)"/u.exec(html)?.[1]

    expect(slot(pending('line_and_bar'))).toBe(slot(render(goal())))
    expect(slot(pending('line_and_bar'))).toBe(slot(render(goal({ belowPace: 1 }))))
    expect(slot(pending('line_and_bar'))).toBe(slot(render(goal({ belowPace: 0 }))))
    expect(slot(pending('line'))).toBe(
      slot(render(goal({ subjectCount: 3, month: null, belowPace: 2 }))),
    )
  })

  it('lays its blocks on the grid the line fills, so a pill or none takes the same rows', () => {
    // The body is the second `class` in either: the slot's own comes first.
    const body = (html: string) => [...html.matchAll(/class="([^"]*)"/gu)][1]?.[1]

    for (const belowPace of [null, 0, 1]) {
      expect(body(pending('line_and_bar'))).toBe(body(render(goal({ belowPace }))))
    }
    expect(body(pending('line'))).toBe(
      body(render(goal({ subjectCount: 3, month: null, belowPace: 2 }))),
    )
  })
})
