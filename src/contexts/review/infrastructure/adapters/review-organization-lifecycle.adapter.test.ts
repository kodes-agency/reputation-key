// LIF-01 T12/T13/T14 — Review lifecycle contributor contract.
//
// The integration test proves the SQL against a real schema. This file proves
// the properties the coordinator depends on and that a database cannot show:
// each phase persists exactly one CONTENT-FREE receipt, a replay returns that
// receipt WITHOUT re-running the work, `no_data` is answered affirmatively,
// closing stops provider effects while deleting nothing, readiness mutates
// nothing and fails closed on an unsettled provider interaction, and purge
// never drops a table, bypasses a trigger, or touches the immutable
// publication authorizations.

import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { organizationLifecycleEvents } from '#/shared/db/schema/organization-lifecycle.schema'
import { organizationLifecycleAuthority } from '#/shared/db/schema/organization-lifecycle.schema'
import type { Tx } from '#/shared/outbox/commit'
import type { OrganizationLifecycleContributionInput } from '#/contexts/identity/application/ports/organization-lifecycle-contributor.port'
import { createReviewOrganizationLifecycleContributor } from './review-organization-lifecycle.adapter'

const ORGANIZATION_ID = 'org-review-lifecycle'
const LINEAGE = '7c6b5a49-3827-4160-8594-a3b2c1d0e9f8'
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
    lifecycleRevision: 4,
    recoverableUntil: RECOVERABLE_UNTIL,
    occurredAt: OCCURRED_AT,
    ...overrides,
  }
}

/** The live authority the store re-reads; it matches the request unless a
 * test deliberately asks for a different one. */
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

const HAS_REVIEWS: readonly [RegExp, ExecuteResult] = [
  /SELECT 1 FROM reviews/u,
  { rows: [{ '?column?': 1 }] },
]

/** Nothing unsettled — the state `prepareClosing` is supposed to leave behind. */
const NO_BLOCKERS: readonly [RegExp, ExecuteResult] = [
  /count\(\*\)::int AS blocked/u,
  { rows: [{ blocked: 0 }], rowCount: 1 },
]

function blockedBy(table: RegExp, count: number): readonly [RegExp, ExecuteResult] {
  return [table, { rows: [{ blocked: count }], rowCount: 1 }]
}

