// BQC-8.1 — deterministic production-shaped scale dataset (§3 of the phase
// doc: "The seed tool records deterministic seed/version/hash and validates
// counts/relationships. It must not only generate SQL; it must load, verify,
// and clean up the environment safely.").
//
// DETERMINISM CONTRACT:
//   - Every id derives from (seed, kind, ordinal) via sha256 — org ids are
//     text (better-auth), property/review ids are RFC-4122 v5-shaped uuids.
//   - Every distribution (region pick, review skew, rating, age) draws from a
//     per-kind Park-Miller LCG stream, seeded per (seed, stream) so a shape
//     change in one entity kind never perturbs another.
//   - Same seed + same shape + same version ⇒ byte-identical plan hash
//     (sha256 over the canonical row stream). Wall-clock anchors
//     (reviewed_at/expires_at) are applied at LOAD time from baseTime and are
//     deliberately NOT part of the hash — identity and structure are
//     deterministic; timestamps are environment-relative.
//
// DISTRIBUTION (production-shaped, §3): US-heavy region spread with denied
// 'europe'/'global' cells for the BQC-4 routing proofs, and ~30% of reviews
// concentrated on the top 5% of properties (hot-tenant skew).
//
// The DB operations (load/verify/clean) stream the plan in batches — no
// 500k-row materialization — and clean deletes EXACTLY the dataset's own
// recomputed ids (contrast scripts/cleanup-all.ts, which deletes everything).

import { createHash } from 'node:crypto'
import { canonicalizeRawAiReviewSource } from '#/shared/ai-review-source-contract'

// ── Constants ────────────────────────────────────────────────────────

/** Dataset plan format version — bump with any generation-rule change. */
export const SCALE_DATASET_VERSION = 1 as const

const DAY_MS = 86_400_000

/**
 * Region table (weights kept from the PRE17C tool). Only 'us' is an approved
 * processing cell in the beta (ADR 0048); the 'europe'/'global' rows are the
 * denied/unprovisioned cases the routing proofs need. Weights sum to 0.92 —
 * the remainder falls through to US (effective US share ≈ 0.68).
 */
const REGIONS = [
  { code: 'US', region: 'us', tz: 'America/New_York', weight: 0.6 },
  { code: 'GB', region: 'europe', tz: 'Europe/London', weight: 0.1 },
  { code: 'DE', region: 'europe', tz: 'Europe/Berlin', weight: 0.08 },
  { code: 'FR', region: 'europe', tz: 'Europe/Paris', weight: 0.07 },
  { code: 'JP', region: 'global', tz: 'Asia/Tokyo', weight: 0.07 },
] as const

/** Share of reviews assigned to the hot property slice. */
const SKEW_REVIEW_SHARE = 0.3
/** Hot slice size (fraction of properties). */
const SKEW_PROPERTY_SHARE = 0.05
/** Reviews spread over this many days back from baseTime. */
const REVIEW_AGE_DAYS = 180
/** Content retention (mirrors the 30-day source lifecycle). */
const REVIEW_TTL_DAYS = 30

