import { describe, expect, it } from 'vitest'
import {
  avelaResults,
  groupResultsRow,
  measuresOf,
  propertyResultsRow,
  updatingMeasures,
} from './portal-overview-results-fixtures'
import {
  groupHeadCount,
  groupSlot,
  indexOverviewResults,
  measureSlot,
  resultsStateOf,
  rowMeasures,
} from './portal-overview-results'

const FRAME = {
  thresholds: { averageMinSample: 5, comparisonMinSample: 10 },
  timezone: 'Europe/Sofia',
}
const READY = { scans: 412, ratings: 118, average: 4.4, googleOpens: 64, notes: 9 }

describe('rowMeasures', () => {
  it('prints the five figures of a ready row, with the star on the average', () => {
    const measures = rowMeasures(measuresOf(READY), FRAME)

    expect(measures.scans).toMatchObject({ text: '412', tone: 'figure' })
    expect(measures.ratings).toMatchObject({ text: '118', tone: 'figure' })
    expect(measures.average).toMatchObject({ text: '4.4', unit: 'star', tone: 'figure' })
    expect(measures.googleOpens).toMatchObject({ text: '64', tone: 'figure' })
    expect(measures.notes).toMatchObject({ text: '9', tone: 'figure' })
  })

  it('groups thousands as the strip does', () => {
    const measures = rowMeasures(measuresOf({ ...READY, scans: 1607 }), FRAME)

    expect(measures.scans.text).toBe('1,607')
  })

  it('says "Too few" for an average the sample is too small to show, and how many there are', () => {
    const measures = rowMeasures(
      measuresOf({ ...READY, ratings: 4, average: null }),
      FRAME,
    )

    expect(measures.average).toMatchObject({
      text: 'Too few',
      tone: 'withheld',
      unit: null,
      reason: '4 ratings, needs 5 to show an average',
    })
    // The counts beside it are real and stay.
    expect(measures.ratings).toMatchObject({ text: '4', tone: 'figure' })
  })

  it('keeps a zero a zero when the evidence says it was counted', () => {
    const measures = rowMeasures(measuresOf({ ...READY, notes: 0 }), FRAME)

    expect(measures.notes).toMatchObject({ text: '0', tone: 'figure' })
  })

  it('leaves a figure that is not ready as a dash with the reason, never a zero', () => {
    const measures = rowMeasures(updatingMeasures(), FRAME)

    expect(measures.scans).toMatchObject({
      text: '—',
      tone: 'missing',
      reason: 'Recent activity is still processing.',
    })
    expect(measures.average).toMatchObject({ text: '—', tone: 'missing' })
    expect(measures.summary).toBeNull()
  })

  it('writes the phone summary as scans, then the average and the ratings behind it', () => {
    expect(rowMeasures(measuresOf(READY), FRAME).summary).toBe(
      '412 qualified scans · 4.4 ★ from 118',
    )
  })

  it('drops the average from the phone summary when it is not shown', () => {
    const measures = rowMeasures(
      measuresOf({ ...READY, ratings: 4, average: null }),
      FRAME,
    )

    expect(measures.summary).toBe('412 qualified scans')
  })

  it('says "1 qualified scan" for one', () => {
    const measures = rowMeasures(
      measuresOf({ ...READY, scans: 1, ratings: 0, average: null }),
      FRAME,
    )

    expect(measures.summary).toBe('1 qualified scan')
  })

  it('writes the group head summary shorter, as board 11 does', () => {
    expect(rowMeasures(measuresOf(READY), FRAME, 'short').summary).toBe(
      '412 scans · 4.4 ★ from 118',
    )
  })
})

