import { describe, expect, it } from 'vitest'
import type { Tx } from '#/shared/outbox/commit'
import { GOAL_ORGANIZATION_LIFECYCLE_PHASES } from './goal-organization-lifecycle.adapter'

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
  it('purge restores the retained validation guard even when a delete fails', async () => {
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
