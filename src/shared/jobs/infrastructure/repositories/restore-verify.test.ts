// BQC-7.8 — ops:restore-verify integration proof (real PostgreSQL).
//
// fallow-ignore-file boundary-violation
// Cross-zone proof (BQC-7.8) — deliberate, no expiry. This end-to-end proof
// BY DESIGN wires the identity-owned policy boot (initPersistedCapability-
// PolicyStore) + audit table against the review context's purge machinery
// (review repository + atomic command store) and the shared operator-command
// harness (the same wiring scripts/ops/restore-verify.ts performs); no
// single context's zone can own it, and the integration project discovers it
// via the infrastructure/repositories glob. Same posture as
// operator-command.test.ts (BQC-7.5).
//
// Proves the restore-verify chain end to end:
//   1. --apply --reason --yes ops:restore-verify — evaluated through the REAL
//      ExecutionPolicy operator branch and audited in policy_decision_audit;
//      the source-policy purge runs IN-PROCESS (the purge job's core, no
//      BullMQ): the seeded expired reviews are deleted (with review.expired
//      outbox facts), the live review survives, the 'reviews.purge' evidence
//      row lands in retention_runs, and the re-scan proves zero expired rows
//      remain eligible;
//   2. dry-run (no --apply) — reports eligibility, purges nothing, audits
//      'dry-run';
//   3. RESTORE_MODE not isolated in the command env — the action REFUSES
//      before any work (exit 1, nothing purged).
//
// The policy boot below is the exact wiring scripts/ops/operator-command.ts
// runs — replicated rather than imported because the shim lives outside
// tsconfig and owns process.exit. The shared scratch DB may carry other
// suites' leftover expired reviews (the purge is cross-tenant by design);
// assertions are scoped to this suite's marker org, and evidence counts are
// lower bounds.

import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { createEventBus } from '#/shared/events/event-bus'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createBusAuthorizer } from '#/shared/jobs/delayed-execution-gate'
import {
  getExecutionPolicy,
  resetExecutionPolicy,
  type DecisionRequest,
} from '#/shared/auth/execution-policy'
import { resetCapabilityPolicyStore } from '#/shared/auth/beta-capabilities'
import { resetDelayedExecutionPolicy } from '#/shared/auth/system-execution-policy'
import { initPersistedCapabilityPolicyStore } from '#/contexts/identity/infrastructure/policy-store-init'
import { createReviewRepository } from '#/contexts/review/infrastructure/repositories/review.repository'
import { createAtomicReplyCommandStore } from '#/contexts/review/infrastructure/reply-command-store'
import { createPurgeExpiredReviewsHandler } from '#/contexts/review/infrastructure/jobs/purge-expired-reviews.job'
import {
  runOperatorCommand,
  type OperatorIO,
  type OperatorRuntime,
} from '#/shared/ops/operator-command'
import {
  RESTORE_VERIFY_PURGE_SUBJECT,
  RESTORE_VERIFY_SPEC,
  runRestoreVerifyAction,
  type RestoreVerifyDeps,
} from '#/shared/ops/restore-verify'

const OPERATOR = 'op-restore-verify@example.com'
const ORG = 'org-bqc78-restore-verify'
const PROPERTY = 'aa000000-0000-4000-8000-000000078078'
const REVIEW_EXPIRED_1 = 'aa000000-0000-4000-8000-0000000780e1'
const REVIEW_EXPIRED_2 = 'aa000000-0000-4000-8000-0000000780e2'
const REVIEW_LIVE = 'aa000000-0000-4000-8000-000000078011'
const REVIEW_DRYRUN = 'aa000000-0000-4000-8000-0000000780d1'

const db = getDb()
const NOW = Date.now()
const DAY = 24 * 60 * 60 * 1000

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
  regionMovesBlocking: 0,
} as const

let stopPolicyPolling: (() => void) | undefined
let runtime: OperatorRuntime

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

async function auditRowsFor(actorId: string, min: number) {
  let rows: Array<Record<string, unknown>> = []
  for (let i = 0; i < 20 && rows.length < min; i++) {
    const result = await db.execute(
      sql`SELECT actor_type, actor_id, action, execution_kind, decision, reason, policy_version, correlation_id
          FROM policy_decision_audit WHERE actor_id = ${actorId} ORDER BY occurred_at`,
    )
    rows = result.rows as Array<Record<string, unknown>>
    if (rows.length >= min) break
    await new Promise((r) => setTimeout(r, 50))
  }
  return rows
}

async function seedReview(id: string, contentExpiresAt: Date): Promise<void> {
  await db.execute(sql`
    INSERT INTO reviews (
      id, organization_id, property_id, platform, external_id,
      external_location_id, rating, reviewed_at, expires_at, content_expires_at,
      source_epoch, source_revision, analysis_sequence,
      ai_source_byte_length, ai_source_digest
    ) VALUES (
      ${id}, ${ORG}, ${PROPERTY}, 'google', ${'ext-' + id},
      ${GOOGLE_LOCATION_PRIMARY_RESOURCE}, 4, now(), now(), ${contentExpiresAt},
      0, 0, 0, 1, ${'0'.repeat(64)}
    )
    ON CONFLICT (id) DO NOTHING
  `)
}

