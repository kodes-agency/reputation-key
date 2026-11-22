// Review provider snapshot repository against real PostgreSQL: the end of a Property's first history import and its history cutoff.

import { replyScopeEffects } from '#/contexts/reputation/public-api'
import { describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { properties, reviewProviderSnapshotRuns } from '#/shared/db/schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { createReviewProviderSnapshotRepository } from './review-provider-snapshot-repository.server'
import {
  EXPIRES_AT,
  ORGANIZATION_ID,
  OTHER_RUN_ID,
  PROPERTY_ID,
  STARTED_AT,
  useSnapshotRepositoryDb,
} from './review-provider-snapshot-repository.test-fixtures'

describe('review provider snapshot repository (real PostgreSQL)', () => {
  const { db, repository } = useSnapshotRepositoryDb()

  describe("the end of a Property's first history import", () => {
    const IMPORT_RUN_ID = '72000000-0000-4000-8000-000000000009'
    const scope = {
      organizationId: organizationId(ORGANIZATION_ID),
      propertyId: propertyId(PROPERTY_ID),
      sourceEpoch: 0,
    }
    const importRepository = createReviewProviderSnapshotRepository(
      db,
      () => IMPORT_RUN_ID,
      replyScopeEffects,
    )
    const resetScope = async () => {
      await db.execute(
        sql`DELETE FROM review_sync_runs WHERE property_id = ${PROPERTY_ID}`,
      )
      await db
        .delete(reviewProviderSnapshotRuns)
        .where(eq(reviewProviderSnapshotRuns.propertyId, PROPERTY_ID))
      await db.execute(sql`
        DELETE FROM review_provider_history_cutoffs WHERE property_id = ${PROPERTY_ID}
      `)
      await db.execute(sql`
        DELETE FROM review_google_reputation_snapshot_facts WHERE property_id = ${PROPERTY_ID}
      `)
      await db.execute(sql`
        DELETE FROM outbox_events WHERE organization_id = ${ORGANIZATION_ID}
      `)
    }
    const importFinishedPayloads = async () => {
      const rows = await db.execute(sql`
        SELECT payload, source_aggregate_id, property_id
        FROM outbox_events
        WHERE event_type = 'review.property_history_import.finished'
          AND organization_id = ${ORGANIZATION_ID}
        ORDER BY created_at
      `)
      return rows.rows
    }
    /** A run parked in `deleting` with nothing left to apply, so one batch completes it. */
    const seedApplyReadyRun = async (
      runId: string,
      overrides: Readonly<{ sourceEpoch?: number; observed?: number }> = {},
    ) => {
      await db.insert(reviewProviderSnapshotRuns).values({
        id: runId,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        sourceEpoch: overrides.sourceEpoch ?? 0,
        observationOrigin: 'historical_onboarding',
        state: 'deleting',
        phase: 'apply',
        expectedTotal: overrides.observed ?? 260,
        expectedAverageRating: 4.5,
        mainUniqueCount: overrides.observed ?? 260,
        startedAt: STARTED_AT,
        expiresAt: EXPIRES_AT,
      })
    }

    it('records what the import took in when its first listing completes', async () => {
      await resetScope()
      await importRepository.fixImportHistoryCutoff(scope)
      await seedApplyReadyRun(IMPORT_RUN_ID)

      await expect(
        importRepository.applyDeletionBatch({ runId: IMPORT_RUN_ID, limit: 100 }),
      ).resolves.toMatchObject({ done: true })

      const finished = await importFinishedPayloads()
      expect(finished).toHaveLength(1)
      expect(finished[0]).toMatchObject({
        source_aggregate_id: IMPORT_RUN_ID,
        property_id: PROPERTY_ID,
      })
      expect(finished[0]?.payload).toMatchObject({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        sourceEpoch: 0,
        runId: IMPORT_RUN_ID,
        outcome: 'completed',
        reviewsObserved: 260,
        failureReason: null,
      })
      await resetScope()
    })

    it('still announces the import when a head fact was stored before its first listing completed', async () => {
      await resetScope()
      await importRepository.fixImportHistoryCutoff(scope)
      // A head check read Google's newest page after the import was admitted:
      // its fact carries Google's numbers but lists nothing.
      await db.execute(sql`
        INSERT INTO review_google_reputation_snapshot_facts
          (run_id, event_id, organization_id, property_id, source_epoch,
           review_count, average_rating, evaluated_at, listing_complete,
           numbers_observed_at)
        VALUES (${crypto.randomUUID()}, ${crypto.randomUUID()}, ${ORGANIZATION_ID},
          ${PROPERTY_ID}, 0, 3, 4.5, clock_timestamp(), false, clock_timestamp())
      `)
      await seedApplyReadyRun(IMPORT_RUN_ID)

      await importRepository.applyDeletionBatch({ runId: IMPORT_RUN_ID, limit: 100 })

      const finished = await importFinishedPayloads()
      expect(finished).toHaveLength(1)
      expect(finished[0]?.payload).toMatchObject({ runId: IMPORT_RUN_ID })
      await resetScope()
    })

    it('stamps the completed run’s fact with when it froze Google’s numbers, apart from when it was written', async () => {
      await resetScope()
      await seedApplyReadyRun(IMPORT_RUN_ID)

      await importRepository.applyDeletionBatch({ runId: IMPORT_RUN_ID, limit: 100 })

      const facts = await db.execute(sql`
        SELECT listing_complete, numbers_observed_at, evaluated_at
        FROM review_google_reputation_snapshot_facts WHERE run_id = ${IMPORT_RUN_ID}
      `)
      const fact = facts.rows[0]
      expect(fact?.listing_complete).toBe(true)
      expect(new Date(String(fact?.numbers_observed_at))).toEqual(STARTED_AT)
      expect(new Date(String(fact?.evaluated_at)).getTime()).toBeGreaterThan(
        STARTED_AT.getTime(),
      )
      const events = await db.execute(sql`
        SELECT payload FROM outbox_events
        WHERE event_type = 'review.google_reputation_snapshot.verified'
          AND organization_id = ${ORGANIZATION_ID}
      `)
      expect(events.rows[0]?.payload).toMatchObject({
        numbersObservedAt: STARTED_AT.toISOString(),
      })
      await resetScope()
    })

    it('announces the import once, not on every later poll that completes', async () => {
      await resetScope()
      await importRepository.fixImportHistoryCutoff(scope)
      await seedApplyReadyRun(IMPORT_RUN_ID)
      await importRepository.applyDeletionBatch({ runId: IMPORT_RUN_ID, limit: 100 })

      await seedApplyReadyRun(OTHER_RUN_ID, { observed: 261 })
      await expect(
        importRepository.applyDeletionBatch({ runId: OTHER_RUN_ID, limit: 100 }),
      ).resolves.toMatchObject({ done: true })

      const finished = await importFinishedPayloads()
      expect(finished).toHaveLength(1)
      expect(finished[0]?.payload).toMatchObject({ runId: IMPORT_RUN_ID })
      await resetScope()
    })

    // `evaluated_at` is written through a JavaScript Date and loses the
    // cutoff's microseconds. A completion inside the cutoff's own millisecond
    // is stored BEFORE it, and the history then looked unlisted forever: this
    // test failed roughly one run in three before the comparison was taken to
    // the precision both values carry.
    it('treats a completion inside the cutoff\u2019s own millisecond as listed', async () => {
      await resetScope()
      await importRepository.fixImportHistoryCutoff(scope)
      await seedApplyReadyRun(IMPORT_RUN_ID)
      await importRepository.applyDeletionBatch({ runId: IMPORT_RUN_ID, limit: 100 })
      // Force the exact collision instead of waiting for it to happen.
      await db.execute(sql`
        UPDATE review_google_reputation_snapshot_facts
        SET evaluated_at = date_trunc(
          'milliseconds',
          (SELECT cutoff_at FROM review_provider_history_cutoffs
            WHERE property_id = ${PROPERTY_ID} AND source_epoch = 0)
        )
        WHERE run_id = ${IMPORT_RUN_ID}
      `)

      await expect(importRepository.readHistoryCutoff(scope)).resolves.toMatchObject({
        historyListed: true,
      })
      await seedApplyReadyRun(OTHER_RUN_ID, { observed: 261 })
      await importRepository.applyDeletionBatch({ runId: OTHER_RUN_ID, limit: 100 })

      await expect(importFinishedPayloads()).resolves.toHaveLength(1)
      await resetScope()
    })

    it('says nothing about a poll of a Property no import ever covered', async () => {
      await resetScope()
      await seedApplyReadyRun(IMPORT_RUN_ID)

      await expect(
        importRepository.applyDeletionBatch({ runId: IMPORT_RUN_ID, limit: 100 }),
      ).resolves.toMatchObject({ done: true })

      await expect(importFinishedPayloads()).resolves.toEqual([])
      await resetScope()
    })

    it("stays silent for a relinked epoch, which is not the Property's first import", async () => {
      await resetScope()
      await db.execute(sql`
        INSERT INTO review_provider_history_cutoffs
          (organization_id, property_id, source_epoch, cutoff_at)
        VALUES (${ORGANIZATION_ID}, ${PROPERTY_ID}, 0, ${STARTED_AT})
      `)
      await importRepository.fixImportHistoryCutoff({ ...scope, sourceEpoch: 2 })
      await db
        .update(properties)
        .set({ sourceEpoch: 2 })
        .where(eq(properties.id, PROPERTY_ID))
      await seedApplyReadyRun(IMPORT_RUN_ID, { sourceEpoch: 2 })

      await importRepository.applyDeletionBatch({ runId: IMPORT_RUN_ID, limit: 100 })

      await expect(importFinishedPayloads()).resolves.toEqual([])
      await db
        .update(properties)
        .set({ sourceEpoch: 0 })
        .where(eq(properties.id, PROPERTY_ID))
      await resetScope()
    })

    // `connection_unusable` is a connection that waits for a reconnect: the run
    // ends under its own code and the import's reader is told to reconnect, as
    // for a refused authorization.
    it.each(['authorization_denied', 'connection_unusable'] as const)(
      'reports a failed import with the closed reason and what it had listed (%s)',
      async (code) => {
        await resetScope()
        await importRepository.fixImportHistoryCutoff(scope)
        const run = await importRepository.startOrResume({
          ...scope,
          observationOrigin: 'historical_onboarding',
        })
        await db
          .update(reviewProviderSnapshotRuns)
          .set({ mainUniqueCount: 12 })
          .where(eq(reviewProviderSnapshotRuns.id, run.id))

        await importRepository.failRun({
          runId: run.id,
          organizationId: scope.organizationId,
          code,
        })

        const finished = await importFinishedPayloads()
        expect(finished).toHaveLength(1)
        expect(finished[0]?.payload).toMatchObject({
          runId: run.id,
          outcome: 'failed',
          reviewsObserved: 12,
          failureReason: 'google_authorization',
        })
        const [stored] = await db
          .select({
            state: reviewProviderSnapshotRuns.state,
            failureCode: reviewProviderSnapshotRuns.failureCode,
          })
          .from(reviewProviderSnapshotRuns)
          .where(eq(reviewProviderSnapshotRuns.id, run.id))
        expect(stored).toEqual({ state: 'failed', failureCode: code })
        await resetScope()
      },
    )

    it.each(['provider_rejected', 'provider_failure', 'authorization_changed'] as const)(
      'stores only closed diagnostics once for a failed %s run',
      async (code) => {
        await resetScope()
        const run = await importRepository.startOrResume({
          ...scope,
          observationOrigin: 'ongoing',
        })
        const providerFailure = {
          providerStatus: 404,
          providerErrorStatus: 'NOT_FOUND' as const,
          dispatch: 'answered' as const,
          message: 'private customer content',
          body: { error: { message: 'private resource' } },
        }

        await importRepository.failRun({
          runId: run.id,
          organizationId: scope.organizationId,
          code,
          providerFailure,
        })
        await importRepository.failRun({
          runId: run.id,
          organizationId: scope.organizationId,
          code,
          providerFailure: {
            providerStatus: 403,
            providerErrorStatus: 'PERMISSION_DENIED',
            dispatch: 'answered',
          },
        })

        const history = await db.execute(sql`
          SELECT id, error_class, result::jsonb AS result,
                 completed_at IS NOT NULL AS completed
          FROM review_sync_runs WHERE id = ${run.id}
        `)
        expect(history.rows).toEqual([
          {
            id: run.id,
            error_class: code,
            result: {
              providerStatus: 404,
              providerErrorStatus: 'NOT_FOUND',
              dispatch: 'answered',
            },
            completed: true,
          },
        ])
        const failed = await importRepository.readRun({ ...scope, runId: run.id })
        expect(failed).toMatchObject({ state: 'failed', failureCode: code })
        expect(JSON.stringify(history.rows)).not.toContain('private')
        await resetScope()
      },
    )

    it('starts a fresh run, not the failed one, once a connection_unusable run is over', async () => {
      await resetScope()
      const ended = await importRepository.startOrResume({
        ...scope,
        observationOrigin: 'ongoing',
      })
      await importRepository.failRun({
        runId: ended.id,
        organizationId: scope.organizationId,
        code: 'connection_unusable',
      })

      const FRESH_RUN_ID = '72000000-0000-4000-8000-0000000000a9'
      const next = await createReviewProviderSnapshotRepository(
        db,
        () => FRESH_RUN_ID,
        replyScopeEffects,
      ).startOrResume({ ...scope, observationOrigin: 'ongoing' })

      expect(ended.id).toBe(IMPORT_RUN_ID)
      expect(next).toMatchObject({
        id: FRESH_RUN_ID,
        state: 'scanning',
        mainPageIndex: 0,
      })
      await resetScope()
    })

    it('records the failure once, however often the run is failed again', async () => {
      await resetScope()
      await importRepository.fixImportHistoryCutoff(scope)
      const run = await importRepository.startOrResume({
        ...scope,
        observationOrigin: 'historical_onboarding',
      })
      const fail = () =>
        importRepository.failRun({
          runId: run.id,
          organizationId: scope.organizationId,
          code: 'provider_failure',
        })

      await fail()
      await fail()

      await expect(importFinishedPayloads()).resolves.toHaveLength(1)
      await resetScope()
    })

    it('says nothing when an ordinary poll run fails on an imported Property', async () => {
      await resetScope()
      await importRepository.fixImportHistoryCutoff(scope)
      const run = await importRepository.startOrResume({
        ...scope,
        observationOrigin: 'ongoing',
      })

      await importRepository.failRun({
        runId: run.id,
        organizationId: scope.organizationId,
        code: 'provider_failure',
      })

      await expect(importFinishedPayloads()).resolves.toEqual([])
      await resetScope()
    })
  })

  describe('initial import history cutoff', () => {
    const scope = {
      organizationId: organizationId(ORGANIZATION_ID),
      propertyId: propertyId(PROPERTY_ID),
      sourceEpoch: 0,
    }
    const resetScope = async () => {
      await db
        .delete(reviewProviderSnapshotRuns)
        .where(eq(reviewProviderSnapshotRuns.propertyId, PROPERTY_ID))
      await db.execute(sql`
        DELETE FROM review_provider_history_cutoffs WHERE property_id = ${PROPERTY_ID}
      `)
      await db.execute(sql`
        DELETE FROM review_google_reputation_snapshot_facts WHERE property_id = ${PROPERTY_ID}
      `)
    }
    const databaseNow = async () => {
      const result = await db.execute(sql`SELECT clock_timestamp() AS now`)
      return new Date(String(result.rows[0]?.now)).getTime()
    }
    const recordCutoff = (sourceEpoch: number, cutoffAt: Date) =>
      db.execute(sql`
        INSERT INTO review_provider_history_cutoffs
          (organization_id, property_id, source_epoch, cutoff_at)
        VALUES (${ORGANIZATION_ID}, ${PROPERTY_ID}, ${sourceEpoch}, ${cutoffAt})
      `)
    /** The verified fact a snapshot run of the epoch records when it completes. */
    const recordCompletedListing = (
      sourceEpoch: number,
      evaluatedAt: Date,
      listingComplete = true,
    ) =>
      db.execute(sql`
        INSERT INTO review_google_reputation_snapshot_facts
          (run_id, event_id, organization_id, property_id, source_epoch,
           review_count, average_rating, evaluated_at, listing_complete)
        VALUES (${crypto.randomUUID()}, ${crypto.randomUUID()}, ${ORGANIZATION_ID},
          ${PROPERTY_ID}, ${sourceEpoch}, 1, 4, ${evaluatedAt}, ${listingComplete})
      `)

    it('fixes the cutoff when the import is admitted, before any run starts, and keeps it', async () => {
      await resetScope()

      const admissionRequestedAt = await databaseNow()
      await repository.fixImportHistoryCutoff(scope)
      const admissionReturnedAt = await databaseNow()
      const admitted = await repository.readHistoryCutoff(scope)
      expect(admitted?.cutoffAt.getTime()).toBeGreaterThanOrEqual(admissionRequestedAt)
      expect(admitted?.cutoffAt.getTime()).toBeLessThanOrEqual(admissionReturnedAt)

      // A retried admission, then the import's own run, keep the first cutoff.
      await repository.fixImportHistoryCutoff(scope)
      await repository.startOrResume({
        ...scope,
        observationOrigin: 'historical_onboarding',
      })
      await expect(repository.readHistoryCutoff(scope)).resolves.toEqual({
        cutoffAt: admitted?.cutoffAt,
        firstImportCutoffAt: admitted?.cutoffAt,
        historyListed: false,
      })
      await resetScope()
    })

    it("reads a relinked epoch's cutoff with the Property's first import cutoff", async () => {
      await resetScope()
      const firstImport = new Date('2026-03-02T09:00:00.000Z')
      const relink = new Date('2026-09-15T10:00:00.000Z')
      await recordCutoff(0, firstImport)
      await recordCutoff(2, relink)

      await expect(
        repository.readHistoryCutoff({ ...scope, sourceEpoch: 2 }),
      ).resolves.toEqual({
        cutoffAt: relink,
        firstImportCutoffAt: firstImport,
        historyListed: false,
      })
      await expect(repository.readHistoryCutoff(scope)).resolves.toEqual({
        cutoffAt: firstImport,
        firstImportCutoffAt: firstImport,
        historyListed: false,
      })
      // The disconnected epoch in between never had an import.
      await expect(
        repository.readHistoryCutoff({ ...scope, sourceEpoch: 1 }),
      ).resolves.toBeNull()
      await resetScope()
    })

    it('reports the history listed once a run of the epoch completes after its cutoff', async () => {
      await resetScope()
      const cutoffAt = new Date('2026-09-15T10:00:00.000Z')
      await recordCutoff(0, cutoffAt)
      // A listing that completed before the import was admitted proves nothing
      // about the history the import takes over; nor does another epoch's.
      await recordCompletedListing(0, new Date('2026-09-15T09:59:59.000Z'))
      await recordCompletedListing(1, new Date('2026-09-15T11:00:00.000Z'))
      await expect(repository.readHistoryCutoff(scope)).resolves.toMatchObject({
        historyListed: false,
      })

      await recordCompletedListing(0, new Date('2026-09-15T10:40:00.000Z'))

      await expect(repository.readHistoryCutoff(scope)).resolves.toEqual({
        cutoffAt,
        firstImportCutoffAt: cutoffAt,
        historyListed: true,
      })
      await resetScope()
    })

    it('does not take a head fact for a listing of the history, however late it is', async () => {
      await resetScope()
      const cutoffAt = new Date('2026-09-15T10:00:00.000Z')
      await recordCutoff(0, cutoffAt)
      // Google's numbers from one read of its newest page (listing_complete =
      // false) say nothing about the reviews the import is still listing.
      await recordCompletedListing(0, new Date('2026-09-15T10:30:00.000Z'), false)
      await expect(repository.readHistoryCutoff(scope)).resolves.toMatchObject({
        historyListed: false,
      })

      await recordCompletedListing(0, new Date('2026-09-15T10:40:00.000Z'))

      await expect(repository.readHistoryCutoff(scope)).resolves.toMatchObject({
        historyListed: true,
      })
      await resetScope()
    })

    it('fixes the cutoff at the start of an import run that no admission fixed, and keeps it', async () => {
      await resetScope()

      const first = await repository.startOrResume({
        ...scope,
        observationOrigin: 'historical_onboarding',
      })
      await expect(repository.readHistoryCutoff(scope)).resolves.toMatchObject({
        cutoffAt: first.startedAt,
      })

      await repository.failRun({
        runId: first.id,
        organizationId: scope.organizationId,
        code: 'observation_failed',
      })
      const later = await createReviewProviderSnapshotRepository(
        db,
        () => OTHER_RUN_ID,
        replyScopeEffects,
      ).startOrResume({ ...scope, observationOrigin: 'historical_onboarding' })
      expect(later.id).toBe(OTHER_RUN_ID)
      await expect(repository.readHistoryCutoff(scope)).resolves.toMatchObject({
        cutoffAt: first.startedAt,
      })
      await expect(
        repository.readHistoryCutoff({ ...scope, sourceEpoch: 1 }),
      ).resolves.toBeNull()
      await resetScope()
    })

    it('fixes the cutoff when an import no admission fixed joins a run that is already active', async () => {
      await resetScope()

      const discovery = await repository.startOrResume({
        ...scope,
        observationOrigin: 'ongoing',
      })
      await expect(repository.readHistoryCutoff(scope)).resolves.toBeNull()
      // The discovery run has been scanning for an hour when the import starts.
      await db
        .update(reviewProviderSnapshotRuns)
        .set({
          startedAt: sql`${reviewProviderSnapshotRuns.startedAt} - interval '1 hour'`,
        })
        .where(eq(reviewProviderSnapshotRuns.id, discovery.id))

      const joinRequestedAt = await databaseNow()
      const joined = await repository.startOrResume({
        ...scope,
        observationOrigin: 'historical_onboarding',
      })
      const joinReturnedAt = await databaseNow()

      expect(joined).toMatchObject({ id: discovery.id, observationOrigin: 'ongoing' })
      const cutoff = (await repository.readHistoryCutoff(scope))?.cutoffAt.getTime()
      expect(cutoff).toBeGreaterThanOrEqual(joinRequestedAt)
      expect(cutoff).toBeLessThanOrEqual(joinReturnedAt)
      await resetScope()
    })
  })
})
