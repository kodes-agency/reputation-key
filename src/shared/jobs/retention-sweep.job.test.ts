// Retention sweep job unit tests (BQC-1.6).
// Per-rule evidence rows, failure isolation, aggregate failure semantics.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('#/shared/db/retention/execute-retention-rule', () => ({
  executeRetentionRule: vi.fn(),
}))
vi.mock('#/shared/db/retention/evidence', () => ({
  openRetentionRun: vi.fn(async (_db, subject: string) => `run-${subject}`),
  closeRetentionRun: vi.fn(async () => {}),
}))
vi.mock('#/shared/observability/logger', () => ({
  getLogger: vi.fn(() => mockLogger),
}))

import { executeRetentionRule } from '#/shared/db/retention/execute-retention-rule'
import { openRetentionRun, closeRetentionRun } from '#/shared/db/retention/evidence'
import { createRetentionSweepHandler, RETENTION_RULES } from './retention-sweep.job'
import type { RetentionRule } from '#/shared/db/retention/execute-retention-rule'

const NOW = new Date('2026-07-17T12:00:00Z')

const RULE_A: RetentionRule = {
  subject: 'a.old',
  table: 'a_table',
  keyColumns: ['id'],
  tsColumn: 'created_at',
  olderThanMs: 30 * 24 * 60 * 60 * 1000,
}
const RULE_B: RetentionRule = {
  subject: 'b.old',
  table: 'b_table',
  keyColumns: ['id'],
  tsColumn: 'created_at',
  olderThanMs: 30 * 24 * 60 * 60 * 1000,
}

describe('retention sweep job (BQC-1.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens and closes an evidence row per rule with counts', async () => {
    ;(executeRetentionRule as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ batches: 2, rowsDeleted: 7 })
      .mockResolvedValueOnce({ batches: 1, rowsDeleted: 3 })

    const handler = createRetentionSweepHandler({
      db: {} as never,
      clock: () => NOW,
      rules: [RULE_A, RULE_B],
      batchSize: 100,
    })
    await handler({} as never)

    expect(openRetentionRun).toHaveBeenCalledTimes(2)
    expect(openRetentionRun).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'a.old',
      100,
      NOW,
    )
    expect(closeRetentionRun).toHaveBeenCalledTimes(2)
    expect(closeRetentionRun).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'run-a.old',
      expect.objectContaining({ batches: 2, rowsDeleted: 7, outcome: 'completed' }),
    )
    // Cutoff derived from the rule's olderThanMs
    const firstCall = (executeRetentionRule as ReturnType<typeof vi.fn>).mock.calls[0]
    expect((firstCall[2] as { cutoff: Date }).cutoff).toEqual(
      new Date(NOW.getTime() - RULE_A.olderThanMs),
    )
  })

  it('a failing rule records failed outcome, does not block others, and the job throws after the sweep', async () => {
    ;(executeRetentionRule as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('relation a_table does not exist'))
      .mockResolvedValueOnce({ batches: 1, rowsDeleted: 5 })

    const handler = createRetentionSweepHandler({
      db: {} as never,
      clock: () => NOW,
      rules: [RULE_A, RULE_B],
      batchSize: 100,
    })

    await expect(handler({} as never)).rejects.toThrow(/1 rule\(s\) failed: a\.old/)

    // The second rule still ran
    expect(executeRetentionRule).toHaveBeenCalledTimes(2)
    expect(closeRetentionRun).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'run-a.old',
      expect.objectContaining({ outcome: 'failed' }),
    )
    expect(closeRetentionRun).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'run-b.old',
      expect.objectContaining({ outcome: 'completed', rowsDeleted: 5 }),
    )
  })

  it('logs an info line when a rule hits the per-run batch cap (BQC-3.7)', async () => {
    ;(executeRetentionRule as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      batches: 100,
      rowsDeleted: 50_000,
      capped: true,
    })

    const handler = createRetentionSweepHandler({
      db: {} as never,
      clock: () => NOW,
      rules: [RULE_A],
      batchSize: 500,
    })
    await handler({} as never)

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'a.old', capped: true }),
      expect.stringMatching(/batch cap/i),
    )
    // The run still closes as completed — the next scheduled run continues.
    expect(closeRetentionRun).toHaveBeenCalledWith(
      expect.anything(),
      'run-a.old',
      expect.objectContaining({ outcome: 'completed' }),
    )
  })
})

describe('retention rule registry (BQC-3.7)', () => {
  it('keys outbox retention on published_at, not created_at', () => {
    const outboxRule = RETENTION_RULES.find(
      (r) => r.subject === 'outbox_events.published',
    )
    expect(outboxRule).toBeDefined()
    // An event unpublished 29d then published must survive ~30 more days —
    // keying on created_at would delete it ~1d after publication.
    expect(outboxRule!.tsColumn).toBe('published_at')
    expect(outboxRule!.extraWhere).toBe('published_at IS NOT NULL')
    // BQC-1.6's deliberate 30d value (the migration-file comment drift —
    // 7d/90d — is documented at the rule; applied migrations are immutable).
    expect(outboxRule!.olderThanMs).toBe(30 * 24 * 60 * 60 * 1000)
  })
})
