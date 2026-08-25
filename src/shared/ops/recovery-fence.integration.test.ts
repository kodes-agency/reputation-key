// REG-04 — real PostgreSQL proof for isolated-restore recovery fencing.
//
// This operation is deliberately cell-global. The integration project runs
// serially, and an outer transaction always rolls the proof back so no test
// authority or evidence leaks into the shared scratch database.

import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { getDb, type Database } from '#/shared/db'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import {
  applyRecoveryFence,
  inspectRecoveryFence,
} from '#/shared/db/recovery/postgres-recovery-fence'

const db = getDb()
const ROLLBACK = new Error('rollback recovery fence integration proof')
const USER_ID = 'recovery-proof-user'
const SESSION_ID = 'recovery-proof-session'
const VERIFICATION_ID = 'recovery-proof-verification'
const INVITATION_ID = 'recovery-proof-invitation'
const DIGEST_ID = '10000000-0000-4000-8000-000000000401'
const LEGACY_JOB_ID = '10000000-0000-4000-8000-000000000402'
const LEGACY_LEASE_ID = '10000000-0000-4000-8000-000000000403'
const MOVE_PROPERTY_ID = '10000000-0000-4000-8000-000000000404'
const MOVE_ID = '10000000-0000-4000-8000-000000000405'
const GOOGLE_CONNECTION_ID = '10000000-0000-4000-8000-000000000406'
const IMPORT_V2_PARENT_ID = '10000000-0000-4000-8000-000000000407'
const IMPORT_V2_CANCELLED_ITEM_ID = '10000000-0000-4000-8000-000000000408'
const IMPORT_V2_COMMITTED_ITEM_ID = '10000000-0000-4000-8000-000000000409'
const IMPORT_V2_PROPERTY_ID = '10000000-0000-4000-8000-000000000410'