// ── Deterministic primitives ─────────────────────────────────────────

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/** RFC-4122 v5-shaped uuid from (seed, kind, ordinal) — sha256-based. */
export function deterministicUuid(seed: string, kind: string, ordinal: number): string {
  const hex = sha256Hex(`${seed}:${kind}:${ordinal}`)
  const b = Buffer.from(hex.slice(0, 32), 'hex')
  b[6] = (b[6] & 0x0f) | 0x50 // version 5 (name-based, sha family)
  b[8] = (b[8] & 0x3f) | 0x80 // RFC 4122 variant
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/**
 * Park-Miller minimal-standard LCG (multiplier 48271, modulus 2^31−1).
 * All intermediate products stay below 2^53, so the stream is exact integer
 * math and byte-identical on every platform. Draws are [0, 1).
 */
export function createLcg(seed: number): () => number {
  const MOD = 2147483647
  let state = (((seed % (MOD - 1)) + (MOD - 1)) % (MOD - 1)) + 1
  return () => {
    state = (state * 48271) % MOD
    return (state - 1) / (MOD - 2)
  }
}

/** Derive a per-stream LCG seed from the dataset seed (stable across platforms). */
function streamSeed(seed: string, stream: string): number {
  return parseInt(sha256Hex(`${seed}|lcg|${stream}`).slice(0, 8), 16)
}

/** Short per-seed tag scoping aggregate SQL probes to this dataset. */
export function seedTag(seed: string): string {
  return sha256Hex(`tag:${seed}`).slice(0, 8)
}

// ── Plan types ───────────────────────────────────────────────────────

export type DatasetShape = Readonly<{
  orgs: number
  properties: number
  reviews: number
}>

export type ScaleOrg = Readonly<{ id: string; name: string; slug: string }>

export type ScaleProperty = Readonly<{
  id: string
  orgId: string
  name: string
  slug: string
  timezone: string
  countryCode: string
  processingRegion: string
  routingPolicyVersion: number
}>

export type ScaleReview = Readonly<{
  id: string
  orgId: string
  propertyId: string
  externalId: string
  rating: number
  /** Deterministic age (days before baseTime) — the wall-clock anchor is NOT hashed. */
  daysAgo: number
}>

export type ScaleDatasetPlan = Readonly<{
  seed: string
  version: number
  shape: DatasetShape
  /**
   * True only for the BQC-8.3 lifecycle dataset. Keeping it separate from
   * capacity data stops the hourly production scheduler from erasing the
   * normal BQC-8.2 population before its load scenarios run.
   */
  sourceLifecycle: boolean
  /** Re-iterable generators (fresh LCG streams per call), in ordinal order. */
  orgs: () => Generator<ScaleOrg>
  properties: () => Generator<ScaleProperty>
  reviews: () => Generator<ScaleReview>
  /** sha256 over the canonical row stream (identity + structure only). */
  hash: string
}>

// ── Plan construction ────────────────────────────────────────────────

/** Org ordinal for a property ordinal: an even spread over the orgs. */
function orgOrdinalForProperty(shape: DatasetShape, propertyOrdinal: number): number {
  const idx = Math.floor((propertyOrdinal / shape.properties) * shape.orgs)
  return Math.min(idx, shape.orgs - 1)
}

function buildOrg(seed: string, ordinal: number): ScaleOrg {
  const tag = seedTag(seed)
  const id = `perf-org-${tag}-${sha256Hex(`org:${seed}:${ordinal}`).slice(0, 16)}`
  return {
    id,
    name: `Perf Org ${ordinal + 1}`,
    slug: `perf-org-${tag}-${ordinal}`,
  }
}

function buildProperty(
  seed: string,
  shape: DatasetShape,
  ordinal: number,
  regionDraw: number,
  routingPolicyVersion: number,
): ScaleProperty {
  const orgOrdinal = orgOrdinalForProperty(shape, ordinal)
  let cumulative = 0
  let region: (typeof REGIONS)[number] = REGIONS[0]
  for (const candidate of REGIONS) {
    cumulative += candidate.weight
    if (regionDraw < cumulative) {
      region = candidate
      break
    }
  }
  return {
    id: deterministicUuid(seed, 'property', ordinal),
    orgId: buildOrg(seed, orgOrdinal).id,
    name: `Perf Property ${ordinal + 1}`,
    slug: `perf-prop-${seedTag(seed)}-${ordinal}`,
    timezone: region.tz,
    countryCode: region.code,
    processingRegion: region.region,
    routingPolicyVersion,
  }
}

function buildReview(
  seed: string,
  shape: DatasetShape,
  ordinal: number,
  draws: { property: number; rating: number; age: number },
): ScaleReview {
  const hotCount = Math.max(1, Math.floor(shape.properties * SKEW_PROPERTY_SHARE))
  let propertyOrdinal: number
  if (ordinal < shape.reviews * SKEW_REVIEW_SHARE) {
    propertyOrdinal = Math.floor(draws.property * hotCount)
  } else {
    propertyOrdinal =
      hotCount + Math.floor(draws.property * (shape.properties - hotCount))
  }
  propertyOrdinal = Math.min(propertyOrdinal, shape.properties - 1)
  const orgOrdinal = orgOrdinalForProperty(shape, propertyOrdinal)
  return {
    id: deterministicUuid(seed, 'review', ordinal),
    orgId: buildOrg(seed, orgOrdinal).id,
    propertyId: deterministicUuid(seed, 'property', propertyOrdinal),
    externalId: `perfR-${seedTag(seed)}-${ordinal}`,
    rating: 1 + Math.floor(draws.rating * 5),
    daysAgo: Math.floor(draws.age * REVIEW_AGE_DAYS),
  }
}

/** One canonical hash line per row — identity + deterministic structure only. */
function hashLine(
  version: number,
  kind: string,
  ordinal: number,
  fields: ReadonlyArray<string | number>,
): string {
  return `v${version}|${kind}|${ordinal}|${fields.join('|')}\n`
}

export function planScaleDataset(input: {
  seed: string
  shape: DatasetShape
  version?: number
  /** Include fetch-clock fields for the BQC-8.3 lifecycle sweep. */
  sourceLifecycle?: boolean
  /** Pinned routing policy version (the CLI passes ROUTING_POLICY_VERSION). */
  routingPolicyVersion?: number
}): ScaleDatasetPlan {
  const { seed, shape } = input
  const version = input.version ?? SCALE_DATASET_VERSION
  const sourceLifecycle = input.sourceLifecycle ?? false
  const routingPolicyVersion = input.routingPolicyVersion ?? 1
  for (const [key, value] of Object.entries(shape)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`shape.${key} must be a positive integer, got ${value}`)
    }
  }

  const orgs = function* (): Generator<ScaleOrg> {
    for (let i = 0; i < shape.orgs; i++) yield buildOrg(seed, i)
  }

  const properties = function* (): Generator<ScaleProperty> {
    const lcg = createLcg(streamSeed(seed, 'property-region'))
    for (let i = 0; i < shape.properties; i++) {
      yield buildProperty(seed, shape, i, lcg(), routingPolicyVersion)
    }
  }

  const reviews = function* (): Generator<ScaleReview> {
    const lcg = createLcg(streamSeed(seed, 'review'))
    for (let i = 0; i < shape.reviews; i++) {
      yield buildReview(seed, shape, i, { property: lcg(), rating: lcg(), age: lcg() })
    }
  }

  // One full pass to hash the canonical stream (identity + structure).
  const hash = createHash('sha256')
  if (sourceLifecycle) hash.update('source-lifecycle|1\n')
  let i = 0
  for (const org of orgs()) {
    hash.update(hashLine(version, 'org', i, [org.id, org.slug]))
    i += 1
  }
  i = 0
  for (const property of properties()) {
    hash.update(
      hashLine(version, 'property', i, [
        property.id,
        property.orgId,
        property.slug,
        property.countryCode,
        property.processingRegion,
        property.timezone,
        property.routingPolicyVersion,
      ]),
    )
    i += 1
  }
  i = 0
  for (const review of reviews()) {
    hash.update(
      hashLine(version, 'review', i, [
        review.id,
        review.propertyId,
        review.orgId,
        review.externalId,
        review.rating,
        review.daysAgo,
      ]),
    )
    i += 1
  }

  return {
    seed,
    version,
    shape,
    sourceLifecycle,
    orgs,
    properties,
    reviews,
    hash: hash.digest('hex'),
  }
}

