import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import { createImportItemRoutingLoader } from './import-item-routing.adapter'

function databaseReturning(rows: readonly unknown[]): Database {
  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () => rows,
          }),
        }),
      }),
    }),
  } as unknown as Database
}

describe('import-item routing adapter', () => {
  it('returns only the content-free current routing facts', async () => {
    const load = createImportItemRoutingLoader({
      db: databaseReturning([{ processingRegion: 'us', routingPolicyVersion: 4 }]),
    })

    await expect(load('org-1', '10000000-0000-4000-8000-000000000001')).resolves.toEqual({
      processingRegion: 'us',
      routingPolicyVersion: 4,
    })
  })

  it('fails closed when the tenant-scoped active item query finds no row', async () => {
    const load = createImportItemRoutingLoader({ db: databaseReturning([]) })

    await expect(
      load('org-other', '10000000-0000-4000-8000-000000000001'),
    ).resolves.toBeNull()
  })
})
