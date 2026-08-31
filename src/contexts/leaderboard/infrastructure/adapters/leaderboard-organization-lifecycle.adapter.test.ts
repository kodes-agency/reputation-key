// LIF-01-T12/T13/T14 — Leaderboard/Recognition lifecycle contribution contract.
//
// Leaderboard is dark (`leaderboard.use` is `legacy_blocked`), so these tests
// pin the affirmative three-phase answer over its retained board rows together
// with the guarantee that answering never reopens the capability. They also pin
// the one scoping subtlety in this context: `leaderboard_snapshots` predates
// tenant columns and must be bound to the Organization indirectly.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { contextOrganizationLifecycleReceipts } from '#/shared/db/schema/context-organization-lifecycle-receipts.schema'
import { organizationLifecycleAuthority } from '#/shared/db/schema/organization-lifecycle.schema'
import { validateContentFreeEvidenceRef } from '#/shared/db/lifecycle/organization-lifecycle-receipt-store'
import type { OrganizationLifecycleContributionRequest } from '#/shared/db/lifecycle/organization-lifecycle-receipt-store'
import type { Tx } from '#/shared/outbox/commit'
import { buildLeaderboardContext } from '../../build'
import {
  createLeaderboardOrganizationLifecycleContributor,
  leaderboardPrepareClosing,
  leaderboardPurge,
  leaderboardVerifyPurgeReadiness,
  LEADERBOARD_LIFECYCLE_APPEND_ONLY_GUARDS,
  LEADERBOARD_LIFECYCLE_TABLES,
} from './leaderboard-organization-lifecycle.adapter'

const ORGANIZATION_ID = 'org-leaderboard-lifecycle'
const LINEAGE = '7f4a8e0d-5b6c-4d8e-9f0a-1b2c3d4e5f6a'
const RECOVERABLE_UNTIL = new Date('2026-09-28T00:00:00.000Z')
const OCCURRED_AT = new Date('2026-08-28T00:00:00.000Z')

/**
 * Purge safety pin: the capability fate authority decides that Leaderboard
 * stays dark. Update this digest only alongside a reviewed capability decision
 * — never to make a lifecycle test pass.
 */
const CAPABILITY_FATE_SHA256 =
  '86551d62c063f175361854f09629bc63716a6352646419389b6bfb0a55647f36'

const request = (
  overrides: Partial<OrganizationLifecycleContributionRequest> = {},
): OrganizationLifecycleContributionRequest => ({
  organizationId: ORGANIZATION_ID,
  closureLineageId: LINEAGE,
  lifecycleRevision: 2,
  recoverableUntil: RECOVERABLE_UNTIL,
  occurredAt: OCCURRED_AT,
  ...overrides,
})

const render = (query: SQL): string => JSON.stringify(query.queryChunks)

const MUTATING = /DELETE\s+FROM|UPDATE\s|INSERT\s+INTO|TRUNCATE|DROP\s/iu

const createFakeTx = (counts: readonly number[]) => {
  const executed: string[] = []
  const guards: string[] = []
  let index = 0
  const tx = {
    execute: vi.fn(async (query: SQL) => {
      const text = render(query)
      if (text.includes('ALTER TABLE')) {
        guards.push(text)
        return { rows: [] }
      }
      executed.push(text)
      if (text.includes('pg_advisory_xact_lock')) return { rows: [] }
      const count = counts[index++] ?? 0
      return { rows: [{ count }] }
    }),
  }
  return { tx: tx as unknown as Tx, executed, guards }
}

const createFakeDb = (options: {
  state: string
  counts: readonly number[]
  receipts?: Array<Record<string, unknown>>
}) => {
  const receipts = options.receipts ?? []
  const executed: string[] = []
  let index = 0
  const authorityRow = {
    state: options.state,
    revision: 2,
    closureLineageId: LINEAGE,
    recoverableUntil: RECOVERABLE_UNTIL,
    lastTransitionAt: new Date('2026-08-27T00:00:00.000Z'),
  }
  const transaction = vi.fn(async (fn: (tx: Tx) => Promise<unknown>) => {
    const tx = {
      execute: vi.fn(async (query: SQL) => {
        const text = render(query)
        if (text.includes('pg_advisory_xact_lock') || text.includes('ALTER TABLE')) {
          return { rows: [] }
        }
        executed.push(text)
        const count = options.counts[index++] ?? 0
        return { rows: [{ count }] }
      }),
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => ({
          where: vi.fn(() => {
            const rows =
              table === organizationLifecycleAuthority ? [authorityRow] : receipts
            const limit = () => {
              const promise = Promise.resolve(rows) as Promise<unknown[]> & {
                for?: () => Promise<unknown[]>
              }
              promise.for = () => Promise.resolve(rows)
              return promise
            }
            return { limit: vi.fn(limit) }
          }),
        })),
      })),
      insert: vi.fn((table: unknown) => ({
        values: vi.fn(async (row: Record<string, unknown>) => {
          if (table === contextOrganizationLifecycleReceipts) receipts.push(row)
        }),
      })),
    }
    return fn(tx as unknown as Tx)
  })
  return { db: { transaction } as unknown as Database, receipts, executed }
}

