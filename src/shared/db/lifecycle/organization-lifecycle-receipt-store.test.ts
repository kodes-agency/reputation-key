// LIF-01-T3 — shared lifecycle receipt store contract.
//
// Wave 5 builds sixteen contributors on this wrapper, so the failure modes
// asserted here are the ones no contributor should ever have to re-prove:
// a receipt cannot be written against a stale authority, a replay cannot
// re-run destructive work, and a request that only LOOKS like an earlier one
// cannot inherit its recorded outcome.

import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { contextOrganizationLifecycleReceipts } from '#/shared/db/schema/context-organization-lifecycle-receipts.schema'
import { organizationLifecycleAuthority } from '#/shared/db/schema/organization-lifecycle.schema'
import type { Tx } from '#/shared/outbox/commit'
import {
  createOrganizationLifecycleContributorScaffold,
  createOrganizationLifecycleReceiptStore,
  lifecycleRequestFingerprint,
  type OrganizationLifecycleContributionRequest,
} from './organization-lifecycle-receipt-store'

const ORGANIZATION_ID = 'org-lifecycle-1'
const LINEAGE = '3f6d5c9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f'
const RECOVERABLE_UNTIL = new Date('2026-09-28T00:00:00.000Z')
const OCCURRED_AT = new Date('2026-08-28T00:00:00.000Z')

type AuthorityRow = Readonly<{
  state: string
  revision: number
  closureLineageId: string | null
  recoverableUntil: Date | null
  lastTransitionAt: Date
}>

function request(
  overrides: Partial<OrganizationLifecycleContributionRequest> = {},
): OrganizationLifecycleContributionRequest {
  return {
    organizationId: ORGANIZATION_ID,
    closureLineageId: LINEAGE,
    lifecycleRevision: 2,
    recoverableUntil: RECOVERABLE_UNTIL,
    occurredAt: OCCURRED_AT,
    ...overrides,
  }
}

function authority(overrides: Partial<AuthorityRow> = {}): AuthorityRow {
  return {
    state: 'closure_requested',
    revision: 2,
    closureLineageId: LINEAGE,
    recoverableUntil: RECOVERABLE_UNTIL,
    lastTransitionAt: new Date('2026-08-27T00:00:00.000Z'),
    ...overrides,
  }
}

/**
 * Minimal Drizzle-shaped fake: one receipt table backed by an array plus one
 * authority row. `.limit()` resolves like a query but still exposes `.for()`
 * so the authority read can request its row lock.
 */
