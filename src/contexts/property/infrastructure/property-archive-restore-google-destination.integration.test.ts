// Archive then Restore, as the product runs them, and what a Portal of the
// Property is then told: the destination's state, whether a Portal may be
// published, whether a guest is offered the Google review action, and the
// Portal Health the Portals list reads.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import { portalHealthIntervals } from '#/shared/db/schema/portal.schema'
import {
  portalPublicationActivations,
  portalPublicationSnapshots,
} from '#/shared/db/schema/portal-publication.schema'
import {
  googleConnectionId,
  organizationId,
  portalId,
  propertyId,
  userId,
  type PropertyId,
} from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { buildConsumerEvent } from '#/shared/outbox/envelope'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { buildLegacyPortalPublicationSnapshot } from '#/contexts/portal/application/__fixtures__/legacy-snapshot-builder'
import { loadVerifiedGoogleReviewDestination } from '#/contexts/portal/application/portal-publication-readiness'
import { resolvePublicPortalToken } from '#/contexts/portal/application/use-cases/resolve-public-portal-token'
import { handlePortalHealthDependencyChanged } from '#/contexts/portal/infrastructure/portal-health-outbox-consumers'
import { createPortalHealthReconciliationStore } from '#/contexts/portal/infrastructure/portal-health-reconciliation-store'
import { snapshotToRow } from '#/contexts/portal/infrastructure/portal-publication-commands'
import { createPortalPublicationRepository } from '#/contexts/portal/infrastructure/repositories/portal-publication.repository'
import { buildGoogleImportedProperty } from '../application/build-google-imported-property'
import { buildPropertyContext } from '../build'
import { createPropertyRepository } from './repositories/property.repository'

const ORG = organizationId('org-property-archive-restore-google')
const ADMIN = userId('admin-archive-restore-google')
const CONNECTION = googleConnectionId('f8000000-0000-4000-8000-000000000001')
const LINKED = propertyId('f8100000-0000-4000-8000-000000000001')
const NO_REVIEW_LINK = propertyId('f8100000-0000-4000-8000-000000000002')
const PORTAL = portalId('f8200000-0000-4000-8000-000000000001')
const REVIEW_URI = 'https://search.google.com/local/writereview?placeid=archive-restore'
const RELINKED_REVIEW_URI =
  'https://search.google.com/local/writereview?placeid=archive-restore-relinked'
const TOKEN_DIGEST = {
  tokenIdentifier: 'archiverestore01',
  // Globally unique by index: no other integration suite may reuse this hash.
  tokenHash: 'e7'.repeat(32),
  tokenKeyVersion: 1,
} as const

const IMPORTED_AT = new Date('2026-09-01T09:00:00.000Z')
const PUBLISHED_AT = new Date('2026-09-01T10:00:00.000Z')
const ARCHIVED_AT = new Date('2026-09-02T09:00:00.000Z')
const DISCONNECTED_AT = new Date('2026-09-02T10:00:00.000Z')
const RESTORED_AT = new Date('2026-09-03T09:00:00.000Z')
const RELINKED_AT = new Date('2026-09-03T10:00:00.000Z')
const GUEST_VISIT_AT = new Date('2026-09-04T09:00:00.000Z')

const db = getDb()
let pool: Pool
let now = IMPORTED_AT

const property = buildPropertyContext({
  db,
  repo: createPropertyRepository(db),
  clock: () => now,
  idGen: () => 'f8f00000-0000-4000-8000-000000000001',
  staffPublicApi: {
    getAccessiblePropertyIds: async () => null,
    getAssignedPortals: async () => [],
  },
  identityManagerFacts: {
    listActiveManagers: async () => [
      { userId: ADMIN, role: 'AccountAdmin', propertyAccessScope: 'organization' },
    ],
  },
  logger: { info: () => {}, warn: () => {} },
})

const admin = buildTestAuthContext({
  userId: ADMIN,
  organizationId: ORG,
  role: 'AccountAdmin',
  effectivePermissions: new Set([
    'property.archive',
    'property.restore',
    'property.disconnect',
  ]),
  scopeByPermission: new Map([
    ['property.archive', 'organization'],
    ['property.restore', 'organization'],
    ['property.disconnect', 'organization'],
  ]),
})

