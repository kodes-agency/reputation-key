// The snapshot run clean-up against real PostgreSQL: what the keep rule
// leaves, how small each batch stays, that a snapshot run in progress is
// never waited on, and that every reader of runs answers as before.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { reviewProviderSnapshotRuns } from '#/shared/db/schema/review.schema'
import {
  createRetentionSweepHandler,
  createScheduledRetentionSweepHandler,
  REVIEW_SNAPSHOT_RUN_RETENTION_SUBJECT,
} from '#/shared/jobs/retention-sweep.job'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createPropertySetupRepository } from '#/contexts/reporting/infrastructure/repositories/property-setup.repository'
import { createReviewHeadCheckRepository } from './review-head-check.repository'
import { recordedFailureCode } from './review-provider-snapshot-listing-change'
import {
  candidateEditedSinceListing,
  mappingObservedAfterRunStart,
  recordMissingFromListing,
  UNLISTED_REVIEW_HOLD_RUNS,
} from './review-provider-snapshot-listing'
import {
  createSnapshotRunRetention,
  SNAPSHOT_MEMBERS_PER_BATCH,
} from './snapshot-run-retention.repository'

// Retention ships on; this file holds the branch a release that switched it off again
// would run, alongside the apply handler it runs while on.
vi.mock('#/shared/db/retention/scheduled-retention-activation', () => ({
  SCHEDULED_RETENTION_ACTIVE: false,
}))

const ORG = organizationId('snapshot-run-retention-org')
const PROPERTY_A = propertyId('77000000-0000-4000-8000-00000000a001')
const PROPERTY_B = propertyId('77000000-0000-4000-8000-00000000b001')
const TEST_KEY_VERSION = 'snapshot-retention-test-v1'
const HOUR_MS = 60 * 60 * 1000
const BASE = Date.parse('2026-11-01T00:00:00.000Z')

const db = getDb()
const retention = createSnapshotRunRetention(db)
const sweep = (maxBatches?: number) =>
  retention.sweepSupersededRuns({ maxBatches, scope: { organizationId: ORG } })

let keyVersion = TEST_KEY_VERSION
let insertedTestKey = false

type RunRow = typeof reviewProviderSnapshotRuns.$inferSelect

type RunSpec = Readonly<{
  property?: string
  epoch?: number
  state: 'scanning' | 'completed' | 'failed'
  failureCode?: string
  hour: number
  members?: number
}>

async function insertRun(spec: RunSpec): Promise<string> {
  const id = crypto.randomUUID()
  const startedAt = new Date(BASE + spec.hour * HOUR_MS)
  const terminal = spec.state !== 'scanning'
  await db.execute(sql`
    INSERT INTO review_provider_snapshot_runs (
      id, organization_id, property_id, source_epoch, state, phase, failure_code,
      expected_total, main_unique_count, started_at, expires_at, terminal_at,
      record_expires_at)
    VALUES (
      ${id}, ${ORG}, ${spec.property ?? PROPERTY_A}, ${spec.epoch ?? 0}, ${spec.state},
      ${terminal ? 'terminal' : 'main'}, ${spec.failureCode ?? (spec.state === 'failed' ? 'listing_changed' : null)},
      0, 0, ${startedAt}, ${new Date(startedAt.getTime() + HOUR_MS)},
      ${terminal ? new Date(startedAt.getTime() + 60_000) : null},
      ${terminal ? new Date(startedAt.getTime() + 60_000 + 30 * 24 * HOUR_MS) : null})
  `)
  await db.execute(sql`
    INSERT INTO review_provider_snapshot_members (run_id, review_id, main_seen)
    SELECT ${id}, gen_random_uuid(), true FROM generate_series(1, ${spec.members ?? 3})
  `)
  return id
}

async function insertCandidate(runId: string, reviewId: string, state: string) {
  await db.execute(sql`
    INSERT INTO review_provider_deletion_candidates
      (run_id, review_id, expected_mapping_state, expected_source_revision, state)
    VALUES (${runId}, ${reviewId}, 'linked', 1, ${state})
  `)
}

