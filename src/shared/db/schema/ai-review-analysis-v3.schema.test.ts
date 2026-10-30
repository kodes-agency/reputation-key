// Migration 0078 is hand-written SQL (drizzle/meta stops at 0013), so what it
// wrote is pinned here: the vocabularies its checks name must be the shared v3
// contract's, so the database and the normalizer cannot disagree about a topic,
// a strength, an Urgent reason, a provider or a normalizer flag. What the SQL
// does against PostgreSQL is `ai-review-analysis-v3.schema.integration.test.ts`;
// `pnpm check:schema-drift` proves the model matches a migrated database.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableColumns, getTableName } from 'drizzle-orm'
import { PgDialect, getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { AI_PROVIDER_IDS } from '#/shared/ai-provider-ids'
import {
  REVIEW_ANALYSIS_V3_MAX_MENTIONS,
  REVIEW_ANALYSIS_V3_MAX_SENTENCE_NUMBER,
  REVIEW_ATTENTION_LEVELS_V2,
  REVIEW_CAUSE_PHRASE_PATTERN,
  REVIEW_NAMES_PERSON_V3,
  REVIEW_POLARITIES_V3,
  REVIEW_STRENGTHS_V3,
  REVIEW_URGENT_REASONS_V3,
} from '#/shared/review-analysis-v3'
import { REVIEW_ANALYSIS_NORMALIZATION_FLAGS } from '#/shared/review-analysis-v3-normalizer'
import { REVIEW_TOPICS_V3 } from '#/shared/review-topic-taxonomy'
import { gbpImportRequestItems } from './google-import-v2.schema'
import {
  aiExecutionControlHeads,
  aiExecutionControlTransitions,
  aiOperations,
  aiPropertyAggregateContributions,
  aiReviewAnalyses,
} from './ai.schema'
import {
  aiPropertyAggregateContributionMentions,
  aiPropertyReviewPopulationDaily,
  aiReviewAnalysisMentionSentences,
  aiReviewAnalysisMentions,
} from './ai-review-analysis-v3.schema'
import { properties } from './property.schema'

const ROOT = join(import.meta.dirname, '..', '..', '..', '..')
const MIGRATION = readFileSync(
  join(ROOT, 'drizzle', '0078_review_analysis_v3.sql'),
  'utf8',
)
// 0082 restates the one check that names the normalizer's flags (it added `cause_refused_shape`).
const FLAGS_MIGRATION = readFileSync(
  join(ROOT, 'drizzle', '0082_review_analysis_cause_shape_flag.sql'),
  'utf8',
)
const JOURNAL = JSON.parse(
  readFileSync(join(ROOT, 'drizzle', 'meta', '_journal.json'), 'utf8'),
) as { entries: ReadonlyArray<{ idx: number; tag: string; when: number }> }

const STATEMENTS = MIGRATION.split('--> statement-breakpoint').map((part) =>
  part
    .split('\n')
    .filter((line) => !line.startsWith('--'))
    .join('\n')
    .trim(),
)
const SQL_TEXT = STATEMENTS.join('\n')

const dialect = new PgDialect()

function quotedList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ')
}

/** The text of every CHECK a model table declares, by constraint name. */
function modelChecks(table: PgTable): ReadonlyMap<string, string> {
  return new Map(
    getTableConfig(table).checks.map((check) => [
      check.name,
      dialect.sqlToQuery(check.value).sql,
    ]),
  )
}

const NEW_TABLES = [
  aiReviewAnalysisMentions,
  aiReviewAnalysisMentionSentences,
  aiPropertyAggregateContributionMentions,
  aiPropertyReviewPopulationDaily,
] as const

const CHANGED_TABLES = [
  properties,
  gbpImportRequestItems,
  aiExecutionControlTransitions,
  aiExecutionControlHeads,
  aiOperations,
  aiReviewAnalyses,
  aiPropertyAggregateContributions,
] as const