describe('Leaderboard Organization lifecycle contribution', () => {
  it('keeps Leaderboard dark: no key reaches its public API and the fate authority is untouched', () => {
    // The contributor must not add a key to any tenant-reachable surface;
    // the coordinator is the only consumer and composition constructs it
    // directly, exactly as Identity's own contributor is constructed.
    expect(Object.keys(buildLeaderboardContext().publicApi)).toEqual([])
    expect(Object.keys(buildLeaderboardContext().internal.repos)).toEqual([])
    expect(Object.keys(buildLeaderboardContext().internal.useCases)).toEqual([])

    const fate = readFileSync(
      join(process.cwd(), 'src/shared/governance/capability-fate.ts'),
    )
    expect(createHash('sha256').update(fate).digest('hex')).toBe(CAPABILITY_FATE_SHA256)
  })

  it('names the exact reviewed Leaderboard tables in FK-safe delete order', () => {
    expect(LEADERBOARD_LIFECYCLE_TABLES).toEqual([
      'leaderboard_snapshots',
      'leaderboard_entries',
      'recognition_reconciliation_events',
      'recognition_board_entries',
      'recognition_board_snapshots',
      'recognition_activation_groups',
      'recognition_activations',
    ])
    // Badge owns the award record that references the board snapshot; the
    // metric catalogue and Portal Groups are foreign and not tenant content.
    expect(LEADERBOARD_LIFECYCLE_TABLES).not.toContain('recognition_awards')
    expect(LEADERBOARD_LIFECYCLE_TABLES).not.toContain('recognition_award_status_facts')
    expect(LEADERBOARD_LIFECYCLE_TABLES).not.toContain('metric_definition_versions')
    expect(LEADERBOARD_LIFECYCLE_TABLES).not.toContain('portal_groups')
  })

  it('binds the tenant-column-less legacy snapshot table through Property and its own entries', async () => {
    const { tx, executed } = createFakeTx([0, 0, 0, 0, 0, 0, 0])
    await leaderboardPurge(tx, request())

    const snapshotStatement = executed[0]!
    expect(snapshotStatement).toContain('leaderboard_snapshots')
    expect(snapshotStatement).toContain('SELECT id FROM properties WHERE organization_id')
    expect(snapshotStatement).toContain('SELECT snapshot_id FROM leaderboard_entries')
    expect(snapshotStatement).toContain(ORGANIZATION_ID)
  })

  it('prepares closing without issuing a single mutating statement', async () => {
    const { tx, executed } = createFakeTx([12])
    await expect(leaderboardPrepareClosing(tx, request())).resolves.toEqual({
      outcome: 'complete',
      evidenceRef: 'leaderboard:closing:complete:12',
    })
    expect(executed).toHaveLength(1)
    for (const statement of executed) expect(statement).not.toMatch(MUTATING)
  })

  it('answers an empty Organization with affirmative no_data rather than silence', async () => {
    const { tx } = createFakeTx([0])
    await expect(leaderboardPrepareClosing(tx, request())).resolves.toEqual({
      outcome: 'no_data',
      evidenceRef: 'leaderboard:closing:no_data:0',
    })
  })

  it('verifies purge readiness read-only and fails closed on an unpublished fact', async () => {
    const ready = createFakeTx([0, 5])
    await expect(leaderboardVerifyPurgeReadiness(ready.tx, request())).resolves.toEqual({
      outcome: 'complete',
      evidenceRef: 'leaderboard:purge_readiness:complete:5',
    })
    for (const statement of ready.executed) expect(statement).not.toMatch(MUTATING)

    const blocked = createFakeTx([3])
    await expect(leaderboardVerifyPurgeReadiness(blocked.tx, request())).rejects.toThrow(
      'Leaderboard purge readiness blocked: unpublished_recognition_outbox_events',
    )
    expect(blocked.executed).toHaveLength(1)
  })

  it('purges exactly the planned tables, in order, scoped to the tenant', async () => {
    const { tx, executed } = createFakeTx([1, 0, 2, 3, 1, 1, 1])
    await expect(leaderboardPurge(tx, request())).resolves.toEqual({
      outcome: 'complete',
      evidenceRef: 'leaderboard:purge:complete:9',
    })
    expect(executed).toHaveLength(LEADERBOARD_LIFECYCLE_TABLES.length)
    executed.forEach((statement, position) => {
      expect(statement).toMatch(/DELETE FROM/u)
      expect(statement).toContain(LEADERBOARD_LIFECYCLE_TABLES[position]!)
      expect(statement).toContain(ORGANIZATION_ID)
      expect(statement).not.toMatch(/DROP|TRUNCATE/iu)
    })
  })

  it('lifts each append-only guard only for the purge, and always restores it', async () => {
    const { tx, guards } = createFakeTx([1, 1, 1, 1, 1, 1, 1])
    await leaderboardPurge(tx, request())

    const disables = guards.filter((statement) => statement.includes('DISABLE'))
    const enables = guards.filter((statement) => statement.includes('ENABLE'))
    expect(disables).toHaveLength(LEADERBOARD_LIFECYCLE_APPEND_ONLY_GUARDS.length)
    expect(enables).toHaveLength(LEADERBOARD_LIFECYCLE_APPEND_ONLY_GUARDS.length)
    for (const trigger of LEADERBOARD_LIFECYCLE_APPEND_ONLY_GUARDS) {
      expect(guards.filter((statement) => statement.includes(trigger))).toHaveLength(2)
    }
    // The guard is never touched by a non-destructive phase.
    const closing = createFakeTx([1])
    await leaderboardPrepareClosing(closing.tx, request())
    expect(closing.guards).toEqual([])
    const readiness = createFakeTx([0, 1])
    await leaderboardVerifyPurgeReadiness(readiness.tx, request())
    expect(readiness.guards).toEqual([])
  })

  it('restores every append-only guard even when the purge fails midway', async () => {
    const guards: string[] = []
    let calls = 0
    const tx = {
      execute: vi.fn(async (query: SQL) => {
        const text = render(query)
        if (text.includes('ALTER TABLE')) {
          guards.push(text)
          return { rows: [] }
        }
        calls += 1
        if (calls === 3) throw new Error('foreign key still referenced')
        return { rows: [{ count: 1 }] }
      }),
    } as unknown as Tx

    await expect(leaderboardPurge(tx, request())).rejects.toThrow(
      'foreign key still referenced',
    )
    expect(guards.filter((statement) => statement.includes('ENABLE'))).toHaveLength(
      LEADERBOARD_LIFECYCLE_APPEND_ONLY_GUARDS.length,
    )
  })

  it('is idempotent for one lineage and revision: a replay re-runs no delete', async () => {
    const { db, receipts, executed } = createFakeDb({
      state: 'purging',
      counts: [1, 0, 0, 1, 1, 0, 1],
    })
    const contributor = createLeaderboardOrganizationLifecycleContributor(db)

    const first = await contributor.purge(request())
    const replay = await contributor.purge(request())

    expect(replay).toEqual(first)
    expect(receipts).toHaveLength(1)
    expect(executed).toHaveLength(LEADERBOARD_LIFECYCLE_TABLES.length)
  })

  it('persists a content-free receipt carrying only context, phase, outcome and a count', async () => {
    const { db, receipts } = createFakeDb({ state: 'closure_requested', counts: [0] })
    const contributor = createLeaderboardOrganizationLifecycleContributor(db)

    await contributor.prepareClosing(request())

    const receipt = receipts[0]!
    expect(receipt).toMatchObject({
      context: 'leaderboard',
      phase: 'closing',
      outcome: 'no_data',
      evidenceRef: 'leaderboard:closing:no_data:0',
    })
    expect(validateContentFreeEvidenceRef(String(receipt.evidenceRef))).toBe(
      'leaderboard:closing:no_data:0',
    )
    expect(Object.keys(receipt).sort()).toEqual([
      'closureLineageId',
      'context',
      'createdAt',
      'evidenceRef',
      'lifecycleRevision',
      'occurredAt',
      'organizationId',
      'outcome',
      'phase',
      'recoverableUntil',
      'requestFingerprint',
    ])
  })

  it('binds every phase to the Leaderboard context of the coordinator contract', () => {
    const { db } = createFakeDb({ state: 'closing', counts: [] })
    expect(createLeaderboardOrganizationLifecycleContributor(db).context).toBe(
      'leaderboard',
    )
  })
})