async function reviewCount(): Promise<number> {
  const r = await db.execute(
    sql`SELECT count(*)::int AS c FROM reviews WHERE organization_id = ${ORG}`,
  )
  return (r.rows[0] as { c: number }).c
}

/** The real deps — the same construction scripts/ops/restore-verify.ts wires. */
function realDeps(env: RestoreVerifyDeps['env']): RestoreVerifyDeps {
  const reviewRepo = createReviewRepository(db)
  const eventBus = createEventBus({ authorizeConsumer: createBusAuthorizer() })
  const commandStore = createAtomicReplyCommandStore(db, eventBus)
  const clock = () => new Date()
  const purgeHandler = createPurgeExpiredReviewsHandler({
    reviewRepo,
    commandStore,
    clock,
    db,
  })
  return {
    env,
    countExpired: async () => reviewRepo.countExpiredBeforeAcrossTenants(clock()),
    purgeExpired: async () => {
      await purgeHandler({} as never)
    },
    inspectGoogleImportLifecycle: async () => ({
      expiredItems: 0,
      purgeCandidates: 0,
      unreleasedExpiredReceipts: 0,
    }),
    sweepGoogleImportLifecycle: async () => {},
    inspectRetentionBacklog: async () => ({}),
    sweepRetentionBacklog: async () => {},
    // The recovery fence is proved independently because it deliberately
    // mutates cell-global authority; this shared-database test remains scoped
    // to the review purge/operator-command integration seam.
    inspectRecoveryFence: async () => ZERO_RECOVERY,
    applyRecoveryFence: async () => ({
      id: '10000000-0000-4000-8000-000000000078',
      generation: 1,
      replayed: false,
      counts: ZERO_RECOVERY,
      completedAt: new Date(),
    }),
    purgeEvidence: async () => {
      const rows = await db.execute(sql`
        SELECT subject, rows_deleted, outcome, started_at
        FROM retention_runs
        WHERE subject = ${RESTORE_VERIFY_PURGE_SUBJECT}
        ORDER BY started_at DESC
        LIMIT 5
      `)
      return rows.rows.map((row) => {
        const r = row as {
          subject: string
          rows_deleted: number
          outcome: string
          started_at: Date | string
        }
        return {
          subject: r.subject,
          rowsDeleted: r.rows_deleted,
          outcome: r.outcome,
          startedAt:
            r.started_at instanceof Date
              ? r.started_at.toISOString()
              : String(r.started_at),
        }
      })
    },
  }
}

const ISOLATED_ENV = {
  RESTORE_MODE: 'isolated',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/restored',
  PROCESSING_CELL: 'us',
  RESTORE_SOURCE_CELL: 'us',
  RESTORE_POINT_AT: new Date(NOW - 1_000).toISOString(),
  RELEASE_SHA: 'a'.repeat(40),
  RELEASE_MANIFEST_SHA256: 'b'.repeat(64),
  RESTORE_DATABASE_SERVICE_NAME: 'Postgres-restored-20260825-1015',
} as const

