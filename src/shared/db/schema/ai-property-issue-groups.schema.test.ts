import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableColumns, getTableName } from 'drizzle-orm'
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { REVIEW_CAUSE_PHRASE_PATTERN } from '#/shared/review-analysis-v3'
import { REVIEW_TOPICS_V3 } from '#/shared/review-topic-taxonomy'
import {
  aiPropertyIssueGroups,
  aiPropertyIssueMembers,
} from './ai-property-issue-groups.schema'
import { aiPropertyAggregateContributionMentions } from './ai-review-analysis-v3.schema'

const ROOT = join(import.meta.dirname, '..', '..', '..', '..')
const MIGRATION = readFileSync(
  join(ROOT, 'drizzle', '0079_property_issue_groups.sql'),
  'utf8',
)
const JOURNAL = JSON.parse(
  readFileSync(join(ROOT, 'drizzle', 'meta', '_journal.json'), 'utf8'),
) as { entries: ReadonlyArray<Readonly<Record<string, unknown>>> }

const SQL_TEXT = MIGRATION.split('--> statement-breakpoint')
  .map((part) =>
    part
      .split('\n')
      .filter((line) => !line.startsWith('--'))
      .join('\n')
      .trim(),
  )
  .join('\n')
const dialect = new PgDialect()

function compactSql(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function quotedList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ')
}