describe('indexOverviewResults', () => {
  const index = indexOverviewResults(avelaResults())

  it('finds a Portal, a group and the ungrouped row by their identifiers', () => {
    expect(index.portal('p-terrace')?.scans.text).toBe('412')
    expect(index.group('group-pool')?.measures.scans.text).toBe('698')
    expect(index.ungrouped('prop-1')?.measures.scans.text).toBe('351')
  })

  it('knows nothing of a Portal or group the read did not name', () => {
    expect(index.portal('p-new')).toBeNull()
    expect(index.group('group-new')).toBeNull()
    expect(index.ungrouped('prop-2')).toBeNull()
  })

  it('counts a group from the Portals in it today, not from those its readings sit under', () => {
    const moved = indexOverviewResults({
      ...avelaResults(),
      groups: [
        groupResultsRow('group-pool', ['p-terrace', 'p-spa'], measuresOf(READY), [
          'p-terrace',
          'p-spa',
          'p-moved-out',
        ]),
      ],
    })

    expect(moved.group('group-pool')?.memberCount).toBe(2)
  })

  it('hands the sort the scans it prints, and nothing where they are not ready', () => {
    const figures = index.sortFigures
    expect(figures.portal('p-reception')).toBe(520)
    expect(figures.group('group-front')).toBe(558)

    const updating = indexOverviewResults({
      ...avelaResults(),
      portals: avelaResults().portals.map((row) => ({ ...row, ...updatingMeasures() })),
    })
    expect(updating.sortFigures.portal('p-reception')).toBeNull()
  })

  it('builds the strip from the Property row: its scans, shares of scans and change', () => {
    const strip = index.strip('prop-1')

    expect(strip?.cells.map((cell) => cell.value)).toEqual([
      '1,607',
      '450',
      '4.4',
      '236',
      '36',
    ])
    expect(strip?.cells.find((cell) => cell.key === 'ratings')?.detail).toBe(
      '28% of scans',
    )
    expect(strip?.cells.find((cell) => cell.key === 'googleOpens')?.detail).toBe(
      '15% of scans',
    )
  })

  it('compares only when the read did', () => {
    const alone = indexOverviewResults({
      ...avelaResults(),
      properties: [
        propertyResultsRow(['p-terrace'], measuresOf(READY), { compare: false }),
      ],
    })

    expect(
      alone.strip('prop-1')?.cells.find((cell) => cell.key === 'scans')?.detail,
    ).toBeNull()
  })

  it('names the window and the floor in the footer', () => {
    expect(index.strip('prop-1')?.footer).toBe(
      'Last 30 days, Europe/Sofia time · an average needs 5 private ratings',
    )
    expect(index.strip('prop-1')?.caption).toBe('1–30 Sep, Europe/Sofia time')
  })

  it('builds a group strip from the group row, in the window of the Property it sits in', () => {
    const strip = index.groupStrip('group-pool')

    expect(strip?.cells.map((cell) => cell.value)).toEqual([
      '698',
      '209',
      '4.5',
      '116',
      '13',
    ])
    // Shares are of the group's own scans: 209 / 698 and 116 / 698.
    expect(strip?.cells.find((cell) => cell.key === 'ratings')?.detail).toBe(
      '30% of scans',
    )
    expect(strip?.cells.find((cell) => cell.key === 'googleOpens')?.detail).toBe(
      '17% of scans',
    )
    expect(strip?.caption).toBe('1–30 Sep, Europe/Sofia time')
    expect(strip?.footer).toBe(
      'Last 30 days, Europe/Sofia time · an average needs 5 private ratings',
    )
  })

  it('has no strip for a group the read did not name', () => {
    expect(index.groupStrip('group-new')).toBeNull()
  })

  it('has no strip for a Property it did not read', () => {
    expect(index.strip('prop-2')).toBeNull()
  })
})

describe('groupHeadCount', () => {
  it('takes the count from the group read when there is one, else from the Portals listed', () => {
    expect(groupHeadCount({ memberCount: 3, matchedCount: 3 }, 3)).toEqual({
      members: 3,
      matched: 3,
    })
    expect(groupHeadCount({ memberCount: 3, matchedCount: 2 }, null)).toEqual({
      members: 3,
      matched: 2,
    })
  })

  it('never says more are matched than there are', () => {
    // The read and the list were fetched a moment apart.
    expect(groupHeadCount({ memberCount: 4, matchedCount: 4 }, 3)).toEqual({
      members: 4,
      matched: 4,
    })
  })
})

