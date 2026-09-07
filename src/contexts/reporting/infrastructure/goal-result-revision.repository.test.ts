import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { auditLogs } from '#/shared/db/schema/audit'
import { goalMonthlyResults, goalResultRevisions } from '#/shared/db/schema/goal.schema'
import type { ClosedGoalResultHead } from '../application/ports/goal-program.repository'
import { createGoalProgramRepository } from './repositories/goal-program.repository'
import { insertOutboxRow } from '#/shared/outbox/commit'

vi.mock('#/shared/outbox/commit', () => ({
  insertOutboxRow: vi.fn(async () => undefined),
}))

const CLOSED_AT = new Date('2026-08-02T12:00:00.000Z')
const PERIOD_START = new Date('2026-07-01T00:00:00.000Z')
const PERIOD_END = new Date('2026-08-01T00:00:00.000Z')

const base = {
  id: '10000000-0000-4000-8000-000000000001',
  assignmentId: '10000000-0000-4000-8000-000000000002',
  programId: '10000000-0000-4000-8000-000000000003',
  programVersionId: '10000000-0000-4000-8000-000000000004',
  organizationId: 'org-goal-revision',
  propertyId: '10000000-0000-4000-8000-000000000005',
  periodStart: PERIOD_START,
  periodEnd: PERIOD_END,
  propertyTimezone: 'UTC',
  status: 'closed',
  evaluationState: 'eligible',
  value: 12,
  sampleCount: 12,
  achieved: true,
  reason: null,
  sourceCompleteThrough: PERIOD_END,
  evaluationWatermark: CLOSED_AT,
  closedAt: CLOSED_AT,
  createdAt: PERIOD_START,
  updatedAt: CLOSED_AT,
} satisfies typeof goalMonthlyResults.$inferSelect

const head: ClosedGoalResultHead = {
  result: {
    id: base.id,
    assignmentId: base.assignmentId,
    programId: base.programId,
    programVersionId: base.programVersionId,
    organizationId: base.organizationId,
    propertyId: base.propertyId,
    periodStart: base.periodStart,
    periodEnd: base.periodEnd,
    propertyTimezone: base.propertyTimezone,
    status: 'closed',
    evaluation: {
      state: 'eligible',
      value: 12,
      sampleCount: 12,
      achieved: true,
      reason: null,
    },
    sourceCompleteThrough: PERIOD_END,
    evaluationWatermark: CLOSED_AT,
    closedAt: CLOSED_AT,
    createdAt: PERIOD_START,
    updatedAt: CLOSED_AT,
  },
  revision: null,
}

function database(options: { outboxFails?: boolean } = {}) {
  const revisionRows: Record<string, unknown>[] = []
  const auditRows: Record<string, unknown>[] = []
  let selectCall = 0
  const tx = {
    select: vi.fn(() => {
      selectCall += 1
      return {
        from: vi.fn(() => ({
          where: vi.fn(() =>
            selectCall === 1
              ? {
                  for: vi.fn(() => ({ limit: vi.fn(async () => [base]) })),
                }
              : {
                  orderBy: vi.fn(() => ({ limit: vi.fn(async () => []) })),
                },
          ),
        })),
      }
    }),
    insert: vi.fn((table: unknown) => {
      if (table === goalResultRevisions) {
        return {
          values: vi.fn((row: Record<string, unknown>) => {
            revisionRows.push(row)
            return { returning: vi.fn(async () => [row]) }
          }),
        }
      }
      if (table === auditLogs) {
        return {
          values: vi.fn(async (row: Record<string, unknown>) => {
            auditRows.push(row)
          }),
        }
      }
      throw new Error('unexpected table')
    }),
  }
  const db = {
    transaction: vi.fn(async (work: (input: typeof tx) => Promise<unknown>) => work(tx)),
  } as unknown as Database
  if (options.outboxFails) {
    vi.mocked(insertOutboxRow).mockRejectedValueOnce(new Error('outbox unavailable'))
  }
  return { db, tx, revisionRows, auditRows }
}

describe('Goal Program closed-result revision writer', () => {
  beforeEach(() => vi.clearAllMocks())

  it('appends a revision and identifier-only fact without rewriting the base row', async () => {
    const fake = database()
    const at = new Date('2026-08-03T12:00:00.000Z')
    const result = await createGoalProgramRepository(fake.db).appendResultRevision({
      head,
      revisionId: '10000000-0000-4000-8000-000000000006',
      evaluation: {
        state: 'eligible',
        value: 8,
        sampleCount: 8,
        achieved: false,
        reason: null,
      },
      sourceCompleteThrough: PERIOD_END,
      evaluationWatermark: at,
      changeReason: 'metric_correction_reconciliation',
      createdBy: 'system',
      at,
    })

    expect(result).toMatchObject({
      status: 'revised',
      revision: { revision: 1, supersedesRevisionId: null },
      outcomeChanged: true,
      availabilityChanged: false,
    })
    expect(fake.revisionRows).toHaveLength(1)
    expect(fake.auditRows).toHaveLength(1)
    expect(fake.tx).not.toHaveProperty('update')
    expect(insertOutboxRow).toHaveBeenCalledWith(
      fake.tx,
      expect.objectContaining({
        _tag: 'goal.monthly_result.revised',
        revision: 1,
        outcomeChanged: true,
        availabilityChanged: false,
      }),
      { recordedAt: at },
    )
  })

  it('does not expose a successful revision when the durable fact fails', async () => {
    const fake = database({ outboxFails: true })

    await expect(
      createGoalProgramRepository(fake.db).appendResultRevision({
        head,
        revisionId: '10000000-0000-4000-8000-000000000006',
        evaluation: {
          state: 'unavailable',
          value: null,
          sampleCount: 0,
          achieved: null,
          reason: 'source_unavailable',
        },
        sourceCompleteThrough: null,
        evaluationWatermark: CLOSED_AT,
        changeReason: 'metric_correction_reconciliation',
        createdBy: 'system',
        at: CLOSED_AT,
      }),
    ).rejects.toThrow('outbox unavailable')
  })
})
