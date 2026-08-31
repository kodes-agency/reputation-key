import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { inboxHandlingCycles } from './schema/inbox.schema'

const ROOT = process.cwd()
const migration = readFileSync(
  resolve(ROOT, 'drizzle/0129_inbox_governed_manual_reopen.sql'),
  'utf8',
)
const journal = JSON.parse(
  readFileSync(resolve(ROOT, 'drizzle/meta/_journal.json'), 'utf8'),
) as { entries: Array<Record<string, unknown>> }

describe('0129 governed Inbox manual reopen', () => {
  it('adds only nullable expand columns and a forward write fence', () => {
    expect(migration).toContain('ADD COLUMN "manual_reopen_reason" varchar(48)')
    expect(migration).toContain('ADD COLUMN "manual_reopen_explanation" varchar(280)')
    expect(migration).not.toContain('UPDATE "inbox_handling_cycles"')
    expect(migration).toContain(
      'ADD CONSTRAINT "inbox_handling_cycles_manual_reopen_valid"',
    )
    expect(migration).toContain(') NOT VALID')
    expect(migration).toContain('AND "manual_reopen_reason" IS NOT NULL')
    for (const reason of [
      'guest_follow_up_still_needed',
      'internal_follow_up_still_needed',
      'new_information',
      'correcting_handling_status',
      'other',
    ]) {
      expect(migration).toContain(`'${reason}'`)
    }
    expect(migration).toContain('length(btrim("manual_reopen_explanation"))')
  })

  it('registers the immutable journal step and matching Drizzle contract', () => {
    expect(journal.entries).toContainEqual({
      idx: 129,
      version: '7',
      when: 1790352000000,
      tag: '0129_inbox_governed_manual_reopen',
      breakpoints: true,
    })
    const config = getTableConfig(inboxHandlingCycles)
    expect(config.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['manual_reopen_reason', 'manual_reopen_explanation']),
    )
    expect(config.checks.map((check) => check.name)).toContain(
      'inbox_handling_cycles_manual_reopen_valid',
    )
  })
})
