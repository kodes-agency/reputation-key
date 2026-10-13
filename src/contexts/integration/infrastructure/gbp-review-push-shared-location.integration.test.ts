// One Google location held by Properties in two Organizations, against real
// PostgreSQL: the Property rows and their bindings are written by the import's
// own store, the lookup is Property's, and the receipt and handoff facts are
// committed by the real receipt store.
//
// A location is unique only within an Organization. A listing that moved from
// an agency's Organization to the customer's own, or one two Organizations
// manage through the same Google account, is therefore held twice, and the
// push names only the account and the location.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_PROVIDER_FIXTURES_V1,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
} from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { buildGoogleImportedProperty } from '#/contexts/property/application/build-google-imported-property'
import { buildPropertyContext } from '#/contexts/property/build'
import { createPropertyRepository } from '#/contexts/property/infrastructure/repositories/property.repository'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  userId,
  type GoogleConnectionId,
  type OrganizationId,
  type PropertyId,
  type UserId,
} from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { handleGbpNotification } from '../application/use-cases/handle-gbp-notification'
import { createGbpReviewPushReceiptStore } from './gbp-review-push-receipt.store'

const SEGMENTS = GOOGLE_PROVIDER_FIXTURES_V1['google-review-primary'].expectedSegments
/** The account and location the push names. */
const ACCOUNT_ID = SEGMENTS.accountId
const LOCATION_ID = SEGMENTS.locationId
/** The same listing as another Google identity sees it. */
const OTHER_ACCOUNT_ID = 'repkey-synthetic-do-not-use-account-0002'

const TOPIC = 'projects/repkey-test/topics/gbp-push-shared-location'
const REFERENCE_REF = `v1.${Buffer.alloc(32, 9).toString('base64url')}`
const IMPORTED_AT = new Date('2026-10-01T09:00:00.000Z')
const RECEIVED_AT = new Date('2026-10-13T09:00:00.000Z')

type Tenant = Readonly<{
  organizationId: OrganizationId
  adminId: UserId
  connectionId: GoogleConnectionId
  propertyId: PropertyId
}>

/** Imported first, so it is the row an unordered `LIMIT 1` meets first. */
const FORMER: Tenant = {
  organizationId: organizationId('org-gbp-push-shared-location-a'),
  adminId: userId('admin-gbp-push-shared-location-a'),
  connectionId: googleConnectionId('f9000000-0000-4000-8000-00000000000a'),
  propertyId: propertyId('f9100000-0000-4000-8000-00000000000a'),
}
const CURRENT: Tenant = {
  organizationId: organizationId('org-gbp-push-shared-location-b'),
  adminId: userId('admin-gbp-push-shared-location-b'),
  connectionId: googleConnectionId('f9000000-0000-4000-8000-00000000000b'),
  propertyId: propertyId('f9100000-0000-4000-8000-00000000000b'),
}
const TENANTS = [FORMER, CURRENT] as const
const ORGANIZATION_IDS = TENANTS.map((tenant) => tenant.organizationId)

const db = getDb()
let pool: Pool
let now = IMPORTED_AT

const property = buildPropertyContext({
  db,
  repo: createPropertyRepository(db),
  outboxRepo: createOutboxRepository(db),
  clock: () => now,
  idGen: () => 'f9f00000-0000-4000-8000-000000000001',
  staffPublicApi: {
    getAccessiblePropertyIds: async () => null,
    getAssignedPortals: async () => [],
  },
  identityManagerFacts: { listActiveManagers: async () => [] },
  logger: { info: () => {}, warn: () => {} },
})

const adminOf = (tenant: Tenant) =>
  buildTestAuthContext({
    userId: tenant.adminId,
    organizationId: tenant.organizationId,
    role: 'AccountAdmin',
    effectivePermissions: new Set(['property.archive', 'property.disconnect']),
    scopeByPermission: new Map([
      ['property.archive', 'organization'],
      ['property.disconnect', 'organization'],
    ]),
  })

/** Imports the shared location into a tenant the way the Google import does. */
async function importLocation(tenant: Tenant, accountId: string): Promise<void> {
  await property.googleBinding.createBoundProperty({
    organizationId: tenant.organizationId,
    idempotencyKey: `f9300000-0000-4000-8000-${tenant.propertyId.slice(-12)}`,
    property: buildGoogleImportedProperty({
      organizationId: tenant.organizationId,
      propertyId: tenant.propertyId,
      importItemId: tenant.propertyId,
      connectionId: tenant.connectionId,
      accountId,
      locationId: LOCATION_ID,
      googleReviewUri: null,
      name: 'Harbour Hotel',
      address: '1 Harbour Road',
      countryCode: 'GB',
      timezone: 'Europe/London',
      confirmedBy: tenant.adminId,
      now: IMPORTED_AT,
    }),
    now: IMPORTED_AT,
  })
}

async function archiveAndDisconnect(tenant: Tenant): Promise<void> {
  const admin = adminOf(tenant)
  await property.publicApi.management.archiveProperty(
    { propertyId: tenant.propertyId, reason: 'Listing handed to its owner' },
    admin,
  )
  await property.publicApi.management.disconnectPropertyGoogleBinding(
    { propertyId: tenant.propertyId },
    admin,
  )
}

function deliver(messageId: string) {
  now = RECEIVED_AT
  return handleGbpNotification({
    propertyLookup: property.publicApi,
    // The short-lived reference store is Redis; a stand-in that always holds.
    references: {
      publish: async () => ({ ok: true, referenceRef: REFERENCE_REF }),
      resolve: async () => ({ ok: false, code: 'unavailable' }),
    },
    receipts: createGbpReviewPushReceiptStore(db),
    clock: () => now,
    logger: createMockLogger(),
  })({
    topic: TOPIC,
    messageId,
    notificationKind: 'NEW_REVIEW',
    locationId: LOCATION_ID,
    locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
  })
}

