import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'drizzle/0160_recent_activity_identifiers.sql',
)
const journalPath = resolve(process.cwd(), 'drizzle/meta/_journal.json')

describe('0160 canonical Recent Activity identifiers migration', () => {
  it('renames in place and leaves an updatable compatibility view without copying rows', () => {
    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).toContain(
      `ALTER TABLE "${['activity', 'log'].join('_')}" RENAME TO "recent_activity_entries"`,
    )
    expect(sql).toContain(`CREATE VIEW "${['activity', 'log'].join('_')}" AS`)
    expect(sql).toContain('FROM "recent_activity_entries"')
    expect(sql).not.toMatch(/INSERT\s+INTO\s+"recent_activity_entries"/iu)
    expect(sql).not.toMatch(/DELETE\s+FROM\s+"activity_log"/iu)
    expect(sql).not.toMatch(/DROP\s+TABLE\s+"activity_log"/iu)
  })

  it('owns the next monotonic journal slot', () => {
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: Array<{ idx: number; when: number; tag: string }>
    }
    const previous = journal.entries.find(({ idx }) => idx === 159)
    const current = journal.entries.find(({ idx }) => idx === 160)

    expect(current).toMatchObject({
      idx: 160,
      when: 1790352000031,
      tag: '0160_recent_activity_identifiers',
    })
    expect(current!.when).toBeGreaterThan(previous!.when)
  })
})
