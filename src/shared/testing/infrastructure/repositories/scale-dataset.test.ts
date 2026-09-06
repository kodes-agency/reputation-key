// BQC-8.1 — scale dataset integration proof (real PostgreSQL).
//
// The unit suite pins determinism/distributions; this suite proves the DB
// contract end to end: load → verify green → tamper → verify red →
// re-load (idempotent) → clean removes EXACTLY the dataset and leaves
// foreign rows untouched.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  planScaleDataset,
  loadScaleDataset,
  verifyScaleDataset,
  cleanScaleDataset,
  createManifest,
} from '#/shared/testing/scale-dataset'

const SEED = 'bqc81-integration'
const SHAPE = { orgs: 2, properties: 20, reviews: 500 }
const BASE_TIME = new Date('2026-07-15T00:00:00.000Z')

const SENTINEL_ORG = 'sentinel-org-bqc81'
const SENTINEL_PROPERTY = '11111111-2222-4333-8444-555555555555'
const SENTINEL_REVIEW = '66666666-7777-4888-8999-000000000000'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
})

const plan = planScaleDataset({ seed: SEED, shape: SHAPE })

async function insertSentinel(): Promise<void> {
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [SENTINEL_ORG, 'Sentinel Org', 'sentinel-org-bqc81', BASE_TIME],
  )
  await pool.query(
    `INSERT INTO properties (
       id, organization_id, name, slug, timezone, country_code
     )
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
    [
      SENTINEL_PROPERTY,
      SENTINEL_ORG,
      'Sentinel Property',
      'sentinel-prop-bqc81',
      'America/New_York',
      'US',
    ],
  )
  await pool.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id, external_location_id,
       rating, reviewed_at, expires_at, source_epoch, source_revision,
       analysis_sequence, ai_source_byte_length, ai_source_digest
     )
     VALUES ($1, $2, $3, 'google', $4, $5, 5, $6, $7, 0, 0, 0, 1, repeat('0', 64))
     ON CONFLICT DO NOTHING`,
    [
      SENTINEL_REVIEW,
      SENTINEL_ORG,
      SENTINEL_PROPERTY,
      'sentinel-review-bqc81',
      SENTINEL_PROPERTY,
      BASE_TIME,
      new Date(BASE_TIME.getTime() + 30 * 86_400_000),
    ],
  )
}

async function removeSentinel(): Promise<void> {
  await pool.query(`DELETE FROM reviews WHERE id = $1`, [SENTINEL_REVIEW])
  await pool.query(`DELETE FROM properties WHERE id = $1`, [SENTINEL_PROPERTY])
  await deleteTestOrganizations(pool, [SENTINEL_ORG])
}

async function sentinelCounts(): Promise<{
  orgs: number
  properties: number
  reviews: number
}> {
  const result = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM organization WHERE id = $1) AS orgs,
       (SELECT count(*)::int FROM properties WHERE id = $2) AS properties,
       (SELECT count(*)::int FROM reviews WHERE id = $3) AS reviews`,
    [SENTINEL_ORG, SENTINEL_PROPERTY, SENTINEL_REVIEW],
  )
  return {
    orgs: result.rows[0].orgs,
    properties: result.rows[0].properties,
    reviews: result.rows[0].reviews,
  }
}

beforeAll(async () => {
  // Idempotent starting point: wipe any leftover dataset + refresh sentinel.
  await cleanScaleDataset(pool, plan)
  await removeSentinel()
  await insertSentinel()
})

afterAll(async () => {
  await cleanScaleDataset(pool, plan).catch(() => {})
  await removeSentinel().catch(() => {})
  await pool.end()
})

describe('scale dataset (BQC-8.1, integration)', () => {
  it('loads, verifies, detects tampering, re-loads idempotently, and cleans exactly', async () => {
    // Load.
    const loaded = await loadScaleDataset(pool, plan, { baseTime: BASE_TIME })
    expect(loaded).toMatchObject({ ...SHAPE, hash: plan.hash })

    // Verify: every check green.
    const report = await verifyScaleDataset(pool, plan, {
      expectedHash: createManifest(plan, BASE_TIME).hash,
    })
    expect(report.checks.map((c) => [c.check, c.passed])).toEqual([
      ['org_count', true],
      ['property_count', true],
      ['property_integrity', true],
      ['review_count', true],
      ['review_distribution_exact', true],
      ['skew_bounds', true],
      ['manifest_hash_match', true],
    ])
    expect(report.ok).toBe(true)

    // Tamper: delete exactly one review → verify must go red.
    const victim = [...plan.reviews()][0]
    await pool.query(`DELETE FROM reviews WHERE id = $1`, [victim.id])
    const tampered = await verifyScaleDataset(pool, plan)
    expect(tampered.ok).toBe(false)
    expect(tampered.checks.find((c) => c.check === 'review_count')?.passed).toBe(false)
    expect(
      tampered.checks.find((c) => c.check === 'review_distribution_exact')?.passed,
    ).toBe(false)

    // Re-load restores the deterministic row (ON CONFLICT path for the rest).
    await loadScaleDataset(pool, plan, { baseTime: BASE_TIME })
    const restored = await verifyScaleDataset(pool, plan)
    expect(restored.ok).toBe(true)

    // Clean removes exactly the dataset; the sentinel is untouched.
    const before = await sentinelCounts()
    expect(before).toEqual({ orgs: 1, properties: 1, reviews: 1 })
    const cleaned = await cleanScaleDataset(pool, plan)
    expect(cleaned).toMatchObject({ ...SHAPE, dryRun: false })
    const after = await sentinelCounts()
    expect(after).toEqual({ orgs: 1, properties: 1, reviews: 1 })

    // And the dataset is gone — verify now reports zero found rows.
    const gone = await verifyScaleDataset(pool, plan)
    expect(gone.ok).toBe(false)
    expect(gone.checks.find((c) => c.check === 'review_count')?.detail).toContain(
      'found 0',
    )
  }, 60_000)

  it('dry-run clean counts without deleting', async () => {
    await loadScaleDataset(pool, plan, { baseTime: BASE_TIME })
    const dry = await cleanScaleDataset(pool, plan, { dryRun: true })
    expect(dry).toMatchObject({ ...SHAPE, dryRun: true })
    const stillThere = await verifyScaleDataset(pool, plan)
    expect(stillThere.ok).toBe(true)
    await cleanScaleDataset(pool, plan)
  }, 60_000)
})
