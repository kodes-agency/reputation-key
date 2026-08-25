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
        })
        expect(first.counts.sessionsInvalidated).toBeGreaterThanOrEqual(1)
        expect(first.counts.verificationTokensInvalidated).toBeGreaterThanOrEqual(1)
        expect(first.counts.invitationsCanceled).toBeGreaterThanOrEqual(1)
        expect(first.counts.digestBatchesTerminated).toBeGreaterThanOrEqual(1)
        expect(first.counts.legacyImportJobsCanceled).toBeGreaterThanOrEqual(1)
        expect(first.counts.legacyImportEffectLeasesReleased).toBeGreaterThanOrEqual(1)

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
            (SELECT state FROM legacy_import_effect_leases WHERE id = ${LEGACY_LEASE_ID}::uuid) AS legacy_lease
        `)
        expect(authorityRows.rows[0]).toMatchObject({
          sessions: 0,
          verifications: 0,
          invitation: 'canceled',
          digest: 'terminal',
          legacy_job: 'failed',
          legacy_lease: 'released',
        })

        const replay = await applyRecoveryFence(transaction, input)
        expect(replay).toMatchObject({
          id: first.id,
          generation: first.generation,
          replayed: true,
          counts: first.counts,
        })
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
