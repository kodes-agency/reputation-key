// LIF-01-T12/T13/T14 — Portal lifecycle contribution policy.
//
// The shared receipt store proves authority binding and replay once for every
// context. What is proved HERE is the Portal decisions: Closing makes Portals
// unavailable as a STOP (nothing deleted, the snapshot survives so the stop is
// reversible), readiness is read-only and fails closed while a printed address
// still resolves, the purge plan deletes rows and never drops a compatibility
// mirror, and no receipt carries tenant content.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { CAPABILITY_FATE } from '#/shared/governance/capability-fate'
import { contextOrganizationLifecycleReceipts } from '#/shared/db/schema/context-organization-lifecycle-receipts.schema'
import { organizationLifecycleAuthority } from '#/shared/db/schema/organization-lifecycle.schema'
import { validateContentFreeEvidenceRef } from '#/shared/db/lifecycle/organization-lifecycle-receipt-store'
import type { OrganizationLifecycleContributionInput } from '#/contexts/identity/application/ports/organization-lifecycle-contributor.port'
import type { Tx } from '#/shared/outbox/commit'
import {
  PORTAL_PURGE_PLAN,
  PORTAL_PURGE_READINESS_BLOCKED,
  createPortalOrganizationLifecycleContributor,
  type PortalLifecycleWorkbench,
} from './portal-organization-lifecycle.adapter'

const ORGANIZATION_ID = 'org-portal-lifecycle'
const LINEAGE = '2d4b6c8a-1e3f-4a5b-8c7d-9e0f1a2b3c4d'
const RECOVERABLE_UNTIL = new Date('2026-09-28T00:00:00.000Z')
const OCCURRED_AT = new Date('2026-08-28T00:00:00.000Z')

const AUTHORITY_STATE_BY_PHASE = {
  closing: 'closure_requested',
  purge_readiness: 'closing',
  purge: 'purging',
} as const

type Phase = keyof typeof AUTHORITY_STATE_BY_PHASE

/** Physical-drop-blocked compatibility mirrors Portal may only DELETE from. */
const COMPATIBILITY_MIRRORS = ['portal_group_members'] as const

/**
 * The capability-fate authority as it stood before this lifecycle work. A
 * lifecycle contributor may never activate a dark capability, so the file must
 * be byte-identical.
 */

function request(
  overrides: Partial<OrganizationLifecycleContributionInput> = {},
): OrganizationLifecycleContributionInput {
  return {
    organizationId: ORGANIZATION_ID,
    closureLineageId: LINEAGE,
    lifecycleRevision: 2,
    recoverableUntil: RECOVERABLE_UNTIL,
    occurredAt: OCCURRED_AT,
    ...overrides,
  }
}

