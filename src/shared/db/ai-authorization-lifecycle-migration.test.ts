import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'drizzle/0145_ai_authorization_lifecycle.sql'),
  'utf8',
)
const journal = JSON.parse(
  readFileSync(join(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; when: number; tag: string }> }
const previousSnapshot = JSON.parse(
  readFileSync(join(process.cwd(), 'drizzle/meta/0144_snapshot.json'), 'utf8'),
) as { id: string }
const snapshot = JSON.parse(
  readFileSync(join(process.cwd(), 'drizzle/meta/0145_snapshot.json'), 'utf8'),
) as {
  prevId: string
  tables: Record<string, unknown>
}

describe('0145 AI authorization lifecycle migration', () => {
  it('owns the reserved migration slot', () => {
    expect(journal.entries.find((entry) => entry.idx === 145)).toEqual(
      expect.objectContaining({
        tag: '0145_ai_authorization_lifecycle',
      }),
    )
    expect(snapshot.prevId).toBe(previousSnapshot.id)
    expect(snapshot.tables).toHaveProperty('public.ai_authorization_lifecycle_records')
  })

  it('stores a durable claim, retry, and class-separated completion fence', () => {
    for (const column of [
      'erasure_attempt_count',
      'erasure_next_attempt_at',
      'erasure_claimed_at',
      'erasure_lease_owner',
      'erasure_lease_expires_at',
      'erasure_last_failure_at',
      'erased_review_analysis_count',
      'erased_property_aggregate_count',
      'erased_property_trend_count',
    ]) {
      expect(migration).toContain(`"${column}"`)
    }
    expect(migration).toContain("'in_progress'")
    expect(migration).toContain('ai_authorization_lifecycle_erasure_lease_idx')
    expect(migration).toContain('ai_authorization_lifecycle_erasure_due_idx')
  })

  it('makes newly seeded retirement work immediately eligible while preserving 24h', () => {
    expect(migration).toContain(
      'THEN current_auth."updated_at" + interval \'24 hours\' END',
    )
    expect(migration).toContain('"erasure_next_attempt_at"')
    expect(migration).toMatch(
      /THEN current_auth\."updated_at" END,[\s\S]*current_auth\."updated_at", current_auth\."updated_at"/,
    )
  })
})
