import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { reviews } from './schema/review.schema'

const ROOT = process.cwd()
const migration = readFileSync(
  resolve(ROOT, 'drizzle/0127_review_lifecycle_cursor.sql'),
  'utf8',
)
const journal = JSON.parse(
  readFileSync(resolve(ROOT, 'drizzle/meta/_journal.json'), 'utf8'),
) as { entries: Array<Record<string, unknown>> }

describe('0127 Review lifecycle cursor', () => {
  it('adds the exact schema index used by the frozen lifecycle keyset', () => {
    expect(getTableConfig(reviews).indexes.map((index) => index.config.name)).toContain(
      'reviews_lifecycle_cursor_idx',
    )
    expect(migration.trim()).toBe(
      'CREATE INDEX "reviews_lifecycle_cursor_idx" ON "reviews" USING btree ("created_at","id");',
    )
  })

  it('is registered as an immutable forward migration after the Inbox invariant', () => {
    expect(journal.entries).toContainEqual({
      idx: 127,
      version: '7',
      when: 1790179200000,
      tag: '0127_review_lifecycle_cursor',
      breakpoints: true,
    })
  })
})