describe('Review Organization lifecycle contributor', () => {
  it('answers for the review context', () => {
    const { db } = createFakeDb({ state: 'closure_requested' })

    expect(createReviewOrganizationLifecycleContributor(db).context).toBe('review')
  })

  it('stops import, sync and reply publication at closing without deleting data', async () => {
    const { db, executed } = createFakeDb({
      state: 'closure_requested',
      results: [
        [/UPDATE review_sync_state/u, { rows: [], rowCount: 3 }],
        [/UPDATE replies/u, { rows: [], rowCount: 1 }],
        HAS_REVIEWS,
      ],
    })

    const result =
      await createReviewOrganizationLifecycleContributor(db).prepareClosing(input())

    expect(result.outcome).toBe('complete')
    const statements = phaseStatements(executed)
    const syncFence = statements.find((text) =>
      text.startsWith('UPDATE review_sync_state'),
    )
    expect(syncFence).toContain('next_incremental_at = NULL')
    expect(syncFence).toContain('next_inventory_at = NULL')
    expect(syncFence).toContain('error_retry_at = NULL')

    const publicationFence = statements.find((text) => text.startsWith('UPDATE replies'))
    expect(publicationFence).toContain("publication_state = 'cancelled'")
    // Only PRE-DISPATCH cycles are cancelled. A reply whose provider write is
    // already out must be settled by reconciliation, never by this adapter.
    expect(publicationFence).toContain("IN ('requested', 'authorized')")
    expect(publicationFence).not.toMatch(/'sending'|'pending_observation'|'ambiguous'/u)

    // Closing opens a recoverable window: no row may be removed or redacted.
    for (const statement of statements) {
      expect(statement).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/u)
    }
    expect(statements.some((text) => text.includes('SET text'))).toBe(false)
  })

  it('persists a content-free receipt for every phase', async () => {
    for (const [phase, state] of [
      ['closing', 'closure_requested'],
      ['purge_readiness', 'closing'],
      ['purge', 'purging'],
    ] as const) {
      const { db, receipts } = createFakeDb({
        state,
        results: [NO_BLOCKERS, HAS_REVIEWS],
      })
      const contributor = createReviewOrganizationLifecycleContributor(db)
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
        context: 'review',
        organizationId: ORGANIZATION_ID,
        phase,
        payload: {
          closureLineageId: LINEAGE,
          lifecycleRevision: 4,
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

  it('answers no_data affirmatively when the Organization has no Review rows', async () => {
    for (const [phase, state] of [
      ['closing', 'closure_requested'],
      ['purge_readiness', 'closing'],
      ['purge', 'purging'],
    ] as const) {
      const { db, receipts } = createFakeDb({ state, results: [NO_BLOCKERS] })
      const contributor = createReviewOrganizationLifecycleContributor(db)
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

  it('verifies purge readiness without mutating anything', async () => {
    const { db, executed } = createFakeDb({
      state: 'closing',
      results: [NO_BLOCKERS, HAS_REVIEWS],
    })

    const result =
      await createReviewOrganizationLifecycleContributor(db).verifyPurgeReadiness(input())

    expect(result.outcome).toBe('complete')
    for (const statement of phaseStatements(executed)) {
      expect(statement).toMatch(/^SELECT\b/u)
    }
  })

  it('fails closed on every unsettled provider interaction', async () => {
    const blockers = [
      ['active_reply_publications', /FROM replies/u],
      ['unsettled_provider_attempts', /FROM reply_publication_attempts/u],
      ['unfenced_sync_schedules', /FROM review_sync_state/u],
      ['open_provider_snapshot_runs', /FROM review_provider_snapshot_runs/u],
    ] as const

    for (const [code, table] of blockers) {
      const { db, receipts } = createFakeDb({
        state: 'closing',
        results: [blockedBy(table, 1), NO_BLOCKERS, HAS_REVIEWS],
      })

      await expect(
        createReviewOrganizationLifecycleContributor(db).verifyPurgeReadiness(input()),
      ).rejects.toThrow(`${code}=1`)
      // A blocked readiness stops the coordinator; it records no progress.
      expect(receipts).toHaveLength(0)
    }
  })

  it('scrubs and deletes without dropping, truncating, or bypassing a trigger', async () => {
    const { db, executed } = createFakeDb({
      state: 'purging',
      results: [HAS_REVIEWS],
    })

    await createReviewOrganizationLifecycleContributor(db).purge(input())

    const statements = phaseStatements(executed)
    for (const statement of statements) {
      expect(statement).not.toMatch(/\bDROP\b|\bTRUNCATE\b|DISABLE TRIGGER/u)
    }
    // Independently retained, content-free evidence is never written to:
    // the publication authorizations are immutable in PostgreSQL, and the
    // retention/refresh run logs carry no Organization scope at all.
    for (const retained of [
      'reply_publication_authorizations',
      'retention_runs',
      'review_refresh_runs',
      'review_provider_subject_hmac_key_versions',
    ]) {
      expect(statements.some((text) => text.includes(retained))).toBe(false)
    }
    // The identity spine survives as SCRUBBED rows, never as deleted ones,
    // because immutable authorizations reference it with ON DELETE RESTRICT.
    for (const spine of ['replies', 'reviews', 'material_review_revisions']) {
      expect(statements.some((text) => text.startsWith(`UPDATE ${spine} `))).toBe(true)
      expect(statements.some((text) => text.startsWith(`DELETE FROM ${spine} `))).toBe(
        false,
      )
    }
    // Provider content and provider identifiers are removed outright.
    for (const removed of [
      'review_source_contents',
      'review_source_observations',
      'google_reply_observations',
      'reply_publication_attempts',
      'review_provider_subjects',
      'idempotency_receipts',
      'review_sync_state',
    ]) {
      expect(statements.some((text) => text.startsWith(`DELETE FROM ${removed} `))).toBe(
        true,
      )
    }
  })

  it('releases the confirmation link before deleting either side of its cycle', async () => {
    const { db, executed } = createFakeDb({ state: 'purging', results: [HAS_REVIEWS] })

    await createReviewOrganizationLifecycleContributor(db).purge(input())

    const statements = phaseStatements(executed)
    const release = statements.findIndex((text) =>
      text.startsWith('UPDATE reply_publication_attempts'),
    )
    const deleteObservations = statements.findIndex((text) =>
      text.startsWith('DELETE FROM google_reply_observations '),
    )
    const deleteAttempts = statements.findIndex((text) =>
      text.startsWith('DELETE FROM reply_publication_attempts '),
    )
    expect(release).toBeGreaterThanOrEqual(0)
    expect(release).toBeLessThan(deleteObservations)
    expect(deleteObservations).toBeLessThan(deleteAttempts)
  })

  it('replays a recorded phase without re-running its work', async () => {
    const receipts: Array<Record<string, unknown>> = []
    const first = createFakeDb({
      state: 'purging',
      receipts,
      results: [
        [/DELETE FROM review_source_contents/u, { rows: [], rowCount: 9 }],
        HAS_REVIEWS,
      ],
    })
    const before = await createReviewOrganizationLifecycleContributor(first.db).purge(
      input(),
    )
    expect(phaseStatements(first.executed).some((s) => s.includes('DELETE'))).toBe(true)

    const replay = createFakeDb({ state: 'purging', receipts })
    const after = await createReviewOrganizationLifecycleContributor(replay.db).purge(
      input(),
    )

    expect(after).toEqual(before)
    expect(receipts).toHaveLength(1)
    // The recorded outcome is returned from the receipt, not re-derived.
    expect(phaseStatements(replay.executed)).toEqual([])
  })

  it('derives the evidence reference deterministically from content-free counts', async () => {
    const results: ReadonlyArray<readonly [RegExp, ExecuteResult]> = [
      [/DELETE FROM review_source_contents/u, { rows: [], rowCount: 5 }],
      HAS_REVIEWS,
    ]
    const one = createFakeDb({ state: 'purging', results })
    const two = createFakeDb({ state: 'purging', results })

    const first = await createReviewOrganizationLifecycleContributor(one.db).purge(
      input(),
    )
    const second = await createReviewOrganizationLifecycleContributor(two.db).purge(
      input(),
    )

    expect(second.evidenceRef).toBe(first.evidenceRef)
    // A different lineage is a different request and must not reuse evidence.
    const otherRequest = input({
      closureLineageId: '1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d',
    })
    const other = createFakeDb({ state: 'purging', request: otherRequest, results })
    const third = await createReviewOrganizationLifecycleContributor(other.db).purge(
      otherRequest,
    )
    expect(third.evidenceRef).not.toBe(first.evidenceRef)
  })
})
