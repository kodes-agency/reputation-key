// LIF-01-T12/T13/T14 — AI lifecycle contributor decision logic.
//
// The shared receipt store already proves authority binding, locking and
// receipt replay. What is proved here is what this context decides: closing
// supersedes work authorities and deletes nothing, readiness refuses while the
// merchant authorization is still enabled, purge erases every derivative and
// the ledgers that could rebuild one, and every receipt is content-free.

import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { contextOrganizationLifecycleReceipts } from '#/shared/db/schema/context-organization-lifecycle-receipts.schema'
import { organizationLifecycleAuthority } from '#/shared/db/schema/organization-lifecycle.schema'
import type { Tx } from '#/shared/outbox/commit'
import {
  AiPurgeReadinessBlockedError,
  createAiOrganizationLifecycleContributor,
} from './ai-organization-lifecycle.adapter'

const ORGANIZATION_ID = 'org-ai-lifecycle'
const LINEAGE = '7c5a1e2b-3d4f-4a5b-9c8d-0e1f2a3b4c5d'
const RECOVERABLE_UNTIL = new Date('2026-09-28T00:00:00.000Z')
const OCCURRED_AT = new Date('2026-08-28T00:00:00.000Z')

/** The store's own guard: an evidence reference must carry no tenant text. */
const CONTENT_FREE_EVIDENCE_REF = /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$/u

const request = {
  organizationId: ORGANIZATION_ID,
  closureLineageId: LINEAGE,
  lifecycleRevision: 4,
  recoverableUntil: RECOVERABLE_UNTIL,
  occurredAt: OCCURRED_AT,
} as const

const READY = Object.freeze({
  enabled_authorizations: 0,
  active_enrollments: 0,
  in_flight_operations: 0,
})

type ExecutedStatement = Readonly<{ text: string }>

function statementText(statement: unknown): string {
  return JSON.stringify((statement as { queryChunks?: unknown[] }).queryChunks ?? [])
}

