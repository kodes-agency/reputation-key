import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { formatRetentionDryRun, runRetentionDryRun } from './dry-run-retention'
import type { RetentionRule } from './execute-retention-rule'

const rules: ReadonlyArray<RetentionRule> = [
  {
    subject: 'a.expired',
    table: 'a',
    keyColumns: ['id'],
    tsColumn: 'expires_at',
    olderThanMs: 0,
  },
  {
    subject: 'b.redacted',
    table: 'b',
    keyColumns: ['id'],
    tsColumn: 'created_at',
    olderThanMonths: 24,
    operation: 'redact',
    redactColumns: ['ip_hash'],
  },
]

function fakeDb() {
  const statements: string[] = []
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ count: 3, oldest: '2026-01-02T00:00:00.000Z' }] })
    .mockResolvedValueOnce({ rows: [{ count: 0, oldest: null }] })
  const transaction = vi.fn(
    async (run: (tx: unknown) => Promise<unknown>, _config: unknown) => run({ execute }),
  )
  return { db: { transaction } as unknown as Database, transaction, execute, statements }
}

describe('runRetentionDryRun', () => {
  it('runs every statement in one READ ONLY transaction', async () => {
    const { db, transaction, execute } = fakeDb()

    await runRetentionDryRun({ db, rules, now: new Date('2026-11-13T00:00:00.000Z') })

    expect(transaction).toHaveBeenCalledTimes(1)
    expect(transaction.mock.calls[0]?.[1]).toEqual({ accessMode: 'read only' })
    expect(execute).toHaveBeenCalledTimes(rules.length)
  })

  it('reports subject, action, count and oldest per rule, with no row content', async () => {
    const { db } = fakeDb()
    const now = new Date('2026-11-13T00:00:00.000Z')

    const run = await runRetentionDryRun({ db, rules, now })

    expect(run).toEqual({
      mode: 'dry-run',
      generatedAt: now.toISOString(),
      totalRows: 3,
      rules: [
        {
          subject: 'a.expired',
          action: 'delete',
          cutoff: now.toISOString(),
          rows: 3,
          oldest: '2026-01-02T00:00:00.000Z',
        },
        {
          subject: 'b.redacted',
          action: 'redact',
          cutoff: '2024-11-13T00:00:00.000Z',
          rows: 0,
          oldest: null,
        },
      ],
    })
    expect(formatRetentionDryRun(run)).toContain('total 3 rows across 2 rules')
  })
})