/** Imports a Property the way the Google import does, then names its manager. */
async function importProperty(
  id: PropertyId,
  input: Readonly<{ locationId: string; googleReviewUri: string | null }>,
): Promise<void> {
  now = IMPORTED_AT
  await property.googleBinding.createBoundProperty({
    organizationId: ORG,
    idempotencyKey: `f8300000-0000-4000-8000-${id.slice(-12)}`,
    property: buildGoogleImportedProperty({
      organizationId: ORG,
      propertyId: id,
      importItemId: id,
      connectionId: CONNECTION,
      accountId: 'account-archive-restore',
      locationId: input.locationId,
      googleReviewUri: input.googleReviewUri,
      name: `Harbour Hotel ${input.locationId}`,
      address: '1 Harbour Road',
      countryCode: 'GB',
      timezone: 'Europe/London',
      confirmedBy: ADMIN,
      now: IMPORTED_AT,
    }),
    now: IMPORTED_AT,
  })
  await pool.query(
    `INSERT INTO property_responsible_managers
       (organization_id, property_id, user_id, effective_from, created_by)
     VALUES ($1, $2, $3, $4, $3)`,
    [ORG, id, ADMIN, IMPORTED_AT],
  )
}

/** A live Portal of the linked Property, published against its destination. */
async function publishPortal(): Promise<void> {
  const destination = await property.publicApi.getGoogleReviewDestination(ORG, LINKED)
  if (
    destination?.state !== 'verified' ||
    destination.uri === null ||
    destination.retrievedAt === null ||
    destination.sourceEpoch === null ||
    destination.profileVersion === null
  ) {
    throw new Error('the linked Property has no verified destination to publish against')
  }
  await pool.query(
    `INSERT INTO portals
       (id, organization_id, property_id, entity_type, entity_id, name, slug,
        theme, private_feedback_threshold, publication_state, created_at, updated_at)
     VALUES ($1, $2, $3, 'property', $4, 'Front desk', 'front-desk',
             '{"primaryColor":"#123456"}'::jsonb, 3, 'published', $5, $5)`,
    [PORTAL, ORG, LINKED, LINKED, PUBLISHED_AT],
  )
  await pool.query(
    `INSERT INTO portal_tokens
       (id, organization_id, property_id, portal_id, token_identifier,
        token_hash, token_key_version, version, status, issued_at)
     VALUES ('f8400000-0000-4000-8000-000000000001', $1, $2, $3, $4, $5, $6,
             1, 'active', $7)`,
    [
      ORG,
      LINKED,
      PORTAL,
      TOKEN_DIGEST.tokenIdentifier,
      TOKEN_DIGEST.tokenHash,
      TOKEN_DIGEST.tokenKeyVersion,
      PUBLISHED_AT,
    ],
  )
  // Someone is responsible for it, so Google is all its health can report.
  await pool.query(
    `INSERT INTO portal_responsible_managers
       (organization_id, property_id, portal_id, user_id, effective_from, created_by)
     VALUES ($1, $2, $3, $4, $5, $4)`,
    [ORG, LINKED, PORTAL, ADMIN, PUBLISHED_AT],
  )
  const snapshot = buildLegacyPortalPublicationSnapshot({
    id: 'f8500000-0000-4000-8000-000000000001',
    portalId: PORTAL,
    organizationId: ORG,
    propertyId: LINKED,
    version: 1,
    source: {
      portal: {
        id: PORTAL,
        name: 'Front desk',
        slug: 'front-desk',
        description: null,
        heroImageUrl: null,
        theme: { primaryColor: '#123456' },
        organizationName: 'Harbour Hotels',
      },
      categories: [],
      links: [],
      privateFeedbackThreshold: 3,
      organizationId: ORG,
      propertyId: LINKED,
    },
    destination: {
      state: 'verified',
      uri: destination.uri,
      retrievedAt: destination.retrievedAt,
      sourceEpoch: destination.sourceEpoch,
      profileVersion: destination.profileVersion,
    },
    createdBy: ADMIN,
    createdAt: PUBLISHED_AT,
  })
  await db.insert(portalPublicationSnapshots).values(snapshotToRow(snapshot))
  await db.insert(portalPublicationActivations).values({
    id: 'f8600000-0000-4000-8000-000000000001',
    organizationId: ORG,
    propertyId: LINKED,
    portalId: PORTAL,
    snapshotId: snapshot.id,
    activationSequence: 1,
    kind: 'publish',
    activatedBy: ADMIN,
    activatedAt: PUBLISHED_AT,
  })
}

