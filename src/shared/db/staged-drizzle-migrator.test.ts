import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Client } from 'pg'
import { describe, expect, it } from 'vitest'
import { runStagedDrizzleMigrations } from './staged-drizzle-migrator'

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../drizzle', import.meta.url))
const journal = JSON.parse(
  readFileSync(new URL('../../../drizzle/meta/_journal.json', import.meta.url), 'utf8'),
) as { entries: Array<{ tag: string; when: number }> }

function migrationTime(tag: string): number {
  const entry = journal.entries.find((candidate) => candidate.tag === tag)
  if (!entry) throw new Error(`Missing test migration ${tag}`)
  return entry.when
}
const PRE_ENUM_CUTOFF_INDEX = journal.entries.findIndex(
  (entry) => entry.tag === '0033_medical_morg',
)
if (PRE_ENUM_CUTOFF_INDEX < 0) throw new Error('Missing test migration 0033_medical_morg')
const INITIAL_MIGRATION_INDEX = journal.entries.findIndex(
  (entry) => entry.tag === '0016_region-moves',
)
if (INITIAL_MIGRATION_INDEX < 0)
  throw new Error('Missing test migration 0016_region-moves')
const PRE_ENUM_MIGRATION_COUNT = PRE_ENUM_CUTOFF_INDEX - INITIAL_MIGRATION_INDEX
const POST_ENUM_MIGRATION_COUNT = journal.entries.length - (PRE_ENUM_CUTOFF_INDEX + 1)
const LATEST_MIGRATION_TIME = journal.entries.at(-1)?.when
if (LATEST_MIGRATION_TIME === undefined) throw new Error('Migration journal is empty')

function createMigrationClient(input: {
  latestMigration: number
  enumTypePresent: boolean
  cleanupRequiredPresent: boolean
  railwayTargetPresent: boolean
  railwayProfilePresent: boolean
  reviews?: readonly Readonly<{
    id: string
    text: string | null
    rating: number
    language_code: string | null
    reviewed_at: Date
    reviewer_name: string | null
  }>[]
}): Readonly<{
  client: Client
  queries: string[]
  parametersByQuery: (readonly unknown[] | undefined)[]
}> {
  const queries: string[] = []
  const parametersByQuery: (readonly unknown[] | undefined)[] = []
  let latestMigration = input.latestMigration
  let enumTypePresent = input.enumTypePresent
  let cleanupRequiredPresent = input.cleanupRequiredPresent
  let railwayTargetPresent = input.railwayTargetPresent
  let railwayProfilePresent = input.railwayProfilePresent
  let reviewBatchRead = false
  let pendingEnumType = false
  let inTransaction = false

  const client = {
    async query(sql: string, parameters?: unknown[]) {
      const statement = sql.trim()
      queries.push(statement)
      parametersByQuery.push(parameters)

      if (statement === 'BEGIN') {
        inTransaction = true
        return { rows: [] }
      }
      if (statement === 'COMMIT') {
        inTransaction = false
        if (pendingEnumType) enumTypePresent = true
        pendingEnumType = false
        return { rows: [] }
      }
      if (statement === 'ROLLBACK') {
        inTransaction = false
        pendingEnumType = false
        return { rows: [] }
      }
      if (statement.startsWith('SELECT created_at')) {
        return { rows: [{ created_at: String(latestMigration) }] }
      }
      if (statement.includes('AS type_present')) {
        return {
          rows: [
            {
              type_present: enumTypePresent,
              cleanup_required_present: cleanupRequiredPresent,
            },
          ],
        }
      }
      if (statement.includes('AS railway_target_present')) {
        return {
          rows: [
            {
              railway_target_present: railwayTargetPresent,
              railway_profile_present: railwayProfilePresent,
            },
          ],
        }
      }
      if (statement.includes("ADD VALUE IF NOT EXISTS 'cleanup_required'")) {
        if (!cleanupRequiredPresent) {
          if (inTransaction) throw new Error('unsafe enum use in migration transaction')
          cleanupRequiredPresent = true
        }
        return { rows: [] }
      }
      if (statement.includes("ADD VALUE IF NOT EXISTS 'railway_closed_beta'")) {
        if (!railwayTargetPresent) {
          if (inTransaction) throw new Error('unsafe Railway phase enum use')
          railwayTargetPresent = true
        }
        return { rows: [] }
      }
      if (statement.includes("ADD VALUE IF NOT EXISTS 'railway-closed-beta-1'")) {
        if (!railwayProfilePresent) {
          if (inTransaction) throw new Error('unsafe Railway profile enum use')
          railwayProfilePresent = true
        }
        return { rows: [] }
      }
      if (statement.includes('FROM "reviews"') && statement.includes('ORDER BY "id"')) {
        if (reviewBatchRead) return { rows: [] }
        reviewBatchRead = true
        return { rows: [...(input.reviews ?? [])] }
      }
      if (
        statement.startsWith('UPDATE "reviews" AS review') &&
        statement.includes('"ai_source_byte_length"')
      ) {
        return { rows: [], rowCount: (parameters?.[0] as readonly unknown[]).length }
      }
      if (statement.startsWith('INSERT INTO "drizzle"."__drizzle_migrations"')) {
        const appliedAt = Number(parameters?.[1])
        latestMigration = appliedAt
        if (appliedAt === migrationTime('0033_medical_morg')) pendingEnumType = true
        return { rows: [] }
      }
      return { rows: [] }
    },
  } as unknown as Client

  return { client, queries, parametersByQuery }
}

