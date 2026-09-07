// LIF-01-T19 — permanent Property Erase against real PostgreSQL.
//
// The claims a reviewer has to be able to check:
//   * erasing ONE Property leaves its siblings in the same Organization
//     byte-identical;
//   * independently retained managerial work survives — a `replies` row for a
//     review of a DIFFERENT Property, and org-level `audit_logs`;
//   * the irreversible boundary holds against direct SQL, not only the domain
//     transition table.
//
// An outer transaction always rolls the proof back. That matters here because
// the authority and receipt tables carry DELETE-refusing triggers by design.

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createGuestPropertyEraseContributor } from '#/contexts/guest/infrastructure/adapters/guest-property-erase.adapter'
import { getDb, type Database } from '#/shared/db'
import { appendBackupErasureLedgerEntry } from '#/shared/db/lifecycle/backup-erasure-ledger'
import type { Tx } from '#/shared/outbox/commit'
import { advancePropertyErase } from './jobs/advance-property-erase.job'
import { createPropertyPropertyEraseContributor } from './adapters/property-property-erase.adapter'
import { createPropertyEraseCommandStore } from './property-erase-command-store'

const db = getDb()
const ROLLBACK = new Error('rollback property erase integration proof')
const NOW = new Date('2027-06-01T00:00:00.000Z')
const SURVIVING_REPLY = 'MANAGERIAL_WORK_THAT_MUST_SURVIVE'

type Fixture = Readonly<{
  organizationId: string
  targetPropertyId: string
  siblingPropertyId: string
  siblingReviewId: string
  userId: string
}>

