import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { journalConcurrentIndex } from '#/shared/db/journal-concurrent-index'

describe('Google import dispatch index migration', () => {
  it('can be applied and recovered by the journal runner', () => {
    const sql = readFileSync(
      new URL(
        '../../../../drizzle/0101_google_import_dispatch_index.sql',
        import.meta.url,
      ),
      'utf8',
    )

    expect(journalConcurrentIndex(sql)).toMatchObject({
      name: 'gbp_import_request_items_due_idx',
      table: 'gbp_import_request_items',
      columns: ['next_dispatch_at', 'id'],
      unique: false,
      predicate: null,
    })
  })
})