// ── Manifest ─────────────────────────────────────────────────────────

export type DatasetManifest = Readonly<{
  seed: string
  version: number
  shape: DatasetShape
  /** Whether review rows have BQC-8.3 fetch-clock fields populated. */
  sourceLifecycle: boolean
  hash: string
  /** Informational only — NOT covered by the hash. */
  createdAt: string
}>

export function createManifest(plan: ScaleDatasetPlan, createdAt: Date): DatasetManifest {
  return {
    seed: plan.seed,
    version: plan.version,
    shape: plan.shape,
    sourceLifecycle: plan.sourceLifecycle,
    hash: plan.hash,
    createdAt: createdAt.toISOString(),
  }
}

export function serializeManifest(manifest: DatasetManifest): string {
  return JSON.stringify(manifest, null, 2)
}

export function parseManifest(json: string): DatasetManifest {
  const parsed = JSON.parse(json) as unknown
  if (typeof parsed !== 'object' || parsed == null)
    throw new Error('dataset manifest: not an object')
  const m = parsed as Record<string, unknown>
  const shape = m.shape as Record<string, unknown> | undefined
  if (
    typeof m.seed !== 'string' ||
    typeof m.version !== 'number' ||
    typeof m.hash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(m.hash) ||
    typeof m.createdAt !== 'string' ||
    (m.sourceLifecycle !== undefined && typeof m.sourceLifecycle !== 'boolean') ||
    typeof shape?.orgs !== 'number' ||
    typeof shape?.properties !== 'number' ||
    typeof shape?.reviews !== 'number'
  )
    throw new Error('dataset manifest: shape mismatch')
  return {
    ...(m as Omit<DatasetManifest, 'sourceLifecycle'>),
    sourceLifecycle: m.sourceLifecycle === true,
  }
}

