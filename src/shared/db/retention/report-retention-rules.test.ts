import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import type { RetentionRule } from './execute-retention-rule'
import { buildRetentionRuleReport } from './report-retention-rules'

const DAY_MS = 24 * 60 * 60 * 1000

const rules: ReadonlyArray<RetentionRule> = [
  {
    subject: 'guest_response_private_feedback.expired',
    table: 'guest_response_private_feedback',
    keyColumns: ['response_id'],
    tsColumn: 'expires_at',
    olderThanMs: 0,
  },
  {
    subject: 'scan_events.abuse_pseudonym',
    table: 'scan_events',
    keyColumns: ['id'],
    tsColumn: 'created_at',
    olderThanMs: 7 * DAY_MS,
    operation: 'redact',
    redactColumns: ['ip_hash'],
  },
]

describe('buildRetentionRuleReport', () => {
  it('reports content-free counts and exact cutoffs without mutating rows', async () => {
    const countCandidates = vi.fn().mockResolvedValueOnce(12).mockResolvedValueOnce(4)
    const generatedAt = new Date('2026-08-25T12:00:00.000Z')

    const report = await buildRetentionRuleReport({
      db: {} as Database,
      rules,
      generatedAt,
      batchSize: 5,
      maxBatches: 2,
      countCandidates,
    })

    expect(countCandidates).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      rules[0],
      generatedAt,
    )
    expect(countCandidates).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      rules[1],
      new Date('2026-08-18T12:00:00.000Z'),
    )
    expect(report).toEqual({
      mode: 'report',
      generatedAt: generatedAt.toISOString(),
      batchSize: 5,
      maxBatches: 2,
      maximumRowsPerApply: 10,
      totalEligibleRows: 16,
      rules: [
        {
          subject: 'guest_response_private_feedback.expired',
          operation: 'delete',
          cutoff: generatedAt.toISOString(),
          eligibleRows: 12,
          estimatedBatches: 3,
          wouldReachRunCap: true,
        },
        {
          subject: 'scan_events.abuse_pseudonym',
          operation: 'redact',
          cutoff: '2026-08-18T12:00:00.000Z',
          eligibleRows: 4,
          estimatedBatches: 1,
          wouldReachRunCap: false,
        },
      ],
    })
  })

  it('rejects invalid execution bounds before inspecting the database', async () => {
    const countCandidates = vi.fn()

    await expect(
      buildRetentionRuleReport({
        db: {} as Database,
        rules,
        generatedAt: new Date('2026-08-25T12:00:00.000Z'),
        batchSize: 0,
        maxBatches: 2,
        countCandidates,
      }),
    ).rejects.toThrow('batchSize must be a positive integer')
    expect(countCandidates).not.toHaveBeenCalled()
  })
})