describe('staged Drizzle migrator', () => {
  it('commits migration 0033 before adding and using cleanup_required', async () => {
    const { client, queries } = createMigrationClient({
      latestMigration: migrationTime('0016_region-moves'),
      enumTypePresent: false,
      cleanupRequiredPresent: false,
      railwayTargetPresent: false,
      railwayProfilePresent: false,
    })

    await expect(runStagedDrizzleMigrations(client, MIGRATIONS_FOLDER)).resolves.toEqual({
      preEnumCommitApplied: PRE_ENUM_MIGRATION_COUNT,
      postEnumCommitApplied: POST_ENUM_MIGRATION_COUNT,
      reviewAiSourceBackfilled: 0,
      outcome: {
        typePresent: true,
        cleanupRequiredPresent: true,
        additionAttempted: true,
      },
    })

    const firstCommit = queries.indexOf('COMMIT')
    const enumAddition = queries.findIndex((query) =>
      query.includes("ADD VALUE IF NOT EXISTS 'cleanup_required'"),
    )
    const secondBegin = queries.indexOf('BEGIN', firstCommit + 1)
    expect(firstCommit).toBeGreaterThan(0)
    expect(enumAddition).toBeGreaterThan(firstCommit)
    expect(secondBegin).toBeGreaterThan(enumAddition)
    const railwayTargetAddition = queries.findIndex((query) =>
      query.includes("ADD VALUE IF NOT EXISTS 'railway_closed_beta'"),
    )
    const railwayProfileAddition = queries.findIndex((query) =>
      query.includes("ADD VALUE IF NOT EXISTS 'railway-closed-beta-1'"),
    )
    expect(railwayTargetAddition).toBeGreaterThan(firstCommit)
    expect(railwayTargetAddition).toBeLessThan(secondBegin)
    expect(railwayProfileAddition).toBeGreaterThan(firstCommit)
    expect(railwayProfileAddition).toBeLessThan(secondBegin)
  })

  it('is a no-op when the complete journal and enum label already exist', async () => {
    const { client, queries } = createMigrationClient({
      latestMigration: LATEST_MIGRATION_TIME,
      enumTypePresent: true,
      cleanupRequiredPresent: true,
      railwayTargetPresent: true,
      railwayProfilePresent: true,
    })
    await expect(runStagedDrizzleMigrations(client, MIGRATIONS_FOLDER)).resolves.toEqual({
      preEnumCommitApplied: 0,
      postEnumCommitApplied: 0,
      reviewAiSourceBackfilled: 0,
      outcome: {
        typePresent: true,
        cleanupRequiredPresent: true,
        additionAttempted: false,
      },
    })
    expect(
      queries.some((query) =>
        query.includes("ADD VALUE IF NOT EXISTS 'cleanup_required'"),
      ),
    ).toBe(false)
  })

  it('backfills canonical AI source provenance before the 0043 contract guard', async () => {
    const reviewedAt = new Date('2026-08-01T12:34:56.789Z')
    const review = {
      id: '11111111-1111-4111-8111-111111111111',
      text: 'Jane Doe thanked JANE DOE and typed [PERSON].',
      rating: 5,
      language_code: 'en-US',
      reviewed_at: reviewedAt,
      reviewer_name: 'Jane Doe',
    } as const
    const { client, queries, parametersByQuery } = createMigrationClient({
      latestMigration: migrationTime('0042_google-import-execution-policy-version'),
      enumTypePresent: true,
      cleanupRequiredPresent: true,
      railwayTargetPresent: true,
      railwayProfilePresent: true,
      reviews: [review],
    })

    await expect(runStagedDrizzleMigrations(client, MIGRATIONS_FOLDER)).resolves.toEqual(
      expect.objectContaining({ reviewAiSourceBackfilled: 1 }),
    )

    const updateIndex = queries.findIndex((query) =>
      query.startsWith('UPDATE "reviews" AS review'),
    )
    const guardIndex = queries.findIndex((query) =>
      query.includes('review_ai_source_contract_migrator_required'),
    )
    expect(updateIndex).toBeGreaterThan(-1)
    expect(guardIndex).toBeGreaterThan(updateIndex)
    expect(parametersByQuery[updateIndex]).toEqual([
      [review.id],
      [67],
      ['3af54f078010ae25fca4b12cb559aebb4b1d062d24887f6d7713796965c33a7d'],
    ])
  })
})
