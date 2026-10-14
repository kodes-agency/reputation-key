import { describe, expect, it } from 'vitest'
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

/**
 * Renders a drizzle SQL object back to text plus its bound parameters, nested
 * fragments (`sql.join`, a `sql` inside a `sql`) included.
 */
function renderSql(statement: unknown): Recorded {
  const chunks = (statement as { queryChunks?: readonly unknown[] }).queryChunks ?? []
  const params: unknown[] = []
  const text = chunks
    .map((chunk) => {
      const kind = (chunk as { constructor?: { name?: string } })?.constructor?.name
      const value = (chunk as { value?: unknown } | null)?.value
      if (kind === 'StringChunk') return (value as readonly string[]).join('')
      if (kind === 'Name') return String(value)
      if (kind === 'SQL') {
        const nested = renderSql(chunk)
        params.push(...nested.params)
        return nested.text
      }
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
  // A failed statement aborts the PostgreSQL transaction: anything sent after
  // it is refused, and that refusal would be reported instead of the failure.
  // The rollback restores the guard (the integration test proves both).
  it('purge sends nothing after a delete fails, so the failure is what is reported', async () => {
    const { tx, statements } = createFakeTx({ tenantRows: 9 })
    const interruption = new Error('simulated purge interruption')
    const failing = {
      execute: async (statement: unknown) => {
        const text = renderSql(statement).text
        if (/DELETE FROM goal_monthly_results/i.test(text)) throw interruption
        return (tx as unknown as { execute: (s: unknown) => Promise<unknown> }).execute(
          statement,
        )
      },
    } as unknown as Tx

    await expect(GOAL_ORGANIZATION_LIFECYCLE_PHASES.purge(failing, REQUEST)).rejects.toBe(
      interruption,
    )
    const sent = writes(statements).map((statement) => statement.text)
    expect(sent.at(-1)).toMatch(/DELETE FROM goal_result_revisions/u)
    expect(sent.filter((text) => /ENABLE TRIGGER/u.test(text))).toEqual([])
  })

  it('purge lifts the guard for its deletes and restores it once they are done', async () => {
    const { tx, statements } = createFakeTx({ tenantRows: 9 })

    await GOAL_ORGANIZATION_LIFECYCLE_PHASES.purge(tx, REQUEST)

    const sent = writes(statements).map((statement) => statement.text)
    expect(sent.at(0)).toBe(
      'ALTER TABLE goal_monthly_results DISABLE TRIGGER goal_monthly_results_guard',
    )
    expect(sent.at(-1)).toBe(
      'ALTER TABLE goal_monthly_results ENABLE TRIGGER goal_monthly_results_guard',
    )
  })

  it('purges the month target log before the results, versions and Programs it references', async () => {
    const { tx, statements } = createFakeTx({ tenantRows: 9 })

    await GOAL_ORGANIZATION_LIFECYCLE_PHASES.purge(tx, REQUEST)

    // The log holds its month, its Program and a following version with
    // ON DELETE RESTRICT, so it has to go before any of them.
    expect(GOAL_PURGE_TABLES[0]).toBe('goal_month_target_changes')
    const deleted = statements.flatMap((statement) => {
      const table = /DELETE FROM (\w+)/u.exec(statement.text)?.[1]
      return table ? [table] : []
    })
    // The revision chain drains in passes, so its table repeats.
    expect([...new Set(deleted)]).toEqual([...GOAL_PURGE_TABLES])
    for (const statement of statements.filter((s) => /DELETE FROM/u.test(s.text))) {
      expect(statement.text).toMatch(/organization_id = \?/u)
      expect(statement.params).toEqual([ORGANIZATION_ID])
    }
  })

  it('purges the Google rating goal change log before the goals it names', async () => {
    const { tx, statements } = createFakeTx({ tenantRows: 2 })

    await GOAL_ORGANIZATION_LIFECYCLE_PHASES.purge(tx, REQUEST)

    const deleted = statements.flatMap((statement) => {
      const table = /DELETE FROM (\w+)/u.exec(statement.text)?.[1]
      return table ? [table] : []
    })
    expect(deleted.slice(-2)).toEqual([
      'property_rating_goal_changes',
      'property_rating_goals',
    ])
  })

  it('counts every table of the purge plan as tenant rows', async () => {
    const { tx, statements } = createFakeTx({ tenantRows: 0 })

    await GOAL_ORGANIZATION_LIFECYCLE_PHASES.purge(tx, REQUEST)

    const [count] = statements.filter((s) => s.text.includes('count(*)'))
    for (const table of GOAL_PURGE_TABLES) {
      expect(count!.text).toContain(`FROM ${table}`)
    }
    expect(count!.text).toContain('FROM goal_month_target_changes')
    expect(new Set(count!.params)).toEqual(new Set([ORGANIZATION_ID]))
  })

  it('purge is a no-op when there is nothing left to scrub', async () => {
    const { tx, statements } = createFakeTx({ tenantRows: 0 })
    const result = await GOAL_ORGANIZATION_LIFECYCLE_PHASES.purge(tx, REQUEST)
    expect(result.outcome).toBe('no_data')
    expect(writes(statements)).toEqual([])
  })
})
