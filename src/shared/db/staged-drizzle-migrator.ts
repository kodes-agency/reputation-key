import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator'
import type { Client } from 'pg'

const PRE_ENUM_COMMIT_TAG = '0033_medical_morg'
const PRE_ENUM_COMMIT_MILLIS = 1786528018434
const POST_ENUM_FIRST_MILLIS = 1786534800305

type GoogleImportOutcomeState = Readonly<{
  typePresent: boolean
  cleanupRequiredPresent: boolean
  additionAttempted: boolean
}>

export type StagedDrizzleMigrationResult = Readonly<{
  preEnumCommitApplied: number
  postEnumCommitApplied: number
  outcome: GoogleImportOutcomeState
}>

type GoogleImportOutcomeRow = Readonly<{
  type_present: boolean
  cleanup_required_present: boolean
}>

type RailwayApprovalEnumState = Readonly<{
  railway_target_present: boolean
  railway_profile_present: boolean
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

async function applyMigrationBatch(
  client: Client,
  migrations: readonly MigrationMeta[],
): Promise<number> {
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

    for (const migration of migrations) {
      if (lastApplied !== undefined && Number(lastApplied) >= migration.folderMillis) {
        continue
      }
      for (const statement of migration.sql) await client.query(statement)
      await client.query(
        'INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)',
        [migration.hash, migration.folderMillis],
      )
      applied += 1
    }

    await client.query('COMMIT')
    return applied
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

/**
 * Preserves immutable migration 0034 while satisfying PostgreSQL's enum rule:
 * a newly added enum label cannot be used until its transaction commits.
 */
export async function runStagedDrizzleMigrations(
  client: Client,
  migrationsFolder: string,
): Promise<StagedDrizzleMigrationResult> {
  const stages = loadMigrationStages(migrationsFolder)
  await ensureMigrationJournal(client)
  const preEnumCommitApplied = await applyMigrationBatch(client, stages.preEnumCommit)
  const outcome = await prepareGoogleImportOutcome(client)
  await prepareRailwayApprovalEnums(client)
  const postEnumCommitApplied = await applyMigrationBatch(client, stages.postEnumCommit)
  return { preEnumCommitApplied, postEnumCommitApplied, outcome }
}
