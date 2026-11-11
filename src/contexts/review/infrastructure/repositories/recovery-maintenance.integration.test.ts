import { replyScopeEffects } from '#/contexts/reputation/application/public-api'
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { completeImportsForRestore } from '#/contexts/integration/imports/import-completion.server'
import { createPropertyGoogleBindingStore } from '#/contexts/property/infrastructure/property-google-binding-store'
import { getEnv } from '#/shared/config/env'
import { createDatabase, type Database } from '#/shared/db'
import { ZERO_BACKUP_ERASURE_REPLAY_COUNTS } from '#/shared/db/lifecycle/backup-erasure-ledger'
import { encodeErasureJournalExport } from '#/shared/db/lifecycle/erasure-journal.server'
import {
  applyRecoveryFence,
  inspectRecoveryFence,
} from '#/shared/db/recovery/postgres-recovery-fence'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { RecoveryFenceInput } from '#/shared/ops/recovery-fence'
import {
  recoveryRuns,
  reviewLifecycleRecoveryExecutions,
} from '#/shared/db/schema/recovery.schema'
import {
  runRestoreVerifyAction,
  type RestoreReviewLifecycleRuntimeTarget,
} from '#/shared/ops/restore-verify'
import { collectReviewSourceContentLifecycleReport } from '../../application/use-cases/collect-source-content-lifecycle-report'
import { ensureTestDatabase } from '#/shared/testing/test-db-setup'
import {
  acquireTestLease,
  type TestLease,
  validateTestDatabaseUrl,
} from '#/shared/testing/test-environment-lease'
import { createReviewLifecycleRecoveryAuthorityFactory } from '../../application/recovery-maintenance'
import {
  createRunReviewSourceContentLifecycle,
  type RunReviewSourceContentLifecycle,
} from '../../application/use-cases/run-source-content-lifecycle'
import {
  createReviewLifecycleRecoveryExecutionRepository,
  createReviewLifecycleRecoveryPlanningQuery,
} from './lifecycle-recovery-execution.repository'
import { createReviewSourceContentLifecycleStore } from './source-content-lifecycle-store.repository'
import { fixHistoryCutoff } from './review-provider-snapshot.repository'

const NOW = new Date('2026-08-28T10:00:00.000Z')
const LATER = new Date('2026-08-30T10:00:00.000Z')
const CREATED_AT = new Date('2026-08-28T08:00:00.000Z')
const PROPERTY_ID = '10000000-0000-4000-8000-000000001000'
const FIRST_RUN_ID = '10000000-0000-4000-8000-000000002001'
const NEXT_RUN_ID = '10000000-0000-4000-8000-000000002002'
const INTERRUPTED = new Error('interrupted after a committed lifecycle page')
const TARGET: RestoreReviewLifecycleRuntimeTarget = {
  releaseSha: 'a'.repeat(40),
  releaseManifestSha256: 'b'.repeat(64),
  restorePointAt: new Date('2026-08-28T09:00:00.000Z'),
  restoreDatabaseServiceName: 'Postgres-restored-20260828-0900',
  railwayProjectId: 'project-proof',
  railwayEnvironmentId: 'environment-proof',
  operatorId: 'operator@example.invalid',
  correlationId: 'recovery-proof',
}

const reviewIdAt = (ordinal: number) =>
  `10000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`

