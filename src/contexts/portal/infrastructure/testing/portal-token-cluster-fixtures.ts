// Seeds one Portal, in its own Property, on a real database for the Portal
// address, token and responsible-manager integration suites. Every id is
// random, so suites that share a database never meet each other's rows.

import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { portalId, propertyId } from '#/shared/domain/ids'

export type SeedClusterPortalOptions = Readonly<{
  kind?: 'place' | 'personal'
  publicName?: string
  createdBy?: string
  publicationState?: 'draft' | 'published' | 'disabled' | 'archived'
  updatedAt: Date
}>

export async function seedClusterPortal(
  pool: Pool,
  org: string,
  options: SeedClusterPortalOptions,
) {
  const property = randomUUID()
  const portal = randomUUID()
  const slug = `cluster-${portal.slice(0, 8)}`
  const kind = options.kind ?? 'place'
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Cluster property', $3, 'UTC')`,
    [property, org, slug],
  )
  await pool.query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id,
                          kind, public_name, name, slug, publication_state, theme,
                          created_by, created_at, updated_at)
     VALUES ($1, $2, $3, 'property', $4, $5, $6, 'Cluster portal', $7, $8,
             '{"primaryColor":"#6366F1"}'::jsonb, $9, $10, $10)`,
    [
      portal,
      org,
      property,
      property,
      kind,
      kind === 'personal' ? (options.publicName ?? 'Harbor') : null,
      slug,
      options.publicationState ?? 'published',
      options.createdBy ?? 'manager-cluster',
      options.updatedAt,
    ],
  )
  return { id: portalId(portal), propertyId: propertyId(property), org }
}

export type SeededClusterPortal = Awaited<ReturnType<typeof seedClusterPortal>>
