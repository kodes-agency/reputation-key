import { describe, expect, it } from 'vitest'
import {
  AVELA,
  FORMA,
  HARBOR,
  allPropertiesResults,
} from './portal-all-properties-fixtures'
import { resultsEvidence } from '../portal-analytics/portal-results-stories-data'
import { indexOverviewResults } from './portal-overview-results'
import { organizationScopeLine } from './portal-overview-strip-scope'

describe('indexOverviewResults over the whole Organization', () => {
  const index = indexOverviewResults(allPropertiesResults())

  it('gives each Property its own subtotal and how many Portals it holds', () => {
    expect(index.property(AVELA)?.measures.scans.text).toBe('1,607')
    expect(index.property(AVELA)?.memberCount).toBe(6)
    expect(index.property(HARBOR)?.measures.scans.text).toBe('1,108')
    expect(index.property(HARBOR)?.measures.summary).toBe('1,108 scans · 4.5 ★ from 312')
    expect(index.property(FORMA)?.memberCount).toBe(2)
  })

  it('knows nothing of a Property the read did not name, never a zero', () => {
    expect(index.property('prop-elsewhere')).toBeNull()
  })

  it('keeps each Property’s not-in-a-group row apart from the others', () => {
    expect(index.ungrouped(AVELA)?.measures.scans.text).toBe('1,607')
    expect(index.ungrouped(FORMA)?.measures.scans.text).toBe('705')
  })

  it('hands the sort each Property’s scans beside each Portal’s', () => {
    expect(index.sortFigures.property(HARBOR)).toBe(1108)
    expect(index.sortFigures.property('prop-elsewhere')).toBeNull()
    expect(index.sortFigures.portal('h-terrace')).toBe(486)
  })

  it('builds the strip from the total: the Organization’s five measures', () => {
    const total = index.total()

    expect(total?.cells.map((cell) => cell.value)).toEqual([
      '3,420',
      '951',
      '4.4',
      '498',
      '71',
    ])
  })

  it('says how the total moved against the days before, and each share of scans', () => {
    const cells = index.total()?.cells ?? []
    const detail = (key: string) => cells.find((cell) => cell.key === key)?.detail

    expect(detail('scans')).toBe('+212 vs the 30 days before')
    expect(detail('ratings')).toBe('28% of scans')
    expect(detail('googleOpens')).toBe('15% of scans')
  })

  it('labels the average a private rating, so it is never taken for Google’s review average', () => {
    const labels = index.total()?.cells.map((cell) => cell.label) ?? []

    expect(labels).toContain('Average private rating')
    expect(labels.join(' ')).not.toMatch(/google review|review average/i)
  })

  it('names no date range for the total: each Property reads its own days', () => {
    const total = index.total()

    expect(total?.caption).toBeNull()
    expect(total?.footer).toBe(
      'Last 30 days · each property’s local time · an average needs 5 private ratings',
    )
  })

  it('does not compare the total when no Property read the period before', () => {
    const alone = indexOverviewResults({
      ...allPropertiesResults(),
      properties: allPropertiesResults().properties.map((row) => ({
        ...row,
        comparePeriod: null,
        localDays: { ...row.localDays, compareStart: null, compareEnd: null },
      })),
    })

    expect(alone.total()?.cells.find((cell) => cell.key === 'scans')?.detail).toBeNull()
  })

  it('has a total with nothing in it for an Organization with no Portals', () => {
    const empty = indexOverviewResults({
      ...allPropertiesResults(),
      properties: [],
      portals: [],
      groups: [],
      ungrouped: [],
    })

    expect(empty.total()?.footer).toBe(
      'Each property’s local time · an average needs 5 private ratings',
    )
  })

  it('counts the Properties the read names, so the page can say when it is fewer than it lists', () => {
    expect(index.propertiesRead).toBe(3)
    expect(
      indexOverviewResults({
        ...allPropertiesResults(),
        properties: allPropertiesResults().properties.slice(0, 2),
      }).propertiesRead,
    ).toBe(2)
  })

  describe('a not-ready line that names a time', () => {
    // An average that cannot be shown although the readings are ready: its line
    // would say "Data through <time> <zone>".
    const withAverageNotShown = (sharedZone: boolean) => {
      const base = allPropertiesResults()
      return indexOverviewResults({
        ...base,
        properties: sharedZone
          ? base.properties
          : base.properties.map((row, index) =>
              index === 1 ? { ...row, timezone: 'America/New_York' } : row,
            ),
        total: {
          ...base.total,
          kpis: {
            ...base.total.kpis,
            avgRating: {
              value: null,
              priorValue: null,
              comparison: null,
              sampleCount: 3,
              priorSampleCount: 0,
              evidence: resultsEvidence({ state: 'ready', sampleCount: 3 }),
            },
          },
        },
      })
    }
    const averageDetail = (index: ReturnType<typeof indexOverviewResults>) =>
      index.total()?.cells.find((cell) => cell.key === 'average')?.detail

    it('names the Property’s zone when every Property reads in it', () => {
      expect(averageDetail(withAverageNotShown(true))).toMatch(/^Data through .+ GMT\+3$/)
    })

    it('names no zone when the Properties read in different ones, rather than UTC', () => {
      const detail = averageDetail(withAverageNotShown(false))

      expect(detail).toBeNull()
    })
  })

  describe('organizationScopeLine', () => {
    it('says "all properties" when the read names every Property the list shows', () => {
      expect(organizationScopeLine(3, 3)).toBe('all properties')
    })

    it('says how many are in the total when the read leaves some out', () => {
      expect(organizationScopeLine(2, 3)).toBe('2 of 3 properties')
    })

    it('says "all properties" until the results are here to count', () => {
      expect(organizationScopeLine(null, 3)).toBe('all properties')
    })

    it('says "all properties" when it is not told how many the list shows', () => {
      expect(organizationScopeLine(2, undefined)).toBe('all properties')
    })
  })
})
