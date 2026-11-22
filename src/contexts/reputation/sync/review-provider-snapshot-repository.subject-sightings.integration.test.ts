// Review provider snapshot repository against real PostgreSQL: reviews a head check or a push stored outside any run.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { getPool } from '#/shared/db/pool'
import { reviewProviderSnapshotRuns } from '#/shared/db/schema'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { deriveReviewProviderSubject } from '#/shared/google-contracts/review-provider-subject-contract'
import { createReviewProviderSubjectSightings } from './review-provider-subject-link.server'
import {
  ORGANIZATION_ID,
  PROPERTY_ID,
  useSnapshotRepositoryDb,
} from './review-provider-snapshot-repository.test-fixtures'

describe('review provider snapshot repository (real PostgreSQL)', () => {
  const { db, repository } = useSnapshotRepositoryDb()

  describe('a review a head check or a push stored, mapped outside any run', () => {
    const SIGHTING_RUN_ID = '72000000-0000-4000-8000-000000000021'
    const SIGHTING_ACCOUNT = 'sighting-account'
    const SIGHTED_REVIEW_ID = '72000000-0000-4000-8000-000000000022'
    const OTHER_REVIEW_ID = '72000000-0000-4000-8000-000000000023'
    const FALLBACK_ACTIVE_KEY = 'sighting-test-active'
    const RETIRED_KEY = 'sighting-test-retired'
    const STAGED_KEY = 'sighting-test-staged'
    const KEY = new Uint8Array(32).fill(5)
    const warn = vi.fn()
    const sightings = createReviewProviderSubjectSightings(db, { warn })
    let activeKey = FALLBACK_ACTIVE_KEY
    let insertedActiveKey = false

    const resetSightingScope = async () => {
      await db
        .delete(reviewProviderSnapshotRuns)
        .where(eq(reviewProviderSnapshotRuns.propertyId, PROPERTY_ID))
      await db.execute(sql`
        DELETE FROM review_provider_subjects
        WHERE review_id IN (${SIGHTED_REVIEW_ID}, ${OTHER_REVIEW_ID})
      `)
    }

    beforeAll(async () => {
      const active = await db.execute(sql`
        SELECT key_version FROM review_provider_subject_hmac_key_versions
        WHERE state = 'active'
      `)
      const existing = active.rows[0]?.key_version
      if (existing == null) {
        await db.execute(sql`
          INSERT INTO review_provider_subject_hmac_key_versions
            (key_version, key_digest, state, generation, created_at, activated_at)
          VALUES (${FALLBACK_ACTIVE_KEY}, ${'5'.repeat(64)}, 'active', 999990,
            transaction_timestamp(), transaction_timestamp())
        `)
        insertedActiveKey = true
      } else {
        activeKey = String(existing)
      }
      // A key an activation retired after a deriver was acquired under it.
      await db.execute(sql`
        INSERT INTO review_provider_subject_hmac_key_versions
          (key_version, key_digest, state, generation, created_at, retiring_at)
        VALUES (${RETIRED_KEY}, ${'6'.repeat(64)}, 'retiring', 1,
          transaction_timestamp(), transaction_timestamp())
      `)
    })

    afterAll(async () => {
      await resetSightingScope()
      await db.execute(sql`
        DELETE FROM review_provider_subject_hmac_key_versions
        WHERE key_version IN (${RETIRED_KEY}, ${STAGED_KEY})
          OR (${insertedActiveKey} AND key_version = ${FALLBACK_ACTIVE_KEY})
      `)
    })

    const sight = (
      over: Readonly<{
        reviewId?: string
        sourceRevision?: number
        keyVersion?: string
      }> = {},
    ) =>
      sightings.record({
        organizationId: organizationId(ORGANIZATION_ID),
        propertyId: propertyId(PROPERTY_ID),
        sourceEpoch: 0,
        reviewId: reviewId(over.reviewId ?? SIGHTED_REVIEW_ID),
        sourceRevision: over.sourceRevision ?? 1,
        subjects: [
          deriveReviewProviderSubject({
            organizationId: ORGANIZATION_ID,
            propertyId: PROPERTY_ID,
            sourceEpoch: 0,
            resourceName: `accounts/${SIGHTING_ACCOUNT}/locations/sighting-location/reviews/sighted`,
            keyVersion: over.keyVersion ?? activeKey,
            key: KEY,
          }),
        ],
      })

    const sightedSubject = async () =>
      (
        await db.execute(sql`
          SELECT state, last_source_revision, last_seen_snapshot_run_id,
                 first_missing_snapshot_run_id, last_observed_at
          FROM review_provider_subjects WHERE review_id = ${SIGHTED_REVIEW_ID}
        `)
      ).rows[0]

    /** A run whose main listing is spent and does not list the sighted review. */
    const seedSpentListing = async (
      startedAt: Date,
      listing: Readonly<{ expected: number; unique: number; pages: number }>,
    ) => {
      await db.insert(reviewProviderSnapshotRuns).values({
        id: SIGHTING_RUN_ID,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        sourceEpoch: 0,
        state: 'scanning',
        phase: 'main',
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
        SELECT ${SIGHTING_RUN_ID}, md5('sighting-listed-' || i)::uuid, true
        FROM generate_series(1, ${listing.unique}::int) AS i
      `)
    }

    /** Just after the sighting, so the run judges the mapping it wrote. */
    const afterSighting = async (): Promise<Date> => {
      const row = await sightedSubject()
      const observedAt = new Date(String(row?.last_observed_at))
      return new Date(observedAt.getTime() + 1)
    }

    const missOf = async () =>
      (await sightedSubject())?.first_missing_snapshot_run_id ?? null

    it('maps it as linked and seen by no run, then keeps only its revision current', async () => {
      await resetSightingScope()

      await expect(sight()).resolves.toBe('linked')
      const linked = await sightedSubject()
      expect(linked).toMatchObject({
        state: 'linked',
        last_source_revision: '1',
        last_seen_snapshot_run_id: null,
        first_missing_snapshot_run_id: null,
      })

      // A later sighting of the same review, at a newer revision: the removal
      // step compares this revision with the Review's own.
      await expect(sight({ sourceRevision: 3 })).resolves.toBe('already_mapped')
      const edited = await sightedSubject()
      expect(edited).toMatchObject({ state: 'linked', last_source_revision: '3' })
      expect(new Date(String(edited?.last_observed_at)).getTime()).toBeGreaterThan(
        new Date(String(linked?.last_observed_at)).getTime(),
      )
      // An older revision, read before that edit, never moves it back.
      await expect(sight({ sourceRevision: 2 })).resolves.toBe('already_mapped')
      expect(await sightedSubject()).toMatchObject({ last_source_revision: '3' })
      await resetSightingScope()
    })

    it('leaves a mapping of another review alone and logs the collision without identifiers', async () => {
      await resetSightingScope()
      await expect(sight()).resolves.toBe('linked')
      warn.mockClear()

      // Another review under the same locator: the mapping it found wins.
      await expect(sight({ reviewId: OTHER_REVIEW_ID, sourceRevision: 5 })).resolves.toBe(
        'collision',
      )

      const rows = await db.execute(sql`
        SELECT review_id, last_source_revision FROM review_provider_subjects
        WHERE review_id IN (${SIGHTED_REVIEW_ID}, ${OTHER_REVIEW_ID})
      `)
      expect(rows.rows).toEqual([
        { review_id: SIGHTED_REVIEW_ID, last_source_revision: '1' },
      ])
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]?.[0]).toEqual({
        event: 'review_provider_subject_sighting_collision',
        count: 1,
      })
      await resetSightingScope()
    })

    it('is not judged missing by a run that started before it was mapped', async () => {
      await resetSightingScope()
      await seedSpentListing(new Date(Date.now() - 60_000), {
        expected: 81,
        unique: 81,
        pages: 2,
      })
      await expect(sight()).resolves.toBe('linked')

      await expect(
        repository.finishMainScan({ runId: SIGHTING_RUN_ID }),
      ).resolves.toMatchObject({ status: 'confirming' })

      expect(await missOf()).toBeNull()
      await resetSightingScope()
    })

    it("records no miss from a listing whose count disagrees with Google's total, and one from a listing that agrees", async () => {
      await resetSightingScope()
      await expect(sight()).resolves.toBe('linked')

      await seedSpentListing(await afterSighting(), {
        expected: 82,
        unique: 81,
        pages: 2,
      })
      await expect(
        repository.finishMainScan({ runId: SIGHTING_RUN_ID }),
      ).resolves.toMatchObject({ status: 'confirming' })
      expect(await missOf()).toBeNull()

      await db
        .delete(reviewProviderSnapshotRuns)
        .where(eq(reviewProviderSnapshotRuns.id, SIGHTING_RUN_ID))
      await seedSpentListing(await afterSighting(), {
        expected: 81,
        unique: 81,
        pages: 2,
      })
      await expect(
        repository.finishMainScan({ runId: SIGHTING_RUN_ID }),
      ).resolves.toMatchObject({ status: 'confirming' })
      expect(await missOf()).toBe(SIGHTING_RUN_ID)
      await resetSightingScope()
    })

    it('maps nothing while the key it was derived under is no longer the active one', async () => {
      await resetSightingScope()

      await expect(sight({ keyVersion: RETIRED_KEY })).resolves.toBe('key_rotating')

      expect(await sightedSubject()).toBeUndefined()
    })

    // Page commits and sightings only read the key rows: one does not wait for
    // another, while a rotation, which updates them, waits for both.
    it('does not wait for another writer holding the active key row', async () => {
      await resetSightingScope()
      const holder = await getPool().connect()
      try {
        await holder.query('BEGIN')
        await holder.query(
          `SELECT 1 FROM review_provider_subject_hmac_key_versions
           WHERE key_version = $1 FOR SHARE`,
          [activeKey],
        )
        const blocked = new Promise<'blocked'>((resolve) => {
          setTimeout(() => resolve('blocked'), 5_000)
        })

        await expect(Promise.race([sight(), blocked])).resolves.toBe('linked')
      } finally {
        await holder.query('ROLLBACK')
        holder.release()
        await resetSightingScope()
      }
    })

    // Candidates are never derived under a staged next key. Activation needs
    // that key to have no mapping, so one written under the active key while
    // a rotation is staged leaves the activation free to proceed; the active
    // key then retires, and cannot be removed while a mapping still uses it.
    it('maps under the active key while a next key is staged, and nothing under the staged key', async () => {
      await resetSightingScope()
      await db.execute(sql`
        INSERT INTO review_provider_subject_hmac_key_versions
          (key_version, key_digest, state, generation, created_at)
        VALUES (${STAGED_KEY}, ${'7'.repeat(64)}, 'trusted_next', 999999,
          transaction_timestamp())
      `)
      try {
        await expect(sight()).resolves.toBe('linked')

        expect(
          (
            await db.execute(sql`
              SELECT key_version FROM review_provider_subjects
              WHERE review_id = ${SIGHTED_REVIEW_ID}
            `)
          ).rows,
        ).toEqual([{ key_version: activeKey }])
        const staged = await db.execute(sql`
          SELECT count(*)::int AS mappings FROM review_provider_subjects
          WHERE key_version = ${STAGED_KEY}
        `)
        expect(staged.rows[0]).toEqual({ mappings: 0 })
      } finally {
        await resetSightingScope()
        await db.execute(sql`
          DELETE FROM review_provider_subject_hmac_key_versions
          WHERE key_version = ${STAGED_KEY}
        `)
      }
    })
  })
})
