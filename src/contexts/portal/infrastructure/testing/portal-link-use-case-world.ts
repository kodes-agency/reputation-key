// Test-only world for the link and Linktree use-case integration suites: tenants
// with a Property and a Portal, links with their texts and a use-case wiring
// over the real repositories and the real command store.

import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { getDb } from '#/shared/db'
import {
  organizationId as brandOrganizationId,
  portalId as brandPortalId,
  portalLinkCategoryId as brandCategoryId,
  portalLinkId as brandLinkId,
  propertyId as brandPropertyId,
  userId as brandUserId,
  type OrganizationId,
  type PortalId,
  type PortalLinkCategoryId,
  type PortalLinkId,
  type PropertyId,
  type UserId,
} from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { Portal } from '../../domain/types'
import { portalCreated } from '../../domain/events'
import type { PortalCommandStore } from '../../publication/portal-command-store-port.server'
import { createPortalRepository } from '../repositories/portal.repository'
import { createPortalLinkRepository } from '../repositories/portal-link.repository'
import { createPortalMediaAssetRepository } from '../repositories/portal-media-asset.repository'
import { createPortalApprovedDestinationRepository } from '../repositories/portal-approved-destination.repository'
import { createPortalExperienceRepository } from '../repositories/portal-experience.repository'

/** Tables the link suites write, in an order that clears children first. */
export const LINK_WORLD_TABLES = [
  'portal_pending_content_changes',
  'portal_publication_snapshots',
  'portal_link_texts',
  'portal_localized_overrides',
  'portal_links',
  'portal_link_categories',
  'portal_approved_destinations',
  'portal_media_assets',
  'portal_responsible_managers',
  'outbox_events',
  'portal_page_edits',
  'portals',
  'properties',
]

/** The instant every Portal of a world is created at. */
export const LINK_WORLD_CREATED_AT = new Date('2026-10-01T10:00:00.000Z')

export type LinkTenant = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  categoryId: PortalLinkCategoryId
  manager: UserId
}>

/** `prefix` is eight hex digits no other suite uses; it names every id of the tenant. */
export function linkTenant(prefix: string, organization: string): LinkTenant {
  const uuid = (tail: string) => `${prefix}-0000-4000-8000-${tail}`
  return {
    organizationId: brandOrganizationId(organization),
    propertyId: brandPropertyId(uuid('00000000000a')),
    portalId: brandPortalId(uuid('00000000000b')),
    categoryId: brandCategoryId(uuid('00000000000c')),
    manager: brandUserId(`manager-${prefix}`),
  }
}

/**
 * What a suite hands the world, since a helper outside a test file may not
 * import another context or the shared fixtures: the real command store, and
 * the Portal and caller builders. Each test file binds them once, at its top.
 */
export type LinkWorldBindings = Readonly<{
  commandStore: () => PortalCommandStore
  buildPortal: (overrides: Partial<Portal>) => Portal
  buildAuthContext: (overrides: Partial<AuthContext>) => AuthContext
}>

let bindings: LinkWorldBindings | undefined

export function bindLinkWorld(next: LinkWorldBindings): void {
  bindings = next
}

const bound = (): LinkWorldBindings => {
  if (!bindings) throw new Error('bindLinkWorld must be called before the world is used')
  return bindings
}

export const linkCommandStore = (): PortalCommandStore => bound().commandStore()

export const staffWithAccessTo = (
  accessible: ReadonlyArray<PropertyId> | null,
): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

export const tenantContext = (
  tenant: LinkTenant,
  role: AuthContext['role'] = 'PropertyManager',
  overrides: Partial<AuthContext> = {},
): AuthContext =>
  bound().buildAuthContext({
    organizationId: tenant.organizationId,
    userId: role === 'AccountAdmin' ? brandUserId('admin-link-world') : tenant.manager,
    role,
    ...overrides,
  })

/** The Property and the Portal of a tenant, created through the command store. */
export async function seedLinkTenant(
  pool: Pool,
  tenant: LinkTenant,
  options: Readonly<{
    additionalGuestLocales?: ReadonlyArray<GuestLocale>
    primaryGuestLocale?: GuestLocale
    withCategory?: boolean
  }> = {},
): Promise<void> {
  const portal = bound().buildPortal({
    id: tenant.portalId,
    organizationId: tenant.organizationId,
    propertyId: tenant.propertyId,
    entityId: tenant.propertyId,
    name: 'Reception',
    slug: `reception-${tenant.portalId.slice(0, 8)}`,
    createdBy: tenant.manager,
    primaryGuestLocale: options.primaryGuestLocale ?? 'en',
    additionalGuestLocales: [...(options.additionalGuestLocales ?? [])],
    createdAt: LINK_WORLD_CREATED_AT,
    updatedAt: LINK_WORLD_CREATED_AT,
  })
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Harbour House', $4, 'UTC', $3, $3)`,
    [
      tenant.propertyId,
      tenant.organizationId,
      LINK_WORLD_CREATED_AT,
      `harbour-${tenant.propertyId.slice(0, 8)}`,
    ],
  )
  await linkCommandStore().createPortal({
    organizationId: tenant.organizationId,
    portal,
    initialResponsibleManagerIds: [tenant.manager],
    event: portalCreated({
      portalId: portal.id,
      organizationId: tenant.organizationId,
      propertyId: tenant.propertyId,
      publicationState: portal.publicationState,
      sourceAggregateVersion: portal.updatedAt.toISOString(),
      occurredAt: portal.createdAt,
    }),
  })
  if (options.withCategory ?? true) await seedCategory(pool, tenant)
}

