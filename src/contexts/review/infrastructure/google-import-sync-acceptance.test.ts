import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import type { SyncPropertyReviewsJobData } from '../application/ports/review-queue.port'
import {
  acceptGoogleImportSync,
  admitGoogleImportSync,
} from './google-import-sync-acceptance'

const data: SyncPropertyReviewsJobData = {
  organizationId: 'import-sync-acceptance',
  propertyId: '11111111-1111-4111-8111-111111111111',
  connectionId: '22222222-2222-4222-8222-222222222222',
  sourceEpoch: 1,
  locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
  importBindingEventId: '33333333-3333-4333-8333-333333333333',
}
const runId = '44444444-4444-4444-8444-444444444444'
const event = {
  payload: {
    sourceEpoch: data.sourceEpoch,
    connectionId: data.connectionId,
    change: 'created',
    importFollowUps: true,
  },
}

// Exercise admission and acceptance decisions with ordered database reads;
// PostgreSQL coverage proves these reads and writes against retained binding facts.
function database(reads: unknown[][]) {
  const insert = vi.fn(() => ({
    values: () => ({
      onConflictDoNothing: async () => undefined,
      onConflictDoUpdate: async () => undefined,
    }),
  }))
  const tx = {
    select: () => {
      const query = {
        from: () => query,
        where: () => query,
        for: () => query,
        limit: async () => {
          const rows = reads.shift()
          if (!rows) throw new Error('Unexpected database read')
          return rows
        },
      }
      return query
    },
    insert,
    delete: () => ({ where: async () => undefined }),
  }
  return {
    db: {
      transaction: async (fn: (value: typeof tx) => unknown) => fn(tx),
    } as unknown as Database,
    insert,
  }
}

describe('durable import sync acceptance', () => {
  it('redelivers a failed admission run so Review can preserve or recover its retry deadline', async () => {
    const { db, insert } = database([
      [event],
      [],
      [{ payload: { runId } }],
      [{ state: 'failed' }],
    ])
    await expect(
      admitGoogleImportSync(
        db,
        () => {
          throw new Error('must reuse failed run')
        },
        data,
      ),
    ).resolves.toEqual({ ...data, runId })
    expect(insert).not.toHaveBeenCalled()
  })

  it('accepts a failed run after the worker records its durable outcome', async () => {
    const { db, insert } = database([[event], [{ state: 'failed' }]])
    await acceptGoogleImportSync(db, { ...data, runId })
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it('refuses unmarked historical facts before admitting or acknowledging sync', async () => {
    const { importFollowUps: _marker, ...payload } = event.payload
    for (const command of [
      (db: Database) => admitGoogleImportSync(db, () => runId, data),
      (db: Database) => acceptGoogleImportSync(db, { ...data, runId }),
    ]) {
      const { db, insert } = database([[{ payload }]])
      await expect(command(db)).rejects.toThrow('attribution mismatch')
      expect(insert).not.toHaveBeenCalled()
    }
  })

  it('keeps a missing run owed', async () => {
    const { db, insert } = database([[event], []])
    await expect(acceptGoogleImportSync(db, { ...data, runId })).rejects.toThrow(
      'lacks durable progress',
    )
    expect(insert).not.toHaveBeenCalled()
  })
})
