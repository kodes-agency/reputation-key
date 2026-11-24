import { createPortalRatingGoalGuard } from '#/contexts/reporting/monthly-goals/portal-rating-goal-guard.server'
import { createHash } from 'node:crypto'
import { beforeEach } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestPortal } from '#/shared/testing/fixtures'
import {
  organizationId,
  portalAccessArtifactId,
  portalGroupId,
  portalId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import {
  portalAccessArtifactPublished,
  portalCreated,
  portalPublicationPublished,
} from '../domain/events'
import { publishPortalAccessArtifact } from '../domain/portal-access-artifact'
import { createAtomicPortalCommandStore } from './portal-command-store.server'
import { buildPortalPublicationSnapshot } from './portal-publication-snapshot.server'
import { publicationSource } from '../domain/__fixtures__/publication-source'
import { issueToken } from '../domain/portal-token'

export const ORG_A = organizationId('org-portalcmd-0000-0000-000000000001')
export const ORG_B = organizationId('org-portalcmd-0000-0000-000000000002')
export const PROPERTY_A = propertyId('6a000000-0000-4000-8000-000000000001')
export const PORTAL_A = portalId('6b000000-0000-4000-8000-000000000001')
export const GROUP_A = portalGroupId('6f000000-0000-4000-8000-000000000001')
export const GROUP_B = portalGroupId('6f000000-0000-4000-8000-000000000002')
export const MANAGER = userId('manager-portalcmd-00000000000000001')
export const CREATED_AT = new Date('2026-08-26T10:00:00.000Z')
export const GROUP_UPDATED_AT = new Date('2026-08-26T10:02:00.000Z')
export const UPDATED_AT = new Date('2026-08-26T10:05:00.000Z')
export const DELETED_AT = new Date('2026-08-26T10:10:00.000Z')
// Stand-ins for stored Portal token hashes: any 64-hex value fits the column.
// Derived rather than written out, so a secret scan has no literal to flag.
const fakeTokenHash = (label: string) => createHash('sha256').update(label).digest('hex')
export const ROLLBACK_TOKEN_HASH = fakeTokenHash('portal command store rollback token')
export const COMMIT_TOKEN_HASH = fakeTokenHash('portal command store commit token')

export { waitForDatabaseCondition } from '#/shared/db/testing/lock-gate'

export function hasDatabaseErrorCode(error: unknown, code: string): boolean {
  let current = error
  for (let depth = 0; depth < 3; depth += 1) {
    if (!current || typeof current !== 'object') return false
    if ((current as { code?: unknown }).code === code) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

export function accessArtifactCommandParts(
  token: ReturnType<typeof issueToken>,
  id: string,
  revision: Date,
) {
  const nfcId = id.replace(/^7c/u, '7d')
  const qrArtifact = publishPortalAccessArtifact({
    id: portalAccessArtifactId(id),
    organizationId: ORG_A,
    propertyId: PROPERTY_A,
    portalId: PORTAL_A,
    portalTokenId: token.id,
    channel: 'qr',
    now: revision,
  })
  const nfcArtifact = publishPortalAccessArtifact({
    id: portalAccessArtifactId(nfcId),
    organizationId: ORG_A,
    propertyId: PROPERTY_A,
    portalId: PORTAL_A,
    portalTokenId: token.id,
    channel: 'nfc',
    now: revision,
  })
  const accessArtifacts = [qrArtifact, nfcArtifact] as const
  const eventFor = (artifact: (typeof accessArtifacts)[number]) =>
    portalAccessArtifactPublished({
      accessArtifactId: artifact.id,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      channel: artifact.channel,
      sourceAggregateVersion: revision.toISOString(),
      occurredAt: revision,
    })
  // Both channels of a code row store a hash of their own (ADR 0069). Fixtures
  // stand in for the keyed hash with an unkeyed one of the marker, so no two rows
  // or channels ever share one.
  const hashOf = (channel: string, artifactId: string) =>
    createHash('sha256').update(`${channel}|${artifactId}`).digest('hex')
  return {
    accessArtifacts,
    accessArtifactEvents: [eventFor(qrArtifact), eventFor(nfcArtifact)] as const,
    printCodeHashes: { qr: hashOf('qr', id), nfc: hashOf('nfc', nfcId) },
  }
}

export const makePortal = (overrides: Parameters<typeof buildTestPortal>[0] = {}) =>
  buildTestPortal({
    id: PORTAL_A,
    organizationId: ORG_A,
    propertyId: PROPERTY_A,
    entityId: PROPERTY_A,
    name: 'Reception',
    slug: 'reception',
    createdBy: MANAGER,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  })

export const createdFact = (portal = makePortal()) =>
  portalCreated({
    portalId: portal.id,
    organizationId: portal.organizationId,
    propertyId: portal.propertyId,
    publicationState: portal.publicationState,
    sourceAggregateVersion: portal.updatedAt.toISOString(),
    occurredAt: portal.createdAt,
  })

/** Stores a Portal (draft unless overridden) through the command store, with its
 * initial responsibility and creation fact. */
export async function seedStoredPortal(overrides: Parameters<typeof makePortal>[0] = {}) {
  const portal = makePortal(overrides)
  const store = createAtomicPortalCommandStore(getDb(), createPortalRatingGoalGuard())
  await store.createPortal({
    organizationId: ORG_A,
    portal,
    initialResponsibleManagerIds: [MANAGER],
    event: createdFact(portal),
  })
  return { store, portal }
}

export async function seedPortalGroupMembership(): Promise<void> {
  const portal = makePortal()
  await createAtomicPortalCommandStore(
    getDb(),
    createPortalRatingGoalGuard(),
  ).createPortal({
    organizationId: ORG_A,
    portal,
    initialResponsibleManagerIds: [MANAGER],
    event: createdFact(portal),
  })
  await getPool().query(
    `INSERT INTO portal_groups
       (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, 'Front Desk', $4, $5)`,
    [GROUP_A, ORG_A, PROPERTY_A, CREATED_AT, GROUP_UPDATED_AT],
  )
  await getPool().query(
    `INSERT INTO portal_group_memberships
       (organization_id, property_id, portal_id, portal_group_id,
        effective_from, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [ORG_A, PROPERTY_A, PORTAL_A, GROUP_A, CREATED_AT, MANAGER],
  )
}

export const PROPERTY_TITLE = 'Tell us about your visit'
export const PROPERTY_DESCRIPTION = 'Rate your visit to the reception.'

export function publicationMutation(
  portal: ReturnType<typeof makePortal>,
  input: Readonly<{
    name: string
    version?: number
    activationSequence?: number
    snapshotId?: string
    activationId?: string
    at?: Date
  }>,
) {
  const at = input.at ?? UPDATED_AT
  const snapshot = buildPortalPublicationSnapshot({
    id: input.snapshotId ?? '6d000000-0000-4000-8000-000000000001',
    portalId: portal.id,
    organizationId: portal.organizationId,
    propertyId: portal.propertyId,
    version: input.version ?? 1,
    // Publishing writes what the working copy says, so this is the Property's
    // wording seeded in beforeEach, in the Portal's own language.
    source: publicationSource({
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      portal: { id: portal.id, name: input.name, slug: portal.slug },
      privateFeedbackThreshold: portal.privateFeedbackThreshold,
      primaryGuestLocale: portal.primaryGuestLocale,
      localeSet: [portal.primaryGuestLocale],
      linktreeEnabled: portal.linktreeEnabled,
      timeZone: 'UTC',
      look: null,
      wording: {
        [portal.primaryGuestLocale]: {
          title: PROPERTY_TITLE,
          shortDescription: PROPERTY_DESCRIPTION,
          heroAlt: null,
          linktreeTitle: null,
        },
      },
      links: [],
    }),
    destination: {
      state: 'verified',
      uri: 'https://search.google.com/local/writereview?placeid=portal-command',
      retrievedAt: CREATED_AT,
      sourceEpoch: 1,
      profileVersion: 1,
    },
    createdBy: MANAGER,
    createdAt: at,
  })
  return {
    kind: 'publish' as const,
    snapshot,
    activation: {
      id: input.activationId ?? '6e000000-0000-4000-8000-000000000001',
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      snapshotId: snapshot.id,
      activationSequence: input.activationSequence ?? 1,
      kind: 'publish' as const,
      activatedBy: MANAGER,
      activatedAt: at,
      deactivatedAt: null,
      deactivationReason: null,
    },
  }
}

export function publicationPublishedFact(
  portal: ReturnType<typeof makePortal>,
  publication: ReturnType<typeof publicationMutation>,
  revision: Date,
) {
  return portalPublicationPublished({
    organizationId: portal.organizationId,
    propertyId: portal.propertyId,
    portalId: portal.id,
    publicationSnapshotId: publication.snapshot.id,
    publicationVersion: publication.snapshot.version,
    publicationDigest: publication.snapshot.configurationDigest,
    userId: MANAGER,
    sourceAggregateVersion: revision.toISOString(),
    occurredAt: revision,
  })
}

export const pageEditRows = async () =>
  (
    await getPool().query(
      `SELECT portal_id::text AS portal_id, change_kind, change_key, actor_user_id, occurred_at,
              previous_text, new_text, edit_count
         FROM portal_page_edits WHERE organization_id = $1
        ORDER BY occurred_at, change_kind, change_key`,
      [ORG_A],
    )
  ).rows

let activePool: ReturnType<typeof setupIntegrationDb>['getPool'] | undefined
const getPool = () => {
  if (!activePool) throw new Error('setupPortalCommandStoreTestDb was not called')
  return activePool()
}

/** Wires the database, event schemas and the Property every command-store
 * suite starts from. Call once at the top of a test file. */
export function setupPortalCommandStoreTestDb() {
  const { getPool: poolOfRun } = setupIntegrationDb({
    orgA: ORG_A,
    orgB: ORG_B,
    tables: [
      'portal_address_downloads',
      'portal_publication_activations',
      'portal_publication_snapshots',
      'portal_links',
      'portal_link_categories',
      'portal_group_memberships',
      'portal_groups',
      'portal_access_artifacts',
      'portal_tokens',
      'portal_responsible_managers',
      'outbox_events',
      'portal_page_edits',
      'property_portal_brand_contents',
      'portals',
      'properties',
    ],
  })
  activePool = poolOfRun

  beforeEach(async () => {
    await getPool().query(
      `INSERT INTO properties
         (id, organization_id, name, slug, timezone, created_at, updated_at)
       VALUES ($1, $2, 'Portal Command Property', 'portal-command-property', 'UTC', $3, $3)`,
      [PROPERTY_A, ORG_A, CREATED_AT],
    )
    await getPool().query(
      `INSERT INTO property_portal_brand_contents
         (id, organization_id, property_id, locale, title, short_description,
          version, updated_by, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'en', $3, $4, 1, 'seed-manager', $5, $5)`,
      [ORG_A, PROPERTY_A, PROPERTY_TITLE, PROPERTY_DESCRIPTION, CREATED_AT],
    )
  })

  return { getPool: poolOfRun }
}