async function archive(id: PropertyId) {
  now = ARCHIVED_AT
  return property.publicApi.management.archiveProperty(
    { propertyId: id, reason: 'Closed for the winter' },
    admin,
  )
}

async function disconnectGoogle(id: PropertyId) {
  now = DISCONNECTED_AT
  return property.publicApi.management.disconnectPropertyGoogleBinding(
    { propertyId: id },
    admin,
  )
}

async function restore(id: PropertyId) {
  now = RESTORED_AT
  return property.publicApi.management.restoreProperty({ propertyId: id }, admin)
}

/** What publishing a Portal of the Property is told about the Google destination. */
const publicationReadiness = (id: PropertyId) =>
  loadVerifiedGoogleReviewDestination(
    { propertyGoogleReviewDestinationApi: property.publicApi },
    ORG,
    buildTestPortal({ id: PORTAL, organizationId: ORG, propertyId: id }),
  )

/** What a guest who opens the live Portal's address is served. */
const guestVisit = () =>
  resolvePublicPortalToken({
    tokenCodec: { digest: () => TOKEN_DIGEST },
    portalPublicationRepo: createPortalPublicationRepository(db),
    // The seeded publication is schema version 1, which predates Portal Health.
    portalHealthRepo: { getCurrent: async () => null },
    listApprovedSecondaryDestinationUris: async () => [],
    isPropertyActive: property.publicApi.isPropertyActive,
    getGoogleReviewDestination: property.publicApi.getGoogleReviewDestination,
    decidePublic: async () => ({ allowed: true }),
    clock: () => GUEST_VISIT_AT,
  })('raw-address-is-not-read-by-the-stub-codec')

const portalHealth = createPortalHealthReconciliationStore(db, {
  clock: () => now,
  idGen: randomUUID,
})

/**
 * The health the Portals list reads once Portal has consumed the Property's
 * latest fact of that type, through the consumer the worker runs. Nothing else
 * reconciles Portal Health with the Property.
 */
