// Tenant fixtures shared by integration suites that need a Portal to hang rows on.

import type { Pool } from 'pg'

/**
 * One Organization row. `slug` is uniquely indexed and suites share a database,
 * so each caller derives it from the whole id. An existing row is left alone,
 * or has its name and slug replaced when `overwrite` is set.
 */
export async function insertOrganization(
  runner: Readonly<{ query: (text: string, values: unknown[]) => Promise<unknown> }>,
  organization: Readonly<{ id: string; name: string; slug: string; overwrite?: boolean }>,
): Promise<void> {
  const onConflict = organization.overwrite
    ? 'DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug'
    : 'DO NOTHING'
  await runner.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) ${onConflict}`,
    [organization.id, organization.name, organization.slug],
  )
}

/** One tenant's Organization, Property and published Portal. */
export async function seedTenantPortal(
  p: Pool,
  tenant: Readonly<{
    orgId: string
    propId: string
    portalId: string
    label: string
    slug: string
  }>,
) {
  await insertOrganization(p, {
    id: tenant.orgId,
    name: `${tenant.label} Org`,
    slug: `${tenant.slug}-org`,
    overwrite: true,
  })
  await p.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       organization_id = EXCLUDED.organization_id,
       name = EXCLUDED.name,
       slug = EXCLUDED.slug,
       timezone = EXCLUDED.timezone,
       updated_at = EXCLUDED.updated_at`,
    [
      tenant.propId,
      tenant.orgId,
      `${tenant.label} Property`,
      `${tenant.slug}-prop`,
      'UTC',
    ],
  )
  await p.query(
    `INSERT INTO portals (
       id, organization_id, property_id, entity_type, entity_id, name, slug,
       publication_state, created_at, updated_at
     ) VALUES ($1, $2, $3, 'property', $4, $5, $6, 'published', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [
      tenant.portalId,
      tenant.orgId,
      tenant.propId,
      tenant.propId,
      `${tenant.label} Portal`,
      `${tenant.slug}-portal`,
    ],
  )
}
