// LIF-01-T12/T13/T14 — Staff lifecycle contribution contract.
//
// The shared receipt store already proves authority binding and replay; what
// only Staff can prove is the shape of its own three phases: that Closing keeps
// every row, that readiness never mutates and fails closed when it must, that
// the purge plan is the exact reviewed table list in FK-safe order, and that no
// receipt ever carries tenant content.

import { describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { contextOrganizationLifecycleReceipts } from '#/shared/db/schema/context-organization-lifecycle-receipts.schema'
import { organizationLifecycleAuthority } from '#/shared/db/schema/organization-lifecycle.schema'
import { validateContentFreeEvidenceRef } from '#/shared/db/lifecycle/organization-lifecycle-receipt-store'
import type { OrganizationLifecycleContributionRequest } from '#/shared/db/lifecycle/organization-lifecycle-receipt-store'
import type { Tx } from '#/shared/outbox/commit'
import {
  createStaffOrganizationLifecycleContributor,
  staffPrepareClosing,
  staffPurge,
  staffVerifyPurgeReadiness,
  STAFF_LIFECYCLE_TABLES,
} from './staff-organization-lifecycle.adapter'

const ORGANIZATION_ID = 'org-staff-lifecycle'
const LINEAGE = '4c1d5b7a-2e3f-4a5b-8c6d-7e8f9a0b1c2d'
const RECOVERABLE_UNTIL = new Date('2026-09-28T00:00:00.000Z')
const OCCURRED_AT = new Date('2026-08-28T00:00:00.000Z')

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

/** Readable rendering of a Drizzle SQL fragment for assertion purposes. */
const render = (query: SQL): string => JSON.stringify(query.queryChunks)

const MUTATING = /DELETE\s+FROM|UPDATE\s|INSERT\s+INTO|TRUNCATE|DROP\s/iu

/** Minimal transaction fake: every query answers with the next queued count. */
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

/**
 * Drizzle-shaped database fake wired to a live `closure_requested` authority,
 * so the real contributor — not a re-implementation — runs end to end.
 */
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

describe('Staff Organization lifecycle contribution', () => {
  it('names the exact reviewed Staff tables in FK-safe delete order', () => {
    expect(STAFF_LIFECYCLE_TABLES).toEqual([
      'portal_responsibilities',
      'portal_group_memberships',
      'staff_participations',
      'staff_user_links',
      'staff_participants',
    ])
    // Identity owns the property-access authority and every user identity row;
    // a Staff purge that touched them would erase a person who belongs to
    // another Organization.
    for (const foreign of [
      'property_access_grants',
      'property_access_grant',
      'user',
      'member',
      'session',
      'user_organization_bindings',
    ]) {
      expect(STAFF_LIFECYCLE_TABLES).not.toContain(foreign)
    }
  })

  it('prepares closing without issuing a single mutating statement', async () => {
    const { tx, executed } = createFakeTx([7])
    const result = await staffPrepareClosing(tx, request())

    expect(result).toEqual({
      outcome: 'complete',
      evidenceRef: 'staff:closing:complete:7',
    })
    expect(executed).toHaveLength(1)
    for (const statement of executed) expect(statement).not.toMatch(MUTATING)
  })

  it('answers an empty Organization with affirmative no_data rather than silence', async () => {
    const { tx } = createFakeTx([0])
    await expect(staffPrepareClosing(tx, request())).resolves.toEqual({
      outcome: 'no_data',
      evidenceRef: 'staff:closing:no_data:0',
    })
  })

  it('verifies purge readiness read-only and reports it as ready', async () => {
    // First query is the pending-outbox probe, second the retained-row count.
    const { tx, executed } = createFakeTx([0, 4])
    const result = await staffVerifyPurgeReadiness(tx, request())

    expect(result).toEqual({
      outcome: 'complete',
      evidenceRef: 'staff:purge_readiness:complete:4',
    })
    expect(executed).toHaveLength(2)
    for (const statement of executed) expect(statement).not.toMatch(MUTATING)
  })

  it('fails readiness closed while a Staff fact is still unpublished', async () => {
    const { tx, executed } = createFakeTx([1])
    await expect(staffVerifyPurgeReadiness(tx, request())).rejects.toThrow(
      'Staff purge readiness blocked: unpublished_staff_outbox_events',
    )
    // It stopped at the probe: a blocked readiness is a real answer, and it
    // must not go on to touch anything.
    expect(executed).toHaveLength(1)
  })

  it('purges exactly the planned tables, in order, scoped to the tenant', async () => {
    const { tx, executed } = createFakeTx([1, 2, 3, 4, 5])
    const result = await staffPurge(tx, request())

    expect(result).toEqual({
      outcome: 'complete',
      evidenceRef: 'staff:purge:complete:15',
    })
    expect(executed).toHaveLength(STAFF_LIFECYCLE_TABLES.length)
    executed.forEach((statement, position) => {
      expect(statement).toMatch(/DELETE FROM/u)
      expect(statement).toContain(STAFF_LIFECYCLE_TABLES[position]!)
      expect(statement).toContain(ORGANIZATION_ID)
    })
    // No physical schema change of any kind is part of a tenant purge.
    for (const statement of executed) expect(statement).not.toMatch(/DROP|TRUNCATE/iu)
  })

  it('reports an already empty purge as no_data instead of inventing work', async () => {
    const { tx } = createFakeTx([0, 0, 0, 0, 0])
    await expect(staffPurge(tx, request())).resolves.toEqual({
      outcome: 'no_data',
      evidenceRef: 'staff:purge:no_data:0',
    })
  })

  it('is idempotent for one lineage and revision: a replay re-runs no delete', async () => {
    const { db, receipts, executed } = createFakeDb({
      state: 'purging',
      counts: [3, 0, 0, 0, 0],
    })
    const contributor = createStaffOrganizationLifecycleContributor(db)

    const first = await contributor.purge(request())
    const replay = await contributor.purge(request())

    expect(replay).toEqual(first)
    expect(receipts).toHaveLength(1)
    // Five deletes for the first pass and none for the replay: the recorded
    // receipt answers, the destructive work does not run twice.
    expect(executed).toHaveLength(STAFF_LIFECYCLE_TABLES.length)
  })

  it('persists a content-free receipt carrying only context, phase, outcome and a count', async () => {
    const { db, receipts } = createFakeDb({ state: 'closure_requested', counts: [5] })
    const contributor = createStaffOrganizationLifecycleContributor(db)

    await contributor.prepareClosing(request())

    const receipt = receipts[0]!
    expect(receipt).toMatchObject({
      context: 'staff',
      phase: 'closing',
      outcome: 'complete',
      evidenceRef: 'staff:closing:complete:5',
      organizationId: ORGANIZATION_ID,
      closureLineageId: LINEAGE,
      lifecycleRevision: 2,
    })
    expect(validateContentFreeEvidenceRef(String(receipt.evidenceRef))).toBe(
      'staff:closing:complete:5',
    )
    // The receipt columns are identifiers, enums, counts and timestamps only —
    // no display name, no email, no free text.
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

  it('binds every phase to the Staff context of the coordinator contract', () => {
    const { db } = createFakeDb({ state: 'closing', counts: [] })
    const contributor = createStaffOrganizationLifecycleContributor(db)
    expect(contributor.context).toBe('staff')
    expect(typeof contributor.prepareClosing).toBe('function')
    expect(typeof contributor.verifyPurgeReadiness).toBe('function')
    expect(typeof contributor.purge).toBe('function')
  })
})
