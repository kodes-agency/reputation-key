import { createHash } from 'node:crypto'
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator'
import type { Client, QueryResult } from 'pg'
import {
  AI_REVIEW_SOURCE_CONTRACT_VERSION,
  canonicalizeRawAiReviewSource,
} from '../ai-review-source-contract'

const PRE_ENUM_COMMIT_TAG = '0033_medical_morg'
const PRE_ENUM_COMMIT_MILLIS = 1786528018434
const POST_ENUM_FIRST_MILLIS = 1786534800305

const REVIEW_SOURCE_MIGRATION_MILLIS = 1786811862145
const REVIEW_SOURCE_BATCH_SIZE = 250
const REVIEW_SOURCE_DIGEST_PREFIX = Buffer.from(
  `${AI_REVIEW_SOURCE_CONTRACT_VERSION}\0`,
  'utf8',
)
type GoogleImportOutcomeState = Readonly<{
  typePresent: boolean
  cleanupRequiredPresent: boolean
  additionAttempted: boolean
}>

export type StagedDrizzleMigrationResult = Readonly<{
  preEnumCommitApplied: number
  postEnumCommitApplied: number
  reviewAiSourceBackfilled: number
  outcome: GoogleImportOutcomeState
}>
type MigrationBatchResult = Readonly<{
  applied: number
  reviewAiSourceBackfilled: number
}>

type ReviewAiSourceMigrationRow = Readonly<{
  id: unknown
  text: unknown
  rating: unknown
  language_code: unknown
  reviewed_at: unknown
  reviewer_name: unknown
}>

type ReviewAiSourceProvenance = Readonly<{
  id: string
  byteLength: number
  digest: string
}>

type GoogleImportOutcomeRow = Readonly<{
  type_present: boolean
  cleanup_required_present: boolean
}>

type RailwayApprovalEnumState = Readonly<{
  railway_target_present: boolean
  railway_profile_present: boolean
}>
type GoogleContentCapabilityEnumState = Readonly<{
  google_connect_present: boolean
  google_publish_reply_present: boolean
}>

type MigrationStages = Readonly<{
  preEnumCommit: readonly MigrationMeta[]
  postEnumCommit: readonly MigrationMeta[]
}>

const GOOGLE_IMPORT_OUTCOME_STATE_SQL = `
  SELECT
    EXISTS (
      SELECT 1
      FROM pg_type AS t
      JOIN pg_namespace AS n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
        AND t.typname = 'google_import_v2_outcome'
    ) AS type_present,
    EXISTS (
      SELECT 1
      FROM pg_type AS t
      JOIN pg_namespace AS n ON n.oid = t.typnamespace
      JOIN pg_enum AS e ON e.enumtypid = t.oid
      WHERE n.nspname = 'public'
        AND t.typname = 'google_import_v2_outcome'
        AND e.enumlabel = 'cleanup_required'
    ) AS cleanup_required_present
`
const RAILWAY_APPROVAL_ENUM_STATE_SQL = `
  SELECT
    EXISTS (
      SELECT 1
      FROM pg_type AS t
      JOIN pg_namespace AS n ON n.oid = t.typnamespace
      JOIN pg_enum AS e ON e.enumtypid = t.oid
      WHERE n.nspname = 'public'
        AND t.typname = 'google_content_approval_target_phase'
        AND e.enumlabel = 'railway_closed_beta'
    ) AS railway_target_present,
    EXISTS (
      SELECT 1
      FROM pg_type AS t
      JOIN pg_namespace AS n ON n.oid = t.typnamespace
      JOIN pg_enum AS e ON e.enumtypid = t.oid
      WHERE n.nspname = 'public'
        AND t.typname = 'google_content_environment_profile'
        AND e.enumlabel = 'railway-closed-beta-1'
    ) AS railway_profile_present
`
const GOOGLE_CONTENT_CAPABILITY_ENUM_STATE_SQL = `
  SELECT
    EXISTS (
      SELECT 1
      FROM pg_type AS t
      JOIN pg_namespace AS n ON n.oid = t.typnamespace
      JOIN pg_enum AS e ON e.enumtypid = t.oid
      WHERE n.nspname = 'public'
        AND t.typname = 'google_content_capability'
        AND e.enumlabel = 'property.connect_gbp'
    ) AS google_connect_present,
    EXISTS (
      SELECT 1
      FROM pg_type AS t
      JOIN pg_namespace AS n ON n.oid = t.typnamespace
      JOIN pg_enum AS e ON e.enumtypid = t.oid
      WHERE n.nspname = 'public'
        AND t.typname = 'google_content_capability'
        AND e.enumlabel = 'property.publish_reply'
    ) AS google_publish_reply_present
`

