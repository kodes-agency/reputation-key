// LIF-01-T12/T13/T14 — Team lifecycle contribution contract.
//
// Team is dark (`team.use` is DISABLED), which changes what the phases DO but
// not that they answer. These tests pin both halves: the affirmative three-phase
// answer over retained quarantine rows, and the guarantee that answering never
// lights the capability back up.

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
import { buildTeamContext } from '../../build'
import {
  createTeamOrganizationLifecycleContributor,
  teamPrepareClosing,
  teamPurge,
  teamVerifyPurgeReadiness,
  TEAM_LIFECYCLE_TABLES,
} from './team-organization-lifecycle.adapter'

const ORGANIZATION_ID = 'org-team-lifecycle'
const LINEAGE = '5d2e6c8b-3f4a-4b6c-9d7e-8f9a0b1c2d3e'
const RECOVERABLE_UNTIL = new Date('2026-09-28T00:00:00.000Z')
const OCCURRED_AT = new Date('2026-08-28T00:00:00.000Z')

/**
 * Purge safety pin: the capability fate authority decides that Team stays dark.
 * A lifecycle contributor must never be the reason that file moves, so its exact
 * bytes are pinned here. Update this digest only alongside a reviewed capability
 * decision — never to make a lifecycle test pass.
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
  let index = 0
  const tx = {
    execute: vi.fn(async (query: SQL) => {
      const text = render(query)
      executed.push(text)
      if (text.includes('pg_advisory_xact_lock')) return { rows: [] }
      const count = counts[index++] ?? 0
      return { rows: [{ count }] }
    }),
  }
  return { tx: tx as unknown as Tx, executed }
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
        if (text.includes('pg_advisory_xact_lock')) return { rows: [] }
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

describe('Team Organization lifecycle contribution', () => {
  it('keeps Team dark: no key reaches its public API and the fate authority is untouched', () => {
    // The contributor must not add a key to any tenant-reachable surface;
    // the coordinator is the only consumer and composition constructs it
    // directly, exactly as Identity's own contributor is constructed.
    expect(Object.keys(buildTeamContext().publicApi)).toEqual([])
    expect(Object.keys(buildTeamContext().internal.repos)).toEqual([])
    expect(Object.keys(buildTeamContext().internal.useCases)).toEqual([])

    const fate = readFileSync(
      join(process.cwd(), 'src/shared/governance/capability-fate.ts'),
    )
    expect(createHash('sha256').update(fate).digest('hex')).toBe(CAPABILITY_FATE_SHA256)
  })

  it('names the exact reviewed Team tables in FK-safe delete order', () => {
    expect(TEAM_LIFECYCLE_TABLES).toEqual([
      'team_memberships',
      'team_portal_group_scopes',
      'teams',
    ])
    // Staff owns the people record `team_memberships` points at; Team only
    // releases its own side of the link.
    expect(TEAM_LIFECYCLE_TABLES).not.toContain('staff_participations')
    expect(TEAM_LIFECYCLE_TABLES).not.toContain('staff_participants')
  })

  it('prepares closing without issuing a single mutating statement', async () => {
    const { tx, executed } = createFakeTx([9])
    await expect(teamPrepareClosing(tx, request())).resolves.toEqual({
      outcome: 'complete',
      evidenceRef: 'team:closing:complete:9',
    })
    expect(executed).toHaveLength(1)
    for (const statement of executed) expect(statement).not.toMatch(MUTATING)
  })

  it('answers an empty Organization with affirmative no_data rather than silence', async () => {
    const { tx } = createFakeTx([0])
    await expect(teamPrepareClosing(tx, request())).resolves.toEqual({
      outcome: 'no_data',
      evidenceRef: 'team:closing:no_data:0',
    })
  })

  it('verifies purge readiness read-only and fails closed on an unpublished fact', async () => {
    const ready = createFakeTx([0, 2])
    await expect(teamVerifyPurgeReadiness(ready.tx, request())).resolves.toEqual({
      outcome: 'complete',
      evidenceRef: 'team:purge_readiness:complete:2',
    })
    for (const statement of ready.executed) expect(statement).not.toMatch(MUTATING)

    const blocked = createFakeTx([1])
    await expect(teamVerifyPurgeReadiness(blocked.tx, request())).rejects.toThrow(
      'Team purge readiness blocked: unpublished_team_outbox_events',
    )
    expect(blocked.executed).toHaveLength(1)
  })

  it('purges exactly the planned tables, in order, scoped to the tenant', async () => {
    const { tx, executed } = createFakeTx([4, 3, 2])
    await expect(teamPurge(tx, request())).resolves.toEqual({
      outcome: 'complete',
      evidenceRef: 'team:purge:complete:9',
    })
    expect(executed).toHaveLength(TEAM_LIFECYCLE_TABLES.length)
    executed.forEach((statement, position) => {
      expect(statement).toMatch(/DELETE FROM/u)
      expect(statement).toContain(TEAM_LIFECYCLE_TABLES[position]!)
      expect(statement).toContain(ORGANIZATION_ID)
      expect(statement).not.toMatch(/DROP|TRUNCATE/iu)
    })
  })

  it('is idempotent for one lineage and revision: a replay re-runs no delete', async () => {
    const { db, receipts, executed } = createFakeDb({
      state: 'purging',
      counts: [2, 0, 1],
    })
    const contributor = createTeamOrganizationLifecycleContributor(db)

    const first = await contributor.purge(request())
    const replay = await contributor.purge(request())

    expect(replay).toEqual(first)
    expect(receipts).toHaveLength(1)
    expect(executed).toHaveLength(TEAM_LIFECYCLE_TABLES.length)
  })

  it('persists a content-free receipt carrying only context, phase, outcome and a count', async () => {
    const { db, receipts } = createFakeDb({ state: 'closure_requested', counts: [0] })
    const contributor = createTeamOrganizationLifecycleContributor(db)

    await contributor.prepareClosing(request())

    const receipt = receipts[0]!
    expect(receipt).toMatchObject({
      context: 'team',
      phase: 'closing',
      outcome: 'no_data',
      evidenceRef: 'team:closing:no_data:0',
    })
    expect(validateContentFreeEvidenceRef(String(receipt.evidenceRef))).toBe(
      'team:closing:no_data:0',
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

  it('binds every phase to the Team context of the coordinator contract', () => {
    const { db } = createFakeDb({ state: 'closing', counts: [] })
    const contributor = createTeamOrganizationLifecycleContributor(db)
    expect(contributor.context).toBe('team')
  })
})
