// LIF-01-T12/T13/T14 — Property lifecycle contribution policy.
//
// The shared receipt store already proves authority binding and replay
// semantics once for every context. What has to be proved HERE is the Property
// decisions: Closing stops admission without deleting, readiness is read-only
// and fails closed, purge names an explicit bounded plan, and no receipt ever
// carries tenant content.

import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { contextOrganizationLifecycleReceipts } from '#/shared/db/schema/context-organization-lifecycle-receipts.schema'
import { organizationLifecycleAuthority } from '#/shared/db/schema/organization-lifecycle.schema'
import { validateContentFreeEvidenceRef } from '#/shared/db/lifecycle/organization-lifecycle-receipt-store'
import type { OrganizationLifecycleContributionInput } from '#/contexts/identity/application/ports/organization-lifecycle-contributor.port'
import type { Tx } from '#/shared/outbox/commit'
import {
  PROPERTY_PURGE_PLAN,
  PROPERTY_PURGE_READINESS_BLOCKED,
  createPropertyOrganizationLifecycleContributor,
  propertyClosingLifecycleReason,
  type PropertyLifecycleWorkbench,
} from './property-organization-lifecycle.adapter'

const ORGANIZATION_ID = 'org-property-lifecycle'
const LINEAGE = '7c1f3a9d-2b4e-4c6a-9d8f-0e1a2b3c4d5e'
const RECOVERABLE_UNTIL = new Date('2026-09-28T00:00:00.000Z')
const OCCURRED_AT = new Date('2026-08-28T00:00:00.000Z')

const AUTHORITY_STATE_BY_PHASE = {
  closing: 'closure_requested',
  purge_readiness: 'closing',
  purge: 'purging',
} as const

type Phase = keyof typeof AUTHORITY_STATE_BY_PHASE

function request(
  overrides: Partial<OrganizationLifecycleContributionInput> = {},
): OrganizationLifecycleContributionInput {
  return {
    organizationId: ORGANIZATION_ID,
    closureLineageId: LINEAGE,
    lifecycleRevision: 3,
    recoverableUntil: RECOVERABLE_UNTIL,
    occurredAt: OCCURRED_AT,
    ...overrides,
  }
}

/**
 * Minimal Drizzle-shaped fake: one authority row plus an array-backed receipt
 * table. It is enough to exercise the real store, which is what makes the
 * idempotence assertion below meaningful rather than a restatement of the
 * adapter.
 */
