import { describe, expect, it, vi } from 'vitest'
import type {
  PropertyFactsPublicApi,
  PropertyPublicApi,
} from '#/contexts/property/application/public-api'
import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import type { ScheduledScopeAuthorizer } from '#/shared/jobs/delayed-execution-gate'
import { createRecognitionRepository } from './repositories/recognition.repository'

function queryChain(rows: readonly unknown[]) {
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  chain.innerJoin = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.orderBy = vi.fn(async () => rows)
  chain.limit = vi.fn(async () => rows)
  chain.then = (
    resolve: (value: readonly unknown[]) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(rows).then(resolve, reject)
  return chain
}

function buildRepository(options?: { propertyExists?: boolean }) {
  const rowsByQuery: readonly (readonly unknown[])[] = [
    [],
    [{ id: 'group-1', name: 'Front desk' }],
    [],
  ]
  let queryIndex = 0
  const select = vi.fn(() => queryChain(rowsByQuery[queryIndex++] ?? []))
  const transaction = vi.fn()
  const propertyExists = vi.fn(async () => options?.propertyExists ?? true)
  const db = { select, transaction } as unknown as Database
  const propertyApi = { propertyExists } as unknown as Pick<
    PropertyPublicApi,
    'propertyExists'
  > &
    PropertyFactsPublicApi
  const authorize = vi.fn() as unknown as ScheduledScopeAuthorizer
  return {
    repository: createRecognitionRepository({
      db,
      clock: (() => new Date('2026-08-16T12:00:00.000Z')) as Clock,
      authorizeBoardScope: authorize,
      authorizeAwardScope: authorize,
      propertyApi,
    }),
    select,
    transaction,
    propertyExists,
  }
}

describe('createRecognitionRepository', () => {
  it('returns only tenant-scoped settings selected by the repository queries', async () => {
    const { repository, select } = buildRepository()

    await expect(repository.getSettings('org-1', 'property-1')).resolves.toEqual({
      activation: null,
      availablePortalGroups: [{ id: 'group-1', name: 'Front desk' }],
      availableMetrics: [],
    })
    expect(select).toHaveBeenCalledTimes(3)
  })

  it('fails activation before transaction when the property is outside the tenant', async () => {
    const { repository, propertyExists, transaction } = buildRepository({
      propertyExists: false,
    })

    await expect(
      repository.activate({
        kind: 'activate',
        organizationId: 'org-1',
        propertyId: 'property-1',
        policyVersion: 'recognition-v1',
        jurisdiction: 'US',
        noticeStatus: 'completed',
        consultationStatus: 'not_required',
        audience: 'property_managers_and_scoped_staff',
        acknowledgedBy: 'user-1',
        selectedPortalGroupIds: ['group-1'],
        metricDefinitionVersionId: 'metric-version-1',
        aggregation: 'sum',
        periodKind: 'monthly',
        minimumExposure: 1,
        minimumSample: 5,
        freshnessSeconds: 3600,
        minimumCompleteness: 0.9,
        now: new Date('2026-08-16T12:00:00.000Z'),
      }),
    ).rejects.toThrow('recognition_property_not_found')
    expect(propertyExists).toHaveBeenCalledOnce()
    expect(transaction).not.toHaveBeenCalled()
  })
})