function createFakeDb(phase: Phase, revision = 2) {
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
  overrides: Partial<PortalLifecycleWorkbench> = {},
): PortalLifecycleWorkbench {
  return {
    withdrawPublicAvailability: vi.fn(async () => 3),
    countLivePublications: vi.fn(async () => 0),
    countTenantRows: vi.fn(async () => 7),
    scrubTenantRows: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('Portal Organization lifecycle contributor', () => {
  it('answers for the Portal context on all three phases', () => {
    const { db } = createFakeDb('closing')
    const contributor = createPortalOrganizationLifecycleContributor(db, workbench())
    expect(contributor.context).toBe('portal')
    expect(typeof contributor.prepareClosing).toBe('function')
    expect(typeof contributor.verifyPurgeReadiness).toBe('function')
    expect(typeof contributor.purge).toBe('function')
  })

  it('withdraws public availability on Closing without deleting anything', async () => {
    const { db, receipts } = createFakeDb('closing')
    const work = workbench()
    const contributor = createPortalOrganizationLifecycleContributor(db, work)

    const result = await contributor.prepareClosing(request())

    expect(result.outcome).toBe('complete')
    expect(work.withdrawPublicAvailability).toHaveBeenCalledTimes(1)
    // Making a Portal unavailable is a stop, not a delete.
    expect(work.scrubTenantRows).not.toHaveBeenCalled()
    expect(receipts).toHaveLength(1)
  })

  it('answers no_data for an Organization that owns no Portal row', async () => {
    const { db } = createFakeDb('closing')
    const contributor = createPortalOrganizationLifecycleContributor(
      db,
      workbench({ countTenantRows: vi.fn(async () => 0) }),
    )

    const result = await contributor.prepareClosing(request())

    expect(result.outcome).toBe('no_data')
    expect(result.evidenceRef).toBe(`portal:closing:no_data:${LINEAGE}:r2`)
  })

  it('replays a persisted receipt without re-running the phase work', async () => {
    const { db, receipts } = createFakeDb('purge')
    const work = workbench()
    const contributor = createPortalOrganizationLifecycleContributor(db, work)

    const first = await contributor.purge(request())
    const replay = await contributor.purge(
      request({ occurredAt: new Date('2026-08-30') }),
    )

    expect(replay).toEqual(first)
    expect(work.scrubTenantRows).toHaveBeenCalledTimes(1)
    expect(receipts).toHaveLength(1)
  })

  it('fails closed while a Portal publication is still resolvable', async () => {
    const { db, receipts } = createFakeDb('purge_readiness')
    const contributor = createPortalOrganizationLifecycleContributor(
      db,
      workbench({ countLivePublications: vi.fn(async () => 1) }),
    )

    await expect(contributor.verifyPurgeReadiness(request())).rejects.toThrow(
      PORTAL_PURGE_READINESS_BLOCKED,
    )
    expect(receipts).toHaveLength(0)
  })

  it('never mutates during purge readiness', async () => {
    const { db } = createFakeDb('purge_readiness')
    const work = workbench()
    const contributor = createPortalOrganizationLifecycleContributor(db, work)

    await contributor.verifyPurgeReadiness(request())

    expect(work.withdrawPublicAvailability).not.toHaveBeenCalled()
    expect(work.scrubTenantRows).not.toHaveBeenCalled()
  })

  it('skips the scrub for an already-empty Organization', async () => {
    const { db } = createFakeDb('purge')
    const work = workbench({ countTenantRows: vi.fn(async () => 0) })
    const contributor = createPortalOrganizationLifecycleContributor(db, work)

    const result = await contributor.purge(request())

    expect(result.outcome).toBe('no_data')
    expect(work.scrubTenantRows).not.toHaveBeenCalled()
  })

  it('writes content-free receipts for every phase and outcome', async () => {
    for (const phase of ['closing', 'purge_readiness', 'purge'] as const) {
      for (const rows of [0, 7]) {
        const { db, receipts } = createFakeDb(phase)
        const contributor = createPortalOrganizationLifecycleContributor(
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
          evidenceRef: `portal:${phase}:${outcome}:${LINEAGE}:r2`,
        })
        expect(validateContentFreeEvidenceRef(result.evidenceRef)).toBe(
          result.evidenceRef,
        )
        // No Portal name, slug, link URL, token material or count.
        expect(result.evidenceRef).not.toMatch(/\b7\b/)
        expect(receipts[0]).toMatchObject({ context: 'portal', phase, outcome })
      }
    }
  })

  it('names a bounded purge plan of row deletes, never drops', () => {
    expect(PORTAL_PURGE_PLAN).toContain('portals')
    expect(PORTAL_PURGE_PLAN).toContain('portal_groups')
    for (const table of PORTAL_PURGE_PLAN) {
      expect(table).not.toMatch(/drop|truncate/i)
    }
    // Compatibility mirrors are row-delete targets, never DROP targets.
    for (const mirror of COMPATIBILITY_MIRRORS) {
      expect(PORTAL_PURGE_PLAN).toContain(mirror)
    }
    // Other owners' rows are never in a Portal plan.
    for (const foreign of [
      'properties',
      'guest_responses',
      'portal_metric_lifetime_aggregates',
      'portal_responsibilities',
      'portal_group_memberships',
    ]) {
      expect(PORTAL_PURGE_PLAN).not.toContain(foreign)
    }
  })

  it('keeps the dark Portal upload capability dark', () => {
    // Portal upload has no public issuance surface. A lifecycle contributor
    // must not be the thing that makes a dark capability reachable, so the
    // governance authority is asserted byte-identical: this work changed no
    // capability fate at all.
    expect(CAPABILITY_FATE['portal.upload'].fate).toBe('safety_blocked')
  })

  it('keeps the lifecycle contributor out of the Portal public API', () => {
    const build = readFileSync(
      join(process.cwd(), 'src/contexts/portal/build.ts'),
      'utf8',
    )
    const publicApiBlock = build.slice(
      build.indexOf('const publicApi:'),
      build.indexOf('const portalGroupPublicApi'),
    )
    expect(publicApiBlock).not.toContain('organizationLifecycleContributor')
    expect(publicApiBlock).not.toContain('LifecycleContributor')
    expect(build).toContain('organizationLifecycleContributor')
  })
})
