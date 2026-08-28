// LIF-01-T12/T13/T14 — Badge lifecycle contribution contract.
//
// Badge is dark (`badge.use` is `legacy_blocked`), so these tests pin two
// things at once: that the three phases give a real answer over the Recognition
// rows an Organization already accumulated, and that answering never reopens
// the capability or reaches the global badge catalogue.

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
import { buildBadgeContext } from '../../build'
import {
  createBadgeOrganizationLifecycleContributor,
  badgePrepareClosing,
  badgePurge,
  badgeVerifyPurgeReadiness,
  BADGE_LIFECYCLE_APPEND_ONLY_GUARDS,
  BADGE_LIFECYCLE_TABLES,
} from './badge-organization-lifecycle.adapter'

const ORGANIZATION_ID = 'org-badge-lifecycle'
const LINEAGE = '6e3f7d9c-4a5b-4c7d-8e9f-0a1b2c3d4e5f'
const RECOVERABLE_UNTIL = new Date('2026-09-28T00:00:00.000Z')
const OCCURRED_AT = new Date('2026-08-28T00:00:00.000Z')

/**
 * Purge safety pin: the capability fate authority decides that Badge stays
 * dark. Update this digest only alongside a reviewed capability decision —
 * never to make a lifecycle test pass.
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

describe('Badge Organization lifecycle contribution', () => {
  it('keeps Badge dark: no key reaches its public API and the fate authority is untouched', () => {
    // The contributor must not add a key to any tenant-reachable surface;
    // the coordinator is the only consumer and composition constructs it
    // directly, exactly as Identity's own contributor is constructed.
    expect(Object.keys(buildBadgeContext().publicApi)).toEqual([])
    expect(Object.keys(buildBadgeContext().internal.repos)).toEqual([])
    expect(Object.keys(buildBadgeContext().internal.useCases)).toEqual([])

    const fate = readFileSync(
      join(process.cwd(), 'src/shared/governance/capability-fate.ts'),
    )
    expect(createHash('sha256').update(fate).digest('hex')).toBe(CAPABILITY_FATE_SHA256)
  })

  it('names the exact reviewed Badge tables in FK-safe delete order', () => {
    expect(BADGE_LIFECYCLE_TABLES).toEqual([
      'recognition_award_status_facts',
      'recognition_awards',
      'badge_awards',
      'organization_badge_enablements',
    ])
    // The definition catalogue is one global, RepKey-authored table with no
    // organization column: one tenant's closure must never touch it.
    expect(BADGE_LIFECYCLE_TABLES).not.toContain('badge_definitions')
    expect(BADGE_LIFECYCLE_TABLES).not.toContain('badge_definition_versions')
    // The board surface belongs to Leaderboard's contributor.
    expect(BADGE_LIFECYCLE_TABLES).not.toContain('recognition_board_snapshots')
    expect(BADGE_LIFECYCLE_TABLES).not.toContain('recognition_activations')
  })

  it('prepares closing without issuing a single mutating statement', async () => {
    const { tx, executed } = createFakeTx([6])
    await expect(badgePrepareClosing(tx, request())).resolves.toEqual({
      outcome: 'complete',
      evidenceRef: 'badge:closing:complete:6',
    })
    expect(executed).toHaveLength(1)
    for (const statement of executed) expect(statement).not.toMatch(MUTATING)
  })

  it('answers an empty Organization with affirmative no_data rather than silence', async () => {
    const { tx } = createFakeTx([0])
    await expect(badgePrepareClosing(tx, request())).resolves.toEqual({
      outcome: 'no_data',
      evidenceRef: 'badge:closing:no_data:0',
    })
  })

  it('verifies purge readiness read-only and fails closed on an unpublished fact', async () => {
    const ready = createFakeTx([0, 3])
    await expect(badgeVerifyPurgeReadiness(ready.tx, request())).resolves.toEqual({
      outcome: 'complete',
      evidenceRef: 'badge:purge_readiness:complete:3',
    })
    for (const statement of ready.executed) expect(statement).not.toMatch(MUTATING)

    const blocked = createFakeTx([2])
    await expect(badgeVerifyPurgeReadiness(blocked.tx, request())).rejects.toThrow(
      'Badge purge readiness blocked: unpublished_badge_outbox_events',
    )
    expect(blocked.executed).toHaveLength(1)
  })

  it('purges exactly the planned tables, in order, scoped to the tenant', async () => {
    const { tx, executed } = createFakeTx([1, 2, 3, 4])
    await expect(badgePurge(tx, request())).resolves.toEqual({
      outcome: 'complete',
      evidenceRef: 'badge:purge:complete:10',
    })
    expect(executed).toHaveLength(BADGE_LIFECYCLE_TABLES.length)
    executed.forEach((statement, position) => {
      expect(statement).toMatch(/DELETE FROM/u)
      expect(statement).toContain(BADGE_LIFECYCLE_TABLES[position]!)
      expect(statement).toContain(ORGANIZATION_ID)
      expect(statement).not.toMatch(/DROP|TRUNCATE/iu)
    })
  })

  it('lifts each append-only guard only for the purge, and always restores it', async () => {
    const { tx, guards } = createFakeTx([1, 1, 1, 1])
    await badgePurge(tx, request())

    expect(guards).toHaveLength(BADGE_LIFECYCLE_APPEND_ONLY_GUARDS.length * 2)
    for (const trigger of BADGE_LIFECYCLE_APPEND_ONLY_GUARDS) {
      expect(guards.filter((statement) => statement.includes(trigger))).toHaveLength(2)
    }
    expect(guards.slice(0, 2).every((statement) => statement.includes('DISABLE'))).toBe(
      true,
    )
    expect(guards.slice(2).every((statement) => statement.includes('ENABLE'))).toBe(true)
    // The guard is never touched by a non-destructive phase.
    const closing = createFakeTx([1])
    await badgePrepareClosing(closing.tx, request())
    expect(closing.guards).toEqual([])
    const readiness = createFakeTx([0, 1])
    await badgeVerifyPurgeReadiness(readiness.tx, request())
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
        if (calls === 2) throw new Error('foreign key still referenced')
        return { rows: [{ count: 1 }] }
      }),
    } as unknown as Tx

    await expect(badgePurge(tx, request())).rejects.toThrow(
      'foreign key still referenced',
    )
    expect(guards.filter((statement) => statement.includes('ENABLE'))).toHaveLength(
      BADGE_LIFECYCLE_APPEND_ONLY_GUARDS.length,
    )
  })

  it('is idempotent for one lineage and revision: a replay re-runs no delete', async () => {
    const { db, receipts, executed } = createFakeDb({
      state: 'purging',
      counts: [1, 1, 0, 1],
    })
    const contributor = createBadgeOrganizationLifecycleContributor(db)

    const first = await contributor.purge(request())
    const replay = await contributor.purge(request())

    expect(replay).toEqual(first)
    expect(receipts).toHaveLength(1)
    expect(executed).toHaveLength(BADGE_LIFECYCLE_TABLES.length)
  })

  it('persists a content-free receipt carrying only context, phase, outcome and a count', async () => {
    const { db, receipts } = createFakeDb({ state: 'closure_requested', counts: [8] })
    const contributor = createBadgeOrganizationLifecycleContributor(db)

    await contributor.prepareClosing(request())

    const receipt = receipts[0]!
    expect(receipt).toMatchObject({
      context: 'badge',
      phase: 'closing',
      outcome: 'complete',
      evidenceRef: 'badge:closing:complete:8',
    })
    expect(validateContentFreeEvidenceRef(String(receipt.evidenceRef))).toBe(
      'badge:closing:complete:8',
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

  it('binds every phase to the Badge context of the coordinator contract', () => {
    const { db } = createFakeDb({ state: 'closing', counts: [] })
    expect(createBadgeOrganizationLifecycleContributor(db).context).toBe('badge')
  })
})