function loadMigrationStages(migrationsFolder: string): MigrationStages {
  const migrations = readMigrationFiles({ migrationsFolder })
  const cutoffIndex = migrations.findIndex(
    (migration) => migration.folderMillis === PRE_ENUM_COMMIT_MILLIS,
  )
  if (cutoffIndex < 0) {
    throw new Error(`Drizzle migration journal is missing ${PRE_ENUM_COMMIT_TAG}`)
  }
  if (migrations[cutoffIndex + 1]?.folderMillis !== POST_ENUM_FIRST_MILLIS) {
    throw new Error(`Drizzle migration cutoff ${PRE_ENUM_COMMIT_TAG} is inconsistent`)
  }

  return {
    preEnumCommit: migrations.slice(0, cutoffIndex + 1),
    postEnumCommit: migrations.slice(cutoffIndex + 1),
  }
}

async function ensureMigrationJournal(client: Client): Promise<void> {
  await client.query('CREATE SCHEMA IF NOT EXISTS "drizzle"')
  await client.query(`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `)
}

function nullableString(value: unknown): string | null {
  if (value === null || typeof value === 'string') return value
  throw new Error('review_ai_source_backfill_invalid_row')
}

function reviewSourceProvenance(
  row: ReviewAiSourceMigrationRow,
): ReviewAiSourceProvenance {
  if (
    typeof row.id !== 'string' ||
    !(row.reviewed_at instanceof Date) ||
    !Number.isInteger(row.rating)
  ) {
    throw new Error('review_ai_source_backfill_invalid_row')
  }
  const reviewedAtEpochMillis = row.reviewed_at.getTime()
  if (!Number.isSafeInteger(reviewedAtEpochMillis) || reviewedAtEpochMillis < 0) {
    throw new Error('review_ai_source_backfill_invalid_row')
  }
  const canonical = canonicalizeRawAiReviewSource({
    text: nullableString(row.text),
    rating: row.rating as number,
    languageCode: nullableString(row.language_code),
    reviewedAtEpochMillis,
    reviewerDisplayName: nullableString(row.reviewer_name),
  })
  return {
    id: row.id,
    byteLength: canonical.bytes.byteLength,
    digest: createHash('sha256')
      .update(REVIEW_SOURCE_DIGEST_PREFIX)
      .update(canonical.bytes)
      .digest('hex'),
  }
}

async function backfillReviewAiSourceProvenance(client: Client): Promise<number> {
  let lastId: string | null = null
  let total = 0
  for (;;) {
    const result: QueryResult<ReviewAiSourceMigrationRow> =
      await client.query<ReviewAiSourceMigrationRow>(
        `
        SELECT "id", "text", "rating", "language_code", "reviewed_at", "reviewer_name"
        FROM "reviews"
        WHERE ($1::uuid IS NULL OR "id" > $1::uuid)
          AND ("ai_source_byte_length" IS NULL OR "ai_source_digest" IS NULL)
        ORDER BY "id"
        LIMIT ${REVIEW_SOURCE_BATCH_SIZE}
      `,
        [lastId],
      )
    if (result.rows.length === 0) return total

    const provenance: ReviewAiSourceProvenance[] = result.rows.map(reviewSourceProvenance)
    const update = await client.query(
      `
        UPDATE "reviews" AS review
        SET
          "ai_source_byte_length" = source."byte_length",
          "ai_source_digest" = source."digest"
        FROM unnest($1::uuid[], $2::integer[], $3::text[])
          AS source("id", "byte_length", "digest")
        WHERE review."id" = source."id"
      `,
      [
        provenance.map((entry) => entry.id),
        provenance.map((entry) => entry.byteLength),
        provenance.map((entry) => entry.digest),
      ],
    )
    if (update.rowCount !== provenance.length) {
      throw new Error('review_ai_source_backfill_write_mismatch')
    }
    total += provenance.length
    lastId = provenance.at(-1)!.id
  }
}

