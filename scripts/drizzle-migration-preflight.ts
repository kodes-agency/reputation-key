import type { Client } from 'pg'

type GoogleImportOutcomeState = Readonly<{
  typePresent: boolean
  cleanupRequiredPresent: boolean
  additionAttempted: boolean
}>

type GoogleImportOutcomeRow = Readonly<{
  type_present: boolean
  cleanup_required_present: boolean
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

/**
 * Commits the enum label required by immutable migration 0034 before Drizzle
 * opens its all-pending-migrations transaction. PostgreSQL rejects a new enum
 * label used in the same transaction that added it (SQLSTATE 55P04).
 */
export async function prepareDrizzleMigrationPrerequisites(
  client: Client,
): Promise<GoogleImportOutcomeState> {
  const before = await readGoogleImportOutcomeState(client)
  if (!before.type_present || before.cleanup_required_present) {
    return {
      typePresent: before.type_present,
      cleanupRequiredPresent: before.cleanup_required_present,
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
    typePresent: after.type_present,
    cleanupRequiredPresent: after.cleanup_required_present,
    additionAttempted: true,
  }
}
