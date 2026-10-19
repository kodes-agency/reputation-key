import { describe, expect, it } from 'vitest'
import type { PortalGoalRows } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { countsLine, portalCountsWords } from './portal-goal-running-view'

describe('what each portal brought in, in words', () => {
  const rows = (patch: Partial<Extract<PortalGoalRows, { kind: 'rows' }>> = {}) =>
    ({
      kind: 'rows',
      portals: [
        { portalId: 'portal-reception', name: 'Reception', count: 3 },
        { portalId: 'portal-restaurant', name: 'Restaurant', count: 0 },
        { portalId: 'portal-spa', name: 'Spa', count: 20 },
      ],
      elsewhere: 0,
      ...patch,
    }) satisfies PortalGoalRows

  it("rows stay in the read's name order", () => {
    // Spa has the most and Reception the fewest: the order is the read's.
    expect(portalCountsWords(rows())).toEqual({
      kind: 'rows',
      heading: 'From your portals',
      rows: [
        { key: 'portal-reception', name: 'Reception', count: '3' },
        { key: 'portal-restaurant', name: 'Restaurant', count: '0' },
        { key: 'portal-spa', name: 'Spa', count: '20' },
      ],
    })
  })

  it('Other portals only when something came from them', () => {
    const words = portalCountsWords(rows({ elsewhere: 2 }))

    expect(words.kind === 'rows' ? words.rows.map(({ name }) => name) : []).toEqual([
      'Reception',
      'Restaurant',
      'Spa',
      'Other portals',
    ])
    expect(words.kind === 'rows' ? words.rows.at(-1) : null).toEqual({
      key: 'elsewhere',
      name: 'Other portals',
      count: '2',
    })
  })

  it('one portal: All from Reception.', () => {
    expect(portalCountsWords({ kind: 'one', name: 'Reception' })).toEqual({
      kind: 'sentence',
      text: 'All from Reception.',
      seeEach: null,
    })
  })

  it('five portals: From 5 portals · See each', () => {
    expect(portalCountsWords({ kind: 'many', count: 5 })).toEqual({
      kind: 'sentence',
      text: 'From 5 portals',
      seeEach: 'See each',
    })
  })
})

describe('what each portal brought in, in one line', () => {
  it("says each portal's count in the read's order, never sorted by count", () => {
    expect(
      countsLine({
        kind: 'rows',
        portals: [
          { portalId: 'portal-reception', name: 'Reception', count: 3 },
          { portalId: 'portal-restaurant', name: 'Restaurant', count: 0 },
          { portalId: 'portal-spa', name: 'Spa', count: 20 },
        ],
        elsewhere: 0,
      }),
    ).toBe('Reception 3 · Restaurant 0 · Spa 20')
  })

  it('ends with Other portals when something came from them', () => {
    expect(
      countsLine({
        kind: 'rows',
        portals: [
          { portalId: 'portal-reception', name: 'Reception', count: 13 },
          { portalId: 'portal-restaurant', name: 'Restaurant', count: 6 },
          { portalId: 'portal-spa', name: 'Spa', count: 2 },
        ],
        elsewhere: 2,
      }),
    ).toBe('Reception 13 · Restaurant 6 · Spa 2 · Other portals 2')
  })

  it('leaves All from Reception. and From 5 portals to the card’s own sentences', () => {
    expect(countsLine({ kind: 'one', name: 'Reception' })).toBeNull()
    expect(countsLine({ kind: 'many', count: 5 })).toBeNull()
  })
})