// ── Row value mapping (load-time wall-clock anchoring) ───────────────

export function orgRowValues(org: ScaleOrg, baseTime: Date): readonly unknown[] {
  return [org.id, org.name, org.slug, baseTime]
}

export function propertyRowValues(property: ScaleProperty): readonly unknown[] {
  return [
    property.id,
    property.orgId,
    property.name,
    property.slug,
    property.timezone,
    property.countryCode,
    property.processingRegion,
    property.routingPolicyVersion,
  ]
}

export function reviewRowValues(
  review: ScaleReview,
  baseTime: Date,
  sourceLifecycle = false,
): readonly unknown[] {
  const reviewedAt = new Date(baseTime.getTime() - review.daysAgo * DAY_MS)
  const expiresAt = new Date(reviewedAt.getTime() + REVIEW_TTL_DAYS * DAY_MS)
  const aiSource = canonicalizeRawAiReviewSource({
    text: null,
    rating: review.rating,
    languageCode: null,
    reviewedAtEpochMillis: reviewedAt.getTime(),
    reviewerDisplayName: null,
  })
  const aiSourceDigest = createHash('sha256').update(aiSource.bytes).digest('hex')
  return [
    review.id,
    review.orgId,
    review.propertyId,
    'google',
    review.externalId,
    review.propertyId, // external_location_id — identifier-only
    review.rating,
    reviewedAt,
    expiresAt,
    sourceLifecycle ? reviewedAt : null,
    sourceLifecycle ? expiresAt : null,
    sourceLifecycle
      ? sha256Hex(`scale-review-content|${review.externalId}|${review.rating}`)
      : null,
    0,
    1,
    0,
    aiSource.bytes.byteLength,
    aiSourceDigest,
  ]
}

// ── DB operations ────────────────────────────────────────────────────

/** Structural pg surface (Pool and PoolClient both satisfy it). */
export type Queryable = Readonly<{
  query: (
    text: string,
    values?: readonly unknown[],
  ) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>
}>

const INSERT_BATCH = 1000
const PROBE_BATCH = 5000

async function batchInsert(
  db: Queryable,
  table: string,
  columns: readonly string[],
  rows: ReadonlyArray<readonly unknown[]>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const batch = rows.slice(i, i + INSERT_BATCH)
    const placeholders = batch
      .map(
        (_, rowIdx) =>
          `(${columns.map((_, colIdx) => `$${rowIdx * columns.length + colIdx + 1}`).join(', ')})`,
      )
      .join(', ')
    await db.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
      batch.flat(),
    )
  }
}

function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export type LoadResult = Readonly<{
  orgs: number
  properties: number
  reviews: number
  durationMs: number
  hash: string
}>

/**
 * Stream the plan into PostgreSQL with batched multi-row INSERTs (the proven
 * ~34k reviews/s path), ON CONFLICT DO NOTHING so a re-load is idempotent.
 */
export async function loadScaleDataset(
  db: Queryable,
  plan: ScaleDatasetPlan,
  opts: { baseTime: Date; now?: () => number },
): Promise<LoadResult> {
  const now = opts.now ?? (() => Date.now())
  const t0 = now()

  const orgRows = [...plan.orgs()].map((o) => orgRowValues(o, opts.baseTime))
  await batchInsert(db, 'organization', ['id', 'name', 'slug', '"createdAt"'], orgRows)

  const propertyRows = [...plan.properties()].map(propertyRowValues)
  await batchInsert(
    db,
    'properties',
    [
      'id',
      'organization_id',
      'name',
      'slug',
      'timezone',
      'country_code',
      'processing_region',
      'routing_policy_version',
    ],
    propertyRows,
  )

  // Reviews stream in batches straight from the generator (no materialization).
  let reviewCount = 0
  let batch: Array<readonly unknown[]> = []
  for (const review of plan.reviews()) {
    batch.push(reviewRowValues(review, opts.baseTime, plan.sourceLifecycle))
    reviewCount += 1
    if (batch.length === INSERT_BATCH) {
      await batchInsert(db, 'reviews', REVIEW_COLUMNS, batch)
      batch = []
    }
  }
  if (batch.length > 0) await batchInsert(db, 'reviews', REVIEW_COLUMNS, batch)

  return {
    orgs: orgRows.length,
    properties: propertyRows.length,
    reviews: reviewCount,
    durationMs: now() - t0,
    hash: plan.hash,
  }
}

