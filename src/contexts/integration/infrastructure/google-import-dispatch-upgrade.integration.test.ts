import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { buildConsumerEvent } from '#/shared/outbox/envelope'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createGoogleImportV2Processor } from '../application/google-import-v2-processor'
import { createMockLogger } from '#/shared/testing/mock-logger'
import {
  createGoogleBindingFollowUpHandlers,
  IMPORT_DISPLAY_NAME_CONSUMER,
  IMPORT_SUBSCRIPTION_CONSUMER,
  IMPORT_REVIEW_SYNC_CONSUMER,
} from './google-binding-follow-up-consumers'
import { fixHistoryCutoff } from '#/contexts/review/infrastructure/repositories/review-provider-snapshot.repository'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { createPropertyGoogleBindingStore } from '#/contexts/property/infrastructure/property-google-binding-store'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { PoolClient } from 'pg'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createGoogleImportV2Store } from './google-import-v2-store'

const DRIZZLE = join(import.meta.dirname, '..', '..', '..', '..', 'drizzle')
const EXPAND = '0099_google_import_dispatch.sql'
const VALIDATE = '0100_google_import_dispatch_validation.sql'
const INDEX = '0101_google_import_dispatch_index.sql'
const NOW = new Date('2026-10-20T10:00:00.000Z')
const DEADLINE = new Date(NOW.getTime() + 86_400_000)
const ORG = 'google-import-dispatch-upgrade'
const USER = 'google-import-dispatch-upgrade-user'
const PARENT = '82000000-0000-4000-8000-000000000001'
const CONNECTION = '82000000-0000-4000-8000-000000000002'
const itemId = (ordinal: number) =>
  `82000000-0000-4000-8000-${String(ordinal + 10).padStart(12, '0')}`
const LEGACY_EVENT = '82000000-0000-4000-8000-000000000090'
const LEGACY_PROPERTY = '82000000-0000-4000-8000-000000000091'
const UNFINISHED_EVENT = '82000000-0000-4000-8000-000000000092'
const UNFINISHED_PROPERTY = '82000000-0000-4000-8000-000000000093'
const SHADOW_SCHEMA = `import_upgrade_${randomUUID().replaceAll('-', '')}`