describe('restore recovery fence (REG-04, integration)', () => {
  it('atomically fences unpublished facts, excludes relay claims, and replays evidence', async () => {
    let proofCompleted = false

    await expect(
      db.transaction(async (tx) => {
        const transaction = tx as unknown as Database
        await transaction.execute(sql`
          INSERT INTO "user" (
            id, name, email, "emailVerified", "createdAt", "updatedAt"
          ) VALUES (
            ${USER_ID}, 'Recovery Proof', 'recovery-proof@example.invalid', false,
            clock_timestamp(), clock_timestamp()
          )
        `)
        await transaction.execute(sql`
          INSERT INTO session (
            id, "expiresAt", token, "userId", "createdAt", "updatedAt"
          ) VALUES (
            ${SESSION_ID}, clock_timestamp() + interval '1 hour',
            'recovery-proof-token', ${USER_ID}, clock_timestamp(), clock_timestamp()
          )
        `)
        await transaction.execute(sql`
          INSERT INTO verification (
            id, identifier, value, "expiresAt", "createdAt", "updatedAt"
          ) VALUES (
            ${VERIFICATION_ID}, 'recovery-proof', 'opaque-proof-value',
            clock_timestamp() + interval '1 hour', clock_timestamp(), clock_timestamp()
          )
        `)
        await transaction.execute(sql`
          INSERT INTO organization (id, name, slug, "createdAt")
          VALUES (
            'org-recovery-proof', 'Recovery Proof Organization',
            'recovery-proof-organization', clock_timestamp()
          )
        `)
        await transaction.execute(sql`
          INSERT INTO google_connections (
            id, organization_id, google_subject, encrypted_access_token,
            encrypted_refresh_token, token_expires_at, scopes, connected_by,
            visibility, status, credential_use_state, created_at, updated_at
          ) VALUES (
            ${GOOGLE_CONNECTION_ID}::uuid, 'org-recovery-proof',
            'recovery-proof-google-subject', 'encrypted-access', 'encrypted-refresh',
            clock_timestamp() + interval '1 day', ARRAY['business.manage'], ${USER_ID},
            'organization', 'active', 'active', clock_timestamp(), clock_timestamp()
          )
        `)
        await transaction.execute(sql`
          INSERT INTO properties (
            id, organization_id, name, slug, timezone, country_code,
            processing_region, data_cell_id, processing_region_resolved_at
          ) VALUES (
            ${IMPORT_V2_PROPERTY_ID}::uuid, 'org-recovery-proof',
            'Recovery Import Destination', 'recovery-import-destination', 'UTC', 'US',
            'us', 'us', clock_timestamp()
          )
        `)
        await transaction.execute(sql`
          INSERT INTO invitation (
            id, "organizationId", email, status, "expiresAt", "inviterId", "createdAt"
          ) VALUES (
            ${INVITATION_ID}, 'org-recovery-proof', 'invite@example.invalid', 'pending',
            clock_timestamp() + interval '1 hour', ${USER_ID}, clock_timestamp()
          )
        `)
        await transaction.execute(sql`
          INSERT INTO notification_digest_batches (
            id, organization_id, user_id, local_date, sequence, member_digest,
            content_digest, provider_idempotency_key, state, created_at, updated_at
          ) VALUES (
            ${DIGEST_ID}::uuid, 'org-recovery-proof', ${USER_ID}, current_date, 1,
            ${'c'.repeat(64)}, ${'d'.repeat(64)}, 'recovery-proof-digest', 'prepared',
            clock_timestamp(), clock_timestamp()
          )
        `)
        await transaction.execute(sql`
          INSERT INTO gbp_import_jobs (
            id, organization_id, initiated_by, status, created_at, updated_at
          ) VALUES (
            ${LEGACY_JOB_ID}::uuid, 'org-recovery-proof', ${USER_ID}, 'queued',
            clock_timestamp(), clock_timestamp()
          )
        `)
        await transaction.execute(sql`
          INSERT INTO legacy_import_control (environment)
          VALUES ('recovery-proof')
        `)
        await transaction.execute(sql`
          INSERT INTO legacy_import_effect_leases (
            id, environment, job_id, generation, worker_id, state, acquired_at, created_at
          ) VALUES (
            ${LEGACY_LEASE_ID}::uuid, 'recovery-proof', ${LEGACY_JOB_ID}::uuid,
            1, 'recovery-proof-worker', 'active', clock_timestamp(), clock_timestamp()
          )
        `)
        await transaction.execute(sql`
          INSERT INTO gbp_import_requests (
            id, organization_id, request_id, initiated_by, status, total_count,
            processed_count, pending_count, processing_count, created_at, updated_at
          ) VALUES (
            ${IMPORT_V2_PARENT_ID}::uuid, 'org-recovery-proof',
            ${IMPORT_V2_PARENT_ID}::uuid, ${USER_ID}, 'queued', 2, 0, 2, 0,
            clock_timestamp(), clock_timestamp()
          )
        `)
        await transaction.execute(sql`
          WITH instant AS (SELECT statement_timestamp() AS at)
          INSERT INTO gbp_import_request_items (
            id, organization_id, import_job_id, connection_id,
            destination_property_id, provider_account_suffix, provider_location_suffix,
            expected_connection_lifecycle_version, expected_connection_access_version,
            expected_credential_generation, action, update_existing_profile,
            property_name, country_code, timezone, processing_region,
            routing_policy_version, status, effect_deadline_at, created_at, updated_at
          )
          SELECT item_id, 'org-recovery-proof', ${IMPORT_V2_PARENT_ID}::uuid,
                 ${GOOGLE_CONNECTION_ID}::uuid, destination_id,
                 'recovery-account', location_suffix, 1, 1, 1, 'create', true,
                 property_name, 'US', 'UTC', 'us', 2, 'pending',
                 instant.at + interval '24 hours', instant.at, instant.at
          FROM instant
          CROSS JOIN (VALUES
            (${IMPORT_V2_CANCELLED_ITEM_ID}::uuid,
             '10000000-0000-4000-8000-000000000411'::uuid,
             'recovery-location-cancel', 'Recovery Cancel Candidate'),
            (${IMPORT_V2_COMMITTED_ITEM_ID}::uuid,
             ${IMPORT_V2_PROPERTY_ID}::uuid,
             'recovery-location-commit', 'Recovery Commit Candidate')
          ) AS item(item_id, destination_id, location_suffix, property_name)
        `)
        await transaction.execute(sql`
          INSERT INTO property_operation_receipts (
            organization_id, idempotency_key, destination_property_id, outcome,
            destination_source_epoch, destination_profile_version, tombstone,
            expires_at, created_at, updated_at
          ) VALUES (
            'org-recovery-proof', ${IMPORT_V2_COMMITTED_ITEM_ID}::uuid,
            ${IMPORT_V2_PROPERTY_ID}::uuid, 'imported', 0, 1, false,
            clock_timestamp() + interval '7 days', clock_timestamp(), clock_timestamp()
          )
        `)
        const inserted = await transaction.execute(sql`
          INSERT INTO outbox_events (
            event_type, event_version, payload, organization_id,
            source_context, source_aggregate_id, created_at
          ) VALUES (
            'test.recovery-fence', 1, '{"resourceId":"recovery-proof"}'::jsonb,
            'org-recovery-proof', 'test', 'recovery-proof', clock_timestamp()
          )
          RETURNING id
        `)
        const eventId = (inserted.rows[0] as { id: string }).id

        const before = await inspectRecoveryFence(transaction)
        expect(before.outboxEventsFenced).toBeGreaterThanOrEqual(1)

        const input = {
          dataCellId: 'us' as const,
          sourceReleaseSha: 'a'.repeat(40),
          sourceManifestSha256: 'b'.repeat(64),
          restorePointAt: new Date(Date.now() - 60_000),
          operatorId: 'restore-proof@example.com',
          correlationId: 'restore-proof-correlation',
        }
        const first = await applyRecoveryFence(transaction, input)
        expect(first.replayed).toBe(false)
        expect(first.generation).toBeGreaterThanOrEqual(1)
        expect(first.counts.outboxEventsFenced).toBeGreaterThanOrEqual(1)
        expect(first.counts).toMatchObject({
          sessionsInvalidated: expect.any(Number),
          verificationTokensInvalidated: expect.any(Number),
          invitationsCanceled: expect.any(Number),
          digestBatchesTerminated: expect.any(Number),
          legacyImportJobsCanceled: expect.any(Number),
          legacyImportEffectLeasesReleased: expect.any(Number),
          googleImportV2ParentsFenced: expect.any(Number),
          googleImportV2ItemsFenced: expect.any(Number),
        })
        expect(first.counts.sessionsInvalidated).toBeGreaterThanOrEqual(1)
        expect(first.counts.verificationTokensInvalidated).toBeGreaterThanOrEqual(1)
        expect(first.counts.invitationsCanceled).toBeGreaterThanOrEqual(1)
        expect(first.counts.digestBatchesTerminated).toBeGreaterThanOrEqual(1)
        expect(first.counts.legacyImportJobsCanceled).toBeGreaterThanOrEqual(1)
        expect(first.counts.legacyImportEffectLeasesReleased).toBeGreaterThanOrEqual(1)
        expect(first.counts.googleImportV2ParentsFenced).toBeGreaterThanOrEqual(1)
        expect(first.counts.googleImportV2ItemsFenced).toBeGreaterThanOrEqual(2)

        const after = await inspectRecoveryFence(transaction)
        expect(Object.values(after).every((count) => count === 0)).toBe(true)

        const row = await transaction.execute(sql`
          SELECT recovery_fence_run_id AS "runId", recovery_fenced_at AS "fencedAt",
                 lease_owner AS "leaseOwner", lease_expires_at AS "leaseExpiresAt"
          FROM outbox_events
          WHERE id = ${eventId}::uuid
        `)
        expect(row.rows[0]).toMatchObject({
          runId: first.id,
          leaseOwner: null,
          leaseExpiresAt: null,
        })
        expect(row.rows[0]?.fencedAt).not.toBeNull()

        const relay = createOutboxRepository(transaction)
        expect(await relay.claimUnpublished(10, 'relay-recovery-proof', 30_000)).toEqual(
          [],
        )
        await relay.markPublished(eventId)
        const publication = await transaction.execute(sql`
          SELECT published_at AS "publishedAt"
          FROM outbox_events WHERE id = ${eventId}::uuid
        `)
        expect(publication.rows[0]).toMatchObject({ publishedAt: null })

        const authorityRows = await transaction.execute(sql`
          SELECT
            (SELECT count(*)::int FROM session WHERE id = ${SESSION_ID}) AS sessions,
            (SELECT count(*)::int FROM verification WHERE id = ${VERIFICATION_ID}) AS verifications,
            (SELECT status FROM invitation WHERE id = ${INVITATION_ID}) AS invitation,
            (SELECT state FROM notification_digest_batches WHERE id = ${DIGEST_ID}::uuid) AS digest,
            (SELECT status FROM gbp_import_jobs WHERE id = ${LEGACY_JOB_ID}::uuid) AS legacy_job,
            (SELECT state FROM legacy_import_effect_leases WHERE id = ${LEGACY_LEASE_ID}::uuid) AS legacy_lease,
            (SELECT status FROM gbp_import_requests WHERE id = ${IMPORT_V2_PARENT_ID}::uuid) AS v2_parent,
            (SELECT status FROM gbp_import_request_items WHERE id = ${IMPORT_V2_CANCELLED_ITEM_ID}::uuid) AS v2_cancelled_item,
            (SELECT outcome_code FROM gbp_import_request_items WHERE id = ${IMPORT_V2_CANCELLED_ITEM_ID}::uuid) AS v2_cancelled_outcome,
            (SELECT status FROM gbp_import_request_items WHERE id = ${IMPORT_V2_COMMITTED_ITEM_ID}::uuid) AS v2_committed_item,
            (SELECT outcome_code FROM gbp_import_request_items WHERE id = ${IMPORT_V2_COMMITTED_ITEM_ID}::uuid) AS v2_committed_outcome,
            (SELECT count(*)::int FROM gbp_import_request_items
              WHERE import_job_id = ${IMPORT_V2_PARENT_ID}::uuid
                AND (connection_id IS NOT NULL OR destination_property_id IS NOT NULL
                  OR claim_fence IS NOT NULL OR claim_lease_expires_at IS NOT NULL)) AS v2_authority_handles
        `)
        expect(authorityRows.rows[0]).toMatchObject({
          sessions: 0,
          verifications: 0,
          invitation: 'canceled',
          digest: 'terminal',
          legacy_job: 'failed',
          legacy_lease: 'released',
          v2_parent: 'completed_with_issues',
          v2_cancelled_item: 'cancelled',
          v2_cancelled_outcome: 'authorization_changed',
          v2_committed_item: 'imported',
          v2_committed_outcome: 'imported',
          v2_authority_handles: 0,
        })

        await transaction.execute(sql`
          INSERT INTO session (
            id, "expiresAt", token, "userId", "createdAt", "updatedAt"
          ) VALUES (
            'recovery-proof-replay-session', clock_timestamp() + interval '1 hour',
            'recovery-proof-replay-token', ${USER_ID}, clock_timestamp(), clock_timestamp()
          )
        `)
        const replayEvent = await transaction.execute(sql`
          INSERT INTO outbox_events (
            event_type, event_version, payload, organization_id,
            source_context, source_aggregate_id, created_at
          ) VALUES (
            'test.recovery-fence-replay', 1, '{"resourceId":"recovery-replay"}'::jsonb,
            'org-recovery-proof', 'test', 'recovery-replay', clock_timestamp()
          ) RETURNING id
        `)
        const replayEventId = (replayEvent.rows[0] as { id: string }).id
        const replayBefore = await inspectRecoveryFence(transaction)
        expect(replayBefore.sessionsInvalidated).toBeGreaterThanOrEqual(1)
        expect(replayBefore.outboxEventsFenced).toBeGreaterThanOrEqual(1)

        const replay = await applyRecoveryFence(transaction, input)
        expect(replay).toMatchObject({
          id: first.id,
          generation: first.generation,
          replayed: true,
        })
        expect(replay.counts.sessionsInvalidated).toBeGreaterThan(
          first.counts.sessionsInvalidated,
        )
        expect(replay.counts.outboxEventsFenced).toBeGreaterThan(
          first.counts.outboxEventsFenced,
        )
        const replayAfter = await inspectRecoveryFence(transaction)
        expect(Object.values(replayAfter).every((count) => count === 0)).toBe(true)
        const replayFence = await transaction.execute(sql`
          SELECT recovery_fence_run_id AS "runId"
          FROM outbox_events WHERE id = ${replayEventId}::uuid
        `)
        expect(replayFence.rows[0]).toMatchObject({ runId: first.id })
        await expect(
          applyRecoveryFence(transaction, {
            ...input,
            sourceReleaseSha: 'c'.repeat(40),
          }),
        ).rejects.toThrow(/source release conflicts/)

        proofCompleted = true
        throw ROLLBACK
      }),
    ).rejects.toBe(ROLLBACK)

    expect(proofCompleted).toBe(true)
  })

  it('refuses to guess through unresolved Data Cell move authority', async () => {
    await expect(
      db.transaction(async (tx) => {
        const transaction = tx as unknown as Database
        await transaction.execute(sql`
          INSERT INTO properties (
            id, organization_id, name, slug, timezone, country_code,
            processing_region, data_cell_id, processing_region_resolved_at
          ) VALUES (
            ${MOVE_PROPERTY_ID}::uuid, 'org-recovery-move-proof', 'Recovery Move',
            'recovery-move-proof', 'UTC', 'US', 'us', 'us', clock_timestamp()
          )
        `)
        await transaction.execute(sql`
          INSERT INTO region_moves (
            id, property_id, organization_id, from_region, to_region, state,
            requested_by, requested_at, state_changed_at
          ) VALUES (
            ${MOVE_ID}::uuid, ${MOVE_PROPERTY_ID}::uuid, 'org-recovery-move-proof',
            'us', 'europe', 'writes_paused', 'restore-proof@example.com',
            clock_timestamp(), clock_timestamp()
          )
        `)

        await expect(
          applyRecoveryFence(transaction, {
            dataCellId: 'us',
            sourceReleaseSha: 'e'.repeat(40),
            sourceManifestSha256: 'f'.repeat(64),
            restorePointAt: new Date(Date.now() - 60_000),
            operatorId: 'restore-proof@example.com',
            correlationId: 'restore-move-proof-correlation',
          }),
        ).rejects.toThrow(/Data Cell move exists/)

        throw ROLLBACK
      }),
    ).rejects.toBe(ROLLBACK)
  })
})
