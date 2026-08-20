import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { createMetricRegistryRepository } from './repositories/metric-registry.repository'

function databaseReturning(rows: readonly unknown[]) {
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  chain.innerJoin = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.limit = vi.fn(async () => rows)
  return {
    db: { select: vi.fn(() => chain) } as unknown as Database,
    chain,
  }
}

describe('createMetricRegistryRepository', () => {
  it('returns null when the requested registry version does not exist', async () => {
    const { db, chain } = databaseReturning([])

    await expect(
      createMetricRegistryRepository(db).findVersionById('version-missing'),
    ).resolves.toBeNull()
    expect(chain.where).toHaveBeenCalledOnce()
    expect(chain.limit).toHaveBeenCalledWith(1)
  })

  it('maps persisted definition and version policy without enabling employment use', async () => {
    const effectiveFrom = new Date('2026-08-01T00:00:00.000Z')
    const row = {
      definition: {
        id: 'definition-1',
        metricKey: 'google.business_profile.impressions',
        displayName: 'Profile impressions',
        description: null,
        valueKind: 'count',
        workerDataFlag: false,
        privacyClass: 'organization_aggregate',
        retentionClass: 'operational',
        lifecycleStatus: 'active',
        approvalOwner: 'analytics-governance',
      },
      version: {
        id: 'version-1',
        definitionId: 'definition-1',
        version: 3,
        effectiveFrom,
        effectiveTo: null,
        numeratorDescription: null,
        denominatorDescription: null,
        unit: 'views',
        precision: 0,
        aggregationRule: 'sum',
        lateArrivalRule: 'replace',
        allowedScopes: ['property'],
        attributionRule: 'property-local-date',
        minimumSample: 1,
        insufficientDataBehavior: 'unavailable',
        sourcePolicyAllowlist: ['provider_aggregate'],
        permittedConsumers: ['goal'],
        correctionBehavior: 'replace',
        fairnessReviewStatus: 'not_applicable',
      },
    }
    const { db } = databaseReturning([row])

    await expect(
      createMetricRegistryRepository(db).findVersionById('version-1'),
    ).resolves.toEqual({
      definition: expect.objectContaining({
        id: 'definition-1',
        key: 'google.business_profile.impressions',
        description: '',
      }),
      version: expect.objectContaining({
        id: 'version-1',
        effectiveFrom,
        allowedScopes: ['property'],
        employmentDecisionEligible: false,
      }),
    })
  })
})
