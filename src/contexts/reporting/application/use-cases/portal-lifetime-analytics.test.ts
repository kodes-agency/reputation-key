import { expect, it } from 'vitest'
import { portalLifetimeAnalyticsData } from './portal-lifetime-analytics'
import { organizationId, propertyId, portalId } from '#/shared/domain/ids'
const input = {
  organizationId: organizationId('org-lifetime'),
  propertyId: propertyId('a0000000-0000-4000-8000-000000000001'),
  portalId: portalId('b0000000-0000-4000-8000-000000000001'),
  startDate: new Date('2026-08-01T00:00:00Z'),
  endDate: new Date('2026-11-01T00:00:00Z'),
  propertyTimezone: 'Europe/Sofia',
  timeRange: 'all' as const,
}
const integrity = { accepted: 0, underReview: 0, filteredAutomatically: 0, total: 0 }
const languages = { total: 0, languages: [], unrecorded: 0 }
it('keeps missing lifetime figures unknown while carrying independently counted link taps', () => {
  const linkTaps = { total: 1, countedSince: '2026-11-01', rows: [], removedTaps: 1 }
  const read = portalLifetimeAnalyticsData(
    input,
    null,
    integrity,
    languages,
    input.startDate,
    linkTaps,
  )
  expect(read.linkTaps).toEqual(linkTaps)
  expect(read.scanPatterns).toBeNull()
  expect(read.series).toBeNull()
  expect(read.kpis.scans.value).toBeNull()
  expect(read.kpis.avgRating.value).toBeNull()
})
it('keeps an unused Linktree absent', () =>
  expect(
    portalLifetimeAnalyticsData(input, null, integrity, languages, input.startDate)
      .linkTaps,
  ).toBeNull())
