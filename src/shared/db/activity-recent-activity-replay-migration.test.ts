import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/0146_activity_recent_activity_replay.sql'),
  'utf8',
)
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; when: number; tag: string }> }

describe('0146 Activity Recent Activity replay migration', () => {
  it('creates a content-free replay authority independent of outbox retention', () => {
    const table = migration.slice(
      migration.indexOf('CREATE TABLE "recent_activity_replay_facts"'),
      migration.indexOf(');', migration.indexOf('CREATE TABLE')),
    )
    expect(table).toContain('"source_event_id"')
    expect(table).toContain('"source_event_type"')
    expect(table).toContain('"source_event_version"')
    expect(table).toContain('"source_occurred_at"')
    expect(table).not.toContain('REFERENCES "outbox_events"')
    for (const prohibited of [
      'actor_name',
      'actor_avatar_url',
      'review_text',
      'private_feedback',
      'contact',
      'ip_hash',
      'token',
      'reason',
    ]) {
      expect(table).not.toContain(`"${prohibited}"`)
    }
  })

  it('labels the minimized legacy baseline without inventing event provenance', () => {
    expect(migration).toContain("'legacy_projection_snapshot'")
    expect(migration).toContain("'from', NULL")
    expect(migration).toContain("'to', NULL")
    expect(migration).toContain("'detail', NULL")
    expect(migration).not.toMatch(
      /'legacy_projection_snapshot'[\s\S]{0,300}"event_type"/u,
    )
  })

  it('owns the next monotonic journal slot', () => {
    const previous = journal.entries.find(({ idx }) => idx === 145)
    const current = journal.entries.find(({ idx }) => idx === 146)
    expect(current).toMatchObject({
      idx: 146,
      when: 1790352000017,
      tag: '0146_activity_recent_activity_replay',
    })
    expect(current!.when).toBeGreaterThan(previous!.when)
  })
})
