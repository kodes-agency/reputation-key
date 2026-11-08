import { expect, it } from 'vitest'
import {
  createFakePortalMetrics,
  resultsTabDeps,
  runResultsTab,
  readyEvidence,
} from './portal-analytics.test-fixtures'

it('carries independently counted link taps while All Time ratings are pending', async () => {
  const evidence = readyEvidence()
  const metrics = createFakePortalMetrics({
    evidence: {
      ...evidence,
      privateRatings: { ...evidence.privateRatings, state: 'updating' },
    },
  })
  const deps = resultsTabDeps({
    metrics: {
      ...metrics,
      getPortalLinkTapCounts: async () => [{ linkId: 'removed-link', taps: 1 }],
    },
  })
  const read = await runResultsTab(deps, { timeRange: 'all', startDate: new Date(0) })
  expect(read.linkTaps).toMatchObject({ total: 1, removedTaps: 1 })
  expect(read.kpis.avgRating.value).toBeNull()
  expect(read.scanPatterns).toBeNull()
  expect(read.series).toBeNull()
})
it('keeps an unused Linktree absent for All Time', async () => {
  const read = await runResultsTab(resultsTabDeps(), {
    timeRange: 'all',
    startDate: new Date(0),
  })
  expect(read.linkTaps).toBeNull()
})
