// Tenant fixtures shared by integration suites that need a Portal to hang rows on.

import type { Pool } from 'pg'

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
  await p.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       slug = EXCLUDED.slug`,
    [tenant.orgId, `${tenant.label} Org`, `${tenant.slug}-org`],
  )
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
