// restore-verify replays a local erasure journal export through the fence,
// against real PostgreSQL: a Property's notification rows come back with the
// restore, the journal erased them, and the command removes them again while
// the sibling Property and the other Organization stay byte-identical.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createNotificationRightsReplayers } from '#/contexts/feed/rights/replayer.server'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { applyRestoreResurrectionFence } from '#/shared/db/lifecycle/backup-erasure-ledger'
import {
  encodeErasureJournalExport,
  type ErasureJournalEntry,
} from '#/shared/db/lifecycle/erasure-journal.server'
import type { Tx } from '#/shared/outbox/commit'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import type { OperatorContext, OperatorIO } from './operator-command'
import { runRestoreVerifyAction, type RestoreVerifyDeps } from './restore-verify'

const RESTORE_POINT = new Date('2026-11-01T00:00:00.000Z')
const ERASED_AT = new Date('2026-11-02T00:00:00.000Z')
const EXPORTED_AT = new Date('2026-11-03T00:00:00.000Z')

const ZERO_RECOVERY = {
  sessionsInvalidated: 0,
  verificationTokensInvalidated: 0,
  invitationsCanceled: 0,
  outboxEventsFenced: 0,
  emailsCanceled: 0,
  digestBatchesTerminated: 0,
  repliesCanceled: 0,
  repliesMadeAmbiguous: 0,
  googleConnectionsFenced: 0,
  googleExecutionPermitsFenced: 0,
  googleSourceOperationsFenced: 0,
  googleRevokePermitsFenced: 0,
  legacyImportJobsCanceled: 0,
  legacyImportEffectLeasesReleased: 0,
  googleImportV2ParentsFenced: 0,
  googleImportV2ItemsFenced: 0,
  aiIssuedPermitsReleased: 0,
  aiConsumedPermitsMadeAmbiguous: 0,
  aiOperationsFenced: 0,
  aiBackfillRunsStalled: 0,
} as const

type Cell = Readonly<{
  organizationId: string
  propertyA: string
  propertyB: string
}>

let lease: TestLease
let db: Database
const organizations = new Set<string>()

async function seedOrganization(): Promise<Cell> {
  const suffix = randomUUID()
  const cell: Cell = {
    organizationId: `rv-replay-${suffix}`,
    propertyA: randomUUID(),
    propertyB: randomUUID(),
  }
  organizations.add(cell.organizationId)
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $2, $3, now())`,
    [cell.organizationId, `Replay ${suffix}`, `rv-replay-${suffix}`],
  )
  for (const propertyId of [cell.propertyA, cell.propertyB]) {
    await lease.pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Replay Property', $3, 'Europe/Sofia')`,
      [propertyId, cell.organizationId, `rv-${propertyId}`],
    )
    await lease.pool.query(
      `INSERT INTO notifications (
         id, user_id, organization_id, property_id, type, category, priority, status,
         resource_type, resource_id, event_id, title, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'review.created', 'workflow_collaboration', 'normal',
                 'unread', 'inbox_item', $5, $6, 'New review', now(), now())`,
      [
        randomUUID(),
        `rv-user-${suffix}`,
        cell.organizationId,
        propertyId,
        `item-${propertyId}`,
        `event-${propertyId}`,
      ],
    )
  }
  return cell
}

async function snapshot(propertyId: string): Promise<string> {
  const rows = await lease.pool.query(
    `SELECT row_to_json(n)::text AS row FROM notifications n
     WHERE property_id = $1 ORDER BY id`,
    [propertyId],
  )
  return JSON.stringify(rows.rows)
}

function journalFor(cell: Cell): string {
  const entry: ErasureJournalEntry = {
    id: randomUUID(),
    recordedBeforeErasure: true,
    subjectClass: 'property',
    organizationId: cell.organizationId,
    propertyId: cell.propertyA,
    context: 'notification',
    closureLineageId: randomUUID(),
    lifecycleRevision: 1,
    effectiveErasureAt: ERASED_AT,
    erasedRowCount: 1,
    evidenceRef: 'notification:purge:batch-1',
  }
  return encodeErasureJournalExport([entry], EXPORTED_AT)
}

function memoryIO(): OperatorIO & { outLines: string[]; errLines: string[] } {
  const outLines: string[] = []
  const errLines: string[] = []
  return {
    outLines,
    errLines,
    out: (line) => void outLines.push(line),
    err: (line) => void errLines.push(line),
  }
}

