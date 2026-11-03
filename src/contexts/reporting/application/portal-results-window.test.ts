import { expect, it } from 'vitest'
import { portalResultsWindow, portalResultsPrior } from './portal-results-window'
const now = new Date('2026-11-03T10:00:00Z')
it('uses calendar months and the Property time zone', () => {
  expect(portalResultsWindow('month', now, 'Europe/Sofia')).toEqual({
    startDate: new Date('2026-10-31T22:00:00Z'),
    endDate: now,
  })
  expect(portalResultsWindow('last-month', now, 'Europe/Sofia')).toEqual({
    startDate: new Date('2026-09-30T21:00:00Z'),
    endDate: new Date('2026-10-31T22:00:00Z'),
  })
  expect(portalResultsWindow('week', now, 'Europe/Sofia').startDate).toEqual(
    new Date('2026-11-01T22:00:00Z'),
  )
  expect(portalResultsWindow('today', now, 'Europe/Sofia').startDate).toEqual(
    new Date('2026-11-02T22:00:00Z'),
  )
})
it('keeps rolling ranges and their comparison intact', () => {
  const dates = portalResultsWindow('7d', now, 'UTC')
  expect(dates.startDate).toEqual(new Date('2026-10-28T00:00:00Z'))
  expect(
    portalResultsPrior('7d', dates.startDate, dates.endDate, 'UTC')?.priorEndDate,
  ).toEqual(new Date('2026-10-27T10:00:00Z'))
})
