import { createPortalRatingGoalGuard } from '#/contexts/reporting/monthly-goals/portal-rating-goal-guard.server'
import { getDb } from '#/shared/db'
import { freshUuid } from '#/shared/testing/fresh-uuid'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestPortal, buildTestPortalLink } from '#/shared/testing/fixtures'
import {
  organizationId,
  portalId,
  portalLinkCategoryId,
  portalLinkId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import {
  portalCreated,
  portalLinkCreated,
  portalLinkUpdated,
  portalLocaleSetUpdated,
  portalUpdated,
} from '../domain/events'
import { createAtomicPortalCommandStore } from '../publication/portal-command-store.server'

export const ORG_A = organizationId('org-linktree-0000-0000-000000000001')
export const ORG_B = organizationId('org-linktree-0000-0000-000000000002')
export const PROPERTY_A = propertyId('8a000000-0000-4000-8000-000000000001')
export const PORTAL_A = portalId('8b000000-0000-4000-8000-000000000001')
export const CATEGORY_A = portalLinkCategoryId('8c000000-0000-4000-8000-000000000001')
export const MANAGER = userId('manager-linktree-0000000000000001')
export const CREATED_AT = new Date('2026-09-30T10:00:00.000Z')

export const store = () =>
  createAtomicPortalCommandStore(getDb(), createPortalRatingGoalGuard())

let tickCount = 0
export const nextInstant = () => new Date(CREATED_AT.getTime() + (tickCount += 1) * 1000)

export async function portalRevision(): Promise<Date> {
  const { rows } = await getPool().query(
    `SELECT updated_at FROM portals WHERE organization_id = $1 AND id = $2`,
    [ORG_A, PORTAL_A],
  )
  return rows[0].updated_at as Date
}

/** The fields every Portal content command shares, taken fresh from the database. */
export async function base() {
  const revision = nextInstant()
  return {
    organizationId: ORG_A,
    propertyId: PROPERTY_A,
    portalId: PORTAL_A,
    expectedPortalUpdatedAt: await portalRevision(),
    revision,
    occurredAt: revision,
  }
}

/** A link as code that predates the texts table wrote it: no text row. */
export async function seedLegacyLink(label: string, sortKey: string): Promise<string> {
  const id = freshUuid()
  await getPool().query(
    `INSERT INTO portal_links (id, category_id, portal_id, organization_id, property_id,
                               label, url, legacy_destination_state, sort_key,
                               created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $9, 'unclassified', $7, $8, $8)`,
    [
      id,
      CATEGORY_A,
      PORTAL_A,
      ORG_A,
      PROPERTY_A,
      label,
      sortKey,
      CREATED_AT,
      `https://example.test/${id}`,
    ],
  )
  return id
}

/** A publication snapshot makes the Portal "published once", so edits become pending. */
export async function seedPublishedSnapshot(): Promise<void> {
  await getPool().query(
    `INSERT INTO portal_publication_snapshots (
       id, organization_id, property_id, portal_id, version, configuration_digest,
       configuration, guest_locale, language_pack_version, private_feedback_threshold,
       destination_uri, destination_retrieved_at, destination_source_epoch,
       destination_profile_version, created_by, created_at
     ) VALUES ($1, $2, $3, $4, 1, $5, '{}'::jsonb, 'en', 'guest-ui-en-v1', 3,
               'https://example.test/review', $6, 0, 1, $7, $6)`,
    [freshUuid(), ORG_A, PROPERTY_A, PORTAL_A, 'a'.repeat(64), CREATED_AT, MANAGER],
  )
}

export async function createLink(label: string, sortKey: string) {
  const command = await base()
  const id = portalLinkId(freshUuid())
  const link = buildTestPortalLink({
    id,
    categoryId: CATEGORY_A,
    portalId: PORTAL_A,
    organizationId: ORG_A,
    propertyId: PROPERTY_A,
    label,
    url: `https://example.test/${id}`,
    sortKey,
    createdAt: command.occurredAt,
    updatedAt: command.occurredAt,
  })
  await store().createPortalLink({
    ...command,
    actorUserId: MANAGER,
    link,
    event: portalLinkCreated({
      portalId: PORTAL_A,
      linkId: id,
      categoryId: CATEGORY_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: command.revision.toISOString(),
      occurredAt: command.occurredAt,
    }),
  })
  return id
}

export async function saveTexts(
  linkId: string,
  texts: ReadonlyArray<{
    locale: 'en' | 'bg'
    label: string
    line?: string | null
  }>,
) {
  const command = await base()
  await store().savePortalLinkTexts({
    ...command,
    actorUserId: MANAGER,
    linkId: portalLinkId(linkId),
    categoryId: CATEGORY_A,
    texts: texts.map((text) => ({
      locale: text.locale,
      label: text.label,
      line: text.line ?? null,
      provenance: null,
    })),
    event: portalLinkUpdated({
      portalId: PORTAL_A,
      linkId: portalLinkId(linkId),
      categoryId: CATEGORY_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: command.revision.toISOString(),
      occurredAt: command.occurredAt,
    }),
  })
}

export async function saveSettings(input: {
  enabled?: boolean
  titles?: ReadonlyArray<{ locale: 'en' | 'bg'; title: string | null }>
}) {
  const command = await base()
  await store().savePortalLinktreeSettings({
    ...command,
    actorUserId: MANAGER,
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    titles: (input.titles ?? []).map((title) => ({
      ...title,
      overrideId: freshUuid(),
    })),
    event: portalUpdated({
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      previousPublicationState: 'published',
      publicationState: 'published',
      sourceAggregateVersion: command.revision.toISOString(),
      occurredAt: command.occurredAt,
    }),
  })
}

/** The Portal's language set changed through the legacy settings path. */
export async function switchPrimary(
  primary: 'en' | 'bg',
  additional: readonly ('en' | 'bg')[],
) {
  const command = await base()
  await store().updatePortal({
    organizationId: ORG_A,
    propertyId: PROPERTY_A,
    portalId: PORTAL_A,
    actorUserId: MANAGER,
    expectedUpdatedAt: command.expectedPortalUpdatedAt,
    revision: command.revision,
    occurredAt: command.occurredAt,
    patch: { primaryGuestLocale: primary, additionalGuestLocales: [...additional] },
    localeSetEvent: portalLocaleSetUpdated({
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      primaryGuestLocale: primary,
      additionalGuestLocales: [...additional],
      sourceAggregateVersion: command.revision.toISOString(),
      occurredAt: command.occurredAt,
    }),
    event: portalUpdated({
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      previousPublicationState: 'published',
      publicationState: 'published',
      sourceAggregateVersion: command.revision.toISOString(),
      occurredAt: command.occurredAt,
    }),
  })
}

export async function renameLink(id: string, label: string) {
  const command = await base()
  await store().updatePortalLink({
    ...command,
    actorUserId: MANAGER,
    linkId: portalLinkId(id),
    categoryId: CATEGORY_A,
    patch: {
      label,
      url: `https://example.test/${id}`,
      destinationId: null,
      legacyDestinationState: 'unclassified',
      iconKey: null,
      imageAssetId: null,
    },
    event: portalLinkUpdated({
      portalId: PORTAL_A,
      linkId: portalLinkId(id),
      categoryId: CATEGORY_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: command.revision.toISOString(),
      occurredAt: command.occurredAt,
    }),
  })
}

export const textRows = async (linkId: string) =>
  (
    await getPool().query(
      `SELECT locale, label, line, provenance, version, updated_by
       FROM portal_link_texts WHERE organization_id = $1 AND link_id = $2
       ORDER BY locale`,
      [ORG_A, linkId],
    )
  ).rows

export const linkLabel = async (linkId: string) =>
  (
    await getPool().query(
      `SELECT label FROM portal_links WHERE organization_id = $1 AND id = $2`,
      [ORG_A, linkId],
    )
  ).rows[0]?.label as string | undefined

export const pendingKeys = async () =>
  (
    await getPool().query(
      `SELECT change_kind, change_key FROM portal_pending_content_changes
       WHERE organization_id = $1 AND portal_id = $2 ORDER BY change_key`,
      [ORG_A, PORTAL_A],
    )
  ).rows.map((row) => `${row.change_kind}|${row.change_key}`)

/** The page-edit ledger of the Portal, oldest first: kind, key and actor. */
export const pageEdits = async () =>
  (
    await getPool().query(
      `SELECT change_kind, change_key, actor_user_id FROM portal_page_edits
       WHERE organization_id = $1 AND portal_id = $2 ORDER BY occurred_at, change_key`,
      [ORG_A, PORTAL_A],
    )
  ).rows.map((row) => `${row.change_kind}|${row.change_key}|${row.actor_user_id}`)

/** The wording a ledger row kept, by key: [before, after, saves folded]. */
export const pageEditWording = async () =>
  new Map(
    (
      await getPool().query(
        `SELECT change_key, previous_text, new_text, edit_count FROM portal_page_edits
         WHERE organization_id = $1 AND portal_id = $2`,
        [ORG_A, PORTAL_A],
      )
    ).rows.map((row) => [
      row.change_key as string,
      [row.previous_text, row.new_text, row.edit_count] as const,
    ]),
  )

export const linkCount = async () =>
  Number(
    (
      await getPool().query(
        `SELECT count(*)::int AS n FROM portal_links WHERE organization_id = $1 AND portal_id = $2`,
        [ORG_A, PORTAL_A],
      )
    ).rows[0].n,
  )

let activePool: ReturnType<typeof setupIntegrationDb>['getPool'] | undefined
const getPool = () => {
  if (!activePool) throw new Error('setupLinktreeCommandsTestDb was not called')
  return activePool()
}

/** Wires the database, event schemas and the seeded Portal every Linktree suite
 * starts from. Call once at the top of a test file. */
export function setupLinktreeCommandsTestDb() {
  const { getPool: poolOfRun } = setupIntegrationDb({
    orgA: ORG_A,
    orgB: ORG_B,
    tables: [
      'portal_pending_content_changes',
      'portal_publication_snapshots',
      'portal_link_texts',
      'portal_localized_overrides',
      'portal_links',
      'portal_link_categories',
      'portal_responsible_managers',
      'outbox_events',
      'portal_page_edits',
      'portals',
      'properties',
    ],
  })
  activePool = poolOfRun

  beforeEach(async () => {
    tickCount = 0
    const portal = buildTestPortal({
      id: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      entityId: PROPERTY_A,
      name: 'Reception',
      slug: 'reception',
      createdBy: MANAGER,
      primaryGuestLocale: 'en',
      additionalGuestLocales: ['bg'],
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })
    await getPool().query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
       VALUES ($1, $2, 'Harbour House', 'harbour-house', 'UTC', $3, $3)`,
      [PROPERTY_A, ORG_A, CREATED_AT],
    )
    await store().createPortal({
      organizationId: ORG_A,
      portal,
      initialResponsibleManagerIds: [MANAGER],
      event: portalCreated({
        portalId: portal.id,
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        publicationState: portal.publicationState,
        sourceAggregateVersion: portal.updatedAt.toISOString(),
        occurredAt: portal.createdAt,
      }),
    })
    await getPool().query(
      `INSERT INTO portal_link_categories (id, portal_id, organization_id, title, sort_key,
                                           created_at, updated_at)
       VALUES ($1, $2, $3, 'Links', 'a0', $4, $4)`,
      [CATEGORY_A, PORTAL_A, ORG_A, CREATED_AT],
    )
  })

  return { getPool: poolOfRun }
}
