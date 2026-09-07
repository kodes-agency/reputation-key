// LIF-01 T12/T13/T14 — Inbox lifecycle contributor contract.
//
// The integration test proves the SQL against a real schema. This file proves
// the properties the coordinator depends on and that a database cannot show:
// each phase persists exactly one CONTENT-FREE receipt, a replay returns that
// receipt WITHOUT re-running the work, `no_data` is answered affirmatively,
// closing deletes nothing, readiness mutates nothing, and a blocked readiness
// refuses instead of reporting progress.

import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { organizationLifecycleEvents } from '#/shared/db/schema/organization-lifecycle.schema'
import { organizationLifecycleAuthority } from '#/shared/db/schema/organization-lifecycle.schema'
import type { Tx } from '#/shared/outbox/commit'
import type { OrganizationLifecycleContributionInput } from '#/contexts/identity/application/ports/organization-lifecycle-contributor.port'
import { createInboxOrganizationLifecycleContributor } from './inbox-organization-lifecycle.adapter'

const ORGANIZATION_ID = 'org-inbox-lifecycle'
const LINEAGE = '2b1c0d9e-4a5b-4c6d-9e7f-0a1b2c3d4e5f'
const RECOVERABLE_UNTIL = new Date('2026-09-27T00:00:00.000Z')
const OCCURRED_AT = new Date('2026-08-28T00:00:00.000Z')

/** The database's own evidence-reference rule, restated as the assertion. */
const CONTENT_FREE_EVIDENCE_REF = /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$/u

type ExecuteResult = Readonly<{ rows: Record<string, unknown>[]; rowCount?: number }>

type AuthorityRow = Readonly<{
  state: string
  revision: number
  closureLineageId: string | null
  recoverableUntil: Date | null
  lastTransitionAt: Date
}>

function input(
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

/** The live authority the store re-reads; it always matches the request here
 * unless a test deliberately asks for a different one. */
function authority(
  state: string,
  request: OrganizationLifecycleContributionInput,
): AuthorityRow {
  return {
    state,
    revision: request.lifecycleRevision,
    closureLineageId: request.closureLineageId,
    recoverableUntil: request.recoverableUntil,
    lastTransitionAt: new Date('2026-08-27T00:00:00.000Z'),
  }
}

/**
 * Flattens a Drizzle `SQL` into matchable text. Only string fragments are
 * kept, which is enough to tell an UPDATE from a DELETE from a SELECT and to
 * name the table each statement touches.
 */
function sqlText(statement: unknown): string {
  const parts: string[] = []
  const walk = (chunk: unknown): void => {
    if (typeof chunk === 'string') {
      parts.push(chunk)
      return
    }
    if (Array.isArray(chunk)) {
      for (const entry of chunk) walk(entry)
      return
    }
    if (chunk === null || typeof chunk !== 'object') return
    const candidate = chunk as { value?: unknown; queryChunks?: unknown }
    if (candidate.queryChunks !== undefined) {
      walk(candidate.queryChunks)
      return
    }
    if (typeof candidate.value === 'string' || Array.isArray(candidate.value)) {
      walk(candidate.value)
    }
  }
  walk((statement as { queryChunks?: unknown }).queryChunks)
  return parts.join(' ').replace(/\s+/gu, ' ').trim()
}

type FakeOptions = Readonly<{
  state: string
  request?: OrganizationLifecycleContributionInput
  /** Ordered matchers: the first whose pattern matches answers the statement. */
  results?: ReadonlyArray<readonly [RegExp, ExecuteResult]>
  receipts?: Array<Record<string, unknown>>
}>

function createFakeDb(options: FakeOptions) {
  const receipts = options.receipts ?? []
  const executed: string[] = []
  const authorityRow = authority(options.state, options.request ?? input())
  const transaction = vi.fn(async (fn: (tx: Tx) => Promise<unknown>) => {
    const tx = {
      execute: vi.fn(async (statement: unknown): Promise<ExecuteResult> => {
        const text = sqlText(statement)
        executed.push(text)
        for (const [pattern, result] of options.results ?? []) {
          if (pattern.test(text)) return result
        }
        return { rows: [], rowCount: 0 }
      }),
      select: vi.fn((_projection?: unknown) => ({
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
          if (table === organizationLifecycleEvents) receipts.push(row)
        }),
      })),
    }
    return fn(tx as unknown as Tx)
  })
  return { db: { transaction } as unknown as Database, receipts, executed }
}

