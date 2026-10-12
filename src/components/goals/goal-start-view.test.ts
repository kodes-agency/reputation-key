import { describe, expect, it } from 'vitest'
import { goalStartChoice, goalStartLabels, offeredStartMonth } from './goal-start-view'

const ZONE = 'Europe/Sofia'
const at = (iso: string) => new Date(iso)

describe('goalStartChoice', () => {
  it('offers the current local month and the next one, by month key', () => {
    const choice = goalStartChoice(at('2026-10-11T09:00:00.000Z'), ZONE)

    expect(choice.current.monthKey).toBe('2026-10')
    expect(choice.current.period.start).toEqual(at('2026-09-30T21:00:00.000Z'))
    expect(choice.next.monthKey).toBe('2026-11')
    expect(choice.next.period.start).toEqual(at('2026-10-31T22:00:00.000Z'))
  })

  it('starts this month by default up to the 20th and next month after it', () => {
    const onThe20th = goalStartChoice(at('2026-10-20T09:00:00.000Z'), ZONE)
    const onThe21st = goalStartChoice(at('2026-10-21T09:00:00.000Z'), ZONE)

    expect(onThe20th.defaultMonth).toBe('2026-10')
    expect(onThe21st.defaultMonth).toBe('2026-11')
  })
})

describe('offeredStartMonth', () => {
  const choice = goalStartChoice(at('2026-10-11T09:00:00.000Z'), ZONE)

  it('is the default until the person picks a month', () => {
    expect(offeredStartMonth(choice, null)).toBe('2026-10')
  })

  it('keeps a pick that is still offered', () => {
    expect(offeredStartMonth(choice, '2026-11')).toBe('2026-11')
  })

  it('falls back to the default once the picked month is no longer offered', () => {
    // Picked "this month" in October; the options were read again in November.
    const november = goalStartChoice(at('2026-11-01T09:00:00.000Z'), ZONE)

    expect(offeredStartMonth(november, '2026-10')).toBe('2026-11')
  })

  it('keeps a pick the new month still offers, now as this month', () => {
    // Picked "next month" (November) in October; in November it is the current one.
    const november = goalStartChoice(at('2026-11-21T09:00:00.000Z'), ZONE)

    expect(november.defaultMonth).toBe('2026-12')
    expect(offeredStartMonth(november, '2026-11')).toBe('2026-11')
  })
})

describe('goalStartLabels', () => {
  it('names the day each option counts from', () => {
    const now = at('2026-10-11T09:00:00.000Z')

    const labels = goalStartLabels(goalStartChoice(now, ZONE), ZONE, now)

    expect(labels).toEqual({
      current: 'This month — counts everything since Oct 1',
      next: 'Next month — starts Nov 1',
    })
  })

  it('prints the year of a start that falls in the next year', () => {
    const now = at('2026-12-11T09:00:00.000Z')

    const labels = goalStartLabels(goalStartChoice(now, ZONE), ZONE, now)

    expect(labels.next).toBe('Next month — starts Jan 1, 2027')
  })
})
