// LIF-01 bullet 12 — the shape and safety properties of the three legacy
// reconciliation inventories, proven without a database by observing exactly
// what they ask PostgreSQL to do.

import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { BUILT_IN_ROLE_SCOPE } from '#/shared/auth/resolve-permissions'
import {
  BUILT_IN_ROLE_NAMES,
  readLegacyCustomRoleInventory,
  readLegacyGuestCompatibilityInventory,
  readLegacyMultiOrganizationInventory,
} from './legacy-reconciliation-inventories'

const AS_OF = new Date('2026-08-28T00:00:00.000Z')

type Executed = { sql: string; params: readonly unknown[] }

/**
 * A database stand-in that records the exact SQL each inventory issues. The
 * point is not to fake results — it is to hold the read-only claim to account:
 * a write would show up here as a statement, not as a silent side effect.
 */
function recordingDb(counts: readonly number[]): {
  db: Database
  executed: Executed[]
} {
  const executed: Executed[] = []
  let index = 0
  const db = {
    execute: vi.fn(async (query: { queryChunks?: unknown }) => {
      const rendered = JSON.stringify(query)
      executed.push({ sql: rendered, params: [] })
      const count = counts[index] ?? 0
      index += 1
      return { rows: [{ count }], rowCount: 1 }
    }),
  } as unknown as Database
  return { db, executed }
}

const WRITE_KEYWORDS = [
  'DELETE',
  'UPDATE',
  'INSERT',
  'TRUNCATE',
  'DROP',
  'ALTER',
  'CREATE',
]

const inventories = [
  ['custom roles', readLegacyCustomRoleInventory, 5],
  ['multi-organization', readLegacyMultiOrganizationInventory, 2],
  ['legacy guest compatibility', readLegacyGuestCompatibilityInventory, 9],
] as const

describe('legacy reconciliation inventories', () => {
  it('derives the built-in role set from the permission authority', () => {
    expect(BUILT_IN_ROLE_NAMES).toEqual(Object.keys(BUILT_IN_ROLE_SCOPE).sort())
    expect(BUILT_IN_ROLE_NAMES.length).toBeGreaterThan(0)
  })

  it.each(inventories)(
    '%s issues only counting reads and never a write',
    async (_name, read, expectedQueries) => {
      const { db, executed } = recordingDb(Array.from({ length: 12 }, () => 0))

      await read(db, AS_OF)

      expect(executed).toHaveLength(expectedQueries)
      for (const { sql } of executed) {
        expect(sql).toContain('count(')
        for (const keyword of WRITE_KEYWORDS) {
          expect(sql, `${keyword} in a read-only inventory`).not.toContain(keyword)
        }
      }
    },
  )

  it.each(inventories)(
    '%s reports non-mutating and content-free',
    async (_name, read) => {
      const { db } = recordingDb(Array.from({ length: 12 }, (_value, i) => i))

      const report = await read(db, AS_OF)

      expect(report.mutation).toBe('none')
      expect(report.findings.length).toBeGreaterThan(0)
      for (const finding of report.findings) {
        expect(Number.isInteger(finding.count)).toBe(true)
        expect(finding.meaning.length).toBeGreaterThan(0)
        expect(finding.remediation.length).toBeGreaterThan(0)
      }
      expect(report.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    },
  )

  it('blocks migration when a member still holds a custom role', async () => {
    // Finding order in the source is: members_holding_custom_role,
    // pending_invitations_on_custom_role, definitions_without_policy,
    // orphan_role_policies, custom_role_definitions.
    const { db } = recordingDb([1, 0, 0, 0, 4])

    const report = await readLegacyCustomRoleInventory(db, AS_OF)

    expect(report.blocksMigration).toBe(true)
    expect(report.blockingFindingIds).toEqual(['members_holding_custom_role'])
  })

  it('does not block migration on dormant custom role definitions alone', async () => {
    const { db } = recordingDb([0, 0, 2, 3, 40])

    const report = await readLegacyCustomRoleInventory(db, AS_OF)

    // §3.1.3 explicitly allows the dormant schema to remain.
    expect(report.blocksMigration).toBe(false)
    expect(
      report.findings.find(({ id }) => id === 'custom_role_definitions')?.severity,
    ).toBe('informational')
  })

  it('blocks migration when a user has multiple Better Auth memberships', async () => {
    // Order: users_with_multiple_memberships, then conflicting invitations.
    const { db } = recordingDb([2, 0])

    const report = await readLegacyMultiOrganizationInventory(db, AS_OF)

    expect(report.blockingFindingIds).toEqual(['users_with_multiple_memberships'])
  })

  it('treats every legacy Guest finding as reconcilable rather than blocking', async () => {
    const { db } = recordingDb([9, 9, 9, 9, 9, 9, 9, 9, 9])

    const report = await readLegacyGuestCompatibilityInventory(db, AS_OF)

    // The mirrors cannot be contracted before one verified release plus a
    // restore proof, so nothing here can legitimately block a migration — it
    // can only require a recorded decision.
    expect(report.blocksMigration).toBe(false)
    expect(report.findings.every(({ severity }) => severity !== 'blocks_migration')).toBe(
      true,
    )
  })

  it('surfaces correlation loss as its own finding', async () => {
    const { db } = recordingDb([9, 9, 9, 9, 9, 9, 9, 9, 9])

    const report = await readLegacyGuestCompatibilityInventory(db, AS_OF)

    const ids = report.findings.map(({ id }) => id)
    expect(ids).toContain('ratings_without_correlatable_session')
    expect(ids).toContain('feedback_without_correlatable_session')
    // The 24-hour session-binding expiry is what makes this urgent; the
    // remediation must say so rather than proposing re-identification.
    const rating = report.findings.find(
      ({ id }) => id === 'ratings_without_canonical_response',
    )
    expect(rating?.remediation).toMatch(/24 hours/)
  })
})
