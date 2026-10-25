import { describe, expect, it, vi } from 'vitest'
import {
  aiReopenAnalysesCommandSpec,
  planAiReopenAnalyses,
  runAiReopenAnalyses,
  type ReopenedAnalysisRow,
  type SpentAnalysisRow,
  type SpentAnalysisStore,
} from './ai-reopen-analyses-command'
import { parseOperatorArgs, validateOperatorArgs } from './operator-command'

const PROPERTY = '5eed0100-0000-4000-8000-000000000001'
const OTHER_PROPERTY = '5eed0100-0000-4000-8000-000000000002'
const SPEC = aiReopenAnalysesCommandSpec
const NOW = new Date('2026-10-25T20:00:00.000Z')

function argsOf(...argv: string[]) {
  const parsed = parseOperatorArgs(argv, SPEC)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.args
}

const SPENT: ReadonlyArray<SpentAnalysisRow> = [
  {
    organizationId: 'org-1',
    propertyId: PROPERTY,
    reviewId: 'review-1',
    operationId: 'operation-1',
    failureCode: 'operation_ambiguous',
    failedAt: new Date('2026-10-24T20:58:55.401Z'),
    analysisSequence: 4006,
  },
  {
    organizationId: 'org-2',
    propertyId: OTHER_PROPERTY,
    reviewId: 'review-2',
    operationId: 'operation-2',
    failureCode: 'quota_exhausted',
    failedAt: new Date('2026-10-25T17:49:55.259Z'),
    analysisSequence: 12,
  },
]

const REOPENED: ReadonlyArray<ReopenedAnalysisRow> = SPENT.map((row) => ({
  organizationId: row.organizationId,
  propertyId: row.propertyId,
  reviewId: row.reviewId,
  operationId: row.operationId,
  previousSequence: row.analysisSequence,
  analysisSequence: row.analysisSequence + 10,
}))

function harness(overrides: Partial<SpentAnalysisStore> = {}) {
  const lines: string[] = []
  const errors: string[] = []
  const store: SpentAnalysisStore = {
    list: vi.fn(async () => SPENT),
    reopen: vi.fn(async () => REOPENED),
    ...overrides,
  }
  return {
    lines,
    errors,
    store,
    io: {
      out: (line: string) => lines.push(line),
      err: (line: string) => errors.push(line),
    },
  }
}

const ctx = (dryRun: boolean, batchSize = 200) => ({
  dryRun,
  operatorId: 'denev',
  correlationId: 'corr-1',
  reason: dryRun ? undefined : 'provider credit restored',
  batchSize,
})

describe('ops ai-reopen-analyses invocation', () => {
  it.each([
    [[PROPERTY], PROPERTY],
    [[PROPERTY.toUpperCase()], PROPERTY],
    [['all'], null],
  ])('takes one Property id or all: %j', (positionals, propertyId) => {
    expect(planAiReopenAnalyses(argsOf(...positionals, '--operator', 'denev'))).toEqual({
      ok: true,
      propertyId,
    })
  })

  it.each([
    [[], "<propertyId> or 'all' is required"],
    [['not-a-uuid'], "<propertyId> must be a UUID or 'all'"],
    [[PROPERTY, OTHER_PROPERTY], "one <propertyId> or 'all'"],
  ])('rejects %j', (positionals, error) => {
    expect(planAiReopenAnalyses(argsOf(...positionals, '--operator', 'denev'))).toEqual({
      ok: false,
      error,
    })
  })

  it('reports by default and needs a reason to apply', () => {
    expect(validateOperatorArgs(SPEC, argsOf('all', '--operator', 'denev'))).toBeNull()
    expect(
      validateOperatorArgs(SPEC, argsOf('all', '--operator', 'denev', '--apply')),
    ).toContain('--reason')
    expect(
      validateOperatorArgs(
        SPEC,
        argsOf('all', '--operator', 'denev', '--reason', 'credit restored', '--apply'),
      ),
    ).toBeNull()
  })

  it('bounds the batch', () => {
    expect(
      validateOperatorArgs(
        SPEC,
        argsOf('all', '--operator', 'denev', '--batch-size', '1001'),
      ),
    ).toContain('<= 1000')
  })
})

describe('ops ai-reopen-analyses run', () => {
  it('lists the spent reviews without writing in a dry run', async () => {
    const value = harness()
    const code = await runAiReopenAnalyses({
      ctx: ctx(true, 50),
      propertyId: null,
      store: value.store,
      io: value.io,
    })

    expect(code).toBe(0)
    expect(value.store.list).toHaveBeenCalledWith({ propertyId: null, limit: 50 })
    expect(value.store.reopen).not.toHaveBeenCalled()
    expect(JSON.parse(value.lines[0] ?? '')).toEqual({
      outcome: 'would_reopen',
      target: 'all',
      limit: 50,
      candidates: 2,
      byProperty: { [PROPERTY]: 1, [OTHER_PROPERTY]: 1 },
      reviews: SPENT.map((row) => ({ ...row, failedAt: row.failedAt.toISOString() })),
    })
    expect(value.lines[1]).toContain('2 review(s)')
  })

  it('says when nothing waits', async () => {
    const value = harness({ list: vi.fn(async () => []) })
    await runAiReopenAnalyses({
      ctx: ctx(true),
      propertyId: PROPERTY,
      store: value.store,
      io: value.io,
    })
    expect(value.lines[1]).toBe(
      'report only — no review is waiting for an operator reopen',
    )
  })

  it('reopens and prints the audit record on apply', async () => {
    const value = harness()
    const code = await runAiReopenAnalyses({
      ctx: ctx(false),
      propertyId: PROPERTY,
      store: value.store,
      io: value.io,
      now: () => NOW,
    })

    expect(code).toBe(0)
    expect(value.store.list).not.toHaveBeenCalled()
    expect(value.store.reopen).toHaveBeenCalledWith({
      propertyId: PROPERTY,
      limit: 200,
      occurredAt: NOW,
    })
    expect(JSON.parse(value.lines[0] ?? '')).toEqual({
      outcome: 'reopened',
      operator: 'denev',
      reason: 'provider credit restored',
      correlationId: 'corr-1',
      target: PROPERTY,
      reopened: 2,
      byProperty: { [PROPERTY]: 1, [OTHER_PROPERTY]: 1 },
      reviews: REOPENED,
    })
  })

  it('reports a second apply that finds nothing', async () => {
    const value = harness({ reopen: vi.fn(async () => []) })
    await runAiReopenAnalyses({
      ctx: ctx(false),
      propertyId: null,
      store: value.store,
      io: value.io,
      now: () => NOW,
    })
    expect(JSON.parse(value.lines[0] ?? '')).toMatchObject({
      outcome: 'nothing_to_reopen',
      reopened: 0,
    })
  })
})
