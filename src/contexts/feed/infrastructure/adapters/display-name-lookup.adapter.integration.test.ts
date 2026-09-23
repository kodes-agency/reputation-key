import { describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { Database } from '#/shared/db'
import { createDisplayNameLookupAdapter } from './display-name-lookup.adapter'

const ORG_A = organizationId('b7200000-0000-4000-8000-000000000001')
const ORG_B = organizationId('b7200000-0000-4000-8000-000000000002')
const PROPERTY_A = propertyId('b7200000-0000-4000-8000-000000000010')
const UNKNOWN = propertyId('b7200000-0000-4000-8000-000000000099')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: ['properties'],
})

const lookup = () =>
  createDisplayNameLookupAdapter(drizzle(getPool()) as unknown as Database)

describe('createDisplayNameLookupAdapter', () => {
  it("reads the Property's display name inside its Organization", async () => {
    await getPool().query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Riverside Hotel', 'riverside-name-lookup', 'UTC')`,
      [PROPERTY_A, ORG_A],
    )

    await expect(lookup().findPropertyName(ORG_A, PROPERTY_A)).resolves.toBe(
      'Riverside Hotel',
    )
    await expect(lookup().findPropertyName(ORG_B, PROPERTY_A)).resolves.toBeNull()
  })

  it('finds nothing for a Property that does not exist', async () => {
    await expect(lookup().findPropertyName(ORG_A, UNKNOWN)).resolves.toBeNull()
  })

  it("reads the Organization's display name", async () => {
    await getPool().query(
      `UPDATE organization SET name = 'Riverside Group' WHERE id = $1`,
      [ORG_A],
    )

    await expect(lookup().findOrganizationName(ORG_A)).resolves.toBe('Riverside Group')
  })
})