describe('migration 0079 Property issue groups', () => {
  it('creates exactly the two modeled tables and one nullable mention column', () => {
    const tables = [...SQL_TEXT.matchAll(/CREATE TABLE "([a-z_0-9]+)"/gu)].map(
      (match) => match[1],
    )

    expect(tables.sort()).toEqual(
      [getTableName(aiPropertyIssueGroups), getTableName(aiPropertyIssueMembers)].sort(),
    )
    expect(SQL_TEXT).toContain(
      'ALTER TABLE "ai_property_aggregate_contribution_mentions" ADD COLUMN "issue_group_id" uuid',
    )
    expect(
      getTableColumns(aiPropertyAggregateContributionMentions).issueGroupId.notNull,
    ).toBe(false)
  })

  it('pins every model constraint and index name in the migration', () => {
    for (const table of [
      aiPropertyIssueGroups,
      aiPropertyIssueMembers,
      aiPropertyAggregateContributionMentions,
    ]) {
      const config = getTableConfig(table)
      const names = [
        ...config.checks.map(({ name }) => name),
        ...config.foreignKeys.map((key) => key.getName()),
        ...config.indexes.map((index) => index.config.name ?? ''),
        ...config.primaryKeys.map((key) => key.getName()),
        ...config.uniqueConstraints.map((key) => key.getName()),
      ].filter((name): name is string => name !== undefined && name.includes('issue'))
      for (const name of names) expect(SQL_TEXT, name).toContain(`"${name}"`)
    }
  })

  it('pins every new model column and CHECK expression in the migration', () => {
    for (const table of [aiPropertyIssueGroups, aiPropertyIssueMembers]) {
      const name = getTableName(table)
      const create = SQL_TEXT.match(
        new RegExp(`CREATE TABLE "${name}" \\(.*?\\n\\)`, 'su'),
      )?.[0]
      expect(create, name).toBeTypeOf('string')
      for (const column of Object.values(getTableColumns(table))) {
        expect(create, `${name}.${column.name}`).toContain(
          `"${column.name}" ${column.getSQLType()}`,
        )
      }
      for (const check of getTableConfig(table).checks) {
        expect(compactSql(SQL_TEXT), check.name).toContain(
          compactSql(dialect.sqlToQuery(check.value).sql),
        )
      }
    }
  })

  it('uses the shared topic vocabulary and cause phrase pattern', () => {
    const topics = quotedList(REVIEW_TOPICS_V3)
    const pattern = `'${REVIEW_CAUSE_PHRASE_PATTERN.source}'`
    expect(SQL_TEXT.match(new RegExp(`topic" IN \\(${topics}\\)`, 'gu'))).toHaveLength(2)
    expect(SQL_TEXT).toContain(`"canonical_thing" ~ ${pattern}`)
    expect(SQL_TEXT).toContain(`"member_thing" ~ ${pattern}`)
  })

  it('pins topic-level and bounded manager metadata checks', () => {
    expect(SQL_TEXT).toContain('"canonical_key" = \'__topic__\'')
    expect(SQL_TEXT).toContain('"member_key" = \'__topic__\'')
    expect(SQL_TEXT).toContain(
      'char_length("ai_property_issue_groups"."display_name") BETWEEN 1 AND 80',
    )
    expect(SQL_TEXT).toContain(
      'char_length("ai_property_issue_groups"."hidden_by") BETWEEN 1 AND 255',
    )
    expect(SQL_TEXT).toContain("\"source\" IN ('deterministic', 'manager')")
  })

  it('enforces tenant-and-topic composite references with the required delete actions', () => {
    expect(SQL_TEXT).toContain(
      '"ai_property_issue_groups_merged_into_fk" FOREIGN KEY ("organization_id","property_id","merged_into_issue_id","topic")',
    )
    expect(SQL_TEXT).toContain(
      '"ai_property_issue_members_group_fk" FOREIGN KEY ("organization_id","property_id","issue_group_id","topic")',
    )
    expect(SQL_TEXT).toContain(
      '"ai_property_aggregate_contribution_mentions_issue_group_fk" FOREIGN KEY ("organization_id","property_id","issue_group_id","topic")',
    )
    expect(SQL_TEXT).toContain(
      'ai_property_issue_groups"("organization_id","property_id","id","topic") ON DELETE cascade',
    )
    expect(SQL_TEXT).toContain(
      'ai_property_issue_groups"("organization_id","property_id","id","topic") ON DELETE no action',
    )
  })

  it('pins the active canonical uniqueness and retention/redirect indexes', () => {
    expect(SQL_TEXT).toContain('"ai_property_issue_groups_canonical_active_unique"')
    expect(SQL_TEXT).toContain(
      'WHERE "ai_property_issue_groups"."merged_into_issue_id" IS NULL',
    )
    expect(SQL_TEXT).toContain(
      '"ai_property_issue_groups_retention_idx" ON "ai_property_issue_groups" USING btree ("expires_at")',
    )
    expect(SQL_TEXT).toContain('"ai_property_issue_groups_merged_into_idx"')
    expect(SQL_TEXT).toContain(
      '"ai_property_aggregate_contribution_mentions_issue_group_idx"',
    )
  })

  it('stores no unbounded text or review sentence', () => {
    for (const table of [aiPropertyIssueGroups, aiPropertyIssueMembers]) {
      const textColumns = Object.values(getTableColumns(table)).filter(
        (column) => column.getSQLType() === 'text',
      )
      expect(textColumns).toEqual([])
    }
    expect(getTableColumns(aiPropertyIssueGroups).displayName.getSQLType()).toBe(
      'varchar(80)',
    )
  })

  it('adds no backfill or destructive statement', () => {
    const withoutForeignKeyActions = SQL_TEXT.replace(
      /ON (?:DELETE|UPDATE) [a-z ]+/gu,
      '',
    )
    expect(withoutForeignKeyActions).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/u,
    )
  })

  it('documents the dark path, empty-table locks, roll-forward down step and no backfill', () => {
    expect(MIGRATION).toContain('Both new tables are empty')
    expect(MIGRATION).toContain('also empty while v3 is dark')
    expect(MIGRATION).toContain('No backfill')
    expect(MIGRATION).toContain('Roll forward, never back')
  })

  it('is the exact required journal entry after 0078', () => {
    const entry = JOURNAL.entries.find((candidate) => candidate.idx === 79)
    expect(entry).toEqual({
      idx: 79,
      version: '7',
      when: 1796000000000,
      tag: '0079_property_issue_groups',
      breakpoints: true,
    })
    // Later migrations append after it (0081 reply library layers); 0079 stays right
    // after 0078.
    expect(JOURNAL.entries.find((candidate) => candidate.idx === 78)?.tag).toBe(
      '0078_review_analysis_v3',
    )
  })
})
