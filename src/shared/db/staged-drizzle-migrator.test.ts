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

function createMigrationClient(input: {
  latestMigration: number
  enumTypePresent: boolean
  cleanupRequiredPresent: boolean
  railwayTargetPresent: boolean
  railwayProfilePresent: boolean
}): Readonly<{ client: Client; queries: string[] }> {
  const queries: string[] = []
  let latestMigration = input.latestMigration
  let enumTypePresent = input.enumTypePresent
  let cleanupRequiredPresent = input.cleanupRequiredPresent
  let railwayTargetPresent = input.railwayTargetPresent
  let railwayProfilePresent = input.railwayProfilePresent
  let pendingEnumType = false
  let inTransaction = false

  const client = {
    async query(sql: string, parameters?: unknown[]) {
      const statement = sql.trim()
      queries.push(statement)

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
      if (statement.startsWith('INSERT INTO "drizzle"."__drizzle_migrations"')) {
        const appliedAt = Number(parameters?.[1])
        latestMigration = appliedAt
        if (appliedAt === migrationTime('0033_medical_morg')) pendingEnumType = true
        return { rows: [] }
      }
      return { rows: [] }
    },
  } as unknown as Client

  return { client, queries }
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
      preEnumCommitApplied: 17,
      postEnumCommitApplied: 16,
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
      latestMigration: migrationTime('0049_ai-execution-admission'),
      enumTypePresent: true,
      cleanupRequiredPresent: true,
      railwayTargetPresent: true,
      railwayProfilePresent: true,
    })
    await expect(runStagedDrizzleMigrations(client, MIGRATIONS_FOLDER)).resolves.toEqual({
      preEnumCommitApplied: 0,
      postEnumCommitApplied: 0,
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
})