/** Statements the phase work issued, ignoring the store's advisory lock. */
function phaseStatements(executed: readonly string[]): readonly string[] {
  return executed.filter((text) => !text.includes('pg_advisory_xact_lock'))
}

const HAS_ITEMS: readonly [RegExp, ExecuteResult] = [
  /SELECT 1 FROM inbox_items/u,
  { rows: [{ '?column?': 1 }] },
]

/** No reminder slot is schedulable — the readiness path's cleared state. */
const NO_PENDING_REMINDERS: readonly [RegExp, ExecuteResult] = [
  /count\(\*\)::int AS blocked/u,
  { rows: [{ blocked: 0 }], rowCount: 1 },
]

describe('Inbox Organization lifecycle contributor', () => {
  it('answers for the inbox context', () => {
    const { db } = createFakeDb({ state: 'closure_requested' })

    expect(createInboxOrganizationLifecycleContributor(db).context).toBe('inbox')
  })

  it('cancels open reminder slots at closing and deletes nothing', async () => {
    const { db, executed, receipts } = createFakeDb({
      state: 'closure_requested',
      results: [
        [/UPDATE inbox_response_target_reminders/u, { rows: [], rowCount: 2 }],
        HAS_ITEMS,
      ],
    })

    const result =
      await createInboxOrganizationLifecycleContributor(db).prepareClosing(input())

    expect(result.outcome).toBe('complete')
    const statements = phaseStatements(executed)
    expect(statements[0]).toContain('UPDATE inbox_response_target_reminders')
    expect(statements[0]).toContain('SET cancelled_at')
    // Closing opens a recoverable window: no row may be removed or redacted.
    for (const statement of statements) {
      expect(statement).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/u)
    }
    expect(receipts).toHaveLength(1)
  })

  it('persists a content-free receipt for every phase', async () => {
    for (const [phase, state] of [
      ['closing', 'closure_requested'],
      ['purge_readiness', 'closing'],
      ['purge', 'purging'],
    ] as const) {
      const { db, receipts } = createFakeDb({
        state,
        results: [NO_PENDING_REMINDERS, HAS_ITEMS],
      })
      const contributor = createInboxOrganizationLifecycleContributor(db)
      const result =
        phase === 'closing'
          ? await contributor.prepareClosing(input())
          : phase === 'purge_readiness'
            ? await contributor.verifyPurgeReadiness(input())
            : await contributor.purge(input())

      expect(result.evidenceRef).toMatch(CONTENT_FREE_EVIDENCE_REF)
      expect(receipts).toHaveLength(1)
      const receipt = receipts[0]!
      expect(receipt).toMatchObject({
        context: 'inbox',
        organizationId: ORGANIZATION_ID,
        phase,
        payload: {
          closureLineageId: LINEAGE,
          lifecycleRevision: 3,
          outcome: 'complete',
        },
      })
      // The generic envelope is fixed; its payload remains content-free
      // identifiers, enums, timestamps and one digest.
      expect(Object.keys(receipt).sort()).toEqual([
        'context',
        'kind',
        'organizationId',
        'payload',
        'phase',
        'recordedAt',
      ])
      expect(Object.keys(receipt.payload as Record<string, unknown>).sort()).toEqual([
        'closureLineageId',
        'evidenceRef',
        'lifecycleRevision',
        'outcome',
        'recoverableUntil',
        'requestFingerprint',
      ])
    }
  })

  it('answers no_data affirmatively when the Organization has no Inbox rows', async () => {
    for (const [phase, state] of [
      ['closing', 'closure_requested'],
      ['purge_readiness', 'closing'],
      ['purge', 'purging'],
    ] as const) {
      const { db, receipts } = createFakeDb({
        state,
        results: [NO_PENDING_REMINDERS],
      })
      const contributor = createInboxOrganizationLifecycleContributor(db)
      const result =
        phase === 'closing'
          ? await contributor.prepareClosing(input())
          : phase === 'purge_readiness'
            ? await contributor.verifyPurgeReadiness(input())
            : await contributor.purge(input())

      expect(result.outcome).toBe('no_data')
      expect(result.evidenceRef).toMatch(CONTENT_FREE_EVIDENCE_REF)
      // Affirmative absence: a receipt is still persisted.
      expect(receipts).toHaveLength(1)
    }
  })

  it('replays a recorded phase without re-running its work', async () => {
    const receipts: Array<Record<string, unknown>> = []
    const first = createFakeDb({
      state: 'purging',
      receipts,
      results: [[/DELETE FROM inbox_items/u, { rows: [], rowCount: 4 }], HAS_ITEMS],
    })
    const before = await createInboxOrganizationLifecycleContributor(first.db).purge(
      input(),
    )
    expect(phaseStatements(first.executed).some((s) => s.includes('DELETE'))).toBe(true)

    const replay = createFakeDb({ state: 'purging', receipts })
    const after = await createInboxOrganizationLifecycleContributor(replay.db).purge(
      input(),
    )

    expect(after).toEqual(before)
    expect(receipts).toHaveLength(1)
    // The recorded outcome is returned from the receipt, not re-derived.
    expect(phaseStatements(replay.executed)).toEqual([])
  })

  it('verifies purge readiness without mutating anything', async () => {
    const { db, executed } = createFakeDb({
      state: 'closing',
      results: [NO_PENDING_REMINDERS, HAS_ITEMS],
    })

    const result =
      await createInboxOrganizationLifecycleContributor(db).verifyPurgeReadiness(input())

    expect(result.outcome).toBe('complete')
    for (const statement of phaseStatements(executed)) {
      expect(statement).toMatch(/^SELECT\b/u)
    }
  })

  it('fails closed when a reminder slot is still schedulable', async () => {
    const { db, receipts } = createFakeDb({
      state: 'closing',
      results: [
        [/count\(\*\)::int AS blocked/u, { rows: [{ blocked: 2 }], rowCount: 1 }],
        HAS_ITEMS,
      ],
    })

    await expect(
      createInboxOrganizationLifecycleContributor(db).verifyPurgeReadiness(input()),
    ).rejects.toThrow('unfenced_response_target_reminders=2')
    // A blocked readiness stops the coordinator; it records no progress.
    expect(receipts).toHaveLength(0)
  })

  it('purges through the item parent so cascade-only history is removed', async () => {
    const { db, executed } = createFakeDb({
      state: 'purging',
      results: [HAS_ITEMS],
    })

    await createInboxOrganizationLifecycleContributor(db).purge(input())

    const statements = phaseStatements(executed)
    expect(statements.filter((text) => text.startsWith('DELETE'))).toEqual([
      `DELETE FROM inbox_items WHERE organization_id = ${ORGANIZATION_ID}`,
      `DELETE FROM inbox_response_target_organization_policies WHERE organization_id = ${ORGANIZATION_ID}`,
      `DELETE FROM inbox_private_feedback_target_property_overrides WHERE organization_id = ${ORGANIZATION_ID}`,
      `DELETE FROM inbox_user_views WHERE organization_id = ${ORGANIZATION_ID}`,
    ])
    // No physical schema change and no trigger bypass is ever attempted.
    for (const statement of statements) {
      expect(statement).not.toMatch(/\bDROP\b|\bTRUNCATE\b|DISABLE TRIGGER/u)
    }
  })

  it('derives the evidence reference deterministically from content-free counts', async () => {
    const results: ReadonlyArray<readonly [RegExp, ExecuteResult]> = [
      [/DELETE FROM inbox_items/u, { rows: [], rowCount: 7 }],
      HAS_ITEMS,
    ]
    const one = createFakeDb({ state: 'purging', results })
    const two = createFakeDb({ state: 'purging', results })

    const first = await createInboxOrganizationLifecycleContributor(one.db).purge(input())
    const second = await createInboxOrganizationLifecycleContributor(two.db).purge(
      input(),
    )

    expect(second.evidenceRef).toBe(first.evidenceRef)
    // A different lineage is a different request and must not reuse evidence.
    const otherRequest = input({
      closureLineageId: '9f8e7d6c-5b4a-4392-8281-706f5e4d3c2b',
    })
    const other = createFakeDb({ state: 'purging', request: otherRequest, results })
    const third = await createInboxOrganizationLifecycleContributor(other.db).purge(
      otherRequest,
    )
    expect(third.evidenceRef).not.toBe(first.evidenceRef)
  })
})
