// The lifecycle state the final deletion warning is checked against, read
// from the Identity-owned authority row (N45).

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { deleteTestOrganizations, seedOrgs } from '#/shared/testing/integration-helpers'
import { createNotificationOrganizationLifecycleStateReader } from './notification-organization-email-stop.repository'

const ORG = `org-lifecycle-state-${randomUUID().slice(0, 8)}`

let lease: TestLease
let readState: (organizationId: string) => Promise<string | null>

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL)
  readState = createNotificationOrganizationLifecycleStateReader(
    drizzle(lease.pool) as Database,
  )
  await seedOrgs(lease.pool, [ORG])
})

afterAll(async () => {
  await deleteTestOrganizations(lease.pool, [ORG])
  await lease.release()
})

describe('the Organization lifecycle state a withdrawn warning is checked against', () => {
  it('reads the state of the authority row', async () => {
    await expect(readState(ORG)).resolves.toBe('active')
  })

  it('reads nothing for an Organization with no lifecycle record', async () => {
    await expect(readState(`org-missing-${randomUUID().slice(0, 8)}`)).resolves.toBeNull()
  })
})
