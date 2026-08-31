import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/0155_recent_activity_actor_redaction.sql'),
  'utf8',
)
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; when: number; tag: string }> }
const retentionSweep = readFileSync(
  resolve(process.cwd(), 'src/shared/jobs/retention-sweep.job.ts'),
  'utf8',
)

describe('0155 Recent Activity actor-label redaction migration', () => {
  it('adds a replay marker and a content-free delayed-delivery fence', () => {
    expect(migration).toContain('"actor_label_redacted_at"')
    expect(migration).toContain('CREATE TABLE "recent_activity_actor_label_redactions"')
    expect(migration).toContain('"organization_id"')
    expect(migration).toContain('"actor_subject_id"')
    expect(migration).toContain('"redacted_at"')
    expect(migration).toContain('"expires_at"')
    for (const prohibited of [
      'actor_name',
      'avatar',
      'email',
      'payload',
      'review_text',
      'private_feedback',
    ]) {
      expect(migration).not.toContain(`"${prohibited}"`)
    }
  })

  it('expires the privacy fence only after the retained delivery/replay window', () => {
    expect(retentionSweep).toContain(
      "subject: 'recent_activity_actor_label_redactions.expired'",
    )
    expect(retentionSweep).toContain("table: 'recent_activity_actor_label_redactions'")
    expect(retentionSweep).toContain(
      "keyColumns: ['organization_id', 'actor_subject_id']",
    )
    expect(retentionSweep).toContain("tsColumn: 'expires_at'")
  })

  it('owns the deterministic journal slot after the Review snapshot migration', () => {
    const previous = journal.entries.find(({ idx }) => idx === 154)
    const current = journal.entries.find(({ idx }) => idx === 155)
    expect(current).toMatchObject({
      idx: 155,
      when: 1790352000026,
      tag: '0155_recent_activity_actor_redaction',
    })
    expect(current!.when).toBeGreaterThan(previous!.when)
  })
})