async function applyMigrationBatch(
  client: Client,
  migrations: readonly MigrationMeta[],
): Promise<MigrationBatchResult> {
  await client.query('BEGIN')
  try {
    const result = await client.query<{ created_at: string }>(`
      SELECT created_at
      FROM "drizzle"."__drizzle_migrations"
      ORDER BY created_at DESC
      LIMIT 1
    `)
    const lastApplied = result.rows[0]?.created_at
    let applied = 0
    let reviewAiSourceBackfilled = 0

    for (const migration of migrations) {
      if (lastApplied !== undefined && Number(lastApplied) >= migration.folderMillis) {
        continue
      }
      for (const statement of migration.sql) {
        if (
          migration.folderMillis === REVIEW_SOURCE_MIGRATION_MILLIS &&
          statement.includes('review_ai_source_contract_migrator_required')
        ) {
          reviewAiSourceBackfilled += await backfillReviewAiSourceProvenance(client)
        }
        await client.query(statement)
      }
      await client.query(
        'INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)',
        [migration.hash, migration.folderMillis],
      )
      applied += 1
    }

    await client.query('COMMIT')
    return { applied, reviewAiSourceBackfilled }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

async function readGoogleImportOutcomeState(
  client: Client,
): Promise<GoogleImportOutcomeRow> {
  const result = await client.query<GoogleImportOutcomeRow>(
    GOOGLE_IMPORT_OUTCOME_STATE_SQL,
  )
  const row = result.rows[0]
  if (!row) throw new Error('Google import migration preflight returned no state')
  return row
}

async function prepareGoogleImportOutcome(
  client: Client,
): Promise<GoogleImportOutcomeState> {
  const before = await readGoogleImportOutcomeState(client)
  if (!before.type_present) {
    throw new Error(`${PRE_ENUM_COMMIT_TAG} did not create google_import_v2_outcome`)
  }
  if (before.cleanup_required_present) {
    return {
      typePresent: true,
      cleanupRequiredPresent: true,
      additionAttempted: false,
    }
  }

  await client.query(`
    ALTER TYPE "public"."google_import_v2_outcome"
    ADD VALUE IF NOT EXISTS 'cleanup_required' BEFORE 'internal_error'
  `)

  const after = await readGoogleImportOutcomeState(client)
  if (!after.cleanup_required_present) {
    throw new Error('Google import migration preflight did not commit cleanup_required')
  }
  return {
    typePresent: true,
    cleanupRequiredPresent: true,
    additionAttempted: true,
  }
}
async function prepareRailwayApprovalEnums(client: Client): Promise<void> {
  const result = await client.query<RailwayApprovalEnumState>(
    RAILWAY_APPROVAL_ENUM_STATE_SQL,
  )
  const state = result.rows[0]
  if (!state) throw new Error('Railway approval enum preflight returned no state')
  if (!state.railway_target_present) {
    await client.query(`
      ALTER TYPE "public"."google_content_approval_target_phase"
      ADD VALUE IF NOT EXISTS 'railway_closed_beta' BEFORE 'production_expand_canary'
    `)
  }
  if (!state.railway_profile_present) {
    await client.query(`
      ALTER TYPE "public"."google_content_environment_profile"
      ADD VALUE IF NOT EXISTS 'railway-closed-beta-1' BEFORE 'production'
    `)
  }
}

async function prepareGoogleContentCapabilityEnums(client: Client): Promise<void> {
  const result = await client.query<GoogleContentCapabilityEnumState>(
    GOOGLE_CONTENT_CAPABILITY_ENUM_STATE_SQL,
  )
  const state = result.rows[0]
  if (!state)
    throw new Error('Google Content capability enum preflight returned no state')
  if (!state.google_connect_present) {
    await client.query(`
      ALTER TYPE "public"."google_content_capability"
      ADD VALUE IF NOT EXISTS 'property.connect_gbp'
    `)
  }
  if (!state.google_publish_reply_present) {
    await client.query(`
      ALTER TYPE "public"."google_content_capability"
      ADD VALUE IF NOT EXISTS 'property.publish_reply'
    `)
  }
}

/**
 * Preserves immutable migration 0034 while satisfying PostgreSQL's enum rule:
 * a newly added enum label cannot be used until its transaction commits.
 * Callers must serialize their complete schema-authority sequence with a
 * session-level advisory lock. Locking only this function would leave the
 * Better Auth and registered-sidecar phases exposed and would not be atomic
 * across the required commit boundary. Deploy and test provisioning runners
 * own that full-sequence lock.
 */
export async function runStagedDrizzleMigrations(
  client: Client,
  migrationsFolder: string,
): Promise<StagedDrizzleMigrationResult> {
  const stages = loadMigrationStages(migrationsFolder)
  await ensureMigrationJournal(client)
  const preEnumCommit = await applyMigrationBatch(client, stages.preEnumCommit)
  const outcome = await prepareGoogleImportOutcome(client)
  await prepareRailwayApprovalEnums(client)
  await prepareGoogleContentCapabilityEnums(client)
  const postEnumCommit = await applyMigrationBatch(client, stages.postEnumCommit)
  return {
    preEnumCommitApplied: preEnumCommit.applied,
    postEnumCommitApplied: postEnumCommit.applied,
    reviewAiSourceBackfilled:
      preEnumCommit.reviewAiSourceBackfilled + postEnumCommit.reviewAiSourceBackfilled,
    outcome,
  }
}
