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
})