describe('Google import dispatch populated upgrade (real PostgreSQL)', () => {
  let lease: TestLease
  let client: PoolClient

  async function applyMigration(file: string) {
    const statements = readFileSync(join(DRIZZLE, file), 'utf8')
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean)
    for (const statement of statements) await client.query(statement)
  }

  async function rowsWithoutDispatchColumns() {
    const { rows } = await client.query<{ row: Record<string, unknown> }>(`
      SELECT to_jsonb(item) - 'dispatch_epoch' - 'next_dispatch_at' AS row
      FROM gbp_import_request_items AS item ORDER BY id
    `)
    return rows.map(({ row }) => row)
  }

  async function seedLegacyItem(
    ordinal: number,
    status: 'pending' | 'processing' | 'imported',
    leaseExpiresAt: Date | null,
    tombstone = false,
  ) {
    const active = status !== 'imported'
    await client.query(
      `
      INSERT INTO gbp_import_request_items (
        id, organization_id, import_job_id, connection_id,
        destination_property_id, provider_account_suffix, provider_location_suffix,
        expected_connection_lifecycle_version, expected_connection_access_version,
        expected_credential_generation, action, update_existing_profile,
        property_name, country_code, timezone, status, outcome_code,
        effect_deadline_at, highest_attempt_for_revision, claim_fence,
        claim_lease_expires_at, first_terminal_at, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $8, $8,
        'create', true, 'Upgrade cafe', 'US', 'UTC', $9, $10, $11, $12,
        $13, $14, $15, $16, $16
      )
    `,
      [
        itemId(ordinal),
        ORG,
        PARENT,
        active ? CONNECTION : null,
        tombstone
          ? null
          : ordinal === 4
            ? LEGACY_PROPERTY
            : ordinal === 2
              ? UNFINISHED_PROPERTY
              : randomUUID(),
        active ? 'account' : null,
        active ? `location-${ordinal}` : null,
        active ? 1 : null,
        status,
        active ? null : 'imported',
        DEADLINE,
        status === 'processing' ? 1 : 0,
        status === 'processing' ? randomUUID() : null,
        leaseExpiresAt,
        active ? null : NOW,
        NOW,
      ],
    )
  }

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    client = await lease.pool.connect()
    // Only this disposable schema is changed; the fully migrated public tables
    // supply the surrounding legacy constraints and PostgreSQL enum types.
    await client.query(`CREATE SCHEMA ${SHADOW_SCHEMA}`)
    for (const table of [
      'gbp_import_requests',
      'gbp_import_request_items',
      'outbox_events',
      'event_consumer_receipts',
      'properties',
      'idempotency_receipts',
      'review_provider_history_cutoffs',
    ]) {
      await client.query(
        `CREATE TABLE ${SHADOW_SCHEMA}.${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`,
      )
    }
    await client.query(`SET search_path TO ${SHADOW_SCHEMA}, public`)
    await client.query(
      'ALTER TABLE gbp_import_request_items DROP COLUMN next_dispatch_at, DROP COLUMN dispatch_epoch',
    )
    await client.query(
      `
      INSERT INTO gbp_import_requests (
        id, organization_id, request_id, initiated_by, status, total_count,
        pending_count, processing_count, imported_count, processed_count,
        created_at, updated_at
      ) VALUES ($1, $2, $1, $3, 'processing', 5, 1, 2, 2, 2, $4, $4)
    `,
      [PARENT, ORG, USER, NOW],
    )
    await seedLegacyItem(1, 'pending', null)
    await seedLegacyItem(2, 'processing', new Date(NOW.getTime() - 1))
    await seedLegacyItem(3, 'processing', new Date(NOW.getTime() + 60_000))
    await seedLegacyItem(4, 'imported', null)
    await seedLegacyItem(5, 'imported', null, true)
    await client.query(
      `
      INSERT INTO outbox_events (id, event_type, event_version, payload,
        organization_id, property_id, source_context, source_aggregate_id, created_at, published_at)
      VALUES ($1, 'property.google_binding.changed', 1, $2, $3, $4, 'property', $6, $5, $5)
    `,
      [
        LEGACY_EVENT,
        JSON.stringify({
          organizationId: ORG,
          propertyId: LEGACY_PROPERTY,
          connectionId: CONNECTION,
          sourceEpoch: 1,
          change: 'created',
          occurredAt: NOW.toISOString(),
        }),
        ORG,
        LEGACY_PROPERTY,
        NOW,
        LEGACY_PROPERTY,
      ],
    )
    // The old worker committed the binding and receipt, then died before any
    // follow-up or terminal checkpoint. Its claim is now expired.
    await client.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone,
        google_connection_id, gbp_account_id, gbp_location_id,
        google_binding_state, source_epoch)
       VALUES ($1, $2, 'Unfinished cafe', 'unfinished-cafe', 'UTC',
         $3, 'account', 'location-2', 'active', 1)`,
      [UNFINISHED_PROPERTY, ORG, CONNECTION],
    )
    await client.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone,
        google_connection_id, gbp_account_id, gbp_location_id,
        google_binding_state, source_epoch)
       VALUES ($1, $2, 'Existing cafe', 'existing-cafe', 'UTC',
         $3, 'account', 'location-4', 'active', 1)`,
      [LEGACY_PROPERTY, ORG, CONNECTION],
    )
    await client.query(
      `INSERT INTO idempotency_receipts (scope, key, payload, recorded_at)
       VALUES ('property_operation', $1, $2, $3)`,
      [
        JSON.stringify([ORG, itemId(2)]),
        JSON.stringify({
          organizationId: ORG,
          idempotencyKey: itemId(2),
          destinationPropertyId: UNFINISHED_PROPERTY,
          destinationSourceEpoch: 1,
          destinationProfileVersion: 1,
          outcome: 'imported',
          tombstone: false,
          expiresAt: new Date(NOW.getTime() + 32 * 86_400_000).toISOString(),
          retentionReleasedAt: null,
        }),
        NOW,
      ],
    )
    await client.query(
      `INSERT INTO outbox_events (id, event_type, event_version, payload,
         organization_id, property_id, source_context, source_aggregate_id, created_at, published_at)
       SELECT $1, event_type, event_version,
         jsonb_set(payload, '{propertyId}', to_jsonb($2::text)),
         organization_id, $2, source_context, $2, created_at, published_at
       FROM outbox_events WHERE id = $3`,
      [UNFINISHED_EVENT, UNFINISHED_PROPERTY, LEGACY_EVENT],
    )
    registerAllEventSchemas()
  })

  afterAll(async () => {
    try {
      if (client) {
        await client.query('SET search_path TO public')
        await client.query(`DROP SCHEMA IF EXISTS ${SHADOW_SCHEMA} CASCADE`)
        client.release()
      }
    } finally {
      await lease?.release()
    }
  })

  it('preserves populated rows and leaves legacy active work recoverable without reviving finished imports', async () => {
    const before = await rowsWithoutDispatchColumns()
    const parentsBefore = await client.query(
      'SELECT to_jsonb(parent) AS row FROM gbp_import_requests AS parent',
    )
    await applyMigration(EXPAND)
    await applyMigration(VALIDATE)
    // The real concurrent-index statement must run outside a transaction.
    await applyMigration(INDEX)
    expect(await rowsWithoutDispatchColumns()).toEqual(before)
    expect(
      (
        await client.query(
          'SELECT to_jsonb(parent) AS row FROM gbp_import_requests AS parent',
        )
      ).rows,
    ).toEqual(parentsBefore.rows)
    const upgraded = await client.query(`
      SELECT id, dispatch_epoch, next_dispatch_at FROM gbp_import_request_items ORDER BY id
    `)
    expect(upgraded.rows).toEqual(
      [1, 2, 3, 4, 5].map((ordinal) => ({
        id: itemId(ordinal),
        dispatch_epoch: 0,
        next_dispatch_at: null,
      })),
    )

    // An outgoing image can still write a NULL appointment during rollout.
    await seedLegacyItem(6, 'pending', null)
    await client.query(
      'UPDATE gbp_import_requests SET total_count = 6, pending_count = 2',
    )
    const db = drizzle(client) as unknown as Database
    const store = createGoogleImportV2Store(db, () => NOW, {
      ensureImportFollowUps: createPropertyGoogleBindingStore(db).ensureImportFollowUps,
      readReceipt: createPropertyGoogleBindingStore(db).readReceipt,
      prepareImportSync: (tx, scope) =>
        fixHistoryCutoff(tx, {
          ...scope,
          organizationId: organizationId(scope.organizationId),
          propertyId: propertyId(scope.propertyId),
        }),
    })
    const reserved = await store.reserveDueItems(NOW, 100)
    expect(reserved.map((item) => item.itemId).sort()).toEqual(
      [itemId(1), itemId(2), itemId(6)].sort(),
    )
    expect(reserved.every((item) => item.dispatchEpoch === 0)).toBe(true)
    const afterReservation = await client.query(
      `
      SELECT id, next_dispatch_at FROM gbp_import_request_items
      WHERE id = ANY($1::uuid[]) ORDER BY id
    `,
      [[itemId(1), itemId(2), itemId(6)]],
    )
    expect(afterReservation.rows).toEqual(
      [1, 2, 6].map((ordinal) => ({
        id: itemId(ordinal),
        next_dispatch_at: new Date(NOW.getTime() + 60_000),
      })),
    )
    await expect(store.reserveDueItems(NOW, 100)).resolves.toEqual([])
    const finished = await client.query(
      `
      SELECT to_jsonb(item) - 'dispatch_epoch' - 'next_dispatch_at' AS row
      FROM gbp_import_request_items AS item WHERE id = ANY($1::uuid[]) ORDER BY id
    `,
      [[itemId(4), itemId(5)]],
    )
    expect(finished.rows.map(({ row }) => row)).toEqual(before.slice(3))
    // A rolling outgoing worker knows nothing about the appointment column.
    await client.query(
      `
      UPDATE gbp_import_request_items
      SET status = 'imported', outcome_code = 'imported', first_terminal_at = $2,
          connection_id = NULL, provider_account_suffix = NULL, provider_location_suffix = NULL,
          expected_connection_lifecycle_version = NULL,
          expected_connection_access_version = NULL, expected_credential_generation = NULL
      WHERE id = $1
    `,
      [itemId(1), NOW],
    )
    await client.query(`
      UPDATE gbp_import_requests SET pending_count = 1, imported_count = 3, processed_count = 3
    `)
    const appointment = await client.query(
      'SELECT next_dispatch_at FROM gbp_import_request_items WHERE id = $1',
      [itemId(1)],
    )
    expect(appointment.rows).toEqual([
      { next_dispatch_at: new Date(NOW.getTime() + 60_000) },
    ])
    const nextSweep = await store.reserveDueItems(new Date(NOW.getTime() + 60_000), 100)
    expect(nextSweep.map((item) => item.itemId).sort()).toEqual(
      [itemId(2), itemId(3), itemId(6)].sort(),
    )
    // A retained event from a finished import still has a current binding.
    // New consumer registrations must settle it without repeating any effects.
    const receipts = createOutboxRepository(db)
    const names = [
      IMPORT_DISPLAY_NAME_CONSUMER,
      IMPORT_SUBSCRIPTION_CONSUMER,
      IMPORT_REVIEW_SYNC_CONSUMER,
    ]
    const events = await receipts.claimPublishedForConsumerRedelivery({
      consumerExpectations: names.map((consumerName) => ({
        eventType: 'property.google_binding.changed',
        consumerName,
      })),
      cutoff: new Date(NOW.getTime() + 60_000),
      now: new Date(NOW.getTime() + 120_000),
      limit: 100,
      maxAttempts: 8,
      backoffBaseMs: 60_000,
    })
    expect(events.map((event) => event.id).sort()).toEqual(
      [LEGACY_EVENT, UNFINISHED_EVENT].sort(),
    )
    const effects = {
      propertyBindingApi: createPropertyGoogleBindingStore(db),
      defaultPublicDisplayName: vi.fn(),
      subscribe: vi.fn(),
      enqueueReviewSync: vi.fn(async () => undefined),
    }
    const handlers = createGoogleBindingFollowUpHandlers({
      ...effects,
      receipts,
      newDeliveryId: randomUUID,
    })
    for (const event of events)
      for (const handler of Object.values(handlers))
        await expect(handler(buildConsumerEvent(event))).resolves.toEqual({
          status: 'obsolete',
        })
    expect(effects.defaultPublicDisplayName).not.toHaveBeenCalled()
    expect(effects.subscribe).not.toHaveBeenCalled()
    expect(effects.enqueueReviewSync).not.toHaveBeenCalled()
    for (const name of names)
      expect(await receipts.hasReceipt(LEGACY_EVENT, name)).toBe(true)
    const processor = createGoogleImportV2Processor({
      store,
      propertyBindingApi: effects.propertyBindingApi,
      authorizeGoogleImportCommand: async () => {
        throw new Error('Committed bindings must not be authorized again')
      },
      resolveActor: async () => {
        throw new Error('Committed bindings must not resolve an actor')
      },
      clock: () => NOW,
      newClaimFence: randomUUID,
      logger: createMockLogger(),
    })
    const delivery = {
      organizationId: ORG,
      itemId: itemId(2),
      retryRevision: 0,
      dispatchEpoch: 0,
      attemptOrdinal: 2,
    }
    await processor.process(delivery)
    expect(
      (
        await client.query('SELECT status FROM gbp_import_request_items WHERE id = $1', [
          itemId(2),
        ])
      ).rows,
    ).toEqual([{ status: 'imported' }])
    const recovered = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.organizationId, ORG))
    const marked = recovered.filter(
      (event) => (event.payload as Record<string, unknown>).importFollowUps === true,
    )
    expect(marked).toHaveLength(1)
    expect(marked[0]!.propertyId).toBe(UNFINISHED_PROPERTY)
    // Recovery must survive another process death after marking the item imported.
    await processor.process(delivery)
    effects.subscribe.mockResolvedValue({ outcome: 'subscribed' })
    effects.enqueueReviewSync.mockImplementation(async () => {
      await receipts.insertReceipt(marked[0]!.id, IMPORT_REVIEW_SYNC_CONSUMER, 'applied')
    })
    for (const handler of Object.values(handlers))
      await expect(
        handler(buildConsumerEvent({ ...marked[0]!, recordedAt: marked[0]!.createdAt })),
      ).resolves.toEqual({ status: 'applied' })
    expect(effects.defaultPublicDisplayName).toHaveBeenCalledTimes(1)
    expect(effects.subscribe).toHaveBeenCalledTimes(1)
    expect(effects.enqueueReviewSync).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: UNFINISHED_PROPERTY, sourceEpoch: 1 }),
      expect.anything(),
    )
    expect((await client.query('SELECT id FROM outbox_events')).rows).toHaveLength(3)
    expect(await rowsWithoutDispatchColumns()).toEqual(
      expect.arrayContaining(before.slice(3)),
    )
  })
})