/** The handoff facts the worker turns into targeted fetches, one per row. */
async function handoffs() {
  const result = await pool.query<{
    organization_id: string
    property_id: string
    connection_id: string
  }>(
    `SELECT organization_id, property_id::text, payload->>'connectionId' AS connection_id
     FROM outbox_events
     WHERE event_type = 'integration.google_review_push.accepted'
       AND organization_id = ANY($1)
     ORDER BY organization_id`,
    [ORGANIZATION_IDS],
  )
  return result.rows
}

async function receipts(messageId: string) {
  const result = await pool.query<{ property_id: string | null; outcome: string }>(
    `SELECT payload->>'resolvedPropertyId' AS property_id, payload->>'outcome' AS outcome
     FROM idempotency_receipts
     WHERE scope = 'gbp_webhook'
       AND payload->>'topic' = $1
       AND payload->>'messageId' = $2
     ORDER BY payload->>'resolvedPropertyId'`,
    [TOPIC, messageId],
  )
  return result.rows
}

const handoffTo = (tenant: Tenant) => ({
  organization_id: tenant.organizationId,
  property_id: tenant.propertyId,
  connection_id: tenant.connectionId,
})

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM idempotency_receipts
     WHERE (scope = 'gbp_webhook' AND payload->>'topic' = $1)
        OR (scope = 'property_operation' AND payload->>'organizationId' = ANY($2))`,
    [TOPIC, ORGANIZATION_IDS],
  )
  for (const table of ['properties', 'outbox_events']) {
    await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [
      ORGANIZATION_IDS,
    ])
  }
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  clearEventSchemas()
  registerAllEventSchemas()
  for (const tenant of TENANTS) {
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'GBP Push Shared Location', $1, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [tenant.organizationId],
    )
    await pool.query(
      `INSERT INTO google_connections (
         id, organization_id, google_subject,
         encrypted_access_token, encrypted_refresh_token, token_expires_at,
         scopes, connected_by, created_at, updated_at
       )
       VALUES ($1, $2, $3, 'encrypted', 'encrypted', NOW(),
               ARRAY['https://www.googleapis.com/auth/business.manage'], $4, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [
        tenant.connectionId,
        tenant.organizationId,
        `subject-${tenant.organizationId}`,
        tenant.adminId,
      ],
    )
  }
})

beforeEach(async () => {
  now = IMPORTED_AT
  await cleanup()
})

afterAll(async () => {
  await cleanup()
  await pool.query('DELETE FROM google_connections WHERE organization_id = ANY($1)', [
    ORGANIZATION_IDS,
  ])
  await deleteTestOrganizations(pool, ORGANIZATION_IDS)
  clearEventSchemas()
  await pool.end()
})

describe.sequential('Google review push for a location two Organizations hold', () => {
  it('reaches the Organization bound through the account the push names', async () => {
    await importLocation(FORMER, OTHER_ACCOUNT_ID)
    await importLocation(CURRENT, ACCOUNT_ID)

    await expect(deliver('message-other-account')).resolves.toEqual({
      accepted: true,
      duplicate: false,
      handoff: 'targeted',
      propertyIds: [CURRENT.propertyId],
    })

    expect(await handoffs()).toEqual([handoffTo(CURRENT)])
    expect(await receipts('message-other-account')).toEqual([
      { property_id: CURRENT.propertyId, outcome: 'accepted_targeted' },
    ])
  })

  it('reaches the Organization still linked when the other archived and disconnected its Property', async () => {
    await importLocation(FORMER, ACCOUNT_ID)
    await archiveAndDisconnect(FORMER)
    await importLocation(CURRENT, ACCOUNT_ID)

    await expect(deliver('message-disconnected')).resolves.toMatchObject({
      handoff: 'targeted',
      propertyIds: [CURRENT.propertyId],
    })

    expect(await handoffs()).toEqual([handoffTo(CURRENT)])
  })

  it('reaches every Organization bound to the same account and location, once each', async () => {
    await importLocation(FORMER, ACCOUNT_ID)
    await importLocation(CURRENT, ACCOUNT_ID)

    await expect(deliver('message-both')).resolves.toEqual({
      accepted: true,
      duplicate: false,
      handoff: 'targeted',
      propertyIds: [FORMER.propertyId, CURRENT.propertyId],
    })
    // Pub/Sub redelivers: the message is answered again and nothing is added.
    await expect(deliver('message-both')).resolves.toMatchObject({
      accepted: true,
      duplicate: true,
    })

    expect(await handoffs()).toEqual([handoffTo(FORMER), handoffTo(CURRENT)])
    // One receipt row per Property, so each Organization's purge removes its
    // own and no row names a Property of another Organization.
    expect(await receipts('message-both')).toEqual([
      { property_id: FORMER.propertyId, outcome: 'accepted_targeted' },
      { property_id: CURRENT.propertyId, outcome: 'accepted_targeted' },
    ])
  })

  it('hands nothing off when no Organization is bound through the account the push names', async () => {
    await importLocation(FORMER, OTHER_ACCOUNT_ID)
    await importLocation(CURRENT, OTHER_ACCOUNT_ID)

    await expect(deliver('message-no-binding')).resolves.toEqual({
      accepted: true,
      duplicate: false,
      handoff: 'ignored',
      propertyIds: [],
    })

    expect(await handoffs()).toEqual([])
    expect(await receipts('message-no-binding')).toEqual([
      { property_id: FORMER.propertyId, outcome: 'ignored_binding_mismatch' },
    ])
  })
})