const REVIEW_COLUMNS = [
  'id',
  'organization_id',
  'property_id',
  'platform',
  'external_id',
  'external_location_id',
  'rating',
  'reviewed_at',
  'expires_at',
  'last_fetched_at',
  'content_expires_at',
  'content_hash',
  'source_epoch',
  'source_revision',
  'analysis_sequence',
  'ai_source_byte_length',
  'ai_source_digest',
] as const

export type VerifyCheck = Readonly<{ check: string; passed: boolean; detail: string }>
export type VerifyReport = Readonly<{ ok: boolean; checks: readonly VerifyCheck[] }>

/**
 * Re-read the database and prove it holds EXACTLY this plan: per-table
 * counts, property identity/region integrity, and the exact per-property
 * review distribution (which subsumes orphan/link checks — a review pointing
 * at a non-plan property shows up as a distribution key mismatch).
 */
export async function verifyScaleDataset(
  db: Queryable,
  plan: ScaleDatasetPlan,
  opts: { expectedHash?: string } = {},
): Promise<VerifyReport> {
  const checks: VerifyCheck[] = []
  const tag = seedTag(plan.seed)

  // 1. Org count (seed-scoped id prefix).
  const orgCount = await db.query(
    `SELECT count(*)::int AS c FROM organization WHERE id LIKE $1`,
    [`perf-org-${tag}-%`],
  )
  const orgsFound = Number(orgCount.rows[0]?.c ?? 0)
  checks.push({
    check: 'org_count',
    passed: orgsFound === plan.shape.orgs,
    detail: `expected ${plan.shape.orgs}, found ${orgsFound}`,
  })

  // 2+3. Property count + identity/region integrity (chunked id probes).
  const planProperties = [...plan.properties()]
  const propertyById = new Map(planProperties.map((p) => [p.id, p]))
  let propertiesFound = 0
  let propertyMismatches = 0
  for (const chunk of chunked(planProperties, PROBE_BATCH)) {
    const ids = chunk.map((p) => p.id)
    const rows = await db.query(
      `SELECT id, organization_id, processing_region, country_code FROM properties WHERE id = ANY($1::uuid[])`,
      [ids],
    )
    propertiesFound += rows.rows.length
    for (const row of rows.rows) {
      const expected = propertyById.get(String(row.id))
      if (
        !expected ||
        row.organization_id !== expected.orgId ||
        row.processing_region !== expected.processingRegion ||
        row.country_code !== expected.countryCode
      )
        propertyMismatches += 1
    }
  }
  checks.push({
    check: 'property_count',
    passed: propertiesFound === plan.shape.properties,
    detail: `expected ${plan.shape.properties}, found ${propertiesFound}`,
  })
  checks.push({
    check: 'property_integrity',
    passed: propertyMismatches === 0,
    detail: `${propertyMismatches} properties with org/region drift vs plan`,
  })

  // 4. Review count (seed-scoped external_id prefix).
  const reviewCount = await db.query(
    `SELECT count(*)::int AS c FROM reviews WHERE external_id LIKE $1`,
    [`perfR-${tag}-%`],
  )
  const reviewsFound = Number(reviewCount.rows[0]?.c ?? 0)
  checks.push({
    check: 'review_count',
    passed: reviewsFound === plan.shape.reviews,
    detail: `expected ${plan.shape.reviews}, found ${reviewsFound}`,
  })

  // 5. Exact per-property review distribution (subsumes orphan/link checks).
  const expectedDistribution = new Map<string, number>()
  for (const review of plan.reviews()) {
    expectedDistribution.set(
      review.propertyId,
      (expectedDistribution.get(review.propertyId) ?? 0) + 1,
    )
  }
  const actualDistribution = new Map<string, number>()
  const distributionRows = await db.query(
    `SELECT property_id, count(*)::int AS c FROM reviews WHERE external_id LIKE $1 GROUP BY property_id`,
    [`perfR-${tag}-%`],
  )
  for (const row of distributionRows.rows) {
    actualDistribution.set(String(row.property_id), Number(row.c))
  }
  let distributionDrift = 0
  for (const [propertyId, expected] of expectedDistribution) {
    if (actualDistribution.get(propertyId) !== expected) distributionDrift += 1
  }
  for (const propertyId of actualDistribution.keys()) {
    if (!expectedDistribution.has(propertyId)) distributionDrift += 1
  }
  checks.push({
    check: 'review_distribution_exact',
    passed: distributionDrift === 0,
    detail:
      distributionDrift === 0
        ? `${expectedDistribution.size} properties match the plan distribution`
        : `${distributionDrift} properties drifted from the plan distribution`,
  })

  // 6. Skew bounds hold for the loaded dataset.
  const sorted = [...actualDistribution.values()].sort((a, b) => b - a)
  const hotCount = Math.max(1, Math.floor(plan.shape.properties * SKEW_PROPERTY_SHARE))
  const topShare =
    reviewsFound > 0
      ? sorted.slice(0, hotCount).reduce((a, b) => a + b, 0) / reviewsFound
      : 0
  checks.push({
    check: 'skew_bounds',
    passed: reviewsFound > 0 && topShare >= 0.25 && topShare <= 0.35,
    detail: `top ${hotCount} propert${hotCount === 1 ? 'y' : 'ies'} hold ${(topShare * 100).toFixed(1)}% of reviews (bounds 25–35%)`,
  })

  // 7. Manifest hash matches a fresh plan computation (when provided).
  if (opts.expectedHash !== undefined) {
    checks.push({
      check: 'manifest_hash_match',
      passed: opts.expectedHash === plan.hash,
      detail:
        opts.expectedHash === plan.hash
          ? `hash ${plan.hash.slice(0, 16)}…`
          : `manifest ${opts.expectedHash.slice(0, 16)}… != recomputed ${plan.hash.slice(0, 16)}…`,
    })
  }

  return { ok: checks.every((c) => c.passed), checks }
}

