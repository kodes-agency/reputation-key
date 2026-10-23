// Migration 0070 is hand-written SQL (drizzle/meta stops at 0013), so what it
// wrote is pinned here as literals: widening a format or a predicate later asks
// for a new migration instead of tempting anyone to edit 0070. What the SQL does
// against PostgreSQL is `portal-print-code-columns.integration.test.ts`;
// `pnpm check:schema-drift` proves the model matches a migrated database.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableColumns } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { portalTokens } from './portal.schema'

const ROOT = join(import.meta.dirname, '..', '..', '..', '..')
const MIGRATION = readFileSync(
  join(ROOT, 'drizzle', '0070_portal_print_codes.sql'),
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

const CHANNELS = ['qr', 'nfc'] as const

describe('migration 0070 Portal print codes', () => {
  it('adds the two hash columns, nullable, and nothing else', () => {
    expect(STATEMENTS).toHaveLength(6)
    for (const channel of CHANNELS) {
      expect(STATEMENTS).toContain(
        `ALTER TABLE "portal_tokens" ADD COLUMN "${channel}_print_code_hash" varchar(64);`,
      )
    }
    // No row is rewritten and nothing is removed.
    expect(STATEMENTS.join('\n')).not.toMatch(/\b(?:UPDATE|DELETE|DROP|INSERT)\b/u)
  })

  it('keeps the model nullable with no default, so an older image can still insert', () => {
    const columns = getTableColumns(portalTokens)
    for (const column of [columns.qrPrintCodeHash, columns.nfcPrintCodeHash]) {
      expect(column.notNull).toBe(false)
      expect(column.hasDefault).toBe(false)
      expect(column.getSQLType()).toBe('varchar(64)')
    }
  })

  it.each(CHANNELS)('holds the stored form of the %s hash with a CHECK', (channel) => {
    expect(STATEMENTS).toContain(
      `ALTER TABLE "portal_tokens" ADD CONSTRAINT "portal_tokens_${channel}_print_code_hash_format" ` +
        `CHECK ("portal_tokens"."${channel}_print_code_hash" IS NULL OR ` +
        `"portal_tokens"."${channel}_print_code_hash" ~ '^[0-9a-f]{64}$');`,
    )
  })

  it.each(CHANNELS)('makes each %s hash unique only where there is one', (channel) => {
    expect(STATEMENTS).toContain(
      `CREATE UNIQUE INDEX "portal_tokens_${channel}_print_code_hash_key" ` +
        `ON "portal_tokens" USING btree ("${channel}_print_code_hash") ` +
        `WHERE "portal_tokens"."${channel}_print_code_hash" IS NOT NULL;`,
    )
  })

  it('declares the same names in the model', () => {
    const config = getTableConfig(portalTokens)
    const indexes = config.indexes.map((index) => index.config)
    for (const channel of CHANNELS) {
      const index = indexes.find(
        (candidate) => candidate.name === `portal_tokens_${channel}_print_code_hash_key`,
      )
      expect(index?.unique).toBe(true)
      expect(index?.where).toBeDefined()
      expect(config.checks.map((check) => check.name)).toContain(
        `portal_tokens_${channel}_print_code_hash_format`,
      )
    }
  })

  it('is journalled after 0069', () => {
    const entry = JOURNAL.entries.find((candidate) => candidate.idx === 70)
    expect(entry?.tag).toBe('0070_portal_print_codes')
    const previous = JOURNAL.entries.find((candidate) => candidate.idx === 69)
    expect(entry && previous && entry.when > previous.when).toBe(true)
  })
})