function createInvocation(
  db: Database,
  options: { now?: Date; interruptAfterPage?: boolean } = {},
) {
  const store = createReviewSourceContentLifecycleStore(db, replyScopeEffects)
  const runLifecycle = vi.fn<RunReviewSourceContentLifecycle>()
  const createRecoveryRunId = vi.fn(() => NEXT_RUN_ID)
  const loadNextRecoveryGeneration = vi.fn(
    createReviewLifecycleRecoveryPlanningQuery(db).loadNextRecoveryGeneration,
  )
  const factory = createReviewLifecycleRecoveryAuthorityFactory({
    clock: () => options.now ?? NOW,
    executions: createReviewLifecycleRecoveryExecutionRepository(db),
    createRecoveryRunId,
    loadNextRecoveryGeneration,
    createRunLifecycle: ({ clock, authorizeApply }) => {
      const run = createRunReviewSourceContentLifecycle({
        store,
        clock,
        ...(authorizeApply === undefined ? {} : { authorizeApply }),
      })
      return async (input) => {
        // The real store has committed before the simulated process interruption.
        runLifecycle.mockImplementation(run)
        const result = await runLifecycle(input)
        if (input.mode === 'apply' && options.interruptAfterPage) throw INTERRUPTED
        return result
      }
    },
  })
  const authority = factory.createAuthority({ environmentConfirmation: 'closed-beta-v2' })
  if (authority.kind !== 'confirmed_apply') throw new Error('apply authority required')
  return { authority, runLifecycle, createRecoveryRunId, loadNextRecoveryGeneration }
}

async function seedVerification(db: Database, id: string) {
  await db.execute(sql`
    INSERT INTO verification (
      id, identifier, value, "expiresAt", "createdAt", "updatedAt"
    ) VALUES (
      ${id}, 'recovery-proof', 'opaque-proof-value',
      clock_timestamp() + interval '1 hour', clock_timestamp(), clock_timestamp()
    )
  `)
}

