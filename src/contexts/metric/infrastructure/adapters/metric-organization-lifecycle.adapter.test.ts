// LIF-01-T12/T13/T14 — Metric lifecycle phase contract.
//
// The shared store already proves authority binding and receipt replay, so
// this file proves only what Metric itself decides: that Closing never
// mutates, that readiness never mutates, that purge deletes exactly the
// reviewed tenant-scoped tables, and that every receipt is content-free and
// deterministic.

import { describe, expect, it } from 'vitest'
import { validateContentFreeEvidenceRef } from '#/shared/db/lifecycle/organization-lifecycle-receipt-store'
import type { Tx } from '#/shared/outbox/commit'
import {
  METRIC_ORGANIZATION_LIFECYCLE_PHASES,
  METRIC_PURGE_TABLES,
} from './metric-organization-lifecycle.adapter'

const ORGANIZATION_ID = 'org-metric-lifecycle-1'
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

/**
 * `tenantRows` drives the count query; `correctionPasses` makes the tip-first
 * correction drain report that many affected rows before reporting zero.
 */
function createFakeTx(tenantRows: number, correctionPasses = 1) {
  const statements: Recorded[] = []
  let correctionDeletes = 0
  const tx = {
    execute: async (statement: unknown) => {
      const recorded = renderSql(statement)
      statements.push(recorded)
      if (/SELECT\s+property_id/i.test(recorded.text)) return { rows: [], rowCount: 0 }
      if (recorded.text.includes('count(*)')) {
        return { rows: [{ rows: tenantRows }], rowCount: 1 }
      }
      if (/DELETE FROM metric_corrections/i.test(recorded.text)) {
        correctionDeletes += 1
        return { rows: [], rowCount: correctionDeletes <= correctionPasses ? 2 : 0 }
      }
      return { rows: [], rowCount: 0 }
    },
  } as unknown as Tx
  return { tx, statements }
}

const writes = (statements: readonly Recorded[]): readonly Recorded[] =>
  statements.filter((statement) =>
    /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i.test(statement.text),
  )

describe('metric organization lifecycle phases', () => {
  it('answers every phase affirmatively with a content-free receipt', async () => {
    for (const phase of Object.values(METRIC_ORGANIZATION_LIFECYCLE_PHASES)) {
      const { tx } = createFakeTx(12)
      const result = await phase(tx, REQUEST)

      expect(result.outcome).toBe('complete')
      expect(validateContentFreeEvidenceRef(result.evidenceRef)).toBe(result.evidenceRef)
      expect(result.evidenceRef).not.toContain(ORGANIZATION_ID)
      expect(result.evidenceRef).not.toContain(REQUEST.closureLineageId)
      expect(result.evidenceRef.startsWith('metric:')).toBe(true)
    }
  })

  it('reports no_data — never an omission — for an Organization with no readings', async () => {
    for (const phase of Object.values(METRIC_ORGANIZATION_LIFECYCLE_PHASES)) {
      const { tx } = createFakeTx(0)
      const result = await phase(tx, REQUEST)
      expect(result.outcome).toBe('no_data')
      expect(validateContentFreeEvidenceRef(result.evidenceRef)).toBe(result.evidenceRef)
    }
  })

  it('is deterministic — the same request yields the same receipt', async () => {
    for (const phase of Object.values(METRIC_ORGANIZATION_LIFECYCLE_PHASES)) {
      const first = await phase(createFakeTx(12).tx, REQUEST)
      const second = await phase(createFakeTx(12).tx, REQUEST)
      expect(second).toEqual(first)
    }
  })

  it('prepareClosing keeps every row — it issues no write at all', async () => {
    const { tx, statements } = createFakeTx(12)
    await METRIC_ORGANIZATION_LIFECYCLE_PHASES.prepareClosing(tx, REQUEST)
    expect(writes(statements)).toEqual([])
  })

  it('verifyPurgeReadiness mutates nothing', async () => {
    const { tx, statements } = createFakeTx(12)
    await METRIC_ORGANIZATION_LIFECYCLE_PHASES.verifyPurgeReadiness(tx, REQUEST)
    expect(writes(statements)).toEqual([])
  })

  it('purge deletes only planned tables, each bound to one Organization', async () => {
    const { tx, statements } = createFakeTx(12)
    const result = await METRIC_ORGANIZATION_LIFECYCLE_PHASES.purge(tx, REQUEST)

    expect(result.outcome).toBe('complete')
    const deletes = statements.filter((statement) =>
      /\bDELETE FROM\b/i.test(statement.text),
    )
    expect(deletes.length).toBeGreaterThan(0)
    const targets = new Set<string>()
    for (const statement of deletes) {
      expect(statement.params).toContain(ORGANIZATION_ID)
      const target = /DELETE FROM (\w+)/i.exec(statement.text)?.[1] ?? ''
      targets.add(target)
      expect(METRIC_PURGE_TABLES).toContain(target)
    }
    // Every planned table is actually reached, and nothing else is.
    expect([...targets].sort()).toEqual([...METRIC_PURGE_TABLES].sort())
  })

  it('purge drains the correction supersession chain tip-first, then stops', async () => {
    const { tx, statements } = createFakeTx(12, 3)
    await METRIC_ORGANIZATION_LIFECYCLE_PHASES.purge(tx, REQUEST)

    const correctionDeletes = statements.filter((statement) =>
      /DELETE FROM metric_corrections/i.test(statement.text),
    )
    // Three passes report rows, the fourth reports zero and ends the drain.
    expect(correctionDeletes).toHaveLength(4)
    for (const statement of correctionDeletes) {
      expect(statement.text).toContain('supersedes_correction_id')
    }
  })

  it('purge is a no-op when there is nothing left to scrub', async () => {
    const { tx, statements } = createFakeTx(0)
    const result = await METRIC_ORGANIZATION_LIFECYCLE_PHASES.purge(tx, REQUEST)
    expect(result.outcome).toBe('no_data')
    expect(writes(statements)).toEqual([])
  })
})