/** A linked mapping of a Review the run `lastSeen` saw last, missed since. */
async function insertSubject(
  lastSeen: string | null,
  options: Readonly<{ property?: string; epoch?: number }> = {},
): Promise<string> {
  const reviewId = crypto.randomUUID()
  await db.execute(sql`
    INSERT INTO review_provider_subjects (
      organization_id, property_id, source_epoch, key_version, locator_hmac,
      verifier_hmac, review_id, last_source_revision, state, last_observed_at,
      last_seen_snapshot_run_id, first_missing_at, first_missing_snapshot_run_id)
    VALUES (
      ${ORG}, ${options.property ?? PROPERTY_A}, ${options.epoch ?? 0}, ${keyVersion},
      decode(md5(random()::text) || md5(random()::text), 'hex'),
      decode(md5(random()::text) || md5(random()::text), 'hex'), ${reviewId}, 1, 'linked',
      ${new Date(BASE)}, ${lastSeen}, ${new Date(BASE + HOUR_MS)}, ${crypto.randomUUID()})
  `)
  return reviewId
}

async function runIds(): Promise<string[]> {
  const result = await db.execute<{ id: string }>(sql`
    SELECT id FROM review_provider_snapshot_runs WHERE organization_id = ${ORG}
    ORDER BY id
  `)
  return result.rows.map((row) => row.id)
}

async function memberRunIds(): Promise<string[]> {
  const result = await db.execute<{ run_id: string }>(sql`
    SELECT DISTINCT m.run_id FROM review_provider_snapshot_members m
    JOIN review_provider_snapshot_runs run ON run.id = m.run_id
    WHERE run.organization_id = ${ORG}
    ORDER BY m.run_id
  `)
  return result.rows.map((row) => row.run_id)
}

async function membersOf(runId: string): Promise<number> {
  const result = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM review_provider_snapshot_members WHERE run_id = ${runId}
  `)
  return result.rows[0]!.n
}

async function subjectOf(reviewId: string) {
  const result = await db.execute(sql`
    SELECT last_seen_snapshot_run_id, unlisted_hold_runs_left
    FROM review_provider_subjects
    WHERE organization_id = ${ORG} AND review_id = ${reviewId}
  `)
  return result.rows[0]
}

async function runRow(id: string): Promise<RunRow> {
  const [row] = await db
    .select()
    .from(reviewProviderSnapshotRuns)
    .where(sql`${reviewProviderSnapshotRuns.id} = ${id}`)
  return row!
}

const sorted = (ids: readonly string[]) => [...ids].sort()

async function clear(): Promise<void> {
  await db.execute(
    sql`DELETE FROM review_provider_subjects WHERE organization_id = ${ORG}`,
  )
  await db.execute(
    sql`DELETE FROM review_provider_snapshot_runs WHERE organization_id = ${ORG}`,
  )
  await db.execute(
    sql`DELETE FROM review_google_reputation_snapshot_facts WHERE organization_id = ${ORG}`,
  )
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
}

beforeAll(async () => {
  await clear()
  await deleteTestOrganizations(db, [ORG])
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG}, 'Snapshot run retention test', ${ORG}, now())
  `)
  const active = await db.execute(sql`
    SELECT key_version FROM review_provider_subject_hmac_key_versions
    WHERE state = 'active'
  `)
  const existing = active.rows[0]?.key_version
  if (existing == null) {
    await db.execute(sql`
      INSERT INTO review_provider_subject_hmac_key_versions
        (key_version, key_digest, state, generation, created_at, activated_at)
      VALUES
        (${TEST_KEY_VERSION}, ${'c'.repeat(64)}, 'active', 999994,
         transaction_timestamp(), transaction_timestamp())
    `)
    insertedTestKey = true
  } else {
    keyVersion = String(existing)
  }
})

beforeEach(async () => {
  await clear()
  for (const [id, slug] of [
    [PROPERTY_A, 'snapshot-retention-a'],
    [PROPERTY_B, 'snapshot-retention-b'],
  ]) {
    await db.execute(sql`
      INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch)
      VALUES (${id}, ${ORG}, ${slug}, ${slug}, 'UTC', 1)
    `)
  }
})

afterAll(async () => {
  await clear()
  if (insertedTestKey) {
    await db.execute(sql`
      DELETE FROM review_provider_subject_hmac_key_versions
      WHERE key_version = ${TEST_KEY_VERSION}
    `)
  }
  await deleteTestOrganizations(db, [ORG])
})

/**
 * Property A over two source epochs, oldest first, and Property B with two
 * runs. The keep rule leaves the active run, the latest completed run of each
 * epoch, and the latest three runs of each Property that a listing-change
 * reader counts, with the runs it does not count between them.
 */
