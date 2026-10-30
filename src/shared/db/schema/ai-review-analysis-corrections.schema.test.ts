import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableColumns, getTableName } from 'drizzle-orm'
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  REVIEW_ANALYSIS_V3_MAX_MENTIONS,
  REVIEW_CAUSE_PHRASE_PATTERN,
} from '#/shared/review-analysis-v3'
import { REVIEW_TOPICS_V3 } from '#/shared/review-topic-taxonomy'
import {
  aiReviewAnalysisMentionCorrections,
  MENTION_CORRECTION_KINDS,
} from './ai-review-analysis-corrections.schema'

const ROOT = join(import.meta.dirname, '..', '..', '..', '..')
const MIGRATION = readFileSync(
  join(ROOT, 'drizzle', '0080_review_analysis_mention_corrections.sql'),
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
const config = getTableConfig(aiReviewAnalysisMentionCorrections)
const NAME = getTableName(aiReviewAnalysisMentionCorrections)

function compactSql(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

describe('migration 0080 mention corrections', () => {
  it('creates the one modeled table and nothing else', () => {
    const tables = [...SQL_TEXT.matchAll(/CREATE TABLE "([a-z_0-9]+)"/gu)].map(
      (match) => match[1],
    )

    expect(tables).toEqual([NAME])
    expect(SQL_TEXT).not.toMatch(
      /\bALTER TABLE "(?!ai_review_analysis_mention_corrections)/u,
    )
  })

  it('pins every column, CHECK expression, key and index name of the model', () => {
    const create = SQL_TEXT.match(
      new RegExp(`CREATE TABLE "${NAME}" \\(.*?\\n\\)`, 'su'),
    )?.[0]
    expect(create).toBeTypeOf('string')
    for (const column of Object.values(
      getTableColumns(aiReviewAnalysisMentionCorrections),
    )) {
      expect(create, column.name).toContain(`"${column.name}" ${column.getSQLType()}`)
    }
    for (const check of config.checks) {
      expect(compactSql(SQL_TEXT), check.name).toContain(
        compactSql(dialect.sqlToQuery(check.value).sql),
      )
    }
    for (const key of config.foreignKeys)
      expect(SQL_TEXT, key.getName()).toContain(`"${key.getName()}"`)
    for (const index of config.indexes) {
      expect(SQL_TEXT, index.config.name).toContain(`"${index.config.name}"`)
    }
  })

  it('holds one correction per mention', () => {
    const unique = config.indexes.filter((index) => index.config.unique)

    expect(unique.map((index) => index.config.name)).toEqual([
      'ai_review_analysis_mention_corrections_mention_unique',
    ])
    expect(
      unique[0]?.config.columns.map((column) => ('name' in column ? column.name : '')),
    ).toEqual([
      'organization_id',
      'property_id',
      'review_id',
      'source_epoch',
      'source_revision',
      'analysis_sequence',
      'mention_ordinal',
    ])
  })

  it('goes with the mention, and so with the analysis, and with the issue it moved to', () => {
    expect(SQL_TEXT).toContain(
      '"ai_review_analysis_mention_corrections_mention_fk" FOREIGN KEY ("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence","mention_ordinal") REFERENCES "public"."ai_review_analysis_mentions"("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence","mention_ordinal") ON DELETE cascade',
    )
    expect(SQL_TEXT).toContain(
      '"ai_review_analysis_mention_corrections_issue_group_fk" FOREIGN KEY ("organization_id","property_id","replacement_issue_group_id","topic") REFERENCES "public"."ai_property_issue_groups"("organization_id","property_id","id","topic") ON DELETE cascade',
    )
  })

  it('uses the shared topic vocabulary, mention bound and cause phrase pattern', () => {
    const topics = REVIEW_TOPICS_V3.map((topic) => `'${topic}'`).join(', ')
    const pattern = `'${REVIEW_CAUSE_PHRASE_PATTERN.source}'`

    expect(SQL_TEXT).toContain(`"topic" IN (${topics})`)
    expect(SQL_TEXT).toContain(
      `"mention_ordinal" BETWEEN 0 AND ${REVIEW_ANALYSIS_V3_MAX_MENTIONS - 1}`,
    )
    expect(SQL_TEXT).toContain(`"replacement_thing" ~ ${pattern}`)
    expect(SQL_TEXT).toContain(`"replacement_issue" ~ ${pattern}`)
    expect([...MENTION_CORRECTION_KINDS]).toEqual([
      'remove_topic',
      'change_cause',
      'not_a_problem',
    ])
  })

  it('stores no unbounded text and no review sentence', () => {
    const textColumns = Object.values(
      getTableColumns(aiReviewAnalysisMentionCorrections),
    ).filter((column) => column.getSQLType() === 'text')

    expect(textColumns).toEqual([])
    expect(
      getTableColumns(aiReviewAnalysisMentionCorrections).replacementThing.getSQLType(),
    ).toBe('varchar(80)')
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

  it('documents the dark path, the empty table, no backfill and the roll-forward down step', () => {
    expect(MIGRATION).toContain('The table is new and empty')
    expect(MIGRATION).toContain('No backfill')
    expect(MIGRATION).toContain('Roll forward, never back')
    expect(MIGRATION).toContain('cascades from ai_review_analyses')
  })

  it('is the exact required journal entry after 0081', () => {
    // The file is 0080 (the number this work was given), but main took journal idx 80 for
    // 0081_reply_library_layers first. The journal is append-only and drizzle applies an
    // entry only when its "when" is above the newest applied row, so this one sits at idx 81
    // with a later "when" and cannot be skipped on a database that already ran 0081.
    const entry = JOURNAL.entries.find((candidate) => candidate.idx === 81)

    expect(entry).toEqual({
      idx: 81,
      version: '7',
      when: 1796200000000,
      tag: '0080_review_analysis_mention_corrections',
      breakpoints: true,
    })
    expect(JOURNAL.entries.find((candidate) => candidate.idx === 80)?.tag).toBe(
      '0081_reply_library_layers',
    )
  })
})
