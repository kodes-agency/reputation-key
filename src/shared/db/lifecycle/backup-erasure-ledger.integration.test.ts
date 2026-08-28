// LIF-01-T15 — the resurrection fence against real PostgreSQL.
//
// The failure this file exists to prevent: an Organization is purged, the cell
// is later restored from a backup taken BEFORE that purge, and the purged
// Organization's guest feedback is quietly readable again.
//
// An outer transaction always rolls the proof back, so no ledger entry or
// tenant fixture leaks into the shared scratch database. That matters more here
// than usual: the ledger's triggers refuse DELETE by design, so a leaked entry
// could not be cleaned up afterwards.

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createGuestBackupErasureReplayer } from '#/contexts/guest/infrastructure/adapters/guest-backup-erasure-replayer.adapter'
import { getDb, type Database } from '#/shared/db'
import {
  appendBackupErasureLedgerEntry,
  applyRestoreResurrectionFence,
  readBackupErasureLedger,
  releaseBackupErasureHold,
  type BackupErasureLedgerAppend,
} from './backup-erasure-ledger'
import { assertRestoredCellVerified } from '#/shared/ops/recovery-fence'
import type { Tx } from '#/shared/outbox/commit'

const db = getDb()
const ROLLBACK = new Error('rollback backup erasure ledger integration proof')

/** Guest content that must not survive a replayed erasure. */
const PRIVATE_TEXT = 'NEVER_SURVIVE_RESURRECTION_FEEDBACK_BODY'
const ERASED_AT = new Date('2027-03-01T00:00:00.000Z')

type Fixture = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  responseId: string
  lineage: string
}>

async function seedPurgedOrganization(tx: Tx): Promise<Fixture> {
  const fixture: Fixture = {
    organizationId: `erasure-ledger-org-${randomUUID()}`,
    propertyId: randomUUID(),
    portalId: randomUUID(),
    responseId: randomUUID(),
    lineage: randomUUID(),
  }
  await tx.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${fixture.organizationId}, 'Resurrection Proof',
            ${fixture.organizationId}, clock_timestamp())
  `)
  await tx.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone,
                            created_at, updated_at)
    VALUES (${fixture.propertyId}::uuid, ${fixture.organizationId},
            'Resurrection House', 'resurrection-house', 'UTC',
            clock_timestamp(), clock_timestamp())
  `)
  await tx.execute(sql`
    INSERT INTO portals (id, organization_id, property_id, entity_id, name, slug,
                         publication_state, created_at, updated_at)
    VALUES (${fixture.portalId}::uuid, ${fixture.organizationId},
            ${fixture.propertyId}::uuid, ${fixture.propertyId}::uuid,
            'Front Desk', 'front-desk', 'published',
            clock_timestamp(), clock_timestamp())
  `)
  await tx.execute(sql`
    INSERT INTO guest_responses (
      id, organization_id, property_id, portal_id, status, rating,
      response_consent, text_consent, private_feedback_threshold,
      correction_count, submitted_at, feedback_submitted_at,
      feedback_submission_revision, retention_deadline, created_at, updated_at
    ) VALUES (
      ${fixture.responseId}::uuid, ${fixture.organizationId},
      ${fixture.propertyId}::uuid, ${fixture.portalId}::uuid, 'submitted', 2,
      true, true, 3, 0, clock_timestamp(), clock_timestamp(), 1,
      clock_timestamp() + interval '700 days', clock_timestamp(), clock_timestamp()
    )
  `)
  await tx.execute(sql`
    INSERT INTO guest_response_private_feedback (
      response_id, organization_id, property_id, portal_id, body, submitted_at,
      expires_at, created_at
    ) VALUES (
      ${fixture.responseId}::uuid, ${fixture.organizationId},
      ${fixture.propertyId}::uuid, ${fixture.portalId}::uuid, ${PRIVATE_TEXT},
      clock_timestamp(), clock_timestamp() + interval '88 days', clock_timestamp()
    )
  `)
  return fixture
}