function createFakeDb(options: {
  authorityRow?: AuthorityRow | null
  receipts?: Array<Record<string, unknown>>
  lockKeys?: string[]
}) {
  const receipts = options.receipts ?? []
  const transaction = vi.fn(async (fn: (tx: Tx) => Promise<unknown>) => {
    const tx = {
      execute: vi.fn(async (statement: { queryChunks?: unknown[] }) => {
        const literal = JSON.stringify(statement.queryChunks ?? [])
        options.lockKeys?.push(literal)
        return { rows: [] }
      }),
      select: vi.fn((_projection?: unknown) => ({
        from: vi.fn((table: unknown) => ({
          where: vi.fn(() => {
            const rows =
              table === organizationLifecycleAuthority
                ? options.authorityRow
                  ? [options.authorityRow]
                  : []
                : receipts
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

describe('shared Organization lifecycle receipt store', () => {
  it('refuses a phase whose required authority state is not live', async () => {
    const work = vi.fn()
    for (const [phase, wrongState] of [
      ['closing', 'closing'],
      ['purge_readiness', 'closure_requested'],
      ['purge', 'purge_pending'],
    ] as const) {
      const { db } = createFakeDb({ authorityRow: authority({ state: wrongState }) })
      const store = createOrganizationLifecycleReceiptStore({ db, context: 'inbox' })
      await expect(store.run(phase, work, request())).rejects.toThrow(
        'lifecycle contribution authority changed',
      )
    }
    expect(work).not.toHaveBeenCalled()
  })

  it('accepts each phase only against its own required authority state', async () => {
    for (const [phase, state] of [
      ['closing', 'closure_requested'],
      ['purge_readiness', 'closing'],
      ['purge', 'purging'],
    ] as const) {
      const { db, receipts } = createFakeDb({ authorityRow: authority({ state }) })
      const store = createOrganizationLifecycleReceiptStore({ db, context: 'inbox' })
      const result = await store.run(
        phase,
        async () => ({ outcome: 'no_data', evidenceRef: `inbox:${phase}:none` }),
        request(),
      )
      expect(result).toEqual({ outcome: 'no_data', evidenceRef: `inbox:${phase}:none` })
      expect(receipts).toHaveLength(1)
      expect(receipts[0]).toMatchObject({ context: 'inbox', phase, outcome: 'no_data' })
    }
  })

  it('refuses a mismatched revision, lineage, recovery deadline or missing authority', async () => {
    const work = vi.fn()
    const cases: ReadonlyArray<
      Readonly<{ authorityRow: AuthorityRow | null; label: string }>
    > = [
      { authorityRow: authority({ revision: 3 }), label: 'revision' },
      {
        authorityRow: authority({
          closureLineageId: '11111111-2222-4333-8444-555555555555',
        }),
        label: 'lineage',
      },
      {
        authorityRow: authority({
          recoverableUntil: new Date('2026-10-01T00:00:00.000Z'),
        }),
        label: 'recoverableUntil',
      },
      { authorityRow: authority({ recoverableUntil: null }), label: 'null recovery' },
      { authorityRow: null, label: 'missing authority' },
    ]
    for (const candidate of cases) {
      const { db } = createFakeDb({ authorityRow: candidate.authorityRow })
      const store = createOrganizationLifecycleReceiptStore({ db, context: 'review' })
      await expect(store.run('closing', work, request())).rejects.toThrow(
        'lifecycle contribution authority changed',
      )
    }
    expect(work).not.toHaveBeenCalled()
  })

  it('refuses a contribution that claims to predate the transition it answers', async () => {
    const work = vi.fn()
    const { db } = createFakeDb({
      authorityRow: authority({ lastTransitionAt: new Date('2026-08-29T00:00:00.000Z') }),
    })
    const store = createOrganizationLifecycleReceiptStore({ db, context: 'metric' })
    await expect(store.run('closing', work, request())).rejects.toThrow(
      'lifecycle contribution authority changed',
    )
    expect(work).not.toHaveBeenCalled()
  })

  it('replays an identical request from the receipt without re-running phase work', async () => {
    const work = vi.fn(async () => ({
      outcome: 'complete' as const,
      evidenceRef: 'goal:purge:1',
    }))
    const { db, receipts } = createFakeDb({
      authorityRow: authority({ state: 'purging' }),
    })
    const store = createOrganizationLifecycleReceiptStore({ db, context: 'goal' })

    const first = await store.run('purge', work, request())
    const second = await store.run('purge', work, request())

    expect(first).toEqual(second)
    expect(work).toHaveBeenCalledTimes(1)
    expect(receipts).toHaveLength(1)
  })

  it('refuses to inherit a recorded outcome when the request fingerprint changed', async () => {
    const work = vi.fn(async () => ({
      outcome: 'complete' as const,
      evidenceRef: 'goal:purge:1',
    }))
    const { db } = createFakeDb({
      authorityRow: authority({ state: 'purging' }),
      receipts: [
        {
          context: 'goal',
          closureLineageId: LINEAGE,
          lifecycleRevision: 2,
          phase: 'purge',
          requestFingerprint: 'f'.repeat(64),
          outcome: 'complete',
          evidenceRef: 'goal:purge:1',
        },
      ],
    })
    const store = createOrganizationLifecycleReceiptStore({ db, context: 'goal' })

    await expect(store.run('purge', work, request())).rejects.toThrow(
      'lifecycle contribution authority changed',
    )
    expect(work).not.toHaveBeenCalled()
  })

  it('records no_data as affirmative evidence rather than an omitted contributor', async () => {
    const { db, receipts } = createFakeDb({ authorityRow: authority() })
    const store = createOrganizationLifecycleReceiptStore({ db, context: 'team' })

    const result = await store.run(
      'closing',
      async () => ({ outcome: 'no_data', evidenceRef: 'team:closing:no-data' }),
      request(),
    )

    expect(result.outcome).toBe('no_data')
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ context: 'team', outcome: 'no_data' })
  })

  it('rejects an outcome or evidence reference that is not content-free', async () => {
    const { db, receipts } = createFakeDb({ authorityRow: authority() })
    const store = createOrganizationLifecycleReceiptStore({ db, context: 'guest' })

    await expect(
      store.run(
        'closing',
        async () => ({ outcome: 'no_data', evidenceRef: 'guest@example.com' }),
        request(),
      ),
    ).rejects.toThrow('content-free identifier')
    await expect(
      store.run(
        'closing',
        async () =>
          ({ outcome: 'partial', evidenceRef: 'guest:closing:1' }) as unknown as {
            outcome: 'complete'
            evidenceRef: string
          },
        request(),
      ),
    ).rejects.toThrow('outcome is invalid')
    expect(receipts).toHaveLength(0)
  })

  it('validates the request shape before touching the database', async () => {
    const { db } = createFakeDb({ authorityRow: authority() })
    const store = createOrganizationLifecycleReceiptStore({ db, context: 'portal' })
    const work = vi.fn()

    await expect(
      store.run('closing', work, request({ closureLineageId: 'not-a-uuid' })),
    ).rejects.toThrow('closure lineage must be a UUID')
    await expect(
      store.run('closing', work, request({ lifecycleRevision: 0 })),
    ).rejects.toThrow('positive safe integer')
    await expect(
      store.run('closing', work, request({ occurredAt: new Date(Number.NaN) })),
    ).rejects.toThrow('timestamps must be valid')
    expect(work).not.toHaveBeenCalled()
  })

  it('fingerprints the exact request, so a different revision is a different request', () => {
    const base = lifecycleRequestFingerprint('inbox', 'closing', request())
    expect(base).toMatch(/^[a-f0-9]{64}$/u)
    expect(lifecycleRequestFingerprint('inbox', 'purge', request())).not.toBe(base)
    expect(lifecycleRequestFingerprint('review', 'closing', request())).not.toBe(base)
    expect(
      lifecycleRequestFingerprint('inbox', 'closing', request({ lifecycleRevision: 3 })),
    ).not.toBe(base)
    // occurredAt is deliberately NOT part of the fingerprint: an exact retry
    // arriving a second later is the same request, not a new one.
    expect(
      lifecycleRequestFingerprint(
        'inbox',
        'closing',
        request({ occurredAt: new Date('2026-08-28T00:00:01.000Z') }),
      ),
    ).toBe(base)
  })

  it('exposes a contributor-shaped scaffold that routes each phase to its own work', async () => {
    const calls: string[] = []
    const phaseWork = (name: string) => async () => {
      calls.push(name)
      return { outcome: 'no_data' as const, evidenceRef: `ai:${name}` }
    }
    const { db, receipts } = createFakeDb({
      authorityRow: authority({ state: 'closing' }),
    })
    const contributor = createOrganizationLifecycleContributorScaffold({
      db,
      context: 'ai',
      prepareClosing: phaseWork('closing'),
      verifyPurgeReadiness: phaseWork('purge_readiness'),
      purge: phaseWork('purge'),
    })

    expect(contributor.context).toBe('ai')
    await contributor.verifyPurgeReadiness(request())
    expect(calls).toEqual(['purge_readiness'])
    expect(receipts[0]).toMatchObject({ context: 'ai', phase: 'purge_readiness' })
    // The scaffold must not let a phase run against the wrong authority state.
    await expect(contributor.purge(request())).rejects.toThrow(
      'lifecycle contribution authority changed',
    )
  })

  it('serializes first attempts on a transaction-scoped advisory lock', async () => {
    const lockKeys: string[] = []
    const { db } = createFakeDb({ authorityRow: authority(), lockKeys })
    const store = createOrganizationLifecycleReceiptStore({ db, context: 'staff' })

    await store.run(
      'closing',
      async () => ({ outcome: 'complete', evidenceRef: 'staff:closing:1' }),
      request(),
    )

    expect(lockKeys).toHaveLength(1)
    expect(lockKeys[0]).toContain('pg_advisory_xact_lock')
    expect(lockKeys[0]).toContain(
      'repkey:context-organization-lifecycle:staff:' + LINEAGE + ':2:closing',
    )
  })
})
