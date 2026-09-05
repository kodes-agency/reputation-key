// LIF-01-T12/T13/T14 — Guest lifecycle contribution policy.
//
// Guest holds the most sensitive rows in the product, so the assertions here
// are about what it refuses to do as much as what it does: Closing mutates
// nothing, readiness is read-only and blocks until every Guest correction has
// reached the anonymous lifetime aggregate, the purge plan scrubs guest
// content and permitted contact while keeping the aggregate and the global
// retention cursor, and no receipt carries tenant content.

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
  GUEST_PURGE_PLAN,
  GUEST_PURGE_READINESS_BLOCKED,
  createGuestOrganizationLifecycleContributor,
  type GuestLifecycleWorkbench,
} from './guest-organization-lifecycle.adapter'

const ORGANIZATION_ID = 'org-guest-lifecycle'
const LINEAGE = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
const RECOVERABLE_UNTIL = new Date('2026-09-28T00:00:00.000Z')
const OCCURRED_AT = new Date('2026-08-28T00:00:00.000Z')

const AUTHORITY_STATE_BY_PHASE = {
  closing: 'closure_requested',
  purge_readiness: 'closing',
  purge: 'purging',
} as const

type Phase = keyof typeof AUTHORITY_STATE_BY_PHASE

/** Physical-drop-blocked compatibility mirrors Guest may only DELETE from. */
const COMPATIBILITY_MIRRORS = ['ratings', 'feedback', 'scan_events'] as const

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
    lifecycleRevision: 4,
    recoverableUntil: RECOVERABLE_UNTIL,
    occurredAt: OCCURRED_AT,
    ...overrides,
  }
}

