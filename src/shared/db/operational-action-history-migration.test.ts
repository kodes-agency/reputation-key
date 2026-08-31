import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/0149_operational_action_history.sql'),
  'utf8',
)
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; when: number; tag: string }> }
const retentionSweep = readFileSync(
  resolve(process.cwd(), 'src/shared/jobs/retention-sweep.job.ts'),
  'utf8',
)

describe('0149 restricted Operational Action History migration', () => {
  it('creates a separate identifier-only authority with explicit provenance and vocabulary', () => {
    const records = migration.slice(
      migration.indexOf('CREATE TABLE "operational_action_history_records"'),
      migration.indexOf(
        ');',
        migration.indexOf('CREATE TABLE "operational_action_history_records"'),
      ),
    )
    expect(records).toContain('"organization_id"')
    expect(records).toContain('"sequence"')
    expect(records).toContain('"provenance_kind"')
    expect(records).toContain('"source_event_version"')
    expect(records).toContain('operational_action_history_kind_valid')
    for (const prohibited of [
      'payload',
      'details',
      'content',
      'review_text',
      'private_feedback',
      'ip_address',
      'ip_hash',
      'token',
      'actor_name',
      'email',
    ]) {
      expect(records).not.toContain(`"${prohibited}"`)
    }
    expect(migration).not.toContain('INSERT INTO "operational_action_history_records"')
    expect(migration).not.toContain('FROM "recent_activity_entries"')
    expect(migration).not.toContain('FROM "audit_logs"')
  })

  it('guards the append-only core and hold evidence while permitting bounded redaction', () => {
    expect(migration).toContain('guard_operational_action_history_record_mutation_v1')
    expect(migration).toContain('operational_action_history_records_truncate_guard')
    expect(migration).toContain('active legal hold rejects redaction')
    expect(migration).toContain('guard_operational_action_history_hold_mutation_v1')
    expect(migration).toContain('operational_action_history_legal_holds_truncate_guard')
    expect(migration).toContain('guard_operational_action_history_head_mutation_v1')
    expect(migration).toContain('NEW.last_sequence <> OLD.last_sequence + 1')
    expect(migration).toContain('operational_action_history_heads_truncate_guard')
    expect(migration).not.toMatch(/DELETE FROM\s+"?operational_action_history_records"?/u)
    expect(retentionSweep).not.toContain('operational_action_history_records')
  })

  it('owns the next deterministic monotonic journal slot', () => {
    const previous = journal.entries.find(({ idx }) => idx === 148)
    const current = journal.entries.find(({ idx }) => idx === 149)
    expect(current).toMatchObject({
      idx: 149,
      when: 1790352000020,
      tag: '0149_operational_action_history',
    })
    expect(current!.when).toBeGreaterThan(previous!.when)
  })
})