describe('ops:restore-verify (BQC-7.8, integration)', () => {
  beforeAll(async () => {
    // The production operator boot: policy store + both policies + strong read.
    resetCapabilityPolicyStore()
    resetExecutionPolicy()
    resetDelayedExecutionPolicy()
    const handle = initPersistedCapabilityPolicyStore({
      db,
      env: { NODE_ENV: 'test', OPS_OPERATOR_IDENTITIES: OPERATOR },
    })
    await handle.refresh()
    stopPolicyPolling = handle.stopPolling
    runtime = {
      decide: (request: DecisionRequest) => getExecutionPolicy().decide(request),
    }
    // Outbox payload registry — createContainer runs this in production; the
    // purge commits review.expired facts through the same adapter.
    registerAllEventSchemas()

    await db.execute(
      sql`INSERT INTO organization (id, name, slug, "createdAt") VALUES (${ORG}, 'Restore Verify Org', 'restore-verify-org', NOW()) ON CONFLICT (id) DO NOTHING`,
    )
    await db.execute(sql`
      INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
      VALUES (${PROPERTY}, ${ORG}, 'prop-rv', 'prop-rv', 'UTC', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `)
    // 2 expired + 1 live review.
    await seedReview(REVIEW_EXPIRED_1, new Date(NOW - 2 * DAY))
    await seedReview(REVIEW_EXPIRED_2, new Date(NOW - 1 * DAY))
    await seedReview(REVIEW_LIVE, new Date(NOW + 20 * DAY))
  })

  afterAll(async () => {
    stopPolicyPolling?.()
    await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG}`)
    await db.execute(sql`DELETE FROM reviews WHERE organization_id = ${ORG}`)
    await db.execute(
      sql`DELETE FROM retention_runs WHERE subject = ${RESTORE_VERIFY_PURGE_SUBJECT}`,
    )
    await db.execute(sql`DELETE FROM policy_decision_audit WHERE actor_id = ${OPERATOR}`)
    await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
    await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)
  })

  it('apply: purges expired in-process, keeps live rows, writes evidence + audit', async () => {
    const io = memoryIO()
    const result = await runOperatorCommand(
      RESTORE_VERIFY_SPEC,
      (ctx, _args, actionIo) =>
        runRestoreVerifyAction(ctx, realDeps(ISOLATED_ENV), actionIo),
      runtime,
      [
        '--operator',
        OPERATOR,
        '--reason',
        'restore drill',
        '--apply',
        '--yes',
        'ops:restore-verify',
      ],
      io,
    )

    expect(result.exitCode).toBe(0)
    // Expired gone, live intact (marker-org scoped).
    expect(await reviewCount()).toBe(1)
    const live = await db.execute(
      sql`SELECT count(*)::int AS c FROM reviews WHERE id = ${REVIEW_LIVE}`,
    )
    expect((live.rows[0] as { c: number }).c).toBe(1)

    // review.expired outbox facts for exactly the two purged reviews.
    const facts = await db.execute(
      sql`SELECT count(*)::int AS c FROM outbox_events
          WHERE organization_id = ${ORG} AND event_type = 'review.expired'`,
    )
    expect((facts.rows[0] as { c: number }).c).toBe(2)

    // retention_runs evidence (cross-tenant purge — rows_deleted is a lower bound).
    const evidence = await db.execute(
      sql`SELECT outcome, rows_deleted FROM retention_runs
          WHERE subject = ${RESTORE_VERIFY_PURGE_SUBJECT}
          ORDER BY started_at DESC LIMIT 1`,
    )
    expect(evidence.rows).toHaveLength(1)
    expect(evidence.rows[0]).toMatchObject({ outcome: 'completed' })
    expect(Number(evidence.rows[0].rows_deleted)).toBeGreaterThanOrEqual(2)

    // Operator decision audit: allow with the operator reason.
    const audits = await auditRowsFor(OPERATOR, 1)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      actor_type: 'operator',
      action: 'system:ops',
      execution_kind: 'operator',
      decision: 'allow',
      reason: 'restore drill',
    })

    // The output walks the operator through evidence + cutover.
    const out = io.outLines.join('\n')
    expect(out).toMatch(/RESTORE MODE ISOLATED/)
    expect(out).toMatch(/reviews\.purge/)
    expect(out).toMatch(/zero expired-content row\(s\) remain/)
    expect(out).toMatch(/UNSET RESTORE_MODE/)
  })

  it('dry-run: reports eligibility, purges nothing, audits dry-run', async () => {
    await seedReview(REVIEW_DRYRUN, new Date(NOW - 1 * DAY))
    const io = memoryIO()
    const result = await runOperatorCommand(
      RESTORE_VERIFY_SPEC,
      (ctx, _args, actionIo) =>
        runRestoreVerifyAction(ctx, realDeps(ISOLATED_ENV), actionIo),
      runtime,
      ['--operator', OPERATOR],
      io,
    )

    expect(result.exitCode).toBe(0)
    // The dry-run expired review survived.
    const dryRun = await db.execute(
      sql`SELECT count(*)::int AS c FROM reviews WHERE id = ${REVIEW_DRYRUN}`,
    )
    expect((dryRun.rows[0] as { c: number }).c).toBe(1)
    expect(io.outLines.join('\n')).toMatch(/expired-content row\(s\) eligible/)

    const audits = await auditRowsFor(OPERATOR, 2)
    expect(audits[1]).toMatchObject({ decision: 'allow', reason: 'dry-run' })
  })

  it('refuses before any work when RESTORE_MODE is not isolated', async () => {
    const io = memoryIO()
    const result = await runOperatorCommand(
      RESTORE_VERIFY_SPEC,
      (ctx, _args, actionIo) =>
        runRestoreVerifyAction(
          ctx,
          realDeps({ DATABASE_URL: ISOLATED_ENV.DATABASE_URL }),
          actionIo,
        ),
      runtime,
      ['--operator', OPERATOR, '--reason', 'drill report'],
      io,
    )

    expect(result.exitCode).toBe(1)
    expect(io.errLines.join('\n')).toMatch(/RESTORE_MODE=isolated/)
    // The dry-run expired review is still there — nothing was purged.
    const dryRun = await db.execute(
      sql`SELECT count(*)::int AS c FROM reviews WHERE id = ${REVIEW_DRYRUN}`,
    )
    expect((dryRun.rows[0] as { c: number }).c).toBe(1)
  })
})