async function portalHealthAfter(
  eventType: 'property.archived' | 'property.restored',
): Promise<Readonly<{ status: string; reason: string }> | undefined> {
  const [fact] = await db
    .select()
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.organizationId, ORG),
        eq(outboxEvents.propertyId, LINKED),
        eq(outboxEvents.eventType, eventType),
      ),
    )
    .orderBy(desc(outboxEvents.createdAt))
    .limit(1)
  if (!fact) throw new Error(`the Property recorded no ${eventType} fact`)
  await handlePortalHealthDependencyChanged(
    portalHealth,
    buildConsumerEvent({ ...fact, recordedAt: fact.createdAt }),
  )
  const [current] = await db
    .select({
      status: portalHealthIntervals.status,
      reason: portalHealthIntervals.reason,
    })
    .from(portalHealthIntervals)
    .where(
      and(
        eq(portalHealthIntervals.organizationId, ORG),
        eq(portalHealthIntervals.portalId, PORTAL),
        isNull(portalHealthIntervals.effectiveTo),
      ),
    )
  return current
}

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM idempotency_receipts
     WHERE scope = 'property_operation' AND payload->>'organizationId' = $1`,
    [ORG],
  )
  for (const table of [
    'portal_health_intervals',
    'portal_responsible_managers',
    'portal_publication_activations',
    'portal_publication_snapshots',
    'portal_tokens',
    'portals',
    'property_responsible_managers',
    'properties',
    'outbox_events',
  ]) {
    await pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [ORG])
  }
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  clearEventSchemas()
  registerAllEventSchemas()
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Archive Restore Google', $1, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO google_connections (
       id, organization_id, google_subject,
       encrypted_access_token, encrypted_refresh_token, token_expires_at,
       scopes, connected_by, created_at, updated_at
     )
     VALUES ($1, $2, 'archive-restore-subject', 'encrypted', 'encrypted', NOW(),
             ARRAY['https://www.googleapis.com/auth/business.manage'], $3, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [CONNECTION, ORG, ADMIN],
  )
})

beforeEach(async () => {
  await cleanup()
})

afterAll(async () => {
  await cleanup()
  await pool.query('DELETE FROM google_connections WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
  clearEventSchemas()
  await pool.end()
})

describe.sequential('Archive then Restore of a Property linked to Google', () => {
  it('gives its Portals the Google review action back when the link was never broken', async () => {
    await importProperty(LINKED, {
      locationId: 'location-linked',
      googleReviewUri: REVIEW_URI,
    })
    await publishPortal()
    const accepted = await property.publicApi.getGoogleReviewDestination(ORG, LINKED)

    const archived = await archive(LINKED)

    // While archived the accepted destination is fenced, not forgotten.
    expect(archived.googleReviewDestination).toEqual({
      ...accepted,
      state: 'awaiting_refresh',
    })
    await expect(guestVisit()).resolves.toEqual({ status: 'unavailable' })
    await expect(portalHealthAfter('property.archived')).resolves.toEqual({
      status: 'unavailable',
      reason: 'property_unavailable',
    })

    const restored = await restore(LINKED)

    expect(restored.googleBindingReadiness).toBe('ready')
    expect(restored.property.lifecycleState).toBe('active')
    expect(restored.property.googleBindingState).toBe('active')
    // The same destination Google supplied at import, under the same pin.
    expect(restored.property.googleReviewDestination).toEqual({
      state: 'verified',
      uri: REVIEW_URI,
      retrievedAt: IMPORTED_AT,
      sourceEpoch: 0,
      profileVersion: 1,
    })
    expect(await property.publicApi.getGoogleReviewDestination(ORG, LINKED)).toEqual(
      accepted,
    )
    await expect(publicationReadiness(LINKED)).resolves.toEqual(accepted)
    await expect(guestVisit()).resolves.toMatchObject({
      status: 'found',
      data: {
        reviewGateway: { googleReview: { status: 'available', uri: REVIEW_URI } },
      },
    })
    // The Portals list has nothing left to say about Google.
    await expect(portalHealthAfter('property.restored')).resolves.toEqual({
      status: 'healthy',
      reason: 'operational',
    })
  })

  it('repairs a Property an earlier Restore left on hold: Archive it and Restore it again', async () => {
    await importProperty(LINKED, {
      locationId: 'location-linked',
      googleReviewUri: REVIEW_URI,
    })
    await publishPortal()
    const accepted = await property.publicApi.getGoogleReviewDestination(ORG, LINKED)
    // What Restore used to leave behind: active, still linked, destination fenced.
    await pool.query(
      `UPDATE properties SET google_review_destination_state = 'awaiting_refresh'
       WHERE organization_id = $1 AND id = $2`,
      [ORG, LINKED],
    )
    await expect(guestVisit()).resolves.toMatchObject({
      status: 'found',
      data: { reviewGateway: { googleReview: { status: 'unavailable' } } },
    })

    await archive(LINKED)
    const restored = await restore(LINKED)

    expect(restored.googleBindingReadiness).toBe('ready')
    expect(restored.property.googleReviewDestination).toEqual(accepted)
    await expect(publicationReadiness(LINKED)).resolves.toEqual(accepted)
    await expect(guestVisit()).resolves.toMatchObject({
      status: 'found',
      data: {
        reviewGateway: { googleReview: { status: 'available', uri: REVIEW_URI } },
      },
    })
    await expect(portalHealthAfter('property.restored')).resolves.toEqual({
      status: 'healthy',
      reason: 'operational',
    })
  })

  it('keeps the destination fenced after Restore when Google was disconnected while archived', async () => {
    await importProperty(LINKED, {
      locationId: 'location-linked',
      googleReviewUri: REVIEW_URI,
    })
    await publishPortal()

    await archive(LINKED)
    await disconnectGoogle(LINKED)
    const restored = await restore(LINKED)

    expect(restored.googleBindingReadiness).toBe('reconnect_required')
    expect(restored.property.googleBindingState).toBe('disconnected')
    expect(restored.property.googleReviewDestination).toMatchObject({
      state: 'awaiting_refresh',
      uri: REVIEW_URI,
    })
    await expect(publicationReadiness(LINKED)).rejects.toMatchObject({
      _tag: 'PortalError',
      code: 'google_review_destination_unavailable',
    })
    // The Portal still serves the private rating; only the Google action closes.
    await expect(guestVisit()).resolves.toMatchObject({
      status: 'found',
      data: { reviewGateway: { googleReview: { status: 'unavailable' } } },
    })
    // The one case in which a live Portal of an active Property reports the
    // Google link on hold: it waits for a relink, not for anything under way.
    await expect(portalHealthAfter('property.restored')).resolves.toEqual({
      status: 'degraded',
      reason: 'google_destination_awaiting_refresh',
    })
  })

  it('never invents a destination for a Property Google gave no review link, and a relink asks Google again', async () => {
    await importProperty(NO_REVIEW_LINK, {
      locationId: 'location-no-review-link',
      googleReviewUri: null,
    })
    const none = {
      state: 'unavailable',
      uri: null,
      retrievedAt: null,
      sourceEpoch: null,
      profileVersion: null,
    }

    await archive(NO_REVIEW_LINK)
    const restored = await restore(NO_REVIEW_LINK)

    expect(restored.googleBindingReadiness).toBe('ready')
    expect(restored.property.googleReviewDestination).toEqual(none)
    await expect(publicationReadiness(NO_REVIEW_LINK)).rejects.toMatchObject({
      _tag: 'PortalError',
      code: 'google_review_destination_unavailable',
    })

    // The one way to ask Google again: disconnect the archived Property, restore
    // it, and link it again through the import.
    now = new Date(RESTORED_AT.getTime() + 60_000)
    await property.publicApi.management.archiveProperty(
      { propertyId: NO_REVIEW_LINK, reason: 'Asking Google for the review link again' },
      admin,
    )
    now = new Date(RESTORED_AT.getTime() + 120_000)
    await property.publicApi.management.disconnectPropertyGoogleBinding(
      { propertyId: NO_REVIEW_LINK },
      admin,
    )
    now = new Date(RESTORED_AT.getTime() + 180_000)
    const reconnectNeeded = await property.publicApi.management.restoreProperty(
      { propertyId: NO_REVIEW_LINK },
      admin,
    )
    expect(reconnectNeeded.googleBindingReadiness).toBe('reconnect_required')
    expect(reconnectNeeded.property.googleReviewDestination).toEqual(none)

    await property.googleBinding.relink({
      organizationId: ORG,
      propertyId: NO_REVIEW_LINK,
      idempotencyKey: 'f8300000-0000-4000-8000-0000000000aa',
      connectionId: CONNECTION,
      accountId: 'account-archive-restore',
      locationId: 'location-no-review-link',
      profile: {
        name: 'Harbour Hotel location-no-review-link',
        address: '1 Harbour Road',
        timezone: 'Europe/London',
        confirmedBy: ADMIN,
        googleReviewUri: RELINKED_REVIEW_URI,
      },
      expectedSourceEpoch: reconnectNeeded.property.sourceEpoch,
      expectedProfileVersion: reconnectNeeded.property.profileVersion,
      now: RELINKED_AT,
    })

    await expect(publicationReadiness(NO_REVIEW_LINK)).resolves.toMatchObject({
      state: 'verified',
      uri: RELINKED_REVIEW_URI,
      retrievedAt: RELINKED_AT,
    })
  })
})
