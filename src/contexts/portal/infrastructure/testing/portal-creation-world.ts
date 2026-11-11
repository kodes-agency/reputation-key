// Test-only: the create-Portal use cases wired over the real repositories and the
// real command store, with the other contexts' facts (who may manage a Property,
// who the managers are, the Google destination) as small stand-ins and the
// Property itself read from its table. Not imported by production code.

import type { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { getDb } from '#/shared/db'
import type {
  IdentityManagerFactsPublicApi,
  StaffPublicApi,
} from '#/contexts/identity/application/public-api'
import type { PropertyPublicApi } from '#/contexts/property/application/public-api'
import type { PortalRatingGoalReadApi } from '#/contexts/reporting/application/public-api'
import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import { portalId as toPortalId } from '#/shared/domain/ids'
import { PORTAL_DESTINATION_VALIDATION_VERSION } from '../../domain/approved-destination'
import type { CreatePersonalPortalDeps } from '../../application/use-cases/create-personal-portal'
import { createAtomicPortalCommandStore } from '../../publication/portal-command-store.server'
import { issueToken } from '../../domain/portal-token'
import { seedPortalToken } from './portal-read-fixtures'
import { createPortalApprovedDestinationRepository } from '../repositories/portal-approved-destination.repository'
import { createPortalExperienceRepository } from '../repositories/portal-experience.repository'
import { createPortalGroupRepository } from '../repositories/portal-group.repository'
import { createPortalLastPrintRepository } from '../repositories/portal-last-print.repository'
import { createPortalLinkRepository } from '../repositories/portal-link.repository'
import { createPortalLookRepository } from '../repositories/portal-look.repository'
import { createPortalPrintWordingRepository } from '../repositories/portal-print-wording.repository'
import { createPortalPublicationRepository } from '../repositories/portal-publication.repository'
import { createPortalRepository } from '../repositories/portal.repository'
import { createPortalResponsibleManagerRepository } from '../repositories/portal-responsible-manager.repository'

/** Every table the creation and personal-page use cases write, children first. */
export const PORTAL_CREATION_TABLES = [
  'portal_tokens',
  'portal_page_edits',
  'portal_pending_content_changes',
  'portal_print_wordings',
  'portal_last_prints',
  'portal_look_overrides',
  'portal_publication_activations',
  'portal_publication_snapshots',
  'portal_localized_overrides',
  'property_portal_brand_contents',
  'property_portal_brand_profiles',
  'portal_link_texts',
  'portal_links',
  'portal_media_assets',
  'portal_approved_destinations',
  'portal_link_categories',
  'portal_health_intervals',
  'portal_group_history',
  'portal_group_memberships',
  'portal_groups',
  'portal_responsible_managers',
  'outbox_events',
  'portals',
  'properties',
]

export type CreationManager = Readonly<{
  userId: string
  role: 'AccountAdmin' | 'PropertyManager'
}>

export type CreationWorldOptions = Readonly<{
  pool: Pool
  /** Eight hex digits that start every Portal id the world hands out. */
  idPrefix: string
  clock: Date
  /** The Properties the signed-in manager may use; null is Organization-wide. */
  accessible: ReadonlyArray<PropertyId> | null
  managers: readonly CreationManager[]
  ratingGoalGuard: Pick<PortalRatingGoalReadApi, 'findPortalRatingGoalBlockInTransaction'>
}>

/** A Property that exists only when its row is in the Organization asked about. */
const propertyApiOver = (pool: Pool): PropertyPublicApi => ({
  propertyExists: async (orgId, id) =>
    (
      await pool.query(
        `SELECT 1 FROM properties WHERE organization_id = $1 AND id::text = $2`,
        [orgId, id],
      )
    ).rowCount === 1,
  getPropertyName: async () => null,
  getPropertyTimezones: async (orgId, ids) =>
    (
      await pool.query(
        `SELECT id::text AS id, timezone FROM properties
         WHERE organization_id = $1 AND id::text = ANY($2)`,
        [orgId, ids],
      )
    ).rows,
  getPropertyNames: async () => [],
  listByGbpLocationId: async () => [],
  getSourceEpoch: async () => ({ sourceEpoch: 0 }),
  findIdsByGoogleConnection: async () => [],
  findGoogleNotificationAnchor: async () => null,
})

const VERIFIED_DESTINATION = {
  state: 'verified' as const,
  uri: 'https://search.google.com/local/writereview?placeid=harbor',
  retrievedAt: new Date('2026-08-26T10:00:00.000Z'),
  sourceEpoch: 1,
  profileVersion: 1,
}

/**
 * The dependencies of every create use case over the real repositories. The
 * Portal ids are `<idPrefix>-0000-4000-8000-<counter>`, so a test can name the
 * address an id-based Portal gets.
 */
export function createPortalCreationDeps(options: CreationWorldOptions) {
  const db = getDb()
  let portalCounter = 0
  const staffPublicApi: StaffPublicApi = {
    getAccessiblePropertyIds: async () => options.accessible,
    getAssignedPortals: async () => [],
  }
  const identityPublicApi: IdentityManagerFactsPublicApi = {
    listActiveManagers: async () =>
      options.managers.map((manager) => ({
        ...manager,
        propertyAccessScope:
          manager.role === 'AccountAdmin'
            ? ('organization' as const)
            : ('assigned-properties' as const),
      })),
  }
  const deps = {
    portalRepo: createPortalRepository(db),
    portalGroupRepo: createPortalGroupRepository(db),
    portalLinkRepo: createPortalLinkRepository(db),
    destinationRepo: createPortalApprovedDestinationRepository(db),
    experienceRepo: createPortalExperienceRepository(db),
    propertyApi: propertyApiOver(options.pool),
    portalLookRepo: createPortalLookRepository(db),
    staffPublicApi,
    identityPublicApi,
    commandStore: createAtomicPortalCommandStore(db, options.ratingGoalGuard),
    idGen: (): PortalId =>
      toPortalId(
        `${options.idPrefix}-0000-4000-8000-${String(++portalCounter).padStart(12, '0')}`,
      ),
    entityIdGen: () => randomUUID(),
    clock: () => options.clock,
  } satisfies Parameters<
    typeof import('../../application/use-cases/create-portal').createPortal
  >[0]
  return { deps, db }
}

/** What the personal-page use cases add: the publication, the print words and the gates. */
export function createPersonalPortalDeps(
  options: CreationWorldOptions,
): CreatePersonalPortalDeps {
  const { deps, db } = createPortalCreationDeps(options)
  return {
    ...deps,
    propertyLifecycleApi: { isPropertyActive: async () => true },
    propertyGoogleReviewDestinationApi: {
      getGoogleReviewDestination: async () => VERIFIED_DESTINATION,
    },
    publicationRepo: createPortalPublicationRepository(db),
    managerRepo: createPortalResponsibleManagerRepository(db),
    printWordingRepo: createPortalPrintWordingRepository(db),
    lastPrintRepo: createPortalLastPrintRepository(db),
    addressRecoverable: true,
    checkGroupTarget: async () => {},
  }
}

export const VERIFIED_GOOGLE_DESTINATION = VERIFIED_DESTINATION

const SEEDED_AT = new Date('2026-08-26T10:00:00.000Z')

export async function seedCreationProperty(
  pool: Pool,
  input: Readonly<{
    organizationId: OrganizationId
    propertyId: string
    timezone?: string
    /** A Brand Profile; absent, the Property has none. */
    brand?: Readonly<{
      displayName: string
      defaultGuestLocales: readonly string[]
      lookVersion?: number
      wording?: ReadonlyArray<
        Readonly<{ locale: string; title: string; shortDescription: string }>
      >
    }>
  }>,
): Promise<void> {
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Harbor Hotel', $3, $4, $5, $5)`,
    [
      input.propertyId,
      input.organizationId,
      `creation-${input.propertyId}`,
      input.timezone ?? 'Europe/Sofia',
      SEEDED_AT,
    ],
  )
  if (!input.brand) return
  const { brand } = input
  await pool.query(
    `INSERT INTO property_portal_brand_profiles
       (id, organization_id, property_id, display_name, default_guest_locales,
        look_version, primary_color, background_color, text_color, version,
        updated_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, '#1D4ED8', '#101820', '#111827', 1,
             'seed-manager', $7, $7)`,
    [
      randomUUID(),
      input.organizationId,
      input.propertyId,
      brand.displayName,
      JSON.stringify(brand.defaultGuestLocales),
      brand.lookVersion ?? 1,
      SEEDED_AT,
    ],
  )
  for (const content of brand.wording ?? []) {
    await pool.query(
      `INSERT INTO property_portal_brand_contents
         (id, organization_id, property_id, locale, title, short_description,
          version, updated_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 1, 'seed-manager', $7, $7)`,
      [
        randomUUID(),
        input.organizationId,
        input.propertyId,
        content.locale,
        content.title,
        content.shortDescription,
        SEEDED_AT,
      ],
    )
  }
}

