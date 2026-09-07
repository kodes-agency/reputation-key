import { describe, expect, it } from 'vitest'
import type { Tx } from '#/shared/outbox/commit'
import { METRIC_ORGANIZATION_LIFECYCLE_PHASES } from './metric-organization-lifecycle.adapter'

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
