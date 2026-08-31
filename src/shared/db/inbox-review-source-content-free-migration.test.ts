import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { inboxItems } from './schema/inbox.schema'

const ROOT = process.cwd()
const migration = readFileSync(
  resolve(ROOT, 'drizzle/0126_inbox_review_source_content_free.sql'),
  'utf8',
)
const journal = JSON.parse(
  readFileSync(resolve(ROOT, 'drizzle/meta/_journal.json'), 'utf8'),
) as { entries: Array<Record<string, unknown>> }

describe('0126 Inbox Review source-content boundary', () => {
  it('installs the write fence before scrubbing legacy rows, then validates it', () => {
    const addFence = migration.indexOf(
      'ADD CONSTRAINT "inbox_items_review_source_content_free"',
    )
    const backfill = migration.indexOf('UPDATE "inbox_items"')
    const validate = migration.indexOf(
      'VALIDATE CONSTRAINT "inbox_items_review_source_content_free"',
    )

    expect(addFence).toBeGreaterThanOrEqual(0)
    expect(backfill).toBeGreaterThan(addFence)
    expect(validate).toBeGreaterThan(backfill)
    expect(migration).toContain(') NOT VALID')
    expect(migration).toContain('WHERE "source_type" = \'review\'')
    expect(migration).toContain('"rating" = NULL')
    expect(migration).toContain('"snippet" = NULL')
    expect(migration).toContain('"reviewer_name" = NULL')
    expect(migration).toContain("'9007199254740991'::bigint")
  })

  it('registers the immutable journal step and the matching Drizzle check', () => {
    expect(journal.entries).toContainEqual({
      idx: 126,
      version: '7',
      when: 1790092800000,
      tag: '0126_inbox_review_source_content_free',
      breakpoints: true,
    })
    expect(getTableConfig(inboxItems).checks.map((check) => check.name)).toContain(
      'inbox_items_review_source_content_free',
    )
  })
})