export type CleanResult = Readonly<{
  orgs: number
  properties: number
  reviews: number
  dryRun: boolean
}>

/**
 * Delete EXACTLY this dataset's own rows (ids recomputed from seed+shape) in
 * FK order. Never an indiscriminate delete-all — rows that don't belong to
 * the plan are untouched by construction.
 */
export async function cleanScaleDataset(
  db: Queryable,
  plan: ScaleDatasetPlan,
  opts: { dryRun?: boolean } = {},
): Promise<CleanResult> {
  const dryRun = opts.dryRun ?? false
  const tag = seedTag(plan.seed)

  const countOnly = async (text: string, values: readonly unknown[]): Promise<number> => {
    const rows = await db.query(text, values)
    return Number(rows.rows[0]?.c ?? 0)
  }

  let reviews = 0
  let properties = 0
  let orgs = 0

  if (dryRun) {
    reviews = await countOnly(
      `SELECT count(*)::int AS c FROM reviews WHERE external_id LIKE $1`,
      [`perfR-${tag}-%`],
    )
    properties = await countOnly(
      `SELECT count(*)::int AS c FROM properties WHERE slug LIKE $1`,
      [`perf-prop-${tag}-%`],
    )
    orgs = await countOnly(
      `SELECT count(*)::int AS c FROM organization WHERE id LIKE $1`,
      [`perf-org-${tag}-%`],
    )
    return { orgs, properties, reviews, dryRun: true }
  }

  // Exact id deletes, chunked (reviews → properties → orgs).
  for (const idChunk of chunked(
    [...plan.reviews()].map((r) => r.id),
    PROBE_BATCH,
  )) {
    const result = await db.query(`DELETE FROM reviews WHERE id = ANY($1::uuid[])`, [
      idChunk,
    ])
    reviews += result.rowCount ?? 0
  }
  for (const idChunk of chunked(
    [...plan.properties()].map((p) => p.id),
    PROBE_BATCH,
  )) {
    const result = await db.query(`DELETE FROM properties WHERE id = ANY($1::uuid[])`, [
      idChunk,
    ])
    properties += result.rowCount ?? 0
  }
  const orgIds = [...plan.orgs()].map((o) => o.id)
  for (const idChunk of chunked(orgIds, PROBE_BATCH)) {
    const result = await db.query(`DELETE FROM organization WHERE id = ANY($1::text[])`, [
      idChunk,
    ])
    orgs += result.rowCount ?? 0
  }
  return { orgs, properties, reviews, dryRun: false }
}