function createFakeDb(phase: Phase, revision = 3) {
  const receipts: Array<Record<string, unknown>> = []
  const authorityRow = {
    state: AUTHORITY_STATE_BY_PHASE[phase],
    revision,
    closureLineageId: LINEAGE,
    recoverableUntil: RECOVERABLE_UNTIL,
    lastTransitionAt: new Date('2026-08-27T00:00:00.000Z'),
  }
  const transaction = vi.fn(async (fn: (tx: Tx) => Promise<unknown>) => {
    const tx = {
      execute: vi.fn(async () => ({ rows: [] })),
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
  return { db: { transaction } as unknown as Database, receipts }
}

function workbench(
  overrides: Partial<PropertyLifecycleWorkbench> = {},
): PropertyLifecycleWorkbench {
  return {
    suspendProviderAdmission: vi.fn(async () => 2),
    countAdmittingProperties: vi.fn(async () => 0),
    countTenantRows: vi.fn(async () => 4),
    scrubTenantRows: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('Property Organization lifecycle contributor', () => {
  it('answers for the Property context on all three phases', () => {
    const { db } = createFakeDb('closing')
    const contributor = createPropertyOrganizationLifecycleContributor(db, workbench())
    expect(contributor.context).toBe('property')
    expect(typeof contributor.prepareClosing).toBe('function')
    expect(typeof contributor.verifyPurgeReadiness).toBe('function')
    expect(typeof contributor.purge).toBe('function')
  })

  it('stops provider admission on Closing without deleting anything', async () => {
    const { db, receipts } = createFakeDb('closing')
    const work = workbench()
    const contributor = createPropertyOrganizationLifecycleContributor(db, work)

    const result = await contributor.prepareClosing(request())

    expect(result.outcome).toBe('complete')
    expect(work.suspendProviderAdmission).toHaveBeenCalledTimes(1)
    // Closing opens a recoverable window: the scrub must not be reachable here.
    expect(work.scrubTenantRows).not.toHaveBeenCalled()
    expect(receipts).toHaveLength(1)
  })

  it('stamps the closure lineage into the suspension reason so it can be restored', () => {
    const reason = propertyClosingLifecycleReason(LINEAGE)
    expect(reason).toBe(`organization_closure:${LINEAGE}`)
    // A tenant's own suspension reason can never collide with it.
    expect(reason.startsWith('organization_closure:')).toBe(true)
  })

  it('answers no_data for an Organization that owns no Property row', async () => {
    const { db } = createFakeDb('closing')
    const contributor = createPropertyOrganizationLifecycleContributor(
      db,
      workbench({ countTenantRows: vi.fn(async () => 0) }),
    )

    const result = await contributor.prepareClosing(request())

    // Affirmative evidence, never an omitted contributor.
    expect(result.outcome).toBe('no_data')
    expect(result.evidenceRef).toBe(`property:closing:no_data:${LINEAGE}:r3`)
  })

  it('replays a persisted receipt without re-running the phase work', async () => {
    const { db, receipts } = createFakeDb('purge')
    const work = workbench()
    const contributor = createPropertyOrganizationLifecycleContributor(db, work)

    const first = await contributor.purge(request())
    const replay = await contributor.purge(
      request({ occurredAt: new Date('2026-08-29') }),
    )

    expect(replay).toEqual(first)
    expect(work.scrubTenantRows).toHaveBeenCalledTimes(1)
    expect(receipts).toHaveLength(1)
  })

  it('never re-runs the scrub for a repeated purge, and skips it when empty', async () => {
    const { db } = createFakeDb('purge')
    const work = workbench({ countTenantRows: vi.fn(async () => 0) })
    const contributor = createPropertyOrganizationLifecycleContributor(db, work)

    const result = await contributor.purge(request())

    expect(result.outcome).toBe('no_data')
    expect(work.scrubTenantRows).not.toHaveBeenCalled()
  })

  it('fails closed when a Property still admits provider work', async () => {
    const { db, receipts } = createFakeDb('purge_readiness')
    const work = workbench({ countAdmittingProperties: vi.fn(async () => 1) })
    const contributor = createPropertyOrganizationLifecycleContributor(db, work)

    await expect(contributor.verifyPurgeReadiness(request())).rejects.toThrow(
      PROPERTY_PURGE_READINESS_BLOCKED,
    )
    // A blocked readiness is a real answer that stops the coordinator; it must
    // not leave a receipt claiming the context was ready.
    expect(receipts).toHaveLength(0)
  })

  it('never mutates during purge readiness', async () => {
    const { db } = createFakeDb('purge_readiness')
    const work = workbench()
    const contributor = createPropertyOrganizationLifecycleContributor(db, work)

    await contributor.verifyPurgeReadiness(request())

    expect(work.suspendProviderAdmission).not.toHaveBeenCalled()
    expect(work.scrubTenantRows).not.toHaveBeenCalled()
  })

  it('writes content-free receipts for every phase and outcome', async () => {
    for (const phase of ['closing', 'purge_readiness', 'purge'] as const) {
      for (const rows of [0, 5]) {
        const { db, receipts } = createFakeDb(phase)
        const contributor = createPropertyOrganizationLifecycleContributor(
          db,
          workbench({ countTenantRows: vi.fn(async () => rows) }),
        )
        const result =
          phase === 'closing'
            ? await contributor.prepareClosing(request())
            : phase === 'purge_readiness'
              ? await contributor.verifyPurgeReadiness(request())
              : await contributor.purge(request())

        const outcome = rows === 0 ? 'no_data' : 'complete'
        expect(result).toEqual({
          outcome,
          evidenceRef: `property:${phase}:${outcome}:${LINEAGE}:r3`,
        })
        expect(validateContentFreeEvidenceRef(result.evidenceRef)).toBe(
          result.evidenceRef,
        )
        // Identifiers, enums and a revision only — never a row count.
        expect(result.evidenceRef).not.toMatch(/\b5\b/)
        expect(receipts[0]).toMatchObject({
          context: 'property',
          phase,
          outcome,
          organizationId: ORGANIZATION_ID,
        })
        expect(Object.keys(receipts[0] ?? {})).toEqual(
          expect.not.arrayContaining(['name', 'slug', 'address', 'payload']),
        )
      }
    }
  })

  it('binds the evidence reference to the exact lineage and revision', async () => {
    const { db } = createFakeDb('closing', 9)
    const contributor = createPropertyOrganizationLifecycleContributor(db, workbench())

    const result = await contributor.prepareClosing(request({ lifecycleRevision: 9 }))

    expect(result.evidenceRef).toBe(`property:closing:complete:${LINEAGE}:r9`)
  })

  it('names a bounded purge plan that drops nothing and stays inside Property', () => {
    expect([...PROPERTY_PURGE_PLAN]).toEqual([
      'property_operation_receipts',
      'property_responsible_managers',
      'properties',
    ])
    for (const table of PROPERTY_PURGE_PLAN) {
      expect(table).not.toMatch(/drop|truncate/i)
    }
    // Other owners' rows are never in a Property plan.
    for (const foreign of ['portals', 'guest_responses', 'google_connections', 'user']) {
      expect(PROPERTY_PURGE_PLAN).not.toContain(foreign)
    }
  })
})
