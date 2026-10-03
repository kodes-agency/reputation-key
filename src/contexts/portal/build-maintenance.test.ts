import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import { organizationId } from '#/shared/domain/ids'
import { createMockLogger } from '#/shared/testing/mock-logger'
import type { PublishPortalChangesDeps } from './application/use-cases/publish-portal-changes'
import { buildPortalMaintenance } from './build-maintenance'

/** A database whose every query answers with no rows, whatever the chain. */
const emptyDatabase = (): Database => {
  const chain: unknown = new Proxy(() => undefined, {
    get: (_target, property) =>
      property === 'then' ? (resolve: (rows: []) => void) => resolve([]) : chain,
    apply: () => chain,
  })
  return chain as Database
}

describe('buildPortalMaintenance', () => {
  it('exposes the bulk republish, frozen, and wires it to the reader and the publish deps', async () => {
    const maintenance = buildPortalMaintenance(
      emptyDatabase(),
      {} as PublishPortalChangesDeps,
      createMockLogger(),
    )

    expect(Object.isFrozen(maintenance)).toBe(true)
    expect(Object.keys(maintenance)).toEqual(['republishLegacyPortals'])
    const report = await maintenance.republishLegacyPortals({
      organizationId: organizationId('org-maintenance-00000000000000001'),
      operatorId: 'denev',
      dryRun: true,
      pageSize: 10,
    })
    expect(report).toMatchObject({ mode: 'dry_run', rows: [], halted: null })
  })
})
