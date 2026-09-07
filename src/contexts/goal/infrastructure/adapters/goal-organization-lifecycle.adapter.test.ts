// LIF-01-T12/T13/T14 — Goal lifecycle phase contract.
//
// The shared store already proves authority binding and receipt replay, so
// this file proves only what Goal itself decides: that Closing fences the
// active programs without deleting a row, that readiness fails closed on live
// work and never mutates, that purge deletes exactly the reviewed
// tenant-scoped tables and always restores the append-only guards, and that
// every receipt is content-free and deterministic.

import { describe, expect, it } from 'vitest'
import { validateContentFreeEvidenceRef } from '#/shared/db/lifecycle/organization-lifecycle-receipt-store'
import type { Tx } from '#/shared/outbox/commit'
import {
  GOAL_ORGANIZATION_LIFECYCLE_PHASES,
  GOAL_PURGE_TABLES,
} from './goal-organization-lifecycle.adapter'

const ORGANIZATION_ID = 'org-goal-lifecycle-1'
const REQUEST = Object.freeze({
  organizationId: ORGANIZATION_ID,
  closureLineageId: '3f6d5c9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
  lifecycleRevision: 2,
  recoverableUntil: new Date('2026-09-28T00:00:00.000Z'),
  occurredAt: new Date('2026-08-28T00:00:00.000Z'),
})

type Recorded = Readonly<{ text: string; params: readonly unknown[] }>

/** Renders a drizzle SQL object back to text plus its bound parameters. */
function renderSql(statement: unknown): Recorded {
  const chunks = (statement as { queryChunks?: readonly unknown[] }).queryChunks ?? []
  const params: unknown[] = []
  const text = chunks
    .map((chunk) => {
      const kind = (chunk as { constructor?: { name?: string } })?.constructor?.name
      const value = (chunk as { value?: unknown } | null)?.value
      if (kind === 'StringChunk') return (value as readonly string[]).join('')
      if (kind === 'Name') return String(value)
      // A plain template value is stored raw; a drizzle Param wraps it.
      params.push(value === undefined ? chunk : value)
      return '?'
    })
    .join('')
  return { text, params }
}

type FakeOptions = Readonly<{
  tenantRows: number
  activePrograms?: number
  reconcilingResults?: number
  /** Non-zero passes for each self-superseding drain before it reports zero. */
  supersessionPasses?: number
}>

function createFakeTx(options: FakeOptions) {
  const statements: Recorded[] = []
  const chainPasses = new Map<string, number>()
  const tx = {
    execute: async (statement: unknown) => {
      const recorded = renderSql(statement)
      statements.push(recorded)
      if (/active_programs/i.test(recorded.text)) {
        return {
          rows: [
            {
              active_programs: options.activePrograms ?? 0,
              reconciling_results: options.reconcilingResults ?? 0,
            },
          ],
          rowCount: 1,
        }
      }
      if (recorded.text.includes('count(*)')) {
        return { rows: [{ rows: options.tenantRows }], rowCount: 1 }
      }
      const chain = /DELETE FROM (goal_result_revisions) AS target/i.exec(
        recorded.text,
      )?.[1]
      if (chain) {
        const seen = (chainPasses.get(chain) ?? 0) + 1
        chainPasses.set(chain, seen)
        return { rows: [], rowCount: seen <= (options.supersessionPasses ?? 1) ? 2 : 0 }
      }
      return { rows: [], rowCount: 1 }
    },
  } as unknown as Tx
  return { tx, statements }
}

const writes = (statements: readonly Recorded[]): readonly Recorded[] =>
  statements.filter((statement) =>
    /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i.test(statement.text),
  )