async function seedHistory() {
  const failed = (hour: number, failureCode = 'listing_changed') =>
    insertRun({ epoch: 1, state: 'failed', failureCode, hour })
  const run = {
    oldCompleted0: await insertRun({ epoch: 0, state: 'completed', hour: 1 }),
    failed0: await insertRun({ epoch: 0, state: 'failed', hour: 2 }),
    latestCompleted0: await insertRun({ epoch: 0, state: 'completed', hour: 3 }),
    oldCompleted1: await insertRun({ epoch: 1, state: 'completed', hour: 4 }),
    oldCursorLost1: await failed(5, 'cursor_lost'),
    latestCompleted1: await insertRun({ epoch: 1, state: 'completed', hour: 6 }),
    fourthLatest1: await failed(7),
    thirdLatest1: await failed(8),
    cursorLost1: await failed(9, 'cursor_lost'),
    secondLatest1: await failed(10),
    unusable1: await failed(11, 'connection_unusable'),
    active1: await insertRun({ epoch: 1, state: 'scanning', hour: 12 }),
    otherPropertyOld: await insertRun({
      property: PROPERTY_B,
      state: 'completed',
      hour: 1,
    }),
    otherPropertyNew: await insertRun({ property: PROPERTY_B, state: 'failed', hour: 2 }),
  }
  const kept = [
    run.latestCompleted0,
    run.latestCompleted1,
    run.thirdLatest1,
    run.cursorLost1,
    run.secondLatest1,
    run.unusable1,
    run.active1,
    run.otherPropertyOld,
    run.otherPropertyNew,
  ]
  const deleted = [
    run.oldCompleted0,
    run.failed0,
    run.oldCompleted1,
    run.oldCursorLost1,
    run.fourthLatest1,
  ]
  return { run, kept, deleted }
}

