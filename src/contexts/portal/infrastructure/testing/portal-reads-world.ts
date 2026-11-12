// Test-only world for the Portal read use-case suites on real PostgreSQL: two
// organizations with their own Properties and Portals under fresh identifiers,
// so a suite never shares a row with another file in the same database.
// Not imported by production code.

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { properties } from '#/shared/db/schema/property.schema'
import {
  organizationId,
  portalId,
  propertyId,
  userId,
  type OrganizationId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Portal } from '../../domain/types'
import type { PortalMediaAsset } from '../../domain/portal-media-asset'
import type { PortalApprovedDestination } from '../../domain/approved-destination'
import { createPortalRepository } from '../repositories/portal.repository'
import { createPortalMediaAssetRepository } from '../repositories/portal-media-asset.repository'
import { createPostgresPortalFixtureStore } from './postgres-portal-fixture-store'

export type PortalReadsWorld = ReturnType<typeof createPortalReadsWorld>

export function createPortalReadsWorld(prefix: string) {
  const orgA: OrganizationId = organizationId(`org-${prefix}-${randomUUID()}`)
  const orgB: OrganizationId = organizationId(`org-${prefix}-${randomUUID()}`)
  const propertyA: PropertyId = propertyId(randomUUID())
  const propertyB: PropertyId = propertyId(randomUUID())
  const propertyOfB: PropertyId = propertyId(randomUUID())
  const propertyOwner = new Map<string, OrganizationId>([
    [propertyA, orgA],
    [propertyB, orgA],
    [propertyOfB, orgB],
  ])

  const authContext = (
    owner: OrganizationId,
    overrides: Partial<AuthContext>,
  ): AuthContext => ({
    userId: userId(`user-${randomUUID()}`),
    organizationId: owner,
    role: 'PropertyManager',
    ...overrides,
  })
  const ctx = (overrides: Partial<AuthContext> = {}): AuthContext =>
    authContext(orgA, overrides)
  const ctxB = (overrides: Partial<AuthContext> = {}): AuthContext =>
    authContext(orgB, overrides)

  /** A Portal of organization A's first Property unless the overrides place it elsewhere. */
  const portal = (
    overrides: Partial<Omit<Portal, 'id'>> & { id?: string } = {},
  ): Portal => {
    const { id: givenId, ...rest } = overrides
    const id = givenId ?? randomUUID()
    const property = rest.propertyId ?? propertyA
    const createdAt = new Date('2026-04-10T12:00:00Z')
    return {
      id: portalId(id),
      organizationId: propertyOwner.get(property) ?? orgA,
      propertyId: property,
      kind: 'place',
      publicName: null,
      entityType: 'property',
      entityId: property,
      name: 'Test Portal',
      slug: `portal-${id.slice(0, 8)}`,
      description: null,
      heroImageUrl: null,
      theme: { primaryColor: '#6366F1' },
      privateFeedbackThreshold: 3,
      skipPrivateRating: false,
      publicationState: 'published',
      createdBy: userId(`user-${randomUUID()}`),
      responsibleManagerRevision: 1,
      responsibilityNeededSince: null,
      primaryGuestLocale: 'en',
      additionalGuestLocales: [],
      linktreeEnabled: true,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
      ...rest,
    }
  }

  const ensureProperty = async (
    owner: OrganizationId,
    property: PropertyId,
  ): Promise<void> => {
    await getDb()
      .insert(properties)
      .values({
        id: property,
        organizationId: owner,
        name: 'Reads property',
        slug: `reads-${property.slice(0, 8)}`,
        timezone: 'UTC',
      })
      .onConflictDoNothing()
  }

  /** Writes the Portals (and the Properties they sit under) as stored rows. */
  const seed = async (portals: ReadonlyArray<Portal>): Promise<void> => {
    const store = createPostgresPortalFixtureStore(getDb())
    for (const item of portals) {
      await ensureProperty(item.organizationId, item.propertyId)
      await store.insert(item.organizationId, item)
    }
  }

  /** Writes stored images through the real repository, under their Properties. */
  const seedMedia = async (assets: ReadonlyArray<PortalMediaAsset>): Promise<void> => {
    const repo = createPortalMediaAssetRepository(getDb())
    for (const asset of assets) {
      await ensureProperty(asset.organizationId, asset.propertyId)
      await repo.insert(asset)
    }
  }

  const SEEDED_AT = new Date('2026-10-01T10:00:00Z')

  /** A link category of the Portal, as stored. */
  const seedCategory = async (
    owner: Portal,
    id: string = randomUUID(),
    sortKey = 'a0',
  ): Promise<string> => {
    await getDb().execute(sql`
      INSERT INTO portal_link_categories
        (id, portal_id, organization_id, title, sort_key, created_at, updated_at)
      VALUES (${id}, ${owner.id}, ${owner.organizationId}, 'Links', ${sortKey},
              ${SEEDED_AT}, ${SEEDED_AT})`)
    return id
  }

  /** An approved or pending destination of the Property, as stored. */
  const seedDestination = async (
    destination: PortalApprovedDestination,
  ): Promise<void> => {
    await ensureProperty(destination.organizationId, destination.propertyId)
    await getDb().execute(sql`
      INSERT INTO portal_approved_destinations
        (id, organization_id, property_id, normalized_uri, hostname, source_type,
         approval_state, validation_version, requested_by, approved_by,
         approved_at, last_validated_at, created_at, updated_at)
      VALUES (${destination.id}, ${destination.organizationId},
              ${destination.propertyId}, ${destination.normalizedUri},
              ${destination.hostname}, ${destination.sourceType},
              ${destination.approvalState}, ${destination.validationVersion},
              ${destination.requestedBy}, ${destination.approvedBy},
              ${destination.approvedAt}, ${destination.lastValidatedAt},
              ${destination.createdAt}, ${destination.updatedAt})`)
  }

  /** A link of the Portal with its per-language texts, as stored. */
  const seedLink = async (
    owner: Portal,
    link: Readonly<{
      id?: string
      categoryId: string
      label: string
      sortKey?: string
      destinationId?: string
      texts?: ReadonlyArray<
        Readonly<{ locale: string; label: string; line?: string | null }>
      >
    }>,
  ): Promise<string> => {
    const id = link.id ?? randomUUID()
    const destinationId = link.destinationId ?? null
    await getDb().execute(sql`
      INSERT INTO portal_links
        (id, category_id, portal_id, organization_id, property_id, label,
         destination_id, url, legacy_destination_state, sort_key, created_at,
         updated_at)
      VALUES (${id}, ${link.categoryId}, ${owner.id}, ${owner.organizationId},
              ${owner.propertyId}, ${link.label}, ${destinationId},
              ${destinationId ? null : 'https://legacy.example/link'},
              ${destinationId ? 'migrated' : 'unclassified'},
              ${link.sortKey ?? 'a0'}, ${SEEDED_AT}, ${SEEDED_AT})`)
    for (const text of link.texts ?? []) {
      await getDb().execute(sql`
        INSERT INTO portal_link_texts
          (id, organization_id, property_id, portal_id, link_id, locale, label,
           line, provenance, version, updated_by, created_at, updated_at)
        VALUES (gen_random_uuid(), ${owner.organizationId}, ${owner.propertyId},
                ${owner.id}, ${id}, ${text.locale}, ${text.label},
                ${text.line ?? null}, NULL, 1, 'reads-manager', ${SEEDED_AT},
                ${SEEDED_AT})`)
    }
    return id
  }

  return {
    orgA,
    orgB,
    propertyA,
    propertyB,
    propertyOfB,
    ctx,
    ctxB,
    portal,
    seed,
    seedMedia,
    seedCategory,
    seedDestination,
    seedLink,
    ensureProperty,
    newPortalId: () => portalId(randomUUID()),
    portalRepo: () => createPortalRepository(getDb()),
  }
}