export async function seedCreationGroup(
  pool: Pool,
  input: Readonly<{
    organizationId: OrganizationId
    propertyId: string
    groupId: string
    name?: string
    updatedAt?: Date
    deletedAt?: Date | null
  }>,
): Promise<void> {
  await pool.query(
    `INSERT INTO portal_groups
       (id, organization_id, property_id, name, created_at, updated_at, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.groupId,
      input.organizationId,
      input.propertyId,
      input.name ?? 'Pool side',
      SEEDED_AT,
      input.updatedAt ?? SEEDED_AT,
      input.deletedAt ?? null,
    ],
  )
}

export async function seedCreationPortal(
  pool: Pool,
  input: Readonly<{
    organizationId: OrganizationId
    propertyId: string
    portalId: string
    slug: string
    name?: string
    kind?: 'place' | 'personal'
    publicName?: string | null
    publicationState?: 'draft' | 'published' | 'disabled' | 'archived'
    primaryGuestLocale?: string
    additionalGuestLocales?: readonly string[]
    description?: string | null
    skipPrivateRating?: boolean
    responsibilityNeededSince?: Date | null
  }>,
): Promise<void> {
  await pool.query(
    `INSERT INTO portals
       (id, organization_id, property_id, entity_type, entity_id, name, slug,
        description, theme, private_feedback_threshold, publication_state,
        primary_guest_locale, additional_guest_locales, linktree_enabled,
        kind, public_name, skip_private_rating, responsibility_needed_since,
        created_at, updated_at)
     VALUES ($1, $2, $3::uuid, 'property', $3::text, $4, $5, $6,
             '{"primaryColor":"#123456"}'::jsonb, 4, $7, $8, $9::jsonb, true,
             $10, $11, $12, $13, $14, $14)`,
    [
      input.portalId,
      input.organizationId,
      input.propertyId,
      input.name ?? 'Seeded portal',
      input.slug,
      input.description ?? null,
      input.publicationState ?? 'published',
      input.primaryGuestLocale ?? 'en',
      JSON.stringify(input.additionalGuestLocales ?? []),
      input.kind ?? 'place',
      input.publicName ?? null,
      input.skipPrivateRating ?? false,
      input.responsibilityNeededSince ?? null,
      SEEDED_AT,
    ],
  )
}

export async function seedCreationDestination(
  pool: Pool,
  input: Readonly<{
    organizationId: OrganizationId
    propertyId: string
    destinationId: string
    approvalState: 'pending' | 'approved' | 'disabled' | 'quarantined'
  }>,
): Promise<void> {
  const approved = input.approvalState === 'approved'
  await pool.query(
    `INSERT INTO portal_approved_destinations
       (id, organization_id, property_id, normalized_uri, hostname, source_type,
        approval_state, validation_version, requested_by, approved_by, approved_at,
        last_validated_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'example.com', 'custom', $5, $6, 'seed-manager', $7,
             $8, $9, $9, $9)`,
    [
      input.destinationId,
      input.organizationId,
      input.propertyId,
      `https://example.com/${input.destinationId}`,
      input.approvalState,
      PORTAL_DESTINATION_VALIDATION_VERSION,
      approved ? 'seed-manager' : null,
      approved ? SEEDED_AT : null,
      SEEDED_AT,
    ],
  )
}

