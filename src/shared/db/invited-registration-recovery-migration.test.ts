import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/0138_invited_registration_recovery.sql'),
  'utf8',
)
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
) as {
  entries: ReadonlyArray<Readonly<{ idx: number; when: number; tag: string }>>
}

describe('0138 invited registration recovery migration', () => {
  it('creates one content-free recovery authority with exact identity fences', () => {
    expect(migration).toContain('CREATE TABLE "invited_registration_attempts"')
    expect(migration).toContain('"expected_user_id" text NOT NULL')
    expect(migration).toContain('"expected_credential_account_id" text NOT NULL')
    expect(migration).toContain('"expected_initial_session_id" text NOT NULL')
    expect(migration).not.toMatch(/"(?:email|name|password|token)"/u)
  })

  it('pins unresolved uniqueness, due claims, leases, and terminal shapes', () => {
    expect(migration).toContain('"invited_registration_one_unresolved_per_invitation"')
    expect(migration).toContain('"invited_registration_recovery_due_idx"')
    expect(migration).toContain('"invited_registration_lease_pair"')
    expect(migration).toContain('"invited_registration_terminal_shape"')
    expect(migration).toContain("IN ('prepared', 'manual_review')")
    expect(migration).toContain(
      "IN ('prepared', 'accepted', 'compensated', 'manual_review')",
    )
  })

  it('follows the frozen AI migration in one monotonic journal slot', () => {
    const previousIndex = journal.entries.findIndex((entry) => entry.idx === 137)
    const currentIndex = journal.entries.findIndex((entry) => entry.idx === 138)
    const previous = journal.entries[previousIndex]
    const current = journal.entries[currentIndex]
    expect(currentIndex).toBe(previousIndex + 1)
    expect(previous).toMatchObject({
      idx: 137,
      tag: '0137_ai_review_analysis_enrollment',
    })
    expect(current).toMatchObject({
      idx: 138,
      tag: '0138_invited_registration_recovery',
    })
    expect(current!.when).toBeGreaterThan(previous!.when)
  })
})