async function seedReviews(db: Database, expired: number, eligible = 0) {
  await seedVerification(db, 'recovery-proof-verification')
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch)
    VALUES (${PROPERTY_ID}::uuid, 'recovery-proof', 'Recovery proof',
            'recovery-proof', 'UTC', 1)
  `)
  await db.execute(sql`
    INSERT INTO reviews (
      id, organization_id, property_id, platform, external_id,
      external_location_id, first_fetched_at, source_epoch,
      source_revision, analysis_sequence, source_content_state, created_at,
      updated_at
    )
    SELECT ('10000000-0000-4000-8000-' || lpad(ordinal::text, 12, '0'))::uuid,
           'recovery-proof', ${PROPERTY_ID}::uuid, 'google',
           'provider-review-' || ordinal, 'locations/recovery-proof',
           ${CREATED_AT}::timestamptz, 0, 1, 0, 'active',
           ${CREATED_AT}::timestamptz, ${CREATED_AT}::timestamptz
    FROM generate_series(1, ${expired + eligible}) AS ordinal
  `)
  await db.execute(sql`
    INSERT INTO review_source_contents (
      review_id, organization_id, property_id, platform, external_id,
      external_location_id, reviewer_name, rating, text, reviewed_at,
      source_created_at, first_fetched_at, last_fetched_at,
      content_expires_at, content_hash, source_epoch, source_revision,
      ai_source_byte_length, ai_source_digest,
      created_at, updated_at
    )
    SELECT id, organization_id, property_id, platform, external_id,
           external_location_id, 'Private reviewer', 2, 'Private review text',
           ${CREATED_AT}::timestamptz, ${CREATED_AT}::timestamptz,
           first_fetched_at, ${CREATED_AT}::timestamptz,
           CASE WHEN substring(external_id from 17)::int <= ${expired}
             THEN ${NOW}::timestamptz - interval '1 minute'
             ELSE ${NOW}::timestamptz + interval '1 day' END,
           'content-hash', source_epoch, source_revision,
           19, ${'a'.repeat(64)},
           created_at, updated_at
    FROM reviews WHERE property_id = ${PROPERTY_ID}::uuid
  `)
}

async function readExecution(db: Database, id = FIRST_RUN_ID) {
  const [row] = await db
    .select()
    .from(reviewLifecycleRecoveryExecutions)
    .where(eq(reviewLifecycleRecoveryExecutions.id, id))
  if (!row) throw new Error('expected durable recovery receipt')
  return row
}

async function commitRecoveryRun(
  db: Database,
  admitted: Readonly<{ recoveryInput: RecoveryFenceInput }>,
) {
  return applyRecoveryFence(
    db,
    admitted.recoveryInput,
    (tx, now) => {
      const binding = createPropertyGoogleBindingStore(
        tx as unknown as Database,
        replyScopeEffects,
      )
      return completeImportsForRestore(
        tx,
        {
          ensureImportFollowUps: binding.ensureImportFollowUps,
          readReceipt: binding.readReceipt,
          prepareImportSync: (ownerTx, scope) =>
            fixHistoryCutoff(ownerTx, {
              ...scope,
              organizationId: organizationId(scope.organizationId),
              propertyId: propertyId(scope.propertyId),
            }),
        },
        now,
      )
    },
    replyScopeEffects,
  )
}

function restoreCommand(
  db: Database,
  invocation: ReturnType<typeof createInvocation>,
  now: Date | (() => Date),
  interruptAfterFence = false,
  afterFence: () => void = () => {},
) {
  const io = { out: vi.fn(), err: vi.fn() }
  const clock = typeof now === 'function' ? now : () => now
  const countExpired = async () => {
    const report = await collectReviewSourceContentLifecycleReport(
      createRunReviewSourceContentLifecycle({
        store: createReviewSourceContentLifecycleStore(db, replyScopeEffects),
        clock,
      }),
      { mode: 'report', batchSize: 100 },
    )
    return report.lifecycle.expired
  }
  const run = () =>
    runRestoreVerifyAction(
      {
        operatorId: TARGET.operatorId,
        correlationId: TARGET.correlationId,
        dryRun: false,
        decision: {
          allowed: true,
          reason: 'allowed',
          action: 'system:ops',
          policyVersion: 'test',
        },
      },
      {
        env: {
          RESTORE_MODE: 'isolated',
          DATABASE_URL: getEnv().DATABASE_URL,
          RELEASE_SHA: TARGET.releaseSha,
          RELEASE_MANIFEST_SHA256: TARGET.releaseManifestSha256,
          RESTORE_POINT_AT: TARGET.restorePointAt.toISOString(),
          RESTORE_DATABASE_SERVICE_NAME: TARGET.restoreDatabaseServiceName,
          RAILWAY_PROJECT_ID: TARGET.railwayProjectId!,
          RAILWAY_ENVIRONMENT_ID: TARGET.railwayEnvironmentId!,
        },
        clock,
        confirmation: 'closed-beta-v2',
        erasureReplay: {
          journalFile: '/secure/erasure-journal.json',
          readFile: async () => encodeErasureJournalExport([], new Date()),
          // An empty journal: this proof is about the Review receipt, not replay.
          apply: async () => ({
            verified: true,
            counts: ZERO_BACKUP_ERASURE_REPLAY_COUNTS,
            unreplayedEntryIds: [],
            heldEntryIds: [],
          }),
        },
        reviewLifecycle: invocation.authority,
        countExpired,
        // This fixture has no import or retention-registry candidates.
        inspectGoogleImportLifecycle: async () => ({
          expiredItems: 0,
          purgeCandidates: 0,
          unreleasedExpiredReceipts: 0,
        }),
        sweepGoogleImportLifecycle: async () => {},
        inspectRetentionBacklog: async () => ({}),
        sweepRetentionBacklog: async () => {},
        inspectRecoveryFence: () => inspectRecoveryFence(db),
        applyRecoveryFence: async (recoveryInput) => {
          const result = await commitRecoveryRun(db, { recoveryInput })
          afterFence()
          if (interruptAfterFence) throw INTERRUPTED
          return result
        },
        purgeEvidence: async () => [],
      },
      io,
    )
  return { run, countExpired, io }
}

describe('typed-confirmation recovery receipt discovery (PostgreSQL)', () => {
  let maintenance: TestLease

  beforeAll(async () => {
    maintenance = await acquireTestLease(getEnv().DATABASE_URL)
  })
  afterAll(async () => {
    await maintenance?.release()
  })

  async function withCommittedDatabase(
    proof: (db: Database, freshDb: Database) => Promise<void>,
  ) {
    // Receipts cannot be deleted. Each proof owns a migrated disposable database
    // so page commits and fresh connections exercise the production safeguards.
    const target = new URL(getEnv().DATABASE_URL)
    const database = `${target.pathname.slice(1, 21)}_recovery_${randomUUID().replaceAll('-', '')}`
    target.pathname = `/${database}`
    const url = target.toString()
    validateTestDatabaseUrl(url)
    let lease: TestLease | undefined
    let freshLease: TestLease | undefined
    try {
      await ensureTestDatabase(url)
      lease = await acquireTestLease(url, 2)
      freshLease = await acquireTestLease(url, 2)
      await proof(createDatabase(lease.pool), createDatabase(freshLease.pool))
    } finally {
      await freshLease?.release()
      await lease?.release()
      await maintenance.pool.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
    }
  }

  it('resumes a committed checkpoint in a fresh invocation with its frozen evidence', async () => {
    await withCommittedDatabase(async (db, freshDb) => {
      await seedReviews(db, 101, 1)
      const first = createInvocation(db, { interruptAfterPage: true })
      first.createRecoveryRunId.mockReturnValue(FIRST_RUN_ID)
      const admitted = await first.authority.admit(TARGET)
      await expect(admitted.applyReviewLifecycle()).rejects.toBe(INTERRUPTED)
      expect(await freshDb.select().from(recoveryRuns)).toEqual([])
      const checkpointed = await readExecution(freshDb)
      expect(checkpointed).toMatchObject({
        state: 'applying',
        pages: 1,
        scanned: 100,
        rowsRedacted: 100,
        reportExpired: 101,
        checkpointCreatedAt: CREATED_AT,
        checkpointReviewId: reviewIdAt(100),
        errorCode: 'review_lifecycle_apply_failed',
        operatorId: TARGET.operatorId,
        correlationId: TARGET.correlationId,
        approverIdentity: TARGET.operatorId,
      })

      const fresh = createInvocation(freshDb, { now: LATER })
      const resumed = await fresh.authority.admit({
        ...TARGET,
        operatorId: 'fresh-confirmer@example.invalid',
        correlationId: 'fresh-invocation',
      })
      expect(resumed).toMatchObject({
        recoveryInput: admitted.recoveryInput,
        expired: 101,
        approvalId: admitted.approvalId,
        approvalBundleSha256: admitted.approvalBundleSha256,
        reportSha256: admitted.reportSha256,
      })
      expect(fresh.createRecoveryRunId).not.toHaveBeenCalled()
      expect(fresh.loadNextRecoveryGeneration).not.toHaveBeenCalled()
      expect(fresh.runLifecycle).not.toHaveBeenCalled()
      await resumed.applyReviewLifecycle()
      expect(fresh.runLifecycle).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          mode: 'apply',
          checkpoint: expect.objectContaining({
            evaluatedAt: NOW.toISOString(),
            after: { createdAt: CREATED_AT.toISOString(), reviewId: reviewIdAt(100) },
          }),
        }),
      )
      expect(fresh.runLifecycle).toHaveBeenCalledTimes(3)
      expect(fresh.runLifecycle).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ mode: 'apply' }),
      )
      expect(fresh.runLifecycle.mock.calls[1]![0].checkpoint).toBeUndefined()
      expect(fresh.runLifecycle.mock.calls[2]![0].checkpoint?.evaluatedAt).toBe(
        LATER.toISOString(),
      )
      expect(await readExecution(db)).toMatchObject({
        state: 'lifecycle_applied',
        pages: 2,
        scanned: 102,
        rowsRedacted: 101,
        reportExpired: 101,
        checkpointCreatedAt: null,
        checkpointReviewId: null,
        reportSha256: checkpointed.reportSha256,
        evaluatedAt: NOW,
        errorCode: null,
      })
      const content = await db.execute(sql`
        SELECT count(*)::int AS retained,
               min(review_id::text) AS review_id FROM review_source_contents
      `)
      expect(content.rows).toEqual([{ retained: 0, review_id: null }])

      const recovery = await commitRecoveryRun(freshDb, resumed)
      expect(recovery).toMatchObject({
        id: FIRST_RUN_ID,
        generation: checkpointed.recoveryGeneration,
        replayed: false,
      })
      expect(recovery.counts.verificationTokensInvalidated).toBeGreaterThanOrEqual(1)
      expect((await db.execute(sql`SELECT id FROM verification`)).rows).toEqual([])
      await resumed.complete(recovery)
      expect(await readExecution(db)).toMatchObject({
        id: FIRST_RUN_ID,
        recoveryGeneration: checkpointed.recoveryGeneration,
        state: 'completed',
        recoveryReplayed: false,
        operatorId: TARGET.operatorId,
        correlationId: TARGET.correlationId,
        approverIdentity: TARGET.operatorId,
      })
      expect(await db.select().from(recoveryRuns)).toEqual([
        expect.objectContaining({
          id: FIRST_RUN_ID,
          generation: checkpointed.recoveryGeneration,
          operatorId: TARGET.operatorId,
          correlationId: TARGET.correlationId,
        }),
      ])
      expect(await db.select().from(reviewLifecycleRecoveryExecutions)).toHaveLength(1)
    })
  }, 180_000)

  it('replays a committed fence in a fresh invocation and completes its original receipt', async () => {
    await withCommittedDatabase(async (db, freshDb) => {
      await seedReviews(db, 1)
      const first = createInvocation(db)
      first.createRecoveryRunId.mockReturnValue(FIRST_RUN_ID)
      const admitted = await first.authority.admit(TARGET)
      await admitted.applyReviewLifecycle()
      const applied = await readExecution(db)
      expect(applied).toMatchObject({
        state: 'lifecycle_applied',
        pages: 1,
        rowsRedacted: 1,
      })

      const recovery = await commitRecoveryRun(db, admitted)
      expect(recovery).toMatchObject({ id: FIRST_RUN_ID, replayed: false })
      expect(recovery.counts.verificationTokensInvalidated).toBeGreaterThanOrEqual(1)
      expect(await readExecution(freshDb)).toEqual(applied)
      expect(await freshDb.select().from(recoveryRuns)).toEqual([
        expect.objectContaining({
          id: FIRST_RUN_ID,
          generation: applied.recoveryGeneration,
          operatorId: TARGET.operatorId,
          correlationId: TARGET.correlationId,
        }),
      ])
      await seedVerification(db, 'recovery-proof-after-fence')
      const fresh = createInvocation(freshDb, { now: LATER })
      const resumed = await fresh.authority.admit({
        ...TARGET,
        operatorId: 'another-confirmer@example.invalid',
        correlationId: 'after-fence-interruption',
      })
      expect(resumed.recoveryInput).toEqual(admitted.recoveryInput)
      expect(resumed.expired).toBe(1)
      expect(resumed.reportSha256).toBe(admitted.reportSha256)
      await resumed.applyReviewLifecycle()
      expect(fresh.runLifecycle).toHaveBeenCalledExactlyOnceWith({
        mode: 'apply',
        batchSize: 100,
        applyConfirmation: 'apply-review-source-content-lifecycle-v1',
      })
      expect(fresh.createRecoveryRunId).not.toHaveBeenCalled()
      expect(fresh.loadNextRecoveryGeneration).not.toHaveBeenCalled()
      expect(await readExecution(db)).toEqual(applied)
      const replay = await commitRecoveryRun(freshDb, resumed)
      expect(replay).toMatchObject({
        id: recovery.id,
        generation: recovery.generation,
        replayed: true,
      })
      expect(replay.counts.verificationTokensInvalidated).toBe(
        recovery.counts.verificationTokensInvalidated + 1,
      )
      expect((await db.execute(sql`SELECT id FROM verification`)).rows).toEqual([])
      await resumed.complete(replay)
      expect(await readExecution(db)).toMatchObject({
        state: 'completed',
        recoveryReplayed: true,
        id: FIRST_RUN_ID,
        recoveryGeneration: recovery.generation,
        operatorId: TARGET.operatorId,
        correlationId: TARGET.correlationId,
        approverIdentity: TARGET.operatorId,
      })
      expect(await db.select().from(recoveryRuns)).toEqual([
        expect.objectContaining({
          id: FIRST_RUN_ID,
          generation: recovery.generation,
          operatorId: TARGET.operatorId,
          correlationId: TARGET.correlationId,
        }),
      ])
      expect(await db.select().from(reviewLifecycleRecoveryExecutions)).toHaveLength(1)
    })
  }, 180_000)

  it.each(['page', 'fence', 'catchup', 'expiry-during-fence'] as const)(
    'drains Reviews expiring after a committed %s interruption through restore-verify',
    async (interruption) => {
      await withCommittedDatabase(async (db, freshDb) => {
        await seedReviews(db, 101, 2)
        // A newly expired row lies before the saved cursor; another remains live.
        await db.execute(sql`
        UPDATE review_source_contents SET content_expires_at = ${NOW}::timestamptz + interval '1 day'
        WHERE review_id = ${reviewIdAt(1)}::uuid
      `)
        await db.execute(sql`
        UPDATE review_source_contents SET content_expires_at = ${LATER}::timestamptz + interval '1 day'
        WHERE review_id = ${reviewIdAt(103)}::uuid
      `)
        const first = createInvocation(db, {
          interruptAfterPage: interruption === 'page',
        })
        first.createRecoveryRunId.mockReturnValue(FIRST_RUN_ID)
        if (interruption === 'expiry-during-fence') {
          let now = NOW
          const command = restoreCommand(
            db,
            first,
            () => now,
            false,
            () => {
              now = LATER
            },
          )
          expect(await command.run()).toBe(1)
          expect(command.io.err).toHaveBeenCalledWith(
            expect.stringContaining('2 expired-content row(s) remain'),
          )
        } else {
          await expect(
            restoreCommand(db, first, NOW, interruption !== 'page').run(),
          ).rejects.toBe(INTERRUPTED)
        }
        const interrupted = await readExecution(freshDb)
        expect(interrupted).toMatchObject({
          state: interruption === 'page' ? 'applying' : 'lifecycle_applied',
          evaluatedAt: NOW,
          reportExpired: 100,
          ...(interruption === 'page'
            ? { checkpointReviewId: reviewIdAt(100), pages: 1 }
            : {}),
        })

        if (interruption === 'catchup') {
          const catchup = createInvocation(freshDb, {
            now: LATER,
            interruptAfterPage: true,
          })
          await expect(restoreCommand(freshDb, catchup, LATER).run()).rejects.toBe(
            INTERRUPTED,
          )
          expect(await readExecution(db)).toMatchObject({
            state: 'lifecycle_applied',
            pages: interrupted.pages,
            rowsRedacted: interrupted.rowsRedacted,
            evaluatedAt: NOW,
            errorCode: 'review_lifecycle_apply_failed',
          })
        }

        const fresh = createInvocation(freshDb, { now: LATER })
        const command = restoreCommand(freshDb, fresh, LATER)
        expect(await command.countExpired()).toBe(
          interruption === 'page' ? 3 : interruption === 'catchup' ? 1 : 2,
        )
        expect(await command.run()).toBe(0)
        expect(command.io.err).not.toHaveBeenCalled()
        expect(await command.countExpired()).toBe(0)
        expect(await readExecution(db)).toMatchObject({
          state: 'completed',
          evaluatedAt: NOW,
          reportExpired: 100,
          reportSha256: interrupted.reportSha256,
          approvalBundleSha256: interrupted.approvalBundleSha256,
          checkpointCreatedAt: null,
          checkpointReviewId: null,
          recoveryReplayed: interruption !== 'page',
        })
        expect(
          (await db.execute(sql`SELECT review_id::text FROM review_source_contents`))
            .rows,
        ).toEqual([{ review_id: reviewIdAt(103) }])
        expect(
          (
            await db.execute(sql`
          SELECT count(*)::int AS reviews,
                 count(*) FILTER (WHERE source_content_state = 'source_expired')::int AS expired
          FROM reviews
        `)
          ).rows,
        ).toEqual([{ reviews: 103, expired: 102 }])
        expect(await db.select().from(recoveryRuns)).toEqual([
          expect.objectContaining({
            id: FIRST_RUN_ID,
            generation: interrupted.recoveryGeneration,
          }),
        ])
        expect(await db.select().from(reviewLifecycleRecoveryExecutions)).toHaveLength(1)
        expect(fresh.createRecoveryRunId).not.toHaveBeenCalled()
        expect(fresh.loadNextRecoveryGeneration).not.toHaveBeenCalled()
      })
    },
    180_000,
  )

  it('excludes a completed receipt and admits a distinct restore with a new generation', async () => {
    await withCommittedDatabase(async (db, freshDb) => {
      await seedReviews(db, 1)
      const first = createInvocation(db)
      first.createRecoveryRunId.mockReturnValue(FIRST_RUN_ID)
      const admitted = await first.authority.admit(TARGET)
      await admitted.applyReviewLifecycle()
      await admitted.complete(await commitRecoveryRun(db, admitted))
      const completed = await readExecution(db)

      const fresh = createInvocation(freshDb, { now: LATER })
      const next = await fresh.authority.admit({
        ...TARGET,
        restorePointAt: new Date('2026-08-29T09:00:00.000Z'),
      })
      expect(next.recoveryInput).toMatchObject({
        runId: NEXT_RUN_ID,
        generation: completed.recoveryGeneration + 1,
      })
      expect(next.expired).toBe(0)
      expect(next.approvalId).not.toBe(admitted.approvalId)
      expect(fresh.createRecoveryRunId).toHaveBeenCalledOnce()
      expect(fresh.loadNextRecoveryGeneration).toHaveBeenCalledOnce()
      expect(fresh.runLifecycle.mock.calls.map(([input]) => input.mode)).toEqual([
        'report',
        'shadow',
        'report',
        'shadow',
      ])
      expect(await readExecution(db)).toEqual(completed)
      expect(await readExecution(db, NEXT_RUN_ID)).toMatchObject({
        state: 'applying',
        pages: 0,
        rowsRedacted: 0,
      })
    })
  }, 180_000)

  it('refuses changed restore targets while preserving the active receipt and content', async () => {
    await withCommittedDatabase(async (db, freshDb) => {
      await seedReviews(db, 1)
      const first = createInvocation(db)
      first.createRecoveryRunId.mockReturnValue(FIRST_RUN_ID)
      await first.authority.admit(TARGET)
      const before = await readExecution(db)
      const changes: Partial<RestoreReviewLifecycleRuntimeTarget>[] = [
        { releaseSha: 'c'.repeat(40) },
        { releaseManifestSha256: 'd'.repeat(64) },
        { restorePointAt: new Date('2026-08-28T09:01:00.000Z') },
        { restoreDatabaseServiceName: 'Postgres-another-restore' },
        { railwayProjectId: 'another-project' },
        { railwayEnvironmentId: 'another-environment' },
      ]
      for (const change of changes) {
        const fresh = createInvocation(freshDb, { now: LATER })
        await expect(fresh.authority.admit({ ...TARGET, ...change })).rejects.toThrow(
          'wrong_target',
        )
        expect(fresh.runLifecycle).not.toHaveBeenCalled()
        expect(fresh.createRecoveryRunId).not.toHaveBeenCalled()
        expect(fresh.loadNextRecoveryGeneration).not.toHaveBeenCalled()
        expect(await readExecution(db)).toEqual(before)
      }
      const content = await db.execute(sql`
        SELECT review.source_content_state, source.text AS cached_text
        FROM reviews AS review JOIN review_source_contents AS source ON source.review_id = review.id
        WHERE review.id = ${reviewIdAt(1)}::uuid
      `)
      expect(content.rows).toEqual([
        {
          source_content_state: 'active',
          cached_text: 'Private review text',
        },
      ])
    })
  }, 180_000)
})