describe('goal organization lifecycle phases', () => {
  it('answers every phase affirmatively with a content-free receipt', async () => {
    for (const phase of Object.values(GOAL_ORGANIZATION_LIFECYCLE_PHASES)) {
      const { tx } = createFakeTx({ tenantRows: 9 })
      const result = await phase(tx, REQUEST)

      expect(result.outcome).toBe('complete')
      expect(validateContentFreeEvidenceRef(result.evidenceRef)).toBe(result.evidenceRef)
      expect(result.evidenceRef).not.toContain(ORGANIZATION_ID)
      expect(result.evidenceRef).not.toContain(REQUEST.closureLineageId)
      expect(result.evidenceRef.startsWith('goal:')).toBe(true)
    }
  })

  it('reports no_data — never an omission — for an Organization with no goals', async () => {
    for (const phase of Object.values(GOAL_ORGANIZATION_LIFECYCLE_PHASES)) {
      const { tx } = createFakeTx({ tenantRows: 0 })
      const result = await phase(tx, REQUEST)
      expect(result.outcome).toBe('no_data')
      expect(validateContentFreeEvidenceRef(result.evidenceRef)).toBe(result.evidenceRef)
    }
  })

  it('is deterministic — the same request yields the same receipt', async () => {
    for (const phase of Object.values(GOAL_ORGANIZATION_LIFECYCLE_PHASES)) {
      const first = await phase(createFakeTx({ tenantRows: 9 }).tx, REQUEST)
      const second = await phase(createFakeTx({ tenantRows: 9 }).tx, REQUEST)
      expect(second).toEqual(first)
    }
  })

  it('prepareClosing pauses only active programs and deletes nothing', async () => {
    const { tx, statements } = createFakeTx({ tenantRows: 9 })
    await GOAL_ORGANIZATION_LIFECYCLE_PHASES.prepareClosing(tx, REQUEST)

    const mutations = writes(statements)
    expect(mutations).toHaveLength(1)
    const update = mutations[0]!
    expect(update.text).toMatch(/UPDATE goal_programs/i)
    // Idempotent: the predicate only matches rows still in `active`.
    expect(update.text).toContain("status = 'active'")
    // Reversible: `paused -> active` is a declared Goal Program edge.
    expect(update.text).toContain("status = 'paused'")
    expect(update.params).toContain(ORGANIZATION_ID)
    expect(update.params).toContain(REQUEST.occurredAt)
    expect(statements.some((s) => /\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i.test(s.text))).toBe(
      false,
    )
  })

  it('verifyPurgeReadiness mutates nothing when Goal has no live work', async () => {
    const { tx, statements } = createFakeTx({ tenantRows: 9 })
    await GOAL_ORGANIZATION_LIFECYCLE_PHASES.verifyPurgeReadiness(tx, REQUEST)
    expect(writes(statements)).toEqual([])
  })

  it('verifyPurgeReadiness fails closed while a Goal Program is still active', async () => {
    const { tx, statements } = createFakeTx({ tenantRows: 9, activePrograms: 1 })
    await expect(
      GOAL_ORGANIZATION_LIFECYCLE_PHASES.verifyPurgeReadiness(tx, REQUEST),
    ).rejects.toThrow(/blocked/i)
    expect(writes(statements)).toEqual([])
  })

  it('verifyPurgeReadiness fails closed while a monthly result is reconciling', async () => {
    const { tx } = createFakeTx({ tenantRows: 9, reconcilingResults: 2 })
    await expect(
      GOAL_ORGANIZATION_LIFECYCLE_PHASES.verifyPurgeReadiness(tx, REQUEST),
    ).rejects.toThrow(/blocked/i)
  })

  it('purge deletes exactly the planned tables, each bound to one Organization', async () => {
    const { tx, statements } = createFakeTx({ tenantRows: 9 })
    const result = await GOAL_ORGANIZATION_LIFECYCLE_PHASES.purge(tx, REQUEST)

    expect(result.outcome).toBe('complete')
    const deletes = statements.filter((statement) =>
      /\bDELETE FROM\b/i.test(statement.text),
    )
    const targets = new Set<string>()
    for (const statement of deletes) {
      expect(statement.params).toContain(ORGANIZATION_ID)
      targets.add(/DELETE FROM (\w+)/i.exec(statement.text)?.[1] ?? '')
    }
    expect([...targets].sort()).toEqual([...GOAL_PURGE_TABLES].sort())
  })

  it('purge removes children before the rows they reference', async () => {
    const { tx, statements } = createFakeTx({ tenantRows: 9 })
    await GOAL_ORGANIZATION_LIFECYCLE_PHASES.purge(tx, REQUEST)

    const order = statements
      .map((statement) => /DELETE FROM (\w+)/i.exec(statement.text)?.[1])
      .filter((table): table is string => table !== undefined)
    const firstIndex = (table: string) => order.indexOf(table)
    for (const [child, parent] of [
      ['goal_result_revisions', 'goal_monthly_results'],
      ['goal_monthly_results', 'goal_subject_assignments'],
      ['goal_subject_assignments', 'goal_program_versions'],
      ['goal_program_versions', 'goal_programs'],
    ] as const) {
      expect(firstIndex(child)).toBeLessThan(firstIndex(parent))
    }
  })

  it('purge disables each append-only guard and restores every one of them', async () => {
    const { tx, statements } = createFakeTx({ tenantRows: 9 })
    await GOAL_ORGANIZATION_LIFECYCLE_PHASES.purge(tx, REQUEST)

    const disabled = statements
      .map(
        (statement) => /ALTER TABLE \w+ DISABLE TRIGGER (\w+)/i.exec(statement.text)?.[1],
      )
      .filter((trigger): trigger is string => trigger !== undefined)
    const enabled = statements
      .map(
        (statement) => /ALTER TABLE \w+ ENABLE TRIGGER (\w+)/i.exec(statement.text)?.[1],
      )
      .filter((trigger): trigger is string => trigger !== undefined)

    expect(disabled.length).toBeGreaterThan(0)
    expect(enabled.sort()).toEqual(disabled.sort())
    // Never the blunt instrument that would also suppress foreign keys.
    expect(statements.some((s) => /session_replication_role/i.test(s.text))).toBe(false)
    expect(statements.some((s) => /\bDROP\b|\bTRUNCATE\b/i.test(s.text))).toBe(false)
  })

  it('purge restores the append-only guards even when a delete fails', async () => {
    const { tx, statements } = createFakeTx({ tenantRows: 9 })
    const failing = {
      execute: async (statement: unknown) => {
        const text = renderSql(statement).text
        if (/DELETE FROM goal_monthly_results/i.test(text)) {
          throw new Error('simulated purge interruption')
        }
        return (tx as unknown as { execute: (s: unknown) => Promise<unknown> }).execute(
          statement,
        )
      },
    } as unknown as Tx

    await expect(
      GOAL_ORGANIZATION_LIFECYCLE_PHASES.purge(failing, REQUEST),
    ).rejects.toThrow(/simulated purge interruption/)
    const disabled = statements.filter((s) => /DISABLE TRIGGER/i.test(s.text))
    const enabled = statements.filter((s) => /ENABLE TRIGGER/i.test(s.text))
    expect(enabled).toHaveLength(disabled.length)
  })

  it('purge is a no-op when there is nothing left to scrub', async () => {
    const { tx, statements } = createFakeTx({ tenantRows: 0 })
    const result = await GOAL_ORGANIZATION_LIFECYCLE_PHASES.purge(tx, REQUEST)
    expect(result.outcome).toBe('no_data')
    expect(writes(statements)).toEqual([])
  })
})
