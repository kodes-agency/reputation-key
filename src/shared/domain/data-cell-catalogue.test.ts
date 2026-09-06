import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { getCountries } from 'libphonenumber-js'
import {
  DATA_CELL_CATALOGUE,
  DATA_CELL_CATALOGUE_POLICY_VERSION,
  DATA_CELL_SUPPORTED_COUNTRY_COUNT,
  DATA_CELL_SUPPORTED_COUNTRY_POLICY_SHA256,
  DATA_CELL_IDS,
  BETA_DEPLOYMENT_DATA_CELL_IDS,
  ACCEPTING_DATA_CELL_IDS,
  dataCellById,
  dataCellIdForCountry,
  isBetaDeploymentDataCellId,
  isDataCellAccepting,
  resolvePersistedDataCellId,
  resolveDataCellTarget,
} from './data-cell-catalogue'

describe('Data Cell catalogue', () => {
  it('allocates every supported country to the single US beta cell exactly once', () => {
    const countries = Object.values(DATA_CELL_CATALOGUE).flatMap(
      (cell) => cell.allowedCountryCodes,
    )
    expect(new Set(countries).size).toBe(countries.length)
    expect([...countries].sort()).toEqual([...getCountries()].sort())
    expect(countries).toHaveLength(DATA_CELL_SUPPORTED_COUNTRY_COUNT)
    expect(
      createHash('sha256')
        .update([...countries].sort().join(','))
        .digest('hex'),
    ).toBe(DATA_CELL_SUPPORTED_COUNTRY_POLICY_SHA256)
    expect(DATA_CELL_CATALOGUE.us.allowedCountryCodes).toEqual([...getCountries()].sort())
  })

  it.each([
    ['US', 'us'],
    ['pr', 'us'],
    ['DE', 'us'],
    ['BG', 'us'],
    ['GB', 'us'],
    ['JP', 'us'],
    ['AU', 'us'],
    ['XK', 'us'],
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
    expect(dataCellById('constructor')).toBeNull()
    expect(dataCellById('toString')).toBeNull()
    expect(dataCellById('__proto__')).toBeNull()
    expect(DATA_CELL_CATALOGUE.us.resources).toEqual({
      web: 'web',
      worker: 'worker',
      postgres: 'Postgres',
      cacheRedis: 'Cache Redis',
      queueRedis: 'Queue Redis',
      providerRedis: 'google-provider-redis',
      objectStore: 'object-store',
    })
  })

  it('reads expand-phase assignments without masking invalid or conflicting facts', () => {
    expect(resolvePersistedDataCellId('us', 'us')).toBe('us')
    expect(resolvePersistedDataCellId('us', null)).toBe('us')
    expect(resolvePersistedDataCellId(null, null)).toBeNull()
    expect(resolvePersistedDataCellId(null, 'europe')).toBe('europe')
    expect(resolvePersistedDataCellId(null, 'unresolved')).toBeNull()
    expect(resolvePersistedDataCellId('unknown', 'us')).toBeNull()
    expect(resolvePersistedDataCellId('us', 'europe')).toBeNull()
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
    expect(BETA_DEPLOYMENT_DATA_CELL_IDS).toEqual(['us'])
    expect(isBetaDeploymentDataCellId('us')).toBe(true)
    expect(isBetaDeploymentDataCellId('europe')).toBe(false)
    expect(isBetaDeploymentDataCellId('global')).toBe(false)
    expect(isBetaDeploymentDataCellId('unknown')).toBe(false)
    expect(ACCEPTING_DATA_CELL_IDS).toEqual(['us'])
    expect(isDataCellAccepting('us')).toBe(true)
    expect(isDataCellAccepting('europe')).toBe(false)
    expect(isDataCellAccepting('global')).toBe(false)
    expect(isDataCellAccepting('unknown')).toBe(false)
    expect(isDataCellAccepting(null)).toBe(false)
  })

  it('denies workload names outside the governed catalogue at the runtime boundary', () => {
    expect(
      Reflect.apply(resolveDataCellTarget, undefined, ['us', 'future.unsupported']),
    ).toEqual({
      kind: 'blocked',
      reason: 'workload_denied',
    })
  })

  it('keeps future cells known but dormant and unable to receive beta work', () => {
    for (const cellId of ['europe', 'global'] as const) {
      expect(DATA_CELL_CATALOGUE[cellId]).toMatchObject({
        state: 'denied',
        allowedCountryCodes: [],
        allowedWorkloads: [],
        railway: null,
      })
    }
  })

  it('rejects an ambiguous country policy if the upstream country set contains a duplicate', async () => {
    vi.resetModules()
    vi.doMock('libphonenumber-js', async () => {
      const actual =
        await vi.importActual<typeof import('libphonenumber-js')>('libphonenumber-js')
      return {
        ...actual,
        getCountries: () => ['US', 'US'],
      }
    })

    try {
      await expect(import('./data-cell-catalogue')).rejects.toThrow(
        'Data Cell country policy is ambiguous: US',
      )
    } finally {
      vi.doUnmock('libphonenumber-js')
      vi.resetModules()
    }
  })
})
