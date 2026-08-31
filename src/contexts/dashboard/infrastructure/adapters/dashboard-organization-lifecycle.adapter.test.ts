// LIF-01-T12/T13/T14 — Dashboard lifecycle phase contract.
//
// The shared store already proves authority binding and receipt replay, so
// this file proves only what Dashboard itself decides: that Closing touches
// nothing, that readiness never writes, that purge is a bounded tenant-scoped
// delete, and that every receipt is content-free and deterministic.

import { describe, expect, it } from 'vitest'
import { validateContentFreeEvidenceRef } from '#/shared/db/lifecycle/organization-lifecycle-receipt-store'
import type { Tx } from '#/shared/outbox/commit'
import {
  DASHBOARD_ORGANIZATION_LIFECYCLE_PHASES,
  DASHBOARD_PURGE_TABLES,
} from './dashboard-organization-lifecycle.adapter'

const ORGANIZATION_ID = 'org-dashboard-lifecycle-1'
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

function createFakeTx(milestones: number) {
  const statements: Recorded[] = []
  const tx = {
    execute: async (statement: unknown) => {
      const recorded = renderSql(statement)
      statements.push(recorded)
      if (recorded.text.includes('count(*)')) {
        return { rows: [{ rows: milestones }], rowCount: 1 }
      }
      return { rows: [], rowCount: milestones }
    },
  } as unknown as Tx
  return { tx, statements }
}

const writes = (statements: readonly Recorded[]): readonly Recorded[] =>
  statements.filter((statement) =>
    /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i.test(statement.text),
  )

describe('dashboard organization lifecycle phases', () => {
  it('answers every phase affirmatively with a content-free receipt', async () => {
    for (const phase of Object.values(DASHBOARD_ORGANIZATION_LIFECYCLE_PHASES)) {
      const { tx } = createFakeTx(3)
      const result = await phase(tx, REQUEST)

      expect(result.outcome).toBe('complete')
      expect(validateContentFreeEvidenceRef(result.evidenceRef)).toBe(result.evidenceRef)
      expect(result.evidenceRef).not.toContain(ORGANIZATION_ID)
      expect(result.evidenceRef).not.toContain(REQUEST.closureLineageId)
      expect(result.evidenceRef.startsWith('dashboard:')).toBe(true)
    }
  })

  it('reports no_data — never an omission — when the Organization has no milestone', async () => {
    for (const phase of Object.values(DASHBOARD_ORGANIZATION_LIFECYCLE_PHASES)) {
      const { tx } = createFakeTx(0)
      const result = await phase(tx, REQUEST)
      expect(result.outcome).toBe('no_data')
      expect(validateContentFreeEvidenceRef(result.evidenceRef)).toBe(result.evidenceRef)
    }
  })

  it('is deterministic — the same request yields the same receipt', async () => {
    for (const phase of Object.values(DASHBOARD_ORGANIZATION_LIFECYCLE_PHASES)) {
      const first = await phase(createFakeTx(3).tx, REQUEST)
      const second = await phase(createFakeTx(3).tx, REQUEST)
      expect(second).toEqual(first)
    }
  })

  it('prepareClosing stops effects without writing anything at all', async () => {
    const { tx, statements } = createFakeTx(3)
    await DASHBOARD_ORGANIZATION_LIFECYCLE_PHASES.prepareClosing(tx, REQUEST)
    expect(writes(statements)).toEqual([])
  })

  it('verifyPurgeReadiness mutates nothing', async () => {
    const { tx, statements } = createFakeTx(3)
    await DASHBOARD_ORGANIZATION_LIFECYCLE_PHASES.verifyPurgeReadiness(tx, REQUEST)
    expect(writes(statements)).toEqual([])
  })

  it('purge deletes only the planned table, bound to one Organization', async () => {
    const { tx, statements } = createFakeTx(3)
    const result = await DASHBOARD_ORGANIZATION_LIFECYCLE_PHASES.purge(tx, REQUEST)

    expect(result.outcome).toBe('complete')
    const deletes = statements.filter((statement) => /\bDELETE\b/i.test(statement.text))
    expect(deletes).toHaveLength(1)
    for (const statement of deletes) {
      expect(statement.text).toContain('organization_id = ?')
      expect(statement.params).toContain(ORGANIZATION_ID)
      const target = /DELETE FROM (\w+)/i.exec(statement.text)?.[1]
      expect(DASHBOARD_PURGE_TABLES).toContain(target)
    }
    expect(
      statements.some((statement) => /\bDROP\b|\bTRUNCATE\b/i.test(statement.text)),
    ).toBe(false)
  })

  it('purge is a no-op when there is nothing left to scrub', async () => {
    const { tx, statements } = createFakeTx(0)
    const result = await DASHBOARD_ORGANIZATION_LIFECYCLE_PHASES.purge(tx, REQUEST)
    expect(result.outcome).toBe('no_data')
    expect(writes(statements)).toEqual([])
  })
})
