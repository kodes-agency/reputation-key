// Organization, Property and Portal rows for an integration suite's tenant.
//
// Runs through whichever executor the suite holds (a pg Pool, or a Drizzle
// database via drizzleSeedRunner), so two tenants can be seeded side by side.

import { insertOrganization } from '#/shared/db/testing/tenant-seed'
import type { SeedQueryRunner } from './google-connection-seed'

export type TenantSeed = Readonly<{
  organizationId: string
  organizationName: string
  propertyId: string
  propertyName: string
  propertySlug: string
  portalId: string
  portalName: string
  portalSlug: string
}>

/** Idempotent: rows that already exist are left as they are. */
export async function seedTenant(
  runner: SeedQueryRunner,
  seed: TenantSeed,
): Promise<void> {
  await insertOrganization(runner, {
    id: seed.organizationId,
    name: seed.organizationName,
    slug: seed.organizationId,
  })
  await runner.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, $3, $4, 'UTC')
     ON CONFLICT (id) DO NOTHING`,
    [seed.propertyId, seed.organizationId, seed.propertyName, seed.propertySlug],
  )
  await runner.query(
    `INSERT INTO portals (
       id, organization_id, property_id, entity_type, entity_id, name, slug,
       publication_state
     ) VALUES ($1, $2, $3, 'property', $4, $5, $6, 'published')
     ON CONFLICT (id) DO NOTHING`,
    [
      seed.portalId,
      seed.organizationId,
      seed.propertyId,
      seed.propertyId,
      seed.portalName,
      seed.portalSlug,
    ],
  )
}
