import { describe, expect, it } from 'vitest'
import { getCountries } from 'libphonenumber-js'
import {
  DATA_CELL_CATALOGUE,
  DATA_CELL_CATALOGUE_POLICY_VERSION,
  DATA_CELL_IDS,
  dataCellById,
  dataCellIdForCountry,
  isDataCellAccepting,
  resolveDataCellTarget,
} from './data-cell-catalogue'

describe('Data Cell catalogue', () => {
  it('partitions every supported country exactly once', () => {
    const countries = Object.values(DATA_CELL_CATALOGUE).flatMap(
      (cell) => cell.allowedCountryCodes,
    )
    expect(new Set(countries).size).toBe(countries.length)
    expect([...countries].sort()).toEqual([...getCountries()].sort())
  })

  it.each([
    ['US', 'us'],
    ['pr', 'us'],
    ['DE', 'europe'],
    ['GB', 'europe'],
    ['CH', 'europe'],
    ['JP', 'global'],
    ['AU', 'global'],
    ['XK', 'global'],
  ] as const)('allocates country %s to %s without a default cell', (country, cell) => {
    expect(dataCellIdForCountry(country)).toBe(cell)
  })

  it.each(['', 'U', 'USA', 'ZZ', '12', ' us ' + 'x'])(
    'stops invalid/unsupported country %s for operator review',
    (country) => {
      expect(dataCellIdForCountry(country)).toBe('unresolved')
    },
  )

  it('exposes one small lookup interface and never defaults unknown cells', () => {
    expect(DATA_CELL_IDS.map((id) => dataCellById(id)?.id)).toEqual(DATA_CELL_IDS)
    expect(dataCellById('eu')).toBeNull()
    expect(dataCellById('')).toBeNull()
  })

  it('routes only an accepting cell and hides provider/queue selection', () => {
    expect(resolveDataCellTarget('us', 'review.sync')).toEqual({
      kind: 'target',
      target: {
        cellId: 'us',
        queue: 'default',
        providerRef: 'gbp-default',
        policyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
      },
    })
    expect(resolveDataCellTarget('europe', 'review.sync')).toEqual({
      kind: 'blocked',
      reason: 'cell_not_accepting',
    })
    expect(resolveDataCellTarget('global', 'reply.publish')).toEqual({
      kind: 'blocked',
      reason: 'cell_not_accepting',
    })
    expect(resolveDataCellTarget('unknown', 'review.sync')).toEqual({
      kind: 'blocked',
      reason: 'cell_unknown',
    })
  })

  it('reports activation state without treating known provisioning cells as live', () => {
    expect(isDataCellAccepting('us')).toBe(true)
    expect(isDataCellAccepting('europe')).toBe(false)
    expect(isDataCellAccepting('global')).toBe(false)
    expect(isDataCellAccepting('unknown')).toBe(false)
  })
})