export async function seedCreationLink(
  pool: Pool,
  input: Readonly<{
    organizationId: OrganizationId
    propertyId: string
    portalId: string
    categoryId: string
    linkId: string
    destinationId: string
    label: string
    sortKey: string
    texts?: ReadonlyArray<Readonly<{ locale: string; label: string }>>
  }>,
): Promise<void> {
  await pool.query(
    `INSERT INTO portal_links
       (id, category_id, portal_id, organization_id, property_id, label,
        destination_id, url, legacy_destination_state, sort_key, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, 'migrated', $8, $9, $9)`,
    [
      input.linkId,
      input.categoryId,
      input.portalId,
      input.organizationId,
      input.propertyId,
      input.label,
      input.destinationId,
      input.sortKey,
      SEEDED_AT,
    ],
  )
  for (const text of input.texts ?? []) {
    await pool.query(
      `INSERT INTO portal_link_texts
         (id, organization_id, property_id, portal_id, link_id, locale, label,
          version, updated_by, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 1, 'seed-manager', $7, $7)`,
      [
        input.organizationId,
        input.propertyId,
        input.portalId,
        input.linkId,
        text.locale,
        text.label,
        SEEDED_AT,
      ],
    )
  }
}

export async function seedCreationCategory(
  pool: Pool,
  input: Readonly<{
    organizationId: OrganizationId
    portalId: string
    categoryId: string
  }>,
): Promise<void> {
  await pool.query(
    `INSERT INTO portal_link_categories
       (id, portal_id, organization_id, title, sort_key, created_at, updated_at)
     VALUES ($1, $2, $3, 'Around the hotel', 'a0', $4, $4)`,
    [input.categoryId, input.portalId, input.organizationId, SEEDED_AT],
  )
}

export async function seedCreationResponsibleManager(
  pool: Pool,
  input: Readonly<{
    organizationId: OrganizationId
    propertyId: string
    portalId: string
    userId: string
  }>,
): Promise<void> {
  await pool.query(
    `INSERT INTO portal_responsible_managers
       (organization_id, property_id, portal_id, user_id, effective_from, created_by)
     VALUES ($1, $2, $3, $4, $5, $4)`,
    [input.organizationId, input.propertyId, input.portalId, input.userId, SEEDED_AT],
  )
}

/** A live code for the Portal, as the token table keeps it. */
export async function seedCreationToken(
  input: Readonly<{
    organizationId: OrganizationId
    propertyId: string
    portalId: string
    tokenId: string
    identifier: string
  }>,
): Promise<void> {
  await seedPortalToken(
    getDb(),
    issueToken({
      id: input.tokenId,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      portalId: input.portalId,
      tokenIdentifier: input.identifier,
      tokenHash: `hash-${input.identifier}`.padEnd(64, '0'),
      tokenKeyVersion: 1,
      version: 1,
      now: SEEDED_AT,
    }),
  )
}