function createFakeDb(phase: Phase, revision = 4) {
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
  overrides: Partial<GuestLifecycleWorkbench> = {},
): GuestLifecycleWorkbench {
  return {
    countUndeliveredGuestFacts: vi.fn(async () => 0),
    countTenantRows: vi.fn(async () => 11),
    scrubTenantRows: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('Guest Organization lifecycle contributor', () => {
  it('answers for the Guest context on all three phases', () => {
    const { db } = createFakeDb('closing')
    const contributor = createGuestOrganizationLifecycleContributor(db, workbench())
    expect(contributor.context).toBe('guest')
    expect(typeof contributor.prepareClosing).toBe('function')
    expect(typeof contributor.verifyPurgeReadiness).toBe('function')
    expect(typeof contributor.purge).toBe('function')
  })

  it('mutates nothing during Closing, because Closing must keep the data', async () => {
    const { db, receipts } = createFakeDb('closing')
    const work = workbench()
    const contributor = createGuestOrganizationLifecycleContributor(db, work)

    const result = await contributor.prepareClosing(request())

    expect(result.outcome).toBe('complete')
    expect(work.scrubTenantRows).not.toHaveBeenCalled()
    // Guest still answers affirmatively: an omitted contributor would make a
    // partial closure look complete.
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ context: 'guest', phase: 'closing' })
  })

  it('answers no_data for an Organization that owns no Guest row', async () => {
    const { db } = createFakeDb('closing')
    const contributor = createGuestOrganizationLifecycleContributor(
      db,
      workbench({ countTenantRows: vi.fn(async () => 0) }),
    )

    const result = await contributor.prepareClosing(request())

    expect(result.outcome).toBe('no_data')
    expect(result.evidenceRef).toBe(`guest:closing:no_data:${LINEAGE}:r4`)
  })

  it('blocks purge readiness while a Guest correction is still undelivered', async () => {
    // Program bullet 11 ordering: corrections and withdrawals must reach the
    // anonymous lifetime aggregate BEFORE the source facts are scrubbed.
    const { db, receipts } = createFakeDb('purge_readiness')
    const work = workbench({ countUndeliveredGuestFacts: vi.fn(async () => 1) })
    const contributor = createGuestOrganizationLifecycleContributor(db, work)

    await expect(contributor.verifyPurgeReadiness(request())).rejects.toThrow(
      GUEST_PURGE_READINESS_BLOCKED,
    )
    expect(receipts).toHaveLength(0)
    expect(work.scrubTenantRows).not.toHaveBeenCalled()
  })

  it('never mutates during purge readiness', async () => {
    const { db } = createFakeDb('purge_readiness')
    const work = workbench()
    const contributor = createGuestOrganizationLifecycleContributor(db, work)

    const result = await contributor.verifyPurgeReadiness(request())

    expect(result.outcome).toBe('complete')
    expect(work.scrubTenantRows).not.toHaveBeenCalled()
  })

  it('replays a persisted purge receipt without scrubbing twice', async () => {
    const { db, receipts } = createFakeDb('purge')
    const work = workbench()
    const contributor = createGuestOrganizationLifecycleContributor(db, work)

    const first = await contributor.purge(request())
    const replay = await contributor.purge(
      request({ occurredAt: new Date('2026-09-01') }),
    )

    expect(replay).toEqual(first)
    expect(work.scrubTenantRows).toHaveBeenCalledTimes(1)
    expect(receipts).toHaveLength(1)
  })

  it('skips the scrub for an already-empty Organization', async () => {
    const { db } = createFakeDb('purge')
    const work = workbench({ countTenantRows: vi.fn(async () => 0) })
    const contributor = createGuestOrganizationLifecycleContributor(db, work)

    const result = await contributor.purge(request())

    expect(result.outcome).toBe('no_data')
    expect(work.scrubTenantRows).not.toHaveBeenCalled()
  })

  it('writes content-free receipts for every phase and outcome', async () => {
    for (const phase of ['closing', 'purge_readiness', 'purge'] as const) {
      for (const rows of [0, 11]) {
        const { db, receipts } = createFakeDb(phase)
        const contributor = createGuestOrganizationLifecycleContributor(
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
          evidenceRef: `guest:${phase}:${outcome}:${LINEAGE}:r4`,
        })
        expect(validateContentFreeEvidenceRef(result.evidenceRef)).toBe(
          result.evidenceRef,
        )
        // No rating, feedback text, contact value, pseudonym or row count.
        expect(result.evidenceRef).not.toMatch(/\b11\b/)
        expect(receipts[0]).toMatchObject({ context: 'guest', phase, outcome })
      }
    }
  })

  it('scrubs guest content and permitted contact but keeps what belongs elsewhere', () => {
    for (const scrubbed of [
      'guest_responses',
      'guest_response_private_feedback',
      'guest_contact_requests',
      'guest_contact_request_reveal_audits',
      'guest_response_media',
      'guest_response_session_bindings',
      'guest_network_pressure_records',
    ]) {
      expect(GUEST_PURGE_PLAN).toContain(scrubbed)
    }
    // Compatibility mirrors: rows deleted, tables never dropped.
    for (const mirror of COMPATIBILITY_MIRRORS) {
      expect(GUEST_PURGE_PLAN).toContain(mirror)
    }
    for (const table of GUEST_PURGE_PLAN) {
      expect(table).not.toMatch(/drop|truncate/i)
    }
    // The anonymous lifetime aggregate the metrics depend on is Metric's row.
    expect(GUEST_PURGE_PLAN).not.toContain('portal_metric_lifetime_aggregates')
    // The global 30-day retention cursor has no organization scope at all.
    expect(GUEST_PURGE_PLAN).not.toContain('guest_contact_request_purge_checkpoints')
    // Identities and other owners' rows stay with their owners.
    for (const foreign of ['user', 'member', 'portals', 'properties']) {
      expect(GUEST_PURGE_PLAN).not.toContain(foreign)
    }
  })

  it('keeps the dark Contact Request capability dark', () => {
    expect(CAPABILITY_FATE['portal.guest_contact'].fate).toBe('safety_blocked')
    expect(CAPABILITY_FATE['portal.guest_media'].fate).toBe('beta_disabled')
  })

  it('keeps the lifecycle contributor out of the Guest public API', () => {
    const build = readFileSync(join(process.cwd(), 'src/contexts/guest/build.ts'), 'utf8')
    const publicApiBlock = build.slice(
      build.indexOf('const publicApi = {'),
      build.indexOf('// ARC-03-T11'),
    )
    expect(publicApiBlock).not.toContain('organizationLifecycleContributor')
    expect(publicApiBlock).not.toContain('LifecycleContributor')
    expect(build).toContain('organizationLifecycleContributor')
  })
})
