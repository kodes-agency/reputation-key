import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { reviewLifecycleRecoveryExecutions } from './schema/recovery.schema'

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/0150_review_lifecycle_recovery_execution.sql'),
  'utf8',
)
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; when: number; tag: string }> }

describe('0150 Review lifecycle recovery execution', () => {
  it('persists only the exact approval target, aggregate evidence, and progress', () => {
    const columns = getTableConfig(reviewLifecycleRecoveryExecutions).columns.map(
      (column) => column.name,
    )
    expect(columns).toEqual(
      expect.arrayContaining([
        'recovery_generation',
        'approval_id',
        'approval_bundle_sha256',
        'release_manifest_sha256',
        'restore_database_service_name',
        'policy_sha256',
        'report_sha256',
        'report_expired',
        'checkpoint_created_at',
        'checkpoint_review_id',
        'rows_redacted',
      ]),
    )
    for (const prohibited of [
      'review_id',
      'organization_id',
      'property_id',
      'rating',
      'review_text',
      'reply_text',
      'provider_payload',
    ]) {
      expect(columns).not.toContain(prohibited)
    }
    expect(migration).not.toMatch(/INSERT INTO\s+"review_lifecycle_recovery_executions"/u)
  })

  it('makes the signed binding immutable while allowing only forward progress', () => {
    expect(migration).toContain('guard_review_lifecycle_recovery_execution_v1')
    expect(migration).toContain('review_lifecycle_recovery_executions_mutation_guard')
    expect(migration).toContain('review_lifecycle_recovery_executions_truncate_guard')
    expect(migration).toContain('OLD."state" = \'applying\'')
    expect(migration).toContain('NEW."state" = \'lifecycle_applied\'')
    expect(migration).toContain('NEW."state" = \'completed\'')
    expect(migration).toContain('NEW."scanned" > OLD."scanned" + 100')
    expect(migration).toContain(
      'ROW(NEW."checkpoint_created_at", NEW."checkpoint_review_id")',
    )
    expect(migration).toContain('FROM "recovery_runs"')
    expect(migration).toContain(
      'Review lifecycle recovery completion has no exact recovery run',
    )
    expect(migration).toContain('ENABLE ALWAYS TRIGGER')
  })

  it('owns the next deterministic monotonic journal slot', () => {
    const previous = journal.entries.find(({ idx }) => idx === 149)
    const current = journal.entries.find(({ idx }) => idx === 150)
    expect(current).toMatchObject({
      idx: 150,
      when: 1790352000021,
      tag: '0150_review_lifecycle_recovery_execution',
    })
    expect(current!.when).toBeGreaterThan(previous!.when)
  })
})