describe('measureSlot', () => {
  const ready = { status: 'ready' as const, index: indexOverviewResults(avelaResults()) }

  it('draws nothing where results are not shown to this reader', () => {
    expect(measureSlot({ status: 'off' }, (index) => index.portal('p-spa'))).toEqual({
      kind: 'off',
    })
  })

  it('waits while the read is on its way, and says nothing is known when it failed', () => {
    expect(measureSlot({ status: 'loading' }, (index) => index.portal('p-spa'))).toEqual({
      kind: 'loading',
    })
    expect(measureSlot({ status: 'failed' }, (index) => index.portal('p-spa'))).toEqual({
      kind: 'unavailable',
    })
  })

  it('gives the figures of the row the read named', () => {
    const slot = measureSlot(ready, (index) => index.portal('p-spa'))

    expect(slot).toMatchObject({ kind: 'figures', measures: { scans: { text: '286' } } })
  })

  it('says nothing is known for a row the read did not name, never a zero', () => {
    expect(measureSlot(ready, (index) => index.portal('p-created-a-moment-ago'))).toEqual(
      {
        kind: 'unavailable',
      },
    )
  })
})

describe('groupSlot', () => {
  const ready = { status: 'ready' as const, index: indexOverviewResults(avelaResults()) }

  it('gives a group its figures and how many Portals the read counts in it', () => {
    const { slot, memberCount } = groupSlot(ready, (index) => index.group('group-pool'))

    expect(slot).toMatchObject({ kind: 'figures', measures: { scans: { text: '698' } } })
    expect(memberCount).toBe(3)
  })

  it('knows no count until the read is here, and keeps the state of the read', () => {
    expect(
      groupSlot({ status: 'loading' }, (index) => index.group('group-pool')),
    ).toEqual({
      slot: { kind: 'loading' },
      memberCount: null,
    })
    expect(groupSlot({ status: 'off' }, (index) => index.group('group-pool'))).toEqual({
      slot: { kind: 'off' },
      memberCount: null,
    })
  })

  it('has no count for a group the read did not name', () => {
    expect(groupSlot(ready, (index) => index.group('group-new'))).toEqual({
      slot: { kind: 'unavailable' },
      memberCount: null,
    })
  })
})

describe('resultsStateOf', () => {
  const index = indexOverviewResults(avelaResults())
  const allowed = { allowed: true, error: null }

  it('shows no results to a reader who may not read them', () => {
    expect(resultsStateOf({ allowed: false, error: null }, index)).toEqual({
      status: 'off',
    })
  })

  it('waits while there is nothing yet', () => {
    expect(resultsStateOf(allowed, null)).toEqual({ status: 'loading' })
  })

  it('has the figures once they are there', () => {
    expect(resultsStateOf(allowed, index)).toEqual({ status: 'ready', index })
  })

  it('keeps the figures it has when a later refresh fails', () => {
    expect(resultsStateOf({ allowed: true, error: new Error('network') }, index)).toEqual(
      {
        status: 'ready',
        index,
      },
    )
  })

  it('shows no results when the Property has more Portals than one read answers for', () => {
    const tooMany = Object.assign(new Error('Too many Portals'), {
      code: 'too_many_portals',
    })

    expect(resultsStateOf({ allowed: true, error: tooMany }, null)).toEqual({
      status: 'off',
    })
  })

  it('says it failed on a real error, and whether Try again is reading', () => {
    const error = new Error('database down')

    expect(resultsStateOf({ allowed: true, error }, null)).toEqual({
      status: 'failed',
      retrying: false,
    })
    expect(resultsStateOf({ allowed: true, error, retrying: true }, null)).toEqual({
      status: 'failed',
      retrying: true,
    })
  })

  it('treats a deliberately dark capability as no results, not as a failure', () => {
    const dark = Object.assign(new Error('denied'), { code: 'org_not_allowlisted' })

    expect(resultsStateOf({ allowed: true, error: dark }, null)).toEqual({
      status: 'off',
    })
  })
})
