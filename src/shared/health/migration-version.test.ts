import { describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('#/shared/db/pool', () => ({
  getPool: () => ({ query }),
}))

import { appliedMigrationCount, MIGRATION_COUNT_SQL } from './migration-version'

describe('appliedMigrationCount', () => {
  it('returns the journal row count', async () => {
    query.mockResolvedValueOnce({ rows: [{ count: 17 }] })
    await expect(appliedMigrationCount()).resolves.toBe(17)
    expect(query).toHaveBeenCalledWith(MIGRATION_COUNT_SQL)
  })

  it('returns null when the read fails (degraded, never guessed)', async () => {
    query.mockRejectedValueOnce(new Error('relation does not exist'))
    await expect(appliedMigrationCount()).resolves.toBeNull()
  })

  it('returns null for a non-finite count', async () => {
    query.mockResolvedValueOnce({ rows: [{ count: 'not-a-number' }] })
    await expect(appliedMigrationCount()).resolves.toBeNull()
  })

  it('returns null for an empty result set', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await expect(appliedMigrationCount()).resolves.toBeNull()
  })
})
