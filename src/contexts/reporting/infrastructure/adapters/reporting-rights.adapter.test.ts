import { describe, expect, it } from 'vitest'
import type { Tx } from '#/shared/outbox/commit'
import { REPORTING_EXPORT_TABLES, REPORTING_PURGE_ORDER } from './reporting-rights-plan'
import {
  projectTenantRows,
  reportingPurgeInTransaction,
} from './reporting-rights.adapter'

const ORG = 'org-a'
const AT = new Date('2026-11-08T00:00:00.000Z')

type Recorded = Readonly<{ text: string; params: readonly unknown[] }>

function renderSql(statement: unknown): Recorded {
  const params: unknown[] = []
  const walk = (node: unknown): string => {
    const chunks = (node as { queryChunks?: readonly unknown[] }).queryChunks
    if (!chunks) {
      params.push(node)
      return '?'
    }
    return chunks
      .map((chunk) => {
        const kind = (chunk as { constructor?: { name?: string } })?.constructor?.name
        const value = (chunk as { value?: unknown } | null)?.value
        if (kind === 'StringChunk') return (value as readonly string[]).join('')
        if (kind === 'Name') return `"${String(value)}"`
        if ((chunk as { queryChunks?: unknown }).queryChunks) return walk(chunk)
        params.push(value === undefined ? chunk : value)
        return '?'
      })
      .join('')
  }
  return { text: walk(statement).trim(), params }
}

function createFakeTx(options: { state?: string | null; liveGoals?: number } = {}) {
  const statements: Recorded[] = []
  const passes = new Map<string, number>()
  const state = options.state === undefined ? 'purge_pending' : options.state
  const tx = {
    execute: async (statement: unknown) => {
      const recorded = renderSql(statement)
      statements.push(recorded)
      if (recorded.text.includes('organization_lifecycle_authority')) {
        return { rows: state === null ? [] : [{ state }], rowCount: 1 }
      }
      if (recorded.text.includes('AS active_programs')) {
        return {
          rows: [{ active_programs: options.liveGoals ?? 0, reconciling: 0 }],
          rowCount: 1,
        }
      }
      if (recorded.text.includes('FROM portals')) return { rows: [], rowCount: 0 }
      if (recorded.text.startsWith('DELETE')) {
        // A supersession drain reports rows once, then nothing left.
        const drained = recorded.text.includes('NOT EXISTS')
        const seen = (passes.get(recorded.text) ?? 0) + 1
        passes.set(recorded.text, seen)
        return { rows: [], rowCount: drained && seen > 1 ? 0 : 3 }
      }
      return { rows: [], rowCount: 0 }
    },
  } as unknown as Tx
  return { tx, statements }
}

describe('projectTenantRows', () => {
  const spec = REPORTING_EXPORT_TABLES.find((table) => table.table === 'goal_programs')!

  it('keeps only allowlisted columns', () => {
    const rows = projectTenantRows(
      spec,
      [{ tenant_organization_id: ORG, id: 'p1', name: 'Goal', internal_note: 'x' }],
      ORG,
    )
    expect(Object.keys(rows[0]!).sort()).toEqual([...spec.columns].sort())
    expect(rows[0]).not.toHaveProperty('internal_note')
    expect(rows[0]).not.toHaveProperty('tenant_organization_id')
  })

  it('aborts when a row belongs to another Organization', () => {
    expect(() =>
      projectTenantRows(spec, [{ tenant_organization_id: 'org-b', id: 'p1' }], ORG),
    ).toThrow(/outside the requested Organization/)
  })

  it('never lists a tenant or control column', () => {
    for (const table of REPORTING_EXPORT_TABLES) {
      expect(table.columns).not.toContain('organization_id')
      expect(table.columns).not.toContain('source_event_id')
    }
  })
})

describe('reporting purge', () => {
  it('refuses an Organization that is still active, before touching a row', async () => {
    const { tx, statements } = createFakeTx({ state: 'active' })
    await expect(reportingPurgeInTransaction(tx, ORG, AT)).rejects.toThrow(/still active/)
    expect(statements.some((s) => /DELETE|UPDATE|ALTER/.test(s.text))).toBe(false)
  })

  it('refuses an Organization with no lifecycle record', async () => {
    const { tx } = createFakeTx({ state: null })
    await expect(reportingPurgeInTransaction(tx, ORG, AT)).rejects.toThrow(
      /no lifecycle record/,
    )
  })

  it('refuses while a goal is still active after the fence', async () => {
    const { tx, statements } = createFakeTx({ liveGoals: 1 })
    await expect(reportingPurgeInTransaction(tx, ORG, AT)).rejects.toThrow(
      /still being evaluated/,
    )
    expect(statements.some((s) => s.text.startsWith('DELETE'))).toBe(false)
  })

  it('deletes in the planned order, each statement bound to the Organization', async () => {
    const { tx, statements } = createFakeTx()
    const outcome = await reportingPurgeInTransaction(tx, ORG, AT)
    const deletes = statements.filter((s) => s.text.startsWith('DELETE'))
    expect(deletes.length).toBeGreaterThanOrEqual(REPORTING_PURGE_ORDER.length)
    for (const statement of deletes) expect(statement.params).toContain(ORG)
    const deletedTables = deletes.map(
      (s) => /FROM "(\w+)"/.exec(s.text)?.[1] ?? /FROM (\w+)/.exec(s.text)?.[1],
    )
    expect(deletedTables.indexOf('goal_monthly_results')).toBeGreaterThan(
      deletedTables.indexOf('goal_result_revisions'),
    )
    expect(Object.keys(outcome.deleted)).toEqual([...REPORTING_PURGE_ORDER])
    expect(outcome.evidenceRef).toMatch(/^reporting:purge:v1:tenant_rows_deleted:\d+$/)
  })

  it('disables the monthly-result guard only between fence and delete, and restores it', async () => {
    const { tx, statements } = createFakeTx()
    await reportingPurgeInTransaction(tx, ORG, AT)
    const texts = statements.map((s) => s.text)
    const off = texts.findIndex((t) => t.includes('DISABLE TRIGGER'))
    const on = texts.findIndex((t) => t.includes('ENABLE TRIGGER'))
    const firstDelete = texts.findIndex((t) => t.startsWith('DELETE'))
    const lastDelete = texts.map((t) => t.startsWith('DELETE')).lastIndexOf(true)
    expect(off).toBeGreaterThan(-1)
    expect(off).toBeLessThan(firstDelete)
    expect(on).toBeGreaterThan(lastDelete)
    expect(texts.join('\n')).not.toContain('session_replication_role')
    expect(texts[0]).toContain('lock_timeout')
  })
})
