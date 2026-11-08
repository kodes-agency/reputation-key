import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  executeRetentionRule,
  type RetentionRule,
} from '#/shared/db/retention/execute-retention-rule'
import { openRetentionRun, closeRetentionRun } from '#/shared/db/retention/evidence'
import { createRetentionSweepHandler } from './retention-sweep.job'
import { ALERT_DEFINITIONS } from '#/shared/observability/alert-definitions'
import { createAlertAuxReader } from '#/shared/observability/alert-aux-reads'
import { getLogger } from '#/shared/observability/logger'
import type { Database } from '#/shared/db'
import type { OperationsSnapshot } from '#/shared/health/operations-snapshot'

vi.mock('#/shared/db/retention/execute-retention-rule', () => ({
  executeRetentionRule: vi.fn(),
}))
vi.mock('#/shared/db/retention/evidence', () => ({
  openRetentionRun: vi.fn(async (_db, subject: string) => `run-${subject}`),
  closeRetentionRun: vi.fn(async () => {}),
}))

const NOW = new Date('2026-11-08T00:00:00Z')
const RULE_A: RetentionRule = {
  subject: 'a.old',
  table: 'a_table',
  keyColumns: ['id'],
  tsColumn: 'created_at',
  olderThanMs: 30 * 86400000,
}
const RULE_B: RetentionRule = { ...RULE_A, subject: 'b.old', table: 'b_table' }

describe('retention failure and capped recovery', () => {
  beforeEach(() => vi.clearAllMocks())
  it('does not delete without evidence and still attempts the next subject', async () => {
    vi.mocked(openRetentionRun).mockRejectedValueOnce(new Error('evidence unavailable'))
    vi.mocked(executeRetentionRule).mockResolvedValueOnce({
      batches: 0,
      rowsDeleted: 0,
      rowsRedacted: 0,
      capped: false,
    })
    const handler = createRetentionSweepHandler({
      db: {} as never,
      clock: () => NOW,
      rules: [RULE_A, RULE_B],
    })
    await expect(handler({} as never)).rejects.toThrow('a.old')
    expect(executeRetentionRule).toHaveBeenCalledOnce()
    expect(executeRetentionRule).toHaveBeenCalledWith(
      expect.anything(),
      RULE_B,
      expect.anything(),
    )
  })

  it('records committed batch progress when a later batch fails without retaining error text', async () => {
    vi.mocked(executeRetentionRule).mockImplementationOnce(
      async (_db, _rule, options) => {
        options.onBatch?.(1, 100)
        throw new Error('SQL parameters containing private content')
      },
    )
    const handler = createRetentionSweepHandler({
      db: {} as never,
      clock: () => NOW,
      rules: [RULE_A],
    })
    await expect(handler({} as never)).rejects.toThrow('a.old')
    expect(closeRetentionRun).toHaveBeenCalledWith(expect.anything(), 'run-a.old', {
      finishedAt: NOW,
      batches: 1,
      rowsDeleted: 100,
      rowsRedacted: 0,
      outcome: 'failed',
      errorCode: 'retention_failed',
    })
  })

  it('clears capped overdue evidence only after the next pass finishes', async () => {
    vi.mocked(executeRetentionRule)
      .mockResolvedValueOnce({
        batches: 100,
        rowsDeleted: 50_000,
        rowsRedacted: 0,
        capped: true,
      })
      .mockResolvedValueOnce({
        batches: 1,
        rowsDeleted: 4,
        rowsRedacted: 0,
        capped: false,
      })
    const handler = createRetentionSweepHandler({
      db: {} as never,
      clock: () => NOW,
      rules: [RULE_A],
    })
    await handler({} as never)
    const capped = vi.mocked(closeRetentionRun).mock.calls[0]![2]
    const unavailable = () => Promise.reject(new Error('unrelated monitor unavailable'))
    const aux = await createAlertAuxReader({
      db: {
        execute: vi
          .fn()
          .mockResolvedValueOnce({
            rows: [{ subject: RULE_A.subject, outcome: capped.outcome }],
          })
          .mockImplementation(unavailable),
        select: () => ({ from: () => ({ where: unavailable }) }),
      } as unknown as Database,
      logger: getLogger(),
    }).read()
    expect(
      ALERT_DEFINITIONS.find(({ name }) => name === 'retention.failure')?.evaluate?.(
        {} as OperationsSnapshot,
        aux,
      ),
    ).toMatchObject({ name: 'retention.failure', value: 1 })
    await handler({} as never)
    expect(closeRetentionRun).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'run-a.old',
      expect.objectContaining({ outcome: 'failed', errorCode: 'retention_capped' }),
    )
    expect(closeRetentionRun).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'run-a.old',
      expect.objectContaining({ outcome: 'completed', rowsDeleted: 4 }),
    )
  })
})
