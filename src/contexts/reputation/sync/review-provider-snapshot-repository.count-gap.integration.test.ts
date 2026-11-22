// Review provider snapshot repository against real PostgreSQL: a Google total that disagrees with its list.

import { describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { reviewProviderSnapshotRuns } from '#/shared/db/schema'
import { organizationId } from '#/shared/domain/ids'
import {
  EXPIRES_AT,
  ORGANIZATION_ID,
  PROPERTY_ID,
  TEST_KEY_VERSION,
  useSnapshotRepositoryDb,
} from './review-provider-snapshot-repository.test-fixtures'

describe('review provider snapshot repository (real PostgreSQL)', () => {
  const { db, repository } = useSnapshotRepositoryDb()

  // Google's total and its list do not always agree. A location can report 82
  // and list 81 unique reviews on every read, report 19 and list 20, or report
  // 86 and list 84. Such a run used to fail as `set_mismatch` every time. A
  // small gap (up to 5, or 2% on a big location) now completes the run, but
  // nothing is removed on the strength of that listing.
  describe('a Google total that disagrees with its list by a small amount', () => {
    const GAP_RUN_ID = '72000000-0000-4000-8000-00000000000a'
    const PRIOR_RUN_ID = '72000000-0000-4000-8000-00000000000b'
    /** Stored, absent from this listing, and already missed by an earlier run:
     * exactly what a run whose count matched would make a removal candidate. */
    const ABSENT_REVIEW_ID = '72000000-0000-4000-8000-00000000000c'
    /** Stored and absent from this listing for the first time. */
    const UNMISSED_REVIEW_ID = '72000000-0000-4000-8000-00000000000d'
    const STORED_TEXT = 'count gap stored source'
    const tenant = organizationId(ORGANIZATION_ID)

    type Listing = Readonly<{ expected: number; unique: number; pages: number }>

    const resetGapScope = async () => {
      await db.execute(sql`
        DELETE FROM review_google_reputation_snapshot_facts WHERE run_id = ${GAP_RUN_ID}
      `)
      await db
        .delete(reviewProviderSnapshotRuns)
        .where(eq(reviewProviderSnapshotRuns.propertyId, PROPERTY_ID))
      await db.execute(sql`
        DELETE FROM review_provider_subjects
        WHERE review_id IN (${ABSENT_REVIEW_ID}, ${UNMISSED_REVIEW_ID})
      `)
      await db.execute(sql`
        DELETE FROM review_source_contents WHERE review_id = ${ABSENT_REVIEW_ID}
      `)
      await db.execute(sql`DELETE FROM reviews WHERE id = ${ABSENT_REVIEW_ID}`)
    }

    /** A run whose main listing is spent: `unique` members over `pages` pages,
     * against the total Google reported on every page. */
    const seedListing = async (
      listing: Listing,
      state: Readonly<{ state: 'scanning' | 'deleting'; phase: 'main' | 'apply' }> = {
        state: 'scanning',
        phase: 'main',
      },
    ): Promise<Date> => {
      // Recent, so the confirmation deadline (start + 12 hours) is still open.
      const startedAt = new Date(Date.now() - 60_000)
      await db.insert(reviewProviderSnapshotRuns).values({
        id: GAP_RUN_ID,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        sourceEpoch: 0,
        state: state.state,
        phase: state.phase,
        expectedTotal: listing.expected,
        expectedAverageRating: 4.5,
        mainPageCount: listing.pages,
        mainUniqueCount: listing.unique,
        mainCursorRef: null,
        startedAt,
        expiresAt: new Date(startedAt.getTime() + 12 * 60 * 60 * 1000),
      })
      await db.execute(sql`
        INSERT INTO review_provider_snapshot_members (run_id, review_id, main_seen)
        SELECT ${GAP_RUN_ID}, md5('count-gap-listed-' || i)::uuid, true
        FROM generate_series(1, ${listing.unique}::int) AS i
      `)
      return startedAt
    }

    const seedStoredReviewsMissingFromListing = async (startedAt: Date) => {
      const lastObservedAt = new Date(startedAt.getTime() - 3 * 24 * 60 * 60 * 1000)
      const firstMissingAt = new Date(startedAt.getTime() - 2 * 24 * 60 * 60 * 1000)
      await db.execute(sql`
        INSERT INTO review_provider_subject_hmac_key_versions
          (key_version, key_digest, state, generation, created_at)
        VALUES
          (${TEST_KEY_VERSION}, ${'1'.repeat(64)}, 'trusted_next', 999999, transaction_timestamp())
        ON CONFLICT (key_version) DO NOTHING
      `)
      await db.execute(sql`
        INSERT INTO reviews (
          id, organization_id, property_id, platform, external_id,
          external_location_id, expires_at, source_epoch, source_revision,
          analysis_sequence, reply_state_revision, created_at, updated_at
        ) VALUES (
          ${ABSENT_REVIEW_ID}, ${ORGANIZATION_ID}, ${PROPERTY_ID}, 'google',
          'count-gap-absent-review', 'count-gap-location', ${EXPIRES_AT},
          0, 1, 0, 0, ${lastObservedAt}, ${lastObservedAt}
        )
      `)
      await db.execute(sql`
        INSERT INTO review_source_contents (
          review_id, organization_id, property_id, platform, external_id,
          external_location_id, rating, text, reviewed_at, first_fetched_at,
          last_fetched_at, content_expires_at, source_epoch, source_revision,
          ai_source_byte_length, ai_source_digest, created_at, updated_at
        ) VALUES (
          ${ABSENT_REVIEW_ID}, ${ORGANIZATION_ID}, ${PROPERTY_ID}, 'google',
          'count-gap-absent-review', 'count-gap-location', 3,
          ${STORED_TEXT}, ${lastObservedAt}, ${lastObservedAt},
          ${lastObservedAt}, ${EXPIRES_AT}, 0, 1, 23, ${'5'.repeat(64)},
          ${lastObservedAt}, ${lastObservedAt}
        )
      `)
      await db.execute(sql`
        INSERT INTO review_provider_subjects (
          organization_id, property_id, source_epoch, key_version,
          locator_hmac, verifier_hmac, review_id, last_source_revision,
          state, last_observed_at, first_missing_at,
          first_missing_snapshot_run_id, created_at, updated_at
        ) VALUES
          (
            ${ORGANIZATION_ID}, ${PROPERTY_ID}, 0, ${TEST_KEY_VERSION},
            decode(repeat('0a', 32), 'hex'), decode(repeat('0b', 32), 'hex'),
            ${ABSENT_REVIEW_ID}, 1, 'linked', ${lastObservedAt}, ${firstMissingAt},
            ${PRIOR_RUN_ID}, ${lastObservedAt}, ${lastObservedAt}
          ),
          (
            ${ORGANIZATION_ID}, ${PROPERTY_ID}, 0, ${TEST_KEY_VERSION},
            decode(repeat('0c', 32), 'hex'), decode(repeat('0d', 32), 'hex'),
            ${UNMISSED_REVIEW_ID}, 1, 'linked', ${lastObservedAt}, NULL,
            NULL, ${lastObservedAt}, ${lastObservedAt}
          )
      `)
    }

    /** The confirmation scan lists the same reviews again, page for page. */
    const confirmListing = async (listing: Listing) => {
      await db.execute(sql`
        UPDATE review_provider_snapshot_members
        SET confirmation_seen = true
        WHERE run_id = ${GAP_RUN_ID}
      `)
      await db
        .update(reviewProviderSnapshotRuns)
        .set({
          confirmationPageCount: listing.pages,
          confirmationUniqueCount: listing.unique,
        })
        .where(eq(reviewProviderSnapshotRuns.id, GAP_RUN_ID))
    }

    const candidatesOf = async (runId: string) =>
      (
        await db.execute(sql`
          SELECT review_id, expected_mapping_state, state
          FROM review_provider_deletion_candidates
          WHERE run_id = ${runId}
          ORDER BY review_id
        `)
      ).rows

    const subjectOf = async (reviewId: string) =>
      (
        await db.execute(sql`
          SELECT state, first_missing_snapshot_run_id
          FROM review_provider_subjects
          WHERE review_id = ${reviewId}
        `)
      ).rows[0]

    const runState = async () =>
      (
        await db.execute(sql`
          SELECT state, phase, failure_code
          FROM review_provider_snapshot_runs
          WHERE id = ${GAP_RUN_ID}
        `)
      ).rows[0]

    it.each([
      { expected: 82, unique: 81, pages: 2, case: 'one review fewer than Google counts' },
      { expected: 19, unique: 20, pages: 1, case: 'one review more than Google counts' },
      // A real run: 86 counted, 84 unique over 2 pages,
      // a gap of 2 that the 2% rule failed.
      {
        expected: 86,
        unique: 84,
        pages: 2,
        case: 'two reviews fewer (86 counted, 84 listed)',
      },
      {
        expected: 86,
        unique: 81,
        pages: 2,
        case: 'the widest gap a small total allows (5)',
      },
    ])('completes a listing with $case and removes nothing', async (listing) => {
      await resetGapScope()
      const startedAt = await seedListing(listing)
      await seedStoredReviewsMissingFromListing(startedAt)

      await expect(
        repository.finishMainScan({ runId: GAP_RUN_ID }),
      ).resolves.toMatchObject({ status: 'confirming' })
      // Nothing is based on this listing: no candidate, and no first miss either,
      // so a later run cannot finish a removal this one started.
      expect(await candidatesOf(GAP_RUN_ID)).toEqual([])
      expect(await subjectOf(UNMISSED_REVIEW_ID)).toMatchObject({
        first_missing_snapshot_run_id: null,
      })
      expect(await subjectOf(ABSENT_REVIEW_ID)).toMatchObject({
        first_missing_snapshot_run_id: PRIOR_RUN_ID,
      })

      await expect(
        repository.readNextLinkedCandidate({ runId: GAP_RUN_ID }),
      ).resolves.toBeNull()
      await repository.beginConfirmationScan({
        runId: GAP_RUN_ID,
        organizationId: tenant,
      })
      await confirmListing(listing)
      await expect(
        repository.finishConfirmationScan({ runId: GAP_RUN_ID, organizationId: tenant }),
      ).resolves.toMatchObject({ status: 'deleting' })
      await expect(
        repository.applyDeletionBatch({ runId: GAP_RUN_ID, limit: 100 }),
      ).resolves.toMatchObject({
        applied: 0,
        observed: 0,
        done: true,
        run: {
          state: 'completed',
          expectedProviderTotal: listing.expected,
          mainUniqueCount: listing.unique,
        },
      })

      const stored = await db.execute(sql`
        SELECT review.source_content_state, content.text
        FROM reviews AS review
        JOIN review_source_contents AS content ON content.review_id = review.id
        WHERE review.id = ${ABSENT_REVIEW_ID}
      `)
      expect(stored.rows).toEqual([{ source_content_state: 'active', text: STORED_TEXT }])
      const content = await db.execute(sql`
        SELECT review_id FROM review_source_contents WHERE review_id = ${ABSENT_REVIEW_ID}
      `)
      expect(content.rows).toHaveLength(1)
      expect(await subjectOf(ABSENT_REVIEW_ID)).toMatchObject({ state: 'linked' })
      // The completed run verifies Google's own aggregate, not the list's count.
      const facts = await db.execute(sql`
        SELECT review_count FROM review_google_reputation_snapshot_facts
        WHERE run_id = ${GAP_RUN_ID}
      `)
      expect(facts.rows).toEqual([{ review_count: listing.expected }])
      await resetGapScope()
    })

    it("makes the same stored review a removal candidate when Google's total matches its list", async () => {
      await resetGapScope()
      const startedAt = await seedListing({ expected: 81, unique: 81, pages: 2 })
      await seedStoredReviewsMissingFromListing(startedAt)

      await expect(
        repository.finishMainScan({ runId: GAP_RUN_ID }),
      ).resolves.toMatchObject({ status: 'confirming' })

      expect(await candidatesOf(GAP_RUN_ID)).toEqual([
        {
          review_id: ABSENT_REVIEW_ID,
          expected_mapping_state: 'linked',
          state: 'pending',
        },
      ])
      expect(await subjectOf(UNMISSED_REVIEW_ID)).toMatchObject({
        first_missing_snapshot_run_id: GAP_RUN_ID,
      })
      await resetGapScope()
    })

    it.each([
      { expected: 82, unique: 70, pages: 2, case: 'a gap far beyond the tolerance' },
      { expected: 86, unique: 80, pages: 2, case: 'a gap one review past the tolerance' },
      { expected: 20, unique: 17, pages: 1, case: 'a gap over 10% of a small total' },
      { expected: 2_600, unique: 2_550, pages: 51, case: 'a missing full page' },
      { expected: 82, unique: 81, pages: 3, case: 'a short page before the last' },
    ])('still fails $case as set_mismatch', async (listing) => {
      await resetGapScope()
      const startedAt = await seedListing(listing)
      await seedStoredReviewsMissingFromListing(startedAt)

      await expect(
        repository.finishMainScan({ runId: GAP_RUN_ID }),
      ).resolves.toMatchObject({ status: 'failed', code: 'set_mismatch' })

      expect(await runState()).toEqual({
        state: 'failed',
        phase: 'terminal',
        failure_code: 'set_mismatch',
      })
      expect(await candidatesOf(GAP_RUN_ID)).toEqual([])
      await resetGapScope()
    })

    it('refuses to apply a removal on a run whose listing disagreed with the total', async () => {
      await resetGapScope()
      const startedAt = await seedListing(
        { expected: 82, unique: 81, pages: 2 },
        { state: 'deleting', phase: 'apply' },
      )
      await seedStoredReviewsMissingFromListing(startedAt)
      // Unreachable through `finishMainScan`, which records no candidate for such
      // a run. The apply step holds the rule on its own all the same.
      await db.execute(sql`
        INSERT INTO review_provider_deletion_candidates (
          run_id, review_id, expected_mapping_state, expected_source_revision, state
        ) VALUES (${GAP_RUN_ID}, ${ABSENT_REVIEW_ID}, 'linked', 1, 'confirmed_missing')
      `)

      await expect(
        repository.applyDeletionBatch({ runId: GAP_RUN_ID, limit: 100 }),
      ).rejects.toMatchObject({ code: 'snapshot_count_gap_removal_refused' })

      const stored = await db.execute(sql`
        SELECT source_content_state FROM reviews WHERE id = ${ABSENT_REVIEW_ID}
      `)
      expect(stored.rows).toEqual([{ source_content_state: 'active' }])
      expect(await runState()).toMatchObject({ state: 'deleting' })
      await resetGapScope()
    })
  })
})
