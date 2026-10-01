import { describe, expect, it } from 'vitest'
import {
  AVELA,
  FORMA,
  HARBOR,
  allPropertiesResults,
} from './portal-all-properties-fixtures'
import { indexOverviewResults } from './portal-overview-results'

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
})
