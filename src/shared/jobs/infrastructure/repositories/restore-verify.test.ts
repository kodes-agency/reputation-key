// BQC-7.8 — ops:restore-verify integration proof (real PostgreSQL).
//
// fallow-ignore-file boundary-violation
// Cross-zone proof (BQC-7.8) — deliberate, no expiry. This end-to-end proof
// BY DESIGN wires the identity-owned policy boot against the review context's
// report authority and the shared operator-command harness (the same wiring
// scripts/ops/restore-verify.ts performs); no single context's zone can own it,
// and the integration project discovers it via the infrastructure/repositories
// glob. Same posture as
// operator-command.test.ts (BQC-7.5).
//
// Proves the restore-verify chain end to end:
//   1. --apply --reason --yes ops:restore-verify — evaluated through the REAL
//      ExecutionPolicy operator branch; SAFE-03 inspection-only authority
//      refuses before any lifecycle is invoked, so every Review survives and
//      no false expiry fact or retention evidence is written;
//   2. dry-run (no --apply) — reports eligibility and purges nothing;
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
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  getExecutionPolicy,
  resetExecutionPolicy,
  type DecisionRequest,
} from '#/shared/auth/execution-policy'
import { resetCapabilityPolicyStore } from '#/shared/auth/beta-capabilities'
import { resetDelayedExecutionPolicy } from '#/shared/auth/system-execution-policy'
import {
  bindProcessPolicies,
  releaseProcessPolicies,
} from '#/shared/auth/process-policy-binding'
import { initCapabilityPolicyStore } from '#/contexts/identity/infrastructure/policy-store-init'
import { createReviewRepository } from '#/contexts/review/infrastructure/repositories/review.repository'
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
} as const

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
  const reviewRepo = createReviewRepository(db, () => new Date())
  const clock = () => new Date()
  return {
    env,
    reviewLifecycle: {
      kind: 'inspection_only',
      reason: 'reviewed_cutover_authority_required',
      prepare: async () => ({
        requestContent: '{"kind":"review-lifecycle-recovery"}\n',
        requestSha256: 'a'.repeat(64),
        reportContent: '{"version":"integration-report"}\n',
        reportSha256: 'b'.repeat(64),
        expired: await reviewRepo.countExpiredBeforeAcrossTenants(clock()),
      }),
    },
    countExpired: async () => reviewRepo.countExpiredBeforeAcrossTenants(clock()),
    inspectGoogleImportLifecycle: async () => ({
      expiredItems: 0,
      purgeCandidates: 0,
      unreleasedExpiredReceipts: 0,
    }),
    sweepGoogleImportLifecycle: async () => {},
    inspectRetentionBacklog: async () => ({}),
    sweepRetentionBacklog: async () => {},
    // The recovery fence is proved independently because it deliberately
    // mutates deployment-wide authority; this shared-database test remains
    // scoped to the review purge/operator-command integration seam.
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
    const handle = initCapabilityPolicyStore({
      db,
      env: { NODE_ENV: 'test', OPS_OPERATOR_IDENTITIES: OPERATOR },
      clock: () => new Date(),
      logger: { warn: () => {} },
    })
    // ARC-03-T8: the real operator boot now binds the handle explicitly —
    // building it installs nothing.
    bindProcessPolicies(handle)
    await handle.refresh()
    runtime = {
      decide: (request: DecisionRequest) => getExecutionPolicy().decide(request),
    }
    // The Review lifecycle-store suite records `reviews.purge` runs in the same
    // database; vitest orders files by cached duration, so own the subject here
    // instead of assuming this file runs first.
    await db.execute(
      sql`DELETE FROM retention_runs WHERE subject = ${RESTORE_VERIFY_PURGE_SUBJECT}`,
    )
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
    releaseProcessPolicies()
    await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG}`)
    await db.execute(sql`DELETE FROM reviews WHERE organization_id = ${ORG}`)
    await db.execute(
      sql`DELETE FROM retention_runs WHERE subject = ${RESTORE_VERIFY_PURGE_SUBJECT}`,
    )
    await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
    await deleteTestOrganizations(db, [ORG])
  })

  it('apply: fails closed while Review erasure is quarantined and preserves every row', async () => {
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

    expect(result.exitCode).toBe(1)
    expect(result.decision).toMatchObject({ allowed: true, reason: 'allowed' })
    expect(await reviewCount()).toBe(3)
    const live = await db.execute(
      sql`SELECT count(*)::int AS c FROM reviews WHERE id = ${REVIEW_LIVE}`,
    )
    expect((live.rows[0] as { c: number }).c).toBe(1)

    const facts = await db.execute(
      sql`SELECT count(*)::int AS c FROM outbox_events
          WHERE organization_id = ${ORG} AND event_type = 'review.expired'`,
    )
    expect((facts.rows[0] as { c: number }).c).toBe(0)

    const evidence = await db.execute(
      sql`SELECT outcome, rows_deleted FROM retention_runs
          WHERE subject = ${RESTORE_VERIFY_PURGE_SUBJECT}
          ORDER BY started_at DESC LIMIT 1`,
    )
    expect(evidence.rows).toHaveLength(0)

    const out = io.outLines.join('\n')
    const err = io.errLines.join('\n')
    expect(out).toMatch(/RESTORE MODE ISOLATED/)
    expect(err).toMatch(/no reviewed cutover authority/i)
    expect(out).not.toMatch(/UNSET RESTORE_MODE/)
  })

  it('dry-run: reports eligibility and purges nothing', async () => {
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
    expect(result.decision).toMatchObject({ allowed: true, reason: 'allowed' })
    const dryRun = await db.execute(
      sql`SELECT count(*)::int AS c FROM reviews WHERE id = ${REVIEW_DRYRUN}`,
    )
    expect((dryRun.rows[0] as { c: number }).c).toBe(1)
    expect(io.outLines.join('\n')).toMatch(/expired-content row\(s\) eligible/)
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
