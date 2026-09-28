// Refused addresses survive a change of the key they were stored under (real
// PostgreSQL).
//
// Durable suppression used to be keyed with BETTER_AUTH_SECRET, the secret an
// account-compromise incident rotates. Rotating it made every stored digest
// unmatchable, so mail went back to addresses that had bounced or complained.
// A dedicated key now takes over; entries stored under the auth secret keep
// matching while it is adopted, and move to the dedicated key the first time
// they match, so a later auth-secret rotation no longer reaches them.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createNotificationEmailRepository } from './notification-email.repository'

const ADDRESS = 'suppression-keys-test@example.com'
const AT = new Date('2026-09-25T08:00:00.000Z')
const AUTH_SECRET = 'notification-suppression-keys-auth-secret-0001'
const ROTATED_AUTH_SECRET = 'notification-suppression-keys-auth-secret-0002'
const DEDICATED_KEY = 'notification-suppression-keys-dedicated-0001'

describe.sequential('email suppression across key changes (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database

  const store = (emailAddressKey: string, retiredEmailAddressKeys: string[] = []) =>
    createNotificationEmailRepository(db, { emailAddressKey, retiredEmailAddressKeys })

  const forgetEverywhere = () =>
    store(DEDICATED_KEY, [AUTH_SECRET, ROTATED_AUTH_SECRET]).forgetAddress(ADDRESS)

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
  })

  beforeEach(forgetEverywhere)

  afterAll(async () => {
    if (db) await forgetEverywhere()
    await lease?.release()
  })

  it('still refuses an address stored under the auth secret once the dedicated key is adopted', async () => {
    await store(AUTH_SECRET).suppressAddress(ADDRESS, 'bounced', AT)

    await expect(
      store(DEDICATED_KEY, [AUTH_SECRET]).isAddressSuppressed(ADDRESS),
    ).resolves.toBe(true)
  })

  it('keeps refusing it after the auth secret rotates', async () => {
    await store(AUTH_SECRET).suppressAddress(ADDRESS, 'complained', AT)
    await store(DEDICATED_KEY, [AUTH_SECRET]).isAddressSuppressed(ADDRESS)

    await expect(
      store(DEDICATED_KEY, [ROTATED_AUTH_SECRET]).isAddressSuppressed(ADDRESS),
    ).resolves.toBe(true)
  })

  it('forgets an address under every key it may be stored under', async () => {
    await store(AUTH_SECRET).suppressAddress(ADDRESS, 'bounced', AT)
    await store(DEDICATED_KEY).suppressAddress(ADDRESS, 'bounced', AT)

    await store(DEDICATED_KEY, [AUTH_SECRET]).forgetAddress(ADDRESS)

    await expect(store(AUTH_SECRET).isAddressSuppressed(ADDRESS)).resolves.toBe(false)
    await expect(store(DEDICATED_KEY).isAddressSuppressed(ADDRESS)).resolves.toBe(false)
  })
})