export async function seedCategory(
  pool: Pool,
  tenant: LinkTenant,
  id: PortalLinkCategoryId = tenant.categoryId,
  sortKey = 'a0',
): Promise<PortalLinkCategoryId> {
  await pool.query(
    `INSERT INTO portal_link_categories (id, portal_id, organization_id, title, sort_key,
                                         created_at, updated_at)
     VALUES ($1, $2, $3, 'Links', $4, $5, $5)`,
    [id, tenant.portalId, tenant.organizationId, sortKey, LINK_WORLD_CREATED_AT],
  )
  return id
}

export type SeededLink = Readonly<{ id: PortalLinkId; url: string }>

/**
 * A link as stored today: the legacy label column empty and its name a
 * primary-language text row. The Portal revision is left where it was.
 */
export async function seedLink(
  pool: Pool,
  tenant: LinkTenant,
  options: Readonly<{
    sortKey?: string
    url?: string
    iconKey?: string | null
    imageAssetId?: string | null
    categoryId?: PortalLinkCategoryId
    portalId?: PortalId
    /** The name, written as a text row; null seeds a link that has no text at all. */
    text?: Readonly<{ locale: GuestLocale; label: string; line?: string | null }> | null
    /** The legacy label column, for a link written before texts existed. */
    legacyLabel?: string
  }> = {},
): Promise<SeededLink> {
  const id = brandLinkId(randomUUID())
  const url = options.url ?? `https://example.test/${id}`
  await pool.query(
    `INSERT INTO portal_links (id, category_id, portal_id, organization_id, property_id,
                               label, url, legacy_destination_state, sort_key, icon_key,
                               image_asset_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'unclassified', $8, $9, $10, $11, $11)`,
    [
      id,
      options.categoryId ?? tenant.categoryId,
      options.portalId ?? tenant.portalId,
      tenant.organizationId,
      tenant.propertyId,
      options.legacyLabel ?? '',
      url,
      options.sortKey ?? 'a0',
      options.iconKey ?? null,
      options.imageAssetId ?? null,
      LINK_WORLD_CREATED_AT,
    ],
  )
  const text =
    options.text === undefined ? { locale: 'en' as const, label: 'Link' } : options.text
  if (text !== null) await seedLinkText(pool, tenant, id, text)
  return { id, url }
}

export async function seedLinkText(
  pool: Pool,
  tenant: LinkTenant,
  linkId: string,
  text: Readonly<{ locale: GuestLocale; label: string; line?: string | null }>,
): Promise<void> {
  await pool.query(
    `INSERT INTO portal_link_texts (organization_id, property_id, portal_id, link_id, locale,
                                    label, line, provenance, version, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, 1, $8)`,
    [
      tenant.organizationId,
      tenant.propertyId,
      tenant.portalId,
      linkId,
      text.locale,
      text.label,
      text.line ?? null,
      tenant.manager,
    ],
  )
}

/** The dependencies every link use case takes, over real repositories and the real store. */
export function realLinkDeps(
  options: Readonly<{
    accessible?: ReadonlyArray<PropertyId> | null
    clock?: () => Date
    wrapStore?: (store: PortalCommandStore) => PortalCommandStore
    networkChecks?: string[]
  }> = {},
) {
  const db = getDb()
  const networkChecks = options.networkChecks ?? []
  let ticks = 0
  return {
    portalRepo: createPortalRepository(db),
    portalLinkRepo: createPortalLinkRepository(db),
    mediaRepo: createPortalMediaAssetRepository(db),
    destinationRepo: createPortalApprovedDestinationRepository(db),
    experienceRepo: createPortalExperienceRepository(db),
    staffPublicApi: staffWithAccessTo(options.accessible ?? null),
    commandStore: (options.wrapStore ?? ((store) => store))(linkCommandStore()),
    destinationNetworkValidator: {
      validate: async (uri: string) => {
        networkChecks.push(uri)
        return {
          outcome: 'safe' as const,
          validatedAt: LINK_WORLD_CREATED_AT,
          finalUri: uri,
          redirectCount: 0,
        }
      },
    },
    idGen: () => randomUUID(),
    // Each call sees a later instant, as real time does.
    clock:
      options.clock ??
      (() => new Date(LINK_WORLD_CREATED_AT.getTime() + 60_000 + (ticks += 1) * 1000)),
  }
}

export const rowsOf = async <Row extends Record<string, unknown>>(
  pool: Pool,
  text: string,
  values: ReadonlyArray<unknown>,
): Promise<Row[]> => (await pool.query<Row>(text, [...values])).rows

export const countRows = async (
  pool: Pool,
  table: string,
  organization: string,
): Promise<number> =>
  Number(
    (
      await pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM ${table} WHERE organization_id = $1`,
        [organization],
      )
    ).rows[0]?.n,
  )

export const outboxPayloads = async (
  pool: Pool,
  organization: string,
  eventType: string,
): Promise<Record<string, unknown>[]> =>
  (
    await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM outbox_events
        WHERE organization_id = $1 AND event_type = $2 ORDER BY created_at, id`,
      [organization, eventType],
    )
  ).rows.map((row) => row.payload)

export const portalUpdatedAt = async (pool: Pool, tenant: LinkTenant): Promise<Date> =>
  (
    await pool.query<{ updated_at: Date }>(
      `SELECT updated_at FROM portals WHERE organization_id = $1 AND id = $2`,
      [tenant.organizationId, tenant.portalId],
    )
  ).rows[0]!.updated_at