async function seed(tx: Tx): Promise<Fixture> {
  const fixture: Fixture = {
    organizationId: `erase-org-${randomUUID()}`,
    targetPropertyId: randomUUID(),
    siblingPropertyId: randomUUID(),
    siblingReviewId: randomUUID(),
    userId: `erase-user-${randomUUID()}`,
  }
  await tx.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${fixture.organizationId}, 'Erase Proof', ${fixture.organizationId},
            clock_timestamp())
  `)
  await tx.execute(sql`
    INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
    VALUES (${fixture.userId}, 'Erase Admin', ${`${fixture.userId}@example.invalid`},
            true, clock_timestamp(), clock_timestamp())
  `)
  for (const [id, slug, state] of [
    [fixture.targetPropertyId, 'target', 'archived'],
    [fixture.siblingPropertyId, 'sibling', 'active'],
  ] as const) {
    await tx.execute(sql`
      INSERT INTO properties (id, organization_id, name, slug, timezone,
                              lifecycle_state, address, created_at, updated_at)
      VALUES (${id}::uuid, ${fixture.organizationId}, ${`Property ${slug}`},
              ${`${slug}-${id}`}, 'UTC', ${state}, '1 Test Street',
              clock_timestamp(), clock_timestamp())
    `)
    await tx.execute(sql`
      INSERT INTO portals (id, organization_id, property_id, entity_id, name, slug,
                           publication_state, created_at, updated_at)
      VALUES (${id}::uuid, ${fixture.organizationId}, ${id}::uuid, ${id}::uuid,
              ${`Portal ${slug}`}, ${`portal-${slug}-${id}`}, 'published',
              clock_timestamp(), clock_timestamp())
    `)
    await tx.execute(sql`
      INSERT INTO guest_responses (
        id, organization_id, property_id, portal_id, status, rating,
        response_consent, text_consent, private_feedback_threshold,
        correction_count, submitted_at, feedback_submitted_at,
        feedback_submission_revision, retention_deadline, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), ${fixture.organizationId}, ${id}::uuid, ${id}::uuid,
        'submitted', 2, true, true, 3, 0, clock_timestamp(), clock_timestamp(), 1,
        clock_timestamp() + interval '700 days', clock_timestamp(), clock_timestamp()
      )
    `)
  }
  // Managerial work on the SIBLING Property. It is retained for reasons that
  // have nothing to do with the erased Property and must not be touched.
  await tx.execute(sql`
    INSERT INTO reviews (
      id, organization_id, property_id, platform, external_id, rating,
      source_epoch, source_revision, analysis_sequence, created_at, updated_at
    ) VALUES (
      ${fixture.siblingReviewId}::uuid, ${fixture.organizationId},
      ${fixture.siblingPropertyId}::uuid, 'google',
      ${`erase-proof-${fixture.siblingReviewId}`}, 5, 0, 1, 1,
      clock_timestamp(), clock_timestamp()
    )
  `)
  await tx.execute(sql`
    INSERT INTO replies (
      id, organization_id, review_id, text, status, source, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), ${fixture.organizationId}, ${fixture.siblingReviewId}::uuid,
      ${SURVIVING_REPLY}, 'published', 'internal', clock_timestamp(), clock_timestamp()
    )
  `)
  await tx.execute(sql`
    INSERT INTO audit_logs (
      id, organization_id, user_id, action, resource_type, resource_id,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid()::text, ${fixture.organizationId}, ${fixture.userId},
      'property.archived', 'property', ${fixture.targetPropertyId},
      clock_timestamp(), clock_timestamp()
    )
  `)
  return fixture
}

const contributors = [
  createGuestPropertyEraseContributor(),
  createPropertyPropertyEraseContributor(),
]

async function runFullErase(tx: Tx, fixture: Fixture): Promise<string> {
  const store = createPropertyEraseCommandStore(tx as unknown as Database).withTx(tx)
  const authority = await store.request({
    organizationId: fixture.organizationId,
    propertyId: fixture.targetPropertyId,
    requestedByUserId: fixture.userId,
    identityVerificationRef: 'identity:webauthn:2027-06-01',
    supportOperatorId: 'ops-erase',
    supportAuthorizationRef: 'support:auth:zd-99001',
    evidenceRef: 'erase:request:zd-99001',
    correlationId: 'corr-erase-integration',
    requestedAt: NOW,
  })
  await store.recordPreview({
    authorityId: authority.id,
    organizationId: fixture.organizationId,
    inventoryRevision: 1,
    inventoryDigest: 'a'.repeat(64),
    retentionPreviewRef: 'retention:preview:2027-06-01',
    occurredAt: NOW,
  })
  await store.confirm({
    authorityId: authority.id,
    organizationId: fixture.organizationId,
    confirmationDigest: 'b'.repeat(64),
    inventoryRevision: 1,
    graceExpiresAt: new Date(NOW.getTime() - 1_000),
    occurredAt: NOW,
  })

  const deps = {
    store,
    storeIn: () => store,
    contributors,
    runInTransaction: async <T>(work: (inner: Tx) => Promise<T>) => work(tx),
    appendLedgerEntry: appendBackupErasureLedgerEntry,
    now: () => NOW,
  }
  // Pass 1 schedules, pass 2 crosses the irreversible boundary, pass 3 erases
  // and completes. Each is a separate pass so cancellation stays possible right
  // up to the boundary and no single failure spans it.
  expect(await advancePropertyErase(deps)).toMatchObject({ toState: 'purge_pending' })
  expect(await advancePropertyErase(deps)).toMatchObject({ toState: 'purging' })
  expect(await advancePropertyErase(deps)).toMatchObject({ toState: 'purged' })
  return authority.id
}

async function count(tx: Tx, statement: ReturnType<typeof sql>): Promise<number> {
  const result = await tx.execute(statement)
  return Number((result.rows[0] as { rows: number | string }).rows)
}

describe('permanent Property Erase command store (LIF-01-T19)', () => {
  it('erases one Property and leaves its siblings and managerial work intact', async () => {
    let proofCompleted = false

    await expect(
      db.transaction(async (raw) => {
        const tx = raw as unknown as Tx
        const fixture = await seed(tx)
        const before = await tx.execute(sql`
          SELECT name, slug, address, lifecycle_state FROM properties
          WHERE id = ${fixture.siblingPropertyId}::uuid
        `)
        const authorityId = await runFullErase(tx, fixture)

        // The target's guest content is gone and its descriptive content is
        // scrubbed, but the tombstone survives so the evidence stays resolvable.
        expect(
          await count(
            tx,
            sql`SELECT COUNT(*)::int AS "rows" FROM guest_responses
                WHERE property_id = ${fixture.targetPropertyId}::uuid`,
          ),
        ).toBe(0)
        const target = await tx.execute(sql`
          SELECT name, address, lifecycle_state FROM properties
          WHERE id = ${fixture.targetPropertyId}::uuid
        `)
        expect(target.rows[0]).toMatchObject({
          name: 'erased-property',
          address: null,
          lifecycle_state: 'purged',
        })

        // The sibling is byte-identical.
        const after = await tx.execute(sql`
          SELECT name, slug, address, lifecycle_state FROM properties
          WHERE id = ${fixture.siblingPropertyId}::uuid
        `)
        expect(after.rows[0]).toEqual(before.rows[0])
        expect(
          await count(
            tx,
            sql`SELECT COUNT(*)::int AS "rows" FROM guest_responses
                WHERE property_id = ${fixture.siblingPropertyId}::uuid`,
          ),
        ).toBe(1)

        // Independently retained managerial work survives.
        expect(
          await count(
            tx,
            sql`SELECT COUNT(*)::int AS "rows" FROM replies
                WHERE text = ${SURVIVING_REPLY}`,
          ),
        ).toBe(1)
        expect(
          await count(
            tx,
            sql`SELECT COUNT(*)::int AS "rows" FROM audit_logs
                WHERE organization_id = ${fixture.organizationId}`,
          ),
        ).toBe(1)

        // And the backup-erasure ledger records the erasure exactly once.
        expect(
          await count(
            tx,
            sql`SELECT COUNT(*)::int AS "rows" FROM backup_erasure_ledger
                WHERE closure_lineage_id = ${authorityId}::uuid`,
          ),
        ).toBe(1)

        proofCompleted = true
        throw ROLLBACK
      }),
    ).rejects.toBe(ROLLBACK)

    expect(proofCompleted).toBe(true)
  })

  it('refuses cancellation after purging through the database trigger', async () => {
    await expect(
      db.transaction(async (raw) => {
        const tx = raw as unknown as Tx
        const fixture = await seed(tx)
        const store = createPropertyEraseCommandStore(tx as unknown as Database).withTx(
          tx,
        )
        const authority = await store.request({
          organizationId: fixture.organizationId,
          propertyId: fixture.targetPropertyId,
          requestedByUserId: fixture.userId,
          identityVerificationRef: 'identity:webauthn:2027-06-01',
          supportOperatorId: 'ops-erase',
          supportAuthorizationRef: 'support:auth:zd-99002',
          evidenceRef: 'erase:request:zd-99002',
          correlationId: 'corr-erase-trigger',
          requestedAt: NOW,
        })
        await store.recordPreview({
          authorityId: authority.id,
          organizationId: fixture.organizationId,
          inventoryRevision: 1,
          inventoryDigest: 'a'.repeat(64),
          retentionPreviewRef: 'retention:preview:2027-06-01',
          occurredAt: NOW,
        })
        await store.confirm({
          authorityId: authority.id,
          organizationId: fixture.organizationId,
          confirmationDigest: 'b'.repeat(64),
          inventoryRevision: 1,
          graceExpiresAt: NOW,
          occurredAt: NOW,
        })
        await store.transition({
          authorityId: authority.id,
          from: 'confirmed',
          to: 'purge_pending',
          occurredAt: NOW,
        })
        await store.transition({
          authorityId: authority.id,
          from: 'purge_pending',
          to: 'purging',
          occurredAt: NOW,
        })

        // Direct SQL, bypassing the domain transition table entirely.
        let message = ''
        try {
          await (raw as unknown as Database).execute(sql`
            UPDATE property_erase_authorities
            SET state = 'cancelled', cancelled_at = now()
            WHERE id = ${authority.id}::uuid
          `)
        } catch (error) {
          const cause = (error as { cause?: { message?: string } }).cause
          message = cause?.message ?? String(error)
        }
        expect(message).toMatch(/irreversible once purging has begun/u)

        throw ROLLBACK
      }),
    ).rejects.toBe(ROLLBACK)
  })
})
