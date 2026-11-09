import { expect, it } from 'vitest'
import { resultsTabDeps, runResultsTab } from './portal-analytics.test-fixtures'
import { allTimeLabel, windowFooter } from './ui/portal-results-window'
import { portalResultsCheckIn } from './ui/portal-results-check-in'

it.each(['all', '30d'] as const)(
  'carries retention activation through the %s read to every window label',
  async (timeRange) => {
    for (const retentionActive of [false, true]) {
      const data = await runResultsTab(
        { ...resultsTabDeps(), retentionActive },
        {
          timeRange,
          startDate: new Date('2029-01-01T00:00:00Z'),
          endDate: new Date('2029-02-01T00:00:00Z'),
        },
      )
      const label = retentionActive ? 'Last 24 months' : 'All time'
      expect(data.retentionActive).toBe(retentionActive)
      expect(allTimeLabel(data.retentionActive)).toBe(label)
      if (timeRange === 'all') {
        expect(windowFooter(data.localDays, 'UTC', 10, data.retentionActive)).toBe(
          `${label}, UTC time`,
        )
        expect(portalResultsCheckIn(data).using.lines).toEqual([
          `${label} shows the total. Choose a range to see days and weeks.`,
        ])
      }
    }
  },
)
