import { strict as assert } from 'node:assert'
import { randomUUID } from 'node:crypto'
import { acquireTestLease } from '../../src/shared/testing/test-environment-lease'
import { testEnvironment } from '../../src/shared/testing/test-environment'
import {
  restorePopulatedUpgradeFixture,
  upgradeCustomerRows,
} from './populated-upgrade-fixture'
import {
  bootUpgradeImage,
  migrateUpgradeImage,
  upgradeImageJournal,
  UpgradeImageCheckError,
} from './populated-upgrade-images'
import { isEntryPoint } from './entry-point'

export async function checkPopulatedUpgradeImages(): Promise<void> {
  const previous = process.env.POPULATED_UPGRADE_PREVIOUS_IMAGE
  const candidate = process.env.POPULATED_UPGRADE_NEW_IMAGE
  if (!previous || !candidate)
    throw new Error('Both upgrade image references are required')
  const maintenance = await acquireTestLease(testEnvironment().DATABASE_URL)
  const name = `test_upgrade_images_${randomUUID().replaceAll('-', '')}`
  try {
    await maintenance.pool.query(`CREATE DATABASE "${name}"`)
    const url = new URL(testEnvironment().DATABASE_URL)
    url.pathname = `/${name}`
    const lease = await acquireTestLease(url.toString())
    try {
      restorePopulatedUpgradeFixture(url.toString())
      const before = await upgradeCustomerRows(lease.pool)
      migrateUpgradeImage(previous, url.toString())
      assert.deepEqual(await upgradeCustomerRows(lease.pool), before)
      await bootUpgradeImage(previous, url.toString())
      assert.deepEqual(await upgradeCustomerRows(lease.pool), before)
      migrateUpgradeImage(candidate, url.toString())
      assert.deepEqual(await upgradeCustomerRows(lease.pool), before)
      const journal = async () =>
        (
          await lease.pool.query(
            'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at',
          )
        ).rows
      const applied = await journal()
      migrateUpgradeImage(candidate, url.toString())
      assert.deepEqual(await journal(), applied)
      assert.deepEqual(await upgradeCustomerRows(lease.pool), before)
      await bootUpgradeImage(candidate, url.toString())
      assert.deepEqual(await upgradeCustomerRows(lease.pool), before)
      const lastContract = Number(
        (
          await lease.pool.query(
            'SELECT max(created_at) AS value FROM drizzle.__drizzle_migrations WHERE is_contract',
          )
        ).rows[0].value ?? 0,
      )
      const previousWhen = upgradeImageJournal(previous).entries.at(-1)!.when
      await bootUpgradeImage(previous, url.toString(), lastContract <= previousWhen)
      assert.deepEqual(await upgradeCustomerRows(lease.pool), before)
      console.log('Populated upgrade image checks passed')
    } finally {
      await lease.release()
      await maintenance.pool.query(`DROP DATABASE "${name}"`)
    }
  } finally {
    await maintenance.release()
  }
}

if (isEntryPoint(import.meta.url)) {
  checkPopulatedUpgradeImages().catch((error: unknown) => {
    console.error(
      error instanceof UpgradeImageCheckError
        ? error.message
        : 'Populated upgrade image checks failed during fixture setup or data preservation',
    )
    process.exitCode = 1
  })
}
