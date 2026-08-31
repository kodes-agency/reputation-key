import { describe, expect, it } from 'vitest'
import { createPublicationReconciliationRunLease } from './publication-reconciliation-run-lease'
import { getPool } from '#/shared/db/pool'

describe('publication reconciliation run lease', () => {
  it('excludes another database session until the holder releases', async () => {
    const authority = createPublicationReconciliationRunLease(getPool())
    const first = await authority.tryAcquire()
    expect(first).not.toBeNull()

    try {
      await expect(authority.tryAcquire()).resolves.toBeNull()
    } finally {
      await first?.release()
    }

    const afterRelease = await authority.tryAcquire()
    expect(afterRelease).not.toBeNull()
    await afterRelease?.release()
    // Release is idempotent so an error-path finally cannot unlock twice.
    await afterRelease?.release()
  })
})