const entryFor = (fixture: Fixture): BackupErasureLedgerAppend => ({
  subjectClass: 'organization',
  organizationId: fixture.organizationId,
  context: 'guest',
  closureLineageId: fixture.lineage,
  lifecycleRevision: 4,
  effectiveErasureAt: ERASED_AT,
  erasedRowCount: 2,
  evidenceRef: `guest:purge:complete:${fixture.lineage}:r4`,
  dataCellId: 'us',
})

/**
 * The driver wraps a raised exception in a `Failed query:` error, so the
 * trigger's own message only appears on the cause.
 */
async function rejectionCause(work: Promise<unknown>): Promise<string> {
  try {
    await work
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause
    return cause?.message ?? String(error)
  }
  throw new Error('expected the guarded statement to be rejected')
}

async function guestRowCount(tx: Tx, organizationId: string): Promise<number> {
  const result = await tx.execute(sql`
    SELECT (
      (SELECT COUNT(*)::int FROM guest_responses WHERE organization_id = ${organizationId})
      + (SELECT COUNT(*)::int FROM guest_response_private_feedback
         WHERE organization_id = ${organizationId})
    ) AS "rows"
  `)
  return Number((result.rows[0] as { rows: number | string } | undefined)?.rows ?? 0)
}

describe('backup erasure ledger and restore resurrection fence (LIF-01-T15)', () => {
  it('re-applies an erasure a restore undid and leaves zero rows for the org', async () => {
    let proofCompleted = false

    await expect(
      db.transaction(async (raw) => {
        const tx = raw as unknown as Tx
        const fixture = await seedPurgedOrganization(tx)
        // The purge appended exactly one entry per context plan. Guest's is the
        // one under test; a replay of the same phase must not append a second.
        const entryId = await appendBackupErasureLedgerEntry(tx, entryFor(fixture))
        expect(await appendBackupErasureLedgerEntry(tx, entryFor(fixture))).toBe(entryId)
        const ledger = await readBackupErasureLedger(tx, 'us')
        expect(ledger.filter((e) => e.organizationId === fixture.organizationId)).toEqual(
          [
            expect.objectContaining({
              id: entryId,
              context: 'guest',
              erasedRowCount: 2,
              organizationId: fixture.organizationId,
            }),
          ],
        )

        // The restore rolled the cell back to before the erasure, so the rows
        // are back.
        expect(await guestRowCount(tx, fixture.organizationId)).toBe(2)

        const replayed = await applyRestoreResurrectionFence(tx, {
          dataCellId: 'us',
          restorePointAt: new Date(ERASED_AT.getTime() - 60_000),
          replayers: [createGuestBackupErasureReplayer()],
        })
        expect(replayed.verified).toBe(true)
        expect(() => assertRestoredCellVerified(replayed)).not.toThrow()
        expect(replayed.counts.ledgerEntriesReapplied).toBeGreaterThanOrEqual(1)
        expect(replayed.counts.ledgerRowsReErased).toBeGreaterThanOrEqual(1)
        expect(await guestRowCount(tx, fixture.organizationId)).toBe(0)
        const survivors = await tx.execute(sql`
          SELECT COUNT(*)::int AS "rows" FROM guest_response_private_feedback
          WHERE body = ${PRIVATE_TEXT}
        `)
        expect(Number((survivors.rows[0] as { rows: number }).rows)).toBe(0)

        // Convergent: a restore that already post-dates the entry re-erases
        // nothing and reports zero, rather than double-counting.
        const converged = await applyRestoreResurrectionFence(tx, {
          dataCellId: 'us',
          restorePointAt: new Date(ERASED_AT.getTime() + 60_000),
          replayers: [createGuestBackupErasureReplayer()],
        })
        expect(converged.counts.ledgerEntriesReapplied).toBe(0)
        expect(converged.counts.ledgerRowsReErased).toBe(0)
        expect(converged.counts.ledgerEntriesAlreadyErased).toBeGreaterThanOrEqual(1)
        expect(converged.verified).toBe(true)

        proofCompleted = true
        throw ROLLBACK
      }),
    ).rejects.toBe(ROLLBACK)

    expect(proofCompleted).toBe(true)
  })

  it('fails closed when a ledger entry cannot be re-applied', async () => {
    await expect(
      db.transaction(async (raw) => {
        const tx = raw as unknown as Tx
        const fixture = await seedPurgedOrganization(tx)
        await appendBackupErasureLedgerEntry(tx, entryFor(fixture))

        // No replayer is registered for guest/organization, so the fence cannot
        // re-erase what the restore brought back. A partially re-erased restore
        // must never be declared verified.
        const result = await applyRestoreResurrectionFence(tx, {
          dataCellId: 'us',
          restorePointAt: new Date(ERASED_AT.getTime() - 60_000),
          replayers: [],
        })
        expect(result.verified).toBe(false)
        expect(result.counts.ledgerEntriesUnreplayed).toBeGreaterThanOrEqual(1)
        expect(() => assertRestoredCellVerified(result)).toThrow(/is not verified/u)
        // And the resurrected rows are still there — the fence did not pretend.
        expect(await guestRowCount(tx, fixture.organizationId)).toBe(2)

        throw ROLLBACK
      }),
    ).rejects.toBe(ROLLBACK)
  })

  it('holds a delayed-erasure entry until its hold is released', async () => {
    await expect(
      db.transaction(async (raw) => {
        const tx = raw as unknown as Tx
        const fixture = await seedPurgedOrganization(tx)
        const entryId = await appendBackupErasureLedgerEntry(tx, {
          ...entryFor(fixture),
          holdReference: 'legal-hold:2027-03:counsel-4471',
        })
        const restorePointAt = new Date(ERASED_AT.getTime() - 60_000)
        const replayers = [createGuestBackupErasureReplayer()]

        const held = await applyRestoreResurrectionFence(tx, {
          dataCellId: 'us',
          restorePointAt,
          replayers,
        })
        expect(held.heldEntryIds).toContain(entryId)
        expect(held.counts.ledgerRowsReErased).toBe(0)
        // A documented hold is a policy decision, not a fence failure.
        expect(held.verified).toBe(true)
        expect(await guestRowCount(tx, fixture.organizationId)).toBe(2)

        await releaseBackupErasureHold(tx, {
          ledgerEntryId: entryId,
          holdReference: 'legal-hold:2027-03:counsel-4471',
          authorityRef: 'counsel:release:2027-03-15',
          releasedAt: new Date('2027-03-15T00:00:00.000Z'),
        })
        const released = await applyRestoreResurrectionFence(tx, {
          dataCellId: 'us',
          restorePointAt,
          replayers,
        })
        expect(released.heldEntryIds).not.toContain(entryId)
        expect(released.counts.ledgerRowsReErased).toBeGreaterThanOrEqual(1)
        expect(await guestRowCount(tx, fixture.organizationId)).toBe(0)

        throw ROLLBACK
      }),
    ).rejects.toBe(ROLLBACK)
  })

  it('refuses to rewrite or delete a ledger entry', async () => {
    await expect(
      db.transaction(async (raw) => {
        const tx = raw as unknown as Tx
        const fixture = await seedPurgedOrganization(tx)
        const entryId = await appendBackupErasureLedgerEntry(tx, entryFor(fixture))

        // An entry an operator can remove after a bad restore is exactly the
        // resurrection this ledger prevents, so both paths must be closed.
        const database = raw as unknown as Database
        expect(
          await rejectionCause(
            database.execute(
              sql`UPDATE backup_erasure_ledger SET erased_row_count = 0 WHERE id = ${entryId}::uuid`,
            ),
          ),
        ).toMatch(/append-only/u)
        throw ROLLBACK
      }),
    ).rejects.toBe(ROLLBACK)

    await expect(
      db.transaction(async (raw) => {
        const tx = raw as unknown as Tx
        const fixture = await seedPurgedOrganization(tx)
        const entryId = await appendBackupErasureLedgerEntry(tx, entryFor(fixture))
        const database = raw as unknown as Database
        expect(
          await rejectionCause(
            database.execute(
              sql`DELETE FROM backup_erasure_ledger WHERE id = ${entryId}::uuid`,
            ),
          ),
        ).toMatch(/append-only/u)
        throw ROLLBACK
      }),
    ).rejects.toBe(ROLLBACK)
  })
})