function createFakeDb(options: {
  rowsFor: (text: string) => Record<string, unknown>[]
  executed: ExecutedStatement[]
  receipts?: Record<string, unknown>[]
  authorityState?: string
}) {
  const receipts = options.receipts ?? []
  const authorityRow = {
    state: options.authorityState ?? 'closure_requested',
    revision: request.lifecycleRevision,
    closureLineageId: LINEAGE,
    recoverableUntil: RECOVERABLE_UNTIL,
    lastTransitionAt: new Date('2026-08-27T00:00:00.000Z'),
  }
  const transaction = vi.fn(async (fn: (tx: Tx) => Promise<unknown>) => {
    const tx = {
      execute: vi.fn(async (statement: unknown) => {
        const text = statementText(statement)
        options.executed.push({ text })
        return { rows: options.rowsFor(text) }
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
  return { db: { transaction } as unknown as Database, receipts }
}

const footprint = (value: number) => (text: string) =>
  text.includes('AS footprint') ? [{ footprint: value }] : []

describe('AI Organization lifecycle contributor', () => {
  describe('prepareClosing', () => {
    it('answers no_data affirmatively when the Organization never authorized AI', async () => {
      const executed: ExecutedStatement[] = []
      const { db, receipts } = createFakeDb({ executed, rowsFor: footprint(0) })

      const result =
        await createAiOrganizationLifecycleContributor(db).prepareClosing(request)

      expect(result).toEqual({
        outcome: 'no_data',
        evidenceRef: `ai:closing:${LINEAGE}:r4:n0`,
      })
      expect(result.evidenceRef).toMatch(CONTENT_FREE_EVIDENCE_REF)
      expect(receipts).toHaveLength(1)
      expect(executed.filter((statement) => /UPDATE/u.test(statement.text))).toEqual([])
    })

    it('supersedes work authorities and deletes nothing', async () => {
      const executed: ExecutedStatement[] = []
      const { db } = createFakeDb({
        executed,
        rowsFor: (text) => {
          if (text.includes('AS footprint')) return [{ footprint: 6 }]
          if (text.includes('ai_review_analysis_enrollments')) return [{ id: 'e1' }]
          return []
        },
      })

      const result =
        await createAiOrganizationLifecycleContributor(db).prepareClosing(request)

      expect(result).toEqual({
        outcome: 'complete',
        evidenceRef: `ai:closing:${LINEAGE}:r4:n1`,
      })
      const statements = executed.map((statement) => statement.text).join('\n')
      expect(statements).not.toMatch(/DELETE|DROP|TRUNCATE/u)
      expect(statements).toContain('superseded')
      expect(statements).toContain('organization_closing')
      // The merchant authorization head is Identity's to retire; AI must not
      // reach past the schema guard that protects it.
      expect(statements).not.toContain('merchant_ai_enablement')
    })
  })

  describe('verifyPurgeReadiness', () => {
    it('refuses while the merchant authorization is still enabled', async () => {
      const executed: ExecutedStatement[] = []
      const { db, receipts } = createFakeDb({
        executed,
        authorityState: 'closing',
        rowsFor: (text) =>
          text.includes('AS footprint')
            ? [{ footprint: 3 }]
            : [{ ...READY, enabled_authorizations: 2 }],
      })

      const failure = await createAiOrganizationLifecycleContributor(db)
        .verifyPurgeReadiness(request)
        .catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(AiPurgeReadinessBlockedError)
      expect((failure as AiPurgeReadinessBlockedError).blockers).toEqual([
        { code: 'enabled_authorizations', count: 2 },
      ])
      expect((failure as Error).message).not.toContain(ORGANIZATION_ID)
      expect(receipts).toEqual([])
      expect(
        executed.filter((statement) => /UPDATE|DELETE|INSERT/u.test(statement.text)),
      ).toEqual([])
    })

    it('reports complete and reads only once AI has drained', async () => {
      const executed: ExecutedStatement[] = []
      const { db } = createFakeDb({
        executed,
        authorityState: 'closing',
        rowsFor: (text) =>
          text.includes('AS footprint') ? [{ footprint: 5 }] : [{ ...READY }],
      })

      const result =
        await createAiOrganizationLifecycleContributor(db).verifyPurgeReadiness(request)

      expect(result).toEqual({
        outcome: 'complete',
        evidenceRef: `ai:readiness:${LINEAGE}:r4:n5`,
      })
      expect(
        executed.filter((statement) => /UPDATE|DELETE|INSERT/u.test(statement.text)),
      ).toEqual([])
    })
  })

  describe('purge', () => {
    it('erases every derivative and the ledgers that could rebuild one', async () => {
      const executed: ExecutedStatement[] = []
      const { db } = createFakeDb({
        executed,
        authorityState: 'purging',
        rowsFor: (text) => (text.includes('AS footprint') ? [{ footprint: 4 }] : []),
      })

      const result = await createAiOrganizationLifecycleContributor(db).purge(request)

      expect(result.outcome).toBe('complete')
      expect(result.evidenceRef).toMatch(CONTENT_FREE_EVIDENCE_REF)
      const statements = executed.map((statement) => statement.text).join('\n')
      expect(statements).not.toMatch(/DROP |TRUNCATE/u)
      for (const table of [
        'ai_review_analyses',
        'ai_property_daily_aggregates',
        'ai_property_trend_outcomes',
        // Rebuild heads: leaving one behind would make erasure reversible.
        'ai_property_aggregate_heads',
        'ai_review_analysis_enrollments',
      ]) {
        expect(statements).toContain(table)
      }
      // Retained evidence and the Identity-guarded head are left alone.
      expect(statements).not.toContain('merchant_ai_consent_evidence WHERE')
      expect(statements).not.toContain('DELETE FROM merchant_ai_enablement')
    })

    it('answers no_data for an Organization AI never held', async () => {
      const executed: ExecutedStatement[] = []
      const { db } = createFakeDb({
        executed,
        authorityState: 'purging',
        rowsFor: footprint(0),
      })

      const result = await createAiOrganizationLifecycleContributor(db).purge(request)

      expect(result).toEqual({
        outcome: 'no_data',
        evidenceRef: `ai:purge:${LINEAGE}:r4:n0`,
      })
    })
  })

  it('contributes under the ai context', () => {
    const { db } = createFakeDb({ executed: [], rowsFor: footprint(0) })
    expect(createAiOrganizationLifecycleContributor(db).context).toBe('ai')
  })
})