describe('snapshot run retention (real PostgreSQL)', () => {
  it('deletes nothing while scheduled retention is inactive', async () => {
    const { kept, deleted } = await seedHistory()
    const handler = createScheduledRetentionSweepHandler({
      db,
      clock: () => new Date(),
      rules: [],
      reviewSnapshotRunRetentionSweep: () => sweep(),
    })

    await expect(handler({} as never)).resolves.toEqual({ mode: 'inactive' })

    expect(await runIds()).toEqual(sorted([...kept, ...deleted]))
    expect(await memberRunIds()).toEqual(sorted([...kept, ...deleted]))
  })

  it('deletes only the runs outside the keep rule, with their members and candidates, and records it', async () => {
    const { run, kept, deleted } = await seedHistory()
    await insertCandidate(run.fourthLatest1, crypto.randomUUID(), 'observed')
    await insertCandidate(run.thirdLatest1, crypto.randomUUID(), 'pending')
    const handler = createRetentionSweepHandler({
      db,
      clock: () => new Date(),
      rules: [],
      reviewSnapshotRunRetentionSweep: () => sweep(),
    })

    await handler({} as never)

    expect(await runIds()).toEqual(sorted(kept))
    expect(await memberRunIds()).toEqual(sorted(kept))
    const candidates = await db.execute(sql`
      SELECT run_id FROM review_provider_deletion_candidates
      WHERE run_id IN (${run.fourthLatest1}, ${run.thirdLatest1})
    `)
    expect(candidates.rows).toEqual([{ run_id: run.thirdLatest1 }])
    const evidence = await db.execute(sql`
      SELECT rows_deleted, outcome FROM retention_runs
      WHERE subject = ${REVIEW_SNAPSHOT_RUN_RETENTION_SUBJECT}
      ORDER BY started_at DESC LIMIT 1
    `)
    expect(evidence.rows[0]).toEqual({
      rows_deleted: deleted.length + deleted.length * 3,
      outcome: 'completed',
    })

    // Run again: nothing more goes.
    await expect(sweep()).resolves.toEqual({
      batches: 0,
      runs: 0,
      members: 0,
      capped: false,
    })
  })

  it('deletes a large run in bounded batches and finishes it on the next pass', async () => {
    const large = SNAPSHOT_MEMBERS_PER_BATCH * 2 + 1_000
    const old = await insertRun({ state: 'completed', hour: 1, members: large })
    for (const hour of [2, 3, 4]) await insertRun({ state: 'completed', hour })

    await expect(sweep(1)).resolves.toEqual({
      batches: 1,
      runs: 0,
      members: SNAPSHOT_MEMBERS_PER_BATCH,
      capped: true,
    })
    expect(await membersOf(old)).toBe(large - SNAPSHOT_MEMBERS_PER_BATCH)
    expect(await runIds()).toContain(old)

    await expect(sweep()).resolves.toEqual({
      batches: 2,
      runs: 1,
      members: large - SNAPSHOT_MEMBERS_PER_BATCH,
      capped: false,
    })
    expect(await runIds()).not.toContain(old)
  })

  it('never waits on a snapshot run in progress, and finishes once it moved on', async () => {
    const old = await insertRun({ state: 'completed', hour: 1 })
    const alsoOld = await insertRun({ state: 'failed', hour: 2 })
    for (const hour of [3, 4]) await insertRun({ state: 'completed', hour })
    const active = await insertRun({ state: 'scanning', hour: 5 })
    const held = await insertSubject(old)
    const free = await insertSubject(old)

    // A page commit of the active run holds its run and a mapping it is
    // about to move on, and refuses to wait on anything.
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    let locked!: () => void
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve
    })
    const page = db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '2s'`)
      await tx.execute(sql`
        SELECT 1 FROM review_provider_snapshot_runs WHERE id = ${active} FOR UPDATE
      `)
      await tx.execute(sql`
        SELECT 1 FROM review_provider_subjects
        WHERE organization_id = ${ORG} AND review_id = ${held} FOR UPDATE
      `)
      locked()
      await released
      await tx.execute(sql`
        INSERT INTO review_provider_snapshot_members (run_id, review_id, main_seen)
        VALUES (${active}, ${held}, true)
      `)
      await tx.execute(sql`
        UPDATE review_provider_subjects SET last_seen_snapshot_run_id = ${active}
        WHERE organization_id = ${ORG} AND review_id = ${held}
      `)
    })
    await isLocked

    const timeout = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('the clean-up waited on the page commit')),
        10_000,
      ),
    )
    await expect(Promise.race([sweep(), timeout])).resolves.toMatchObject({ runs: 1 })
    expect(await runIds()).toContain(old)
    expect(await runIds()).not.toContain(alsoOld)
    expect(await subjectOf(free)).toMatchObject({ last_seen_snapshot_run_id: null })

    release()
    await page
    expect(await subjectOf(held)).toMatchObject({ last_seen_snapshot_run_id: active })

    await expect(sweep()).resolves.toMatchObject({ runs: 1, capped: false })
    expect(await runIds()).not.toContain(old)
  })

  it('carries an unlisted-review hold over the deletion of the run that began it', async () => {
    const found = await insertRun({ state: 'failed', hour: 1 })
    const completedSince = 3
    for (let hour = 2; hour < 2 + completedSince; hour += 1) {
      await insertRun({ state: 'completed', hour })
    }
    const unlisted = await insertSubject(found)
    await insertCandidate(found, unlisted, 'observed')
    const listedThen = await insertSubject(found)
    await insertCandidate(found, listedThen, 'pending')

    await sweep()

    expect(await runIds()).not.toContain(found)
    expect(await subjectOf(unlisted)).toEqual({
      last_seen_snapshot_run_id: null,
      unlisted_hold_runs_left: UNLISTED_REVIEW_HOLD_RUNS - completedSince,
    })
    expect(await subjectOf(listedThen)).toEqual({
      last_seen_snapshot_run_id: null,
      unlisted_hold_runs_left: null,
    })

    // A complete listing still holds the Review back, and records the other
    // one's missing candidate, whose first miss is long past.
    const next = await insertRun({ state: 'scanning', hour: 10 })
    const nextRow = await runRow(next)
    await db.transaction((tx) => recordMissingFromListing(tx, nextRow))
    const candidates = async () =>
      (
        await db.execute<{ review_id: string }>(sql`
          SELECT review_id FROM review_provider_deletion_candidates WHERE run_id = ${next}
        `)
      ).rows.map((row) => row.review_id)
    expect(await candidates()).toEqual([listedThen])

    // Once the hold has run out, the Review is a candidate again.
    await db.execute(sql`
      UPDATE review_provider_subjects SET unlisted_hold_runs_left = 0
      WHERE organization_id = ${ORG} AND review_id = ${unlisted}
    `)
    await db.transaction((tx) => recordMissingFromListing(tx, nextRow))
    expect(sorted(await candidates())).toEqual(sorted([listedThen, unlisted]))
  })

  it('leaves every reader of runs its answer', async () => {
    const { run } = await seedHistory()
    await db.execute(sql`
      INSERT INTO review_google_reputation_snapshot_facts (
        run_id, event_id, organization_id, property_id, source_epoch, review_count,
        evaluated_at)
      VALUES (${run.latestCompleted1}, gen_random_uuid(), ${ORG}, ${PROPERTY_A}, 1, 0,
        ${new Date(BASE + 8 * HOUR_MS)})
    `)
    const setup = createPropertySetupRepository(db)
    const headCheck = createReviewHeadCheckRepository(db)
    const active = await runRow(run.active1)
    const read = async () => ({
      setup: await setup.readPropertyFacts({
        organizationId: ORG,
        propertyId: PROPERTY_A,
      }),
      persist: await headCheck.readPersistState({
        organizationId: ORG,
        propertyId: PROPERTY_A,
        sourceEpoch: 1,
        now: new Date(BASE + 12 * HOUR_MS + 60_000),
      }),
      listingMove: await db.transaction((tx) =>
        recordedFailureCode(tx, active, 'total_changed'),
      ),
    })
    const before = await read()
    expect(before.setup).toMatchObject({ reviewsSyncedForCurrentSource: true })
    expect(before.persist).toMatchObject({
      hasCompletedListing: true,
      snapshotActive: true,
    })
    // The two runs before the active one that moved, so a third move is loud.
    expect(before.listingMove).toBe('total_changed')

    await sweep()

    expect(await read()).toEqual(before)
  })
})

describe('a mapping stored inside the run start millisecond (real PostgreSQL)', () => {
  // The run row read into the worker keeps milliseconds; the database keeps
  // microseconds. These mappings fall between the two.
  const RUN_STARTED_AT = '2026-11-01T10:00:00.123456Z'

  async function startedRun(): Promise<RunRow> {
    const id = await insertRun({ state: 'scanning', hour: 10 })
    await db.execute(sql`
      UPDATE review_provider_snapshot_runs SET started_at = ${RUN_STARTED_AT}::timestamptz
      WHERE id = ${id}
    `)
    return runRow(id)
  }

  async function observedAt(reviewId: string, microsecondOffset: number) {
    await db.execute(sql`
      UPDATE review_provider_subjects
      SET last_observed_at = ${RUN_STARTED_AT}::timestamptz
        + ${microsecondOffset} * interval '1 microsecond'
      WHERE organization_id = ${ORG} AND review_id = ${reviewId}
    `)
  }

  it('reads the run as started before a mapping stored a microsecond later', async () => {
    const run = await startedRun()
    const later = await insertSubject(null)
    const same = await insertSubject(null)
    const earlier = await insertSubject(null)
    await observedAt(later, 1)
    await observedAt(same, 0)
    await observedAt(earlier, -1)

    const after = (reviewId: string) =>
      db.transaction((tx) => mappingObservedAfterRunStart(tx, run, reviewId))

    expect(await after(later)).toBe(true)
    expect(await after(same)).toBe(false)
    expect(await after(earlier)).toBe(false)
  })

  it('records a first-missed mapping stored a microsecond before the run, not one stored after', async () => {
    const run = await startedRun()
    const before = await insertSubject(null)
    const after = await insertSubject(null)
    await observedAt(before, -1)
    await observedAt(after, 1)

    await db.transaction((tx) => recordMissingFromListing(tx, run))

    const candidates = await db.execute<{ review_id: string }>(sql`
      SELECT review_id FROM review_provider_deletion_candidates WHERE run_id = ${run.id}
    `)
    expect(candidates.rows.map((row) => row.review_id)).toEqual([before])
  })

  it('finds a candidate edited a microsecond after the run began, not one a microsecond before', async () => {
    const run = await startedRun()
    const edited = await insertSubject(null)
    const untouched = await insertSubject(null)
    await observedAt(edited, 1)
    await observedAt(untouched, -1)
    await db.execute(sql`
      UPDATE review_provider_subjects SET last_source_revision = 2
      WHERE organization_id = ${ORG} AND review_id IN (${edited}, ${untouched})
    `)
    await insertCandidate(run.id, edited, 'pending')
    await insertCandidate(run.id, untouched, 'pending')

    const editedSince = (reviewId: string) =>
      db.transaction((tx) =>
        candidateEditedSinceListing(tx, run, { reviewId, expectedSourceRevision: 1 }),
      )

    expect(await editedSince(edited)).toBe(true)
    expect(await editedSince(untouched)).toBe(false)
  })
})
