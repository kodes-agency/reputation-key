// Decision 16 of the v3 contract: nothing v3 stores goes active without a tested
// 24-month deletion rule. This proves it from the schema, so a table added to
// the v3 storage later cannot be forgotten: every v3 table either has a rule
// the sweep executes or is removed by a chain of cascading foreign keys from a
// table that has one. What the sweep does to rows is
// `retention-sweep-ai-v3.integration.test.ts`.

import { getTableName, isTable } from 'drizzle-orm'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import * as schema from '#/shared/db/schema'
import * as v3Schema from '#/shared/db/schema/ai-review-analysis-v3.schema'
import * as issueSchema from '#/shared/db/schema/ai-property-issue-groups.schema'
import * as correctionSchema from '#/shared/db/schema/ai-review-analysis-corrections.schema'
import { RETENTION_RULES } from '#/shared/jobs/retention-sweep.job'
import { RETENTION_REGISTRY } from './retention-registry'

function tablesOf(module: Record<string, unknown>): PgTable[] {
  return Object.values(module).filter((value): value is PgTable => isTable(value))
}

const V3_TABLES = [
  ...tablesOf(v3Schema),
  ...tablesOf(issueSchema),
  ...tablesOf(correctionSchema),
]

const tablesByName = new Map<string, PgTable>(
  tablesOf(schema).map((table) => [getTableName(table), table]),
)

const swept = (table: string) => RETENTION_RULES.filter((rule) => rule.table === table)

/** Parent tables this table's foreign keys delete it with. */
function cascadeParents(table: PgTable): readonly string[] {
  return getTableConfig(table)
    .foreignKeys.filter((key) => key.onDelete === 'cascade')
    .map((key) => getTableName(key.reference().foreignTable))
}

/** The table whose rule deletes this one, directly or through cascades; null if none. */
function deletedBy(name: string, seen: ReadonlySet<string> = new Set()): string | null {
  if (seen.has(name)) return null
  if (swept(name).some((rule) => (rule.operation ?? 'delete') === 'delete')) return name
  const table = tablesByName.get(name)
  if (table === undefined) return null
  for (const parent of cascadeParents(table)) {
    const found = deletedBy(parent, new Set([...seen, name]))
    if (found !== null) return found
  }
  return null
}

describe('Review Analysis v3 retention', () => {
  it('finds every v3 analysis, issue-group and correction table in the schema modules', () => {
    expect(V3_TABLES.map(getTableName).sort()).toEqual([
      'ai_property_aggregate_contribution_mentions',
      'ai_property_issue_groups',
      'ai_property_issue_members',
      'ai_property_review_population_daily',
      'ai_review_analysis_mention_corrections',
      'ai_review_analysis_mention_sentences',
      'ai_review_analysis_mentions',
    ])
  })

  it('removes every v3 table by a rule the sweep executes, directly or by cascade', () => {
    const uncovered = V3_TABLES.map(getTableName).filter(
      (name) => deletedBy(name) === null,
    )

    expect(uncovered).toEqual([])
  })

  it('names the table that deletes each v3 table', () => {
    expect(
      Object.fromEntries(
        V3_TABLES.map((table) => [getTableName(table), deletedBy(getTableName(table))]),
      ),
    ).toEqual({
      ai_property_aggregate_contribution_mentions: 'ai_review_analyses',
      ai_property_issue_groups: 'ai_property_issue_groups',
      ai_property_issue_members: 'ai_property_issue_groups',
      ai_property_review_population_daily: 'ai_property_review_population_daily',
      ai_review_analysis_mention_corrections: 'ai_review_analyses',
      ai_review_analysis_mention_sentences: 'ai_review_analyses',
      ai_review_analysis_mentions: 'ai_review_analyses',
    })
  })

  it('states a 24-month horizon for every v3 table in the counsel registry', () => {
    for (const table of V3_TABLES.map(getTableName)) {
      const entries = RETENTION_REGISTRY.filter((rule) => rule.source === table)
      expect(entries.length, table).toBeGreaterThanOrEqual(1)
      for (const entry of entries) {
        expect(entry.dataClass, entry.id).toBe('ai_derivatives')
        expect(entry.eligibility.horizon, entry.id).toEqual({
          kind: 'months',
          months: 24,
        })
      }
    }
  })

  it('deletes a v3 analysis on the deadline it stamped, and no v2 analysis', () => {
    const [rule, ...others] = swept('ai_review_analyses')

    expect(others).toEqual([])
    expect(rule).toMatchObject({
      subject: 'ai_review_analyses.v3_expired',
      tsColumn: 'expires_at',
      olderThanMs: 0,
      extraWhere: "analysis_profile_version = 'review-analysis-v3'",
    })
    expect(rule?.operation ?? 'delete').toBe('delete')
    // The key is the whole analysis identity, so a batch names exact rows.
    expect(rule?.keyColumns).toEqual([
      'organization_id',
      'property_id',
      'review_id',
      'source_epoch',
      'source_revision',
      'analysis_sequence',
    ])
  })

  it('keeps the daily star counts 24 calendar months from the day they count, never from an update', () => {
    const [rule, ...others] = swept('ai_property_review_population_daily')

    expect(others).toEqual([])
    expect(rule).toMatchObject({
      subject: 'ai_property_review_population_daily.expired',
      tsColumn: 'local_date',
      olderThanMonths: 24,
    })
    expect(rule?.tsColumn).not.toBe('updated_at')
  })

  it('deletes issue groups only after analyses release their contribution references', () => {
    const [rule, ...others] = swept('ai_property_issue_groups')
    const analysisIndex = RETENTION_RULES.findIndex(
      (candidate) => candidate.subject === 'ai_review_analyses.v3_expired',
    )
    const groupIndex = RETENTION_RULES.findIndex(
      (candidate) => candidate.subject === 'ai_property_issue_groups.expired',
    )

    expect(others).toEqual([])
    expect(rule).toMatchObject({
      subject: 'ai_property_issue_groups.expired',
      keyColumns: ['id'],
      tsColumn: 'expires_at',
      olderThanMs: 0,
      extraWhere:
        'NOT EXISTS (SELECT 1 FROM ai_property_aggregate_contribution_mentions m WHERE m.issue_group_id = ai_property_issue_groups.id)',
    })
    expect(groupIndex).toBeGreaterThan(analysisIndex)
  })

  it('leaves the v2 aspect tables to the rule that still waits for them', () => {
    const v2Registry = RETENTION_REGISTRY.find(
      (rule) => rule.id === 'ai.local_derivatives',
    )

    expect(v2Registry?.eligibility.horizon).toEqual({
      kind: 'accepted_unexecuted',
      months: 24,
    })
    expect(v2Registry?.eligibility.implementedBoundary).toContain('v3')
  })
})
