import { describe, expect, it } from 'vitest'
import { NO_CODE, OLDER_CODE, overviewRow } from './portal-overview-fixtures'
import {
  indexOverviewResults,
  type OverviewResultsIndex,
  type PortalOverviewResultsState,
} from './portal-overview-results'
import {
  SCANS_NOT_COUNTED_REASON,
  portalMeasureSlot,
  sortFiguresWithoutUncounted,
} from './portal-overview-uncounted'
import { avelaResults } from './portal-overview-results-fixtures'

const INDEX: OverviewResultsIndex = indexOverviewResults(avelaResults())
const READY: PortalOverviewResultsState = { status: 'ready', index: INDEX }

describe('portalMeasureSlot', () => {
  it('prints the figures of a Portal as the read has them', () => {
    const slot = portalMeasureSlot(READY, overviewRow('p-terrace'))
    if (slot.kind !== 'figures') throw new Error('expected figures')
    expect(slot.measures.scans.tone).toBe('figure')
  })

  it('prints a dash with its reason for a Portal whose scans nobody counted, never its zero', () => {
    const slot = portalMeasureSlot(READY, overviewRow('p-terrace', { token: OLDER_CODE }))
    if (slot.kind !== 'figures') throw new Error('expected figures')
    expect(slot.measures.scans).toMatchObject({
      text: '—',
      tone: 'withheld',
      reason: SCANS_NOT_COUNTED_REASON,
    })
    // The rest of the row is still counted: only scans are missing.
    expect(slot.measures.ratings.tone).toBe('figure')
    // A card has no "0 qualified scans" to print.
    expect(slot.measures.summary).toBeNull()
  })

  it('leaves a Portal with no code, a Portal the read does not name and a loading read alone', () => {
    expect(
      portalMeasureSlot(READY, overviewRow('p-terrace', { token: NO_CODE })).kind,
    ).toBe('figures')
    expect(
      portalMeasureSlot(READY, overviewRow('unknown', { token: OLDER_CODE })).kind,
    ).toBe('unavailable')
    expect(
      portalMeasureSlot({ status: 'loading' }, overviewRow('a', { token: OLDER_CODE })),
    ).toEqual({ kind: 'loading' })
  })
})

describe('sortFiguresWithoutUncounted', () => {
  const index = INDEX

  it('gives no figure to a Portal whose scans were not counted, so it sorts with those still processing', () => {
    const rows = [
      overviewRow('p-terrace', { token: OLDER_CODE }),
      overviewRow('p-reception'),
    ]
    const figures = sortFiguresWithoutUncounted(index.sortFigures, rows)
    expect(figures?.portal('p-terrace')).toBeNull()
    expect(figures?.portal('p-reception')).toBe(index.sortFigures.portal('p-reception'))
  })

  it('is the same figures when every Portal is counted, and none until they arrive', () => {
    expect(sortFiguresWithoutUncounted(index.sortFigures, [overviewRow('a')])).toBe(
      index.sortFigures,
    )
    expect(sortFiguresWithoutUncounted(undefined, [overviewRow('a')])).toBeUndefined()
  })
})
