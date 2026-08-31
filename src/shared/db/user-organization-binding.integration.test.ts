import { describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId } from '#/shared/domain/ids'
import type { Database } from './index'
import {
  authorizeUserOrganizationBinding,
  readUserOrganizationBinding,
} from './user-organization-binding'

const ORG_A = organizationId('b7500000-0000-4000-8000-000000000001')
const ORG_B = organizationId('b7500000-0000-4000-8000-000000000002')
const USER_ID = 'binding-evidence-user'

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: ['user_organization_bindings'],
})

const database = () => drizzle(getPool()) as unknown as Database

async function seedActiveBinding(): Promise<void> {
  await getPool().query(
    `INSERT INTO user_organization_bindings
       (user_id, organization_id, state, source, version)
     VALUES ($1, $2, 'active', 'operator', 4)`,
    [USER_ID, ORG_A],
  )
}

describe('database-backed user Organization binding', () => {
  it('reads the application-owned binding state', async () => {
    await seedActiveBinding()

    await expect(readUserOrganizationBinding(database(), USER_ID)).resolves.toEqual({
      userId: USER_ID,
      organizationId: ORG_A,
      state: 'active',
      version: 4,
    })
  })

  it('authorizes only the Organization named by the active binding', async () => {
    await seedActiveBinding()

    await expect(
      authorizeUserOrganizationBinding(database(), USER_ID, ORG_A),
    ).resolves.toEqual({ kind: 'allow', version: 4 })
    await expect(
      authorizeUserOrganizationBinding(database(), USER_ID, ORG_B),
    ).resolves.toEqual({
      kind: 'deny',
      reason: 'organization_binding_mismatch',
    })
  })

  it('fails closed when no binding exists', async () => {
    await expect(
      authorizeUserOrganizationBinding(database(), 'missing-user', ORG_A),
    ).resolves.toEqual({
      kind: 'deny',
      reason: 'organization_binding_missing',
    })
  })
})