describe('migration 0078 Review Analysis v3 storage', () => {
  it('creates exactly the four v3 tables and names each in the model', () => {
    const created = [...SQL_TEXT.matchAll(/CREATE TABLE "([a-z_0-9]+)"/gu)].map(
      (match) => match[1],
    )

    expect(created.sort()).toEqual(NEW_TABLES.map(getTableName).sort())
  })

  it('declares every constraint and index the model has, by the model name', () => {
    for (const table of [...NEW_TABLES, ...CHANGED_TABLES]) {
      const config = getTableConfig(table)
      const modelNames = [
        ...config.checks.map((check) => check.name),
        ...config.indexes.map((index) => index.config.name ?? ''),
        ...config.primaryKeys.map((key) => key.getName()),
      ]
      const v3Names = modelNames.filter(
        (name) =>
          /^(ai_review_analysis_mention|ai_property_aggregate_contribution_mentions|ai_property_review_population_daily|ai_operations_(provider|vocabulary|normalization|v3)|properties_google_primary|gbp_import_request_items_google_primary)/u.test(
            name,
          ) && !name.includes('issue_group'),
      )
      for (const name of v3Names) {
        expect(SQL_TEXT, `${getTableName(table)}: ${name}`).toContain(`"${name}"`)
      }
    }
  })

  it('writes and removes no row and drops nothing but the four checks it restates', () => {
    // `ON DELETE cascade` and `ON UPDATE no action` belong to the new foreign keys.
    const withoutForeignKeyActions = SQL_TEXT.replace(
      /ON (?:DELETE|UPDATE) [a-z ]+/gu,
      '',
    )
    expect(withoutForeignKeyActions).not.toMatch(
      /\b(?:UPDATE|DELETE|INSERT|TRUNCATE|DROP TABLE|DROP COLUMN)\b/u,
    )
    const drops = [...SQL_TEXT.matchAll(/DROP CONSTRAINT "([a-z_0-9]+)"/gu)].map(
      (match) => match[1],
    )
    expect(drops.sort()).toEqual([
      'ai_execution_control_heads_scope_valid',
      'ai_execution_control_transitions_scope_valid',
      'ai_property_aggregate_contributions_result_valid',
      'ai_review_analyses_result_valid',
    ])
  })

  it('adds every new column nullable or with a constant default, so no table is rewritten', () => {
    const added = [...SQL_TEXT.matchAll(/ADD COLUMN "([a-z_0-9]+)" ([^;]+);/gu)]
    expect(added.length).toBe(15)
    for (const [, column, definition] of added) {
      const isNullable = !definition?.includes('NOT NULL')
      const hasConstantDefault = /DEFAULT ('\{\}'|0) NOT NULL$/u.test(definition ?? '')
      expect(isNullable || hasConstantDefault, `${column}: ${definition}`).toBe(true)
    }
  })

  it('names the shared topic, polarity, strength and names vocabularies in every mention check', () => {
    for (const table of [
      'ai_review_analysis_mentions',
      'ai_property_aggregate_contribution_mentions',
    ]) {
      expect(SQL_TEXT).toContain(
        `"${table}"."topic" IN (${quotedList(REVIEW_TOPICS_V3)})`,
      )
      expect(SQL_TEXT).toContain(
        `"${table}"."polarity" IN (${quotedList(REVIEW_POLARITIES_V3)})`,
      )
      expect(SQL_TEXT).toContain(
        `"${table}"."strength" IN (${quotedList(REVIEW_STRENGTHS_V3)})`,
      )
      expect(SQL_TEXT).toContain(
        `"${table}"."names_person" IN (${quotedList(REVIEW_NAMES_PERSON_V3)})`,
      )
      expect(SQL_TEXT).toContain(
        `"${table}"."mention_ordinal" BETWEEN 0 AND ${REVIEW_ANALYSIS_V3_MAX_MENTIONS - 1}`,
      )
    }
    expect(SQL_TEXT).toContain(
      `"sentence_number" BETWEEN 1 AND ${REVIEW_ANALYSIS_V3_MAX_SENTENCE_NUMBER}`,
    )
  })

  it('holds a cause to the shared one-to-three-word pattern', () => {
    const pattern = `'${REVIEW_CAUSE_PHRASE_PATTERN.source}'`
    for (const table of [
      'ai_review_analysis_mentions',
      'ai_property_aggregate_contribution_mentions',
    ]) {
      expect(SQL_TEXT).toContain(`"${table}"."thing" ~ ${pattern}`)
      expect(SQL_TEXT).toContain(`"${table}"."issue" ~ ${pattern}`)
    }
  })

  it('names the shared Urgent reasons, attention levels and providers', () => {
    expect(SQL_TEXT).toContain(
      `"ai_review_analyses"."urgent_reason" IN (${quotedList(REVIEW_URGENT_REASONS_V3)})`,
    )
    expect(SQL_TEXT).toContain(
      `"ai_review_analyses"."attention" IN (${quotedList(REVIEW_ATTENTION_LEVELS_V2)})`,
    )
    expect(SQL_TEXT).toContain(
      `"ai_operations"."provider_id" IN (${quotedList(AI_PROVIDER_IDS)})`,
    )
    for (const table of [
      'ai_execution_control_transitions',
      'ai_execution_control_heads',
    ]) {
      expect(SQL_TEXT).toContain(
        `"${table}"."scope_value" IN (${quotedList(AI_PROVIDER_IDS)})`,
      )
      expect(SQL_TEXT).toContain(
        `"${table}"."scope_value" NOT IN (${quotedList(AI_PROVIDER_IDS)})`,
      )
    }
  })

  it('admits exactly the normalizer flags, in the migration that restates the check and in the model', () => {
    const listed = quotedList(REVIEW_ANALYSIS_NORMALIZATION_FLAGS)
    expect(FLAGS_MIGRATION).toContain(`"normalization_flags" <@ ARRAY[${listed}]`)
    expect(
      modelChecks(aiOperations).get('ai_operations_normalization_lineage_valid'),
    ).toContain(`ARRAY[${listed}]`)
  })

  it('keeps every flag 0078 admitted in the list 0082 restates, so no recorded row can become invalid', () => {
    const written = /"normalization_flags" <@ ARRAY\[([^\]]+)\]/u.exec(SQL_TEXT)?.[1]
    expect(written).toBeDefined()
    const admitted = [...(written ?? '').matchAll(/'([a-z_]+)'/gu)].map(
      (match) => match[1],
    )
    expect(admitted.length).toBeGreaterThan(0)
    for (const flag of admitted) {
      expect(REVIEW_ANALYSIS_NORMALIZATION_FLAGS).toContain(flag)
    }
    expect(REVIEW_ANALYSIS_NORMALIZATION_FLAGS).toContain('cause_refused_shape')
    expect(admitted).not.toContain('cause_refused_shape')
  })

  it('leaves every added ai_operations lineage column nullable, so an older image can still insert', () => {
    const columns = getTableColumns(aiOperations)
    for (const column of [
      columns.providerId,
      columns.providerModel,
      columns.providerRequestProfileVersion,
      columns.providerRequestProfileDigest,
      columns.vocabularyHintSetId,
      columns.vocabularyHintSetVersion,
      columns.vocabularyHintSetDigest,
      columns.normalizationProfileVersion,
      columns.normalizationProfileDigest,
    ]) {
      expect(column.notNull, column.name).toBe(false)
      expect(column.hasDefault, column.name).toBe(false)
    }
    expect(columns.normalizationFlags.notNull).toBe(true)
    expect(columns.normalizationFlags.hasDefault).toBe(true)
    expect(columns.droppedMentionCount.notNull).toBe(true)
    expect(columns.droppedMentionCount.default).toBe(0)
  })

  it('keeps the Property and import-item category columns nullable', () => {
    for (const column of [
      getTableColumns(properties).googlePrimaryCategory,
      getTableColumns(properties).googlePrimaryCategoryUpdatedAt,
      getTableColumns(gbpImportRequestItems).googlePrimaryCategory,
    ]) {
      expect(column.notNull, column.name).toBe(false)
      expect(column.hasDefault, column.name).toBe(false)
    }
  })

  it('stores no text a review could have written', () => {
    const textColumns = NEW_TABLES.flatMap((table) =>
      Object.values(getTableColumns(table))
        .filter((column) => column.getSQLType() === 'text')
        .map((column) => `${getTableName(table)}.${column.name}`),
    )
    // `thing` and `issue` are bounded generic phrases (varchar(80), three words);
    // nothing in a v3 table is free text, a quote or a sentence.
    expect(textColumns).toEqual([])
    expect(getTableColumns(aiReviewAnalysisMentions).thing.getSQLType()).toBe(
      'varchar(80)',
    )
    expect(getTableColumns(aiReviewAnalysisMentions).issue.getSQLType()).toBe(
      'varchar(80)',
    )
  })

  it('is journalled after 0077', () => {
    const entry = JOURNAL.entries.find((candidate) => candidate.idx === 78)
    expect(entry?.tag).toBe('0078_review_analysis_v3')
    const previous = JOURNAL.entries.find((candidate) => candidate.idx === 77)
    expect(entry && previous && entry.when > previous.when).toBe(true)
  })
})
