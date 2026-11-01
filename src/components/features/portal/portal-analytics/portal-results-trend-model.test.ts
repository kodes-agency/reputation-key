import { expect, it } from 'vitest'
import { trendModel } from './portal-results-trend-model'
import { RESULTS_HEALTHY, RESULTS_WEEKS } from './portal-results-stories-data'
const series = { bucketDays: 7 as const, buckets: RESULTS_WEEKS }
it('uses one scale and keeps dates and page updates outside the values', () => {
  const model = trendModel(series, RESULTS_HEALTHY.versionMarkers)!
  expect(model.columns[0]).toMatchObject({
    height: 100,
    countLabel: '108',
    dateLabel: '1 Sep',
  })
  expect(model.updates).toBe('Page updated 22 Sep')
  expect(model.partialCaption).toBe('The dashed bar covers 2 days.')
  expect(model.columns[3]?.valueLine).toBe('22–28 Sep · 91 scans · page updated')
})
it.each([0, null])('does not draw when scans are %s', (scans) =>
  expect(
    trendModel(
      { ...series, buckets: RESULTS_WEEKS.map((bucket) => ({ ...bucket, scans })) },
      [],
    ),
  ).toBeNull(),
)
it('labels only the first tallest bar over seven columns', () => {
  const model = trendModel(
    {
      bucketDays: 7,
      buckets: Array.from({ length: 13 }, (_, index) => ({
        ...RESULTS_WEEKS[0]!,
        index,
        scans: index === 1 || index === 2 ? 1234 : 1,
      })),
    },
    [],
  )!
  expect(
    model.columns
      .filter((column) => column.countLabel !== null)
      .map((column) => column.index),
  ).toEqual([1])
})
it('daily buckets have a weekday and day number and a singular scan', () => {
  const model = trendModel(
    {
      bucketDays: 1,
      buckets: [
        {
          ...RESULTS_WEEKS[0]!,
          startLocalDate: '2026-10-27',
          endLocalDate: '2026-10-27',
          days: 1,
          scans: 1,
        },
      ],
    },
    [],
  )!
  expect(model.columns[0]).toMatchObject({
    dateLabel: 'Tue',
    dayLabel: '27',
    valueLine: 'Tue 27 Oct · 1 scan',
    partial: false,
  })
})
it('summarises unique update days and keeps three dates at most', () => {
  const markers = [1, 2, 3, 4, 5, 5].map((day) => ({
    ...RESULTS_HEALTHY.versionMarkers[0]!,
    localDate: `2026-09-0${day}`,
  }))
  expect(trendModel(series, markers)?.updates).toBe(
    'Page updated 1 Sep, 2 Sep, 3 Sep and 2 more',
  )
})