const ctx: OperatorContext = {
  operatorId: 'op@example.com',
  correlationId: 'corr-replay',
  dryRun: false,
  decision: {
    allowed: true,
    reason: 'allowed',
    action: 'system:ops',
    policyVersion: 't',
  },
}

function depsFor(journalBytes: string): RestoreVerifyDeps {
  const env = {
    RESTORE_MODE: 'isolated',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/restored',
    RESTORE_DATABASE_SERVICE_NAME: 'Postgres-restored-20261101-0000',
    RESTORE_POINT_AT: RESTORE_POINT.toISOString(),
    RELEASE_SHA: 'a'.repeat(40),
    RELEASE_MANIFEST_SHA256: 'b'.repeat(64),
  } as const
  return {
    env,
    confirmation: 'closed-beta-v2',
    clock: () => EXPORTED_AT,
    erasureReplay: {
      journalFile: '/secure/erasure-journal.json',
      readFile: async () => journalBytes,
      apply: (input) =>
        db.transaction((raw) =>
          applyRestoreResurrectionFence(raw as unknown as Tx, {
            ...input,
            replayers: createNotificationRightsReplayers(),
          }),
        ),
    },
    reviewLifecycle: {
      kind: 'confirmed_apply',
      admit: vi.fn(async () => ({
        recoveryInput: {
          runId: randomUUID(),
          generation: 1,
          sourceReleaseSha: env.RELEASE_SHA,
          sourceManifestSha256: env.RELEASE_MANIFEST_SHA256,
          restorePointAt: RESTORE_POINT,
          operatorId: ctx.operatorId,
          correlationId: ctx.correlationId,
        },
        expired: 0,
        approvalId: 'approval',
        approvalBundleSha256: 'c'.repeat(64),
        reportSha256: 'd'.repeat(64),
        applyReviewLifecycle: async () => {},
        complete: async () => {},
      })),
    },
    countExpired: async () => 0,
    purgeEvidence: async () => [],
    inspectGoogleImportLifecycle: async () => ({
      expiredItems: 0,
      purgeCandidates: 0,
      unreleasedExpiredReceipts: 0,
    }),
    sweepGoogleImportLifecycle: async () => {},
    inspectRetentionBacklog: async () => ({}),
    sweepRetentionBacklog: async () => {},
    inspectRecoveryFence: async () => ZERO_RECOVERY,
    applyRecoveryFence: async () => ({
      id: randomUUID(),
      generation: 1,
      replayed: false,
      counts: ZERO_RECOVERY,
      completedAt: EXPORTED_AT,
    }),
  }
}

describe.sequential('restore-verify erasure replay (real PostgreSQL)', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    db = drizzle(lease.pool) as Database
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    const ids = [...organizations]
    for (const table of ['notifications', 'properties']) {
      await lease.pool.query(
        `DELETE FROM ${table} WHERE organization_id = ANY($1::text[])`,
        [ids],
      )
    }
    await lease.pool.query(`DELETE FROM organization WHERE id = ANY($1::text[])`, [ids])
    organizations.clear()
  })

  it('removes the resurrected Property rows again and leaves everything else identical', async () => {
    const cell = await seedOrganization()
    const other = await seedOrganization()
    const siblingBefore = await snapshot(cell.propertyB)
    const otherBefore = await snapshot(other.propertyA)
    expect(await snapshot(cell.propertyA)).not.toBe('[]')

    const io = memoryIO()
    expect(await runRestoreVerifyAction(ctx, depsFor(journalFor(cell)), io)).toBe(0)

    expect(await snapshot(cell.propertyA)).toBe('[]')
    expect(await snapshot(cell.propertyB)).toBe(siblingBefore)
    expect(await snapshot(other.propertyA)).toBe(otherBefore)
    expect(io.outLines.join('\n')).toMatch(/✓ erasure replay verified/)
    expect(io.outLines.join('\n')).not.toMatch(/NOT WIRED/)
  })

  // Negative control: the same cell with an altered export keeps its rows,
  // so the pass above is the replay's doing.
  it('refuses a tampered export and removes nothing', async () => {
    const cell = await seedOrganization()
    const before = await snapshot(cell.propertyA)
    const tampered = journalFor(cell).replace('"entries":[', '"entries":[null,')

    const io = memoryIO()
    expect(await runRestoreVerifyAction(ctx, depsFor(tampered), io)).toBe(1)

    expect(await snapshot(cell.propertyA)).toBe(before)
    expect(io.errLines.join('\n')).toMatch(/unreadable, malformed or was altered/)
  })
})
