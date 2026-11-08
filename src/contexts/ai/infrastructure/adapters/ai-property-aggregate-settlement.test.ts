import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { Database } from '#/shared/db'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { aiPropertyAggregateSettlements } from '#/shared/db/schema'
import { createAiPropertyAggregateStoreAdapter } from './ai-property-aggregate-store.adapter'

const heads = vi.hoisted(() => ({
  countSettledSequence: vi.fn(),
  commitAggregateHead: vi.fn(),
  lockAggregateHead: vi.fn(async () => ({ aggregateRevision: 7 })),
}))
const withdrawReviewContribution = vi.hoisted(() => vi.fn())
vi.mock('./ai-property-aggregate-head', () => heads)
vi.mock('./ai-property-aggregate-contributions', () => ({
  withdrawReviewContribution,
}))

const INPUT = {
  organizationId: organizationId('aggregate-settlement-test'),
  propertyId: propertyId('75000000-0000-4000-8000-000000000001'),
  reviewId: reviewId('75000000-0000-4000-8000-000000000002'),
  sourceEpoch: 2,
  reviewAnalysisEpoch: 3,
  propertyProfileVersion: 4,
  analysisSequence: 5,
  dispositionCode: 'operation_abandoned' as const,
}

function harness(
  options: {
    latestSequence?: number
    inserted?: boolean
    existingReviewId?: string | null
  } = {},
) {
  const predicates: SQL[] = []
  const insertedValues: unknown[] = []
  const select = () => {
    let rows: readonly unknown[] = []
    const chain = {
      from: (table: unknown) => {
        if (table === aiPropertyAggregateSettlements) {
          rows =
            options.existingReviewId === null
              ? []
              : [{ reviewId: options.existingReviewId ?? INPUT.reviewId }]
        }
        return chain
      },
      where: (predicate: SQL) => {
        predicates.push(predicate)
        return chain
      },
      orderBy: () => {
        rows =
          options.latestSequence === undefined
            ? []
            : [{ analysisSequence: options.latestSequence }]
        return chain
      },
      limit: () => ({
        then: (resolve: (value: readonly unknown[]) => unknown) =>
          Promise.resolve(rows).then(resolve),
        for: async () => rows,
      }),
      innerJoin: () => chain,
    }
    return chain
  }
  const tx = {
    execute: vi.fn(),
    select,
    insert: () => ({
      values: (value: unknown) => {
        insertedValues.push(value)
        return {
          onConflictDoNothing: () => ({
            returning: async () =>
              options.inserted === false ? [] : [{ reviewId: INPUT.reviewId }],
          }),
        }
      },
    }),
  }
  const adapter = createAiPropertyAggregateStoreAdapter({
    transaction: async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx),
  } as unknown as Database)
  return { adapter, predicates, insertedValues }
}

beforeEach(() => vi.clearAllMocks())

describe('aggregate settlement delivery', () => {
  it.each([undefined, 2])(
    'applies a new sequence after %s without losing its settlement',
    async (latestSequence) => {
      const { adapter, insertedValues } = harness({ latestSequence })
      await expect(adapter.advanceWithoutAnalysis(INPUT)).resolves.toEqual({
        status: 'applied',
        aggregateRevision: 8,
      })
      expect(insertedValues).toEqual([
        expect.objectContaining({
          organizationId: INPUT.organizationId,
          propertyId: INPUT.propertyId,
          reviewId: INPUT.reviewId,
          sourceEpoch: INPUT.sourceEpoch,
          reviewAnalysisEpoch: INPUT.reviewAnalysisEpoch,
          analysisSequence: INPUT.analysisSequence,
        }),
      ])
      expect(heads.commitAggregateHead).toHaveBeenCalledOnce()
      expect(withdrawReviewContribution).toHaveBeenCalledOnce()
      expect(heads.countSettledSequence).not.toHaveBeenCalled()
    },
  )

  it('leaves a replay without another contribution withdrawal or head increment', async () => {
    const { adapter } = harness({ latestSequence: 5, inserted: false })
    await expect(adapter.advanceWithoutAnalysis(INPUT)).resolves.toEqual({
      status: 'replayed',
      aggregateRevision: 7,
    })
    expect(withdrawReviewContribution).not.toHaveBeenCalled()
    expect(heads.commitAggregateHead).not.toHaveBeenCalled()
    expect(heads.countSettledSequence).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    'counts an older sequence only on its first settlement (inserted=%s)',
    async (inserted) => {
      const { adapter } = harness({ latestSequence: 6, inserted })
      await expect(adapter.advanceWithoutAnalysis(INPUT)).resolves.toEqual({
        status: 'stale',
      })
      expect(heads.countSettledSequence).toHaveBeenCalledTimes(inserted ? 1 : 0)
      expect(withdrawReviewContribution).not.toHaveBeenCalled()
      expect(heads.commitAggregateHead).not.toHaveBeenCalled()
    },
  )

  it.each([true, false])(
    'settles a missing analysis without counting it twice (inserted=%s)',
    async (inserted) => {
      const { adapter } = harness({ inserted })
      await expect(
        adapter.applyReviewAnalysis({
          ...INPUT,
          sourceRevision: 1,
          calendarProfileVersion: 'property-calendar-v1',
        }),
      ).resolves.toEqual({ status: 'stale' })
      expect(heads.countSettledSequence).toHaveBeenCalledTimes(inserted ? 1 : 0)
      expect(heads.commitAggregateHead).not.toHaveBeenCalled()
    },
  )

  it.each([null, '75000000-0000-4000-8000-000000000003'])(
    'refuses a conflicting sequence owner (%s) before changing the head',
    async (existingReviewId) => {
      const { adapter } = harness({ inserted: false, existingReviewId })
      await expect(adapter.advanceWithoutAnalysis(INPUT)).rejects.toThrow(
        'Property aggregate settlement identity conflict',
      )
      expect(heads.lockAggregateHead).not.toHaveBeenCalled()
      expect(heads.countSettledSequence).not.toHaveBeenCalled()
      expect(heads.commitAggregateHead).not.toHaveBeenCalled()
      expect(withdrawReviewContribution).not.toHaveBeenCalled()
    },
  )

  it('shares settlement identity across profile versions while scoping it to tenant and epochs', async () => {
    const { adapter, predicates, insertedValues } = harness({
      latestSequence: 5,
      inserted: false,
    })
    await expect(
      adapter.advanceWithoutAnalysis({ ...INPUT, propertyProfileVersion: 9 }),
    ).resolves.toMatchObject({ status: 'replayed' })
    expect(insertedValues[0]).not.toHaveProperty('propertyProfileVersion')
    const queries = predicates.map((predicate) => new PgDialect().sqlToQuery(predicate))
    for (const query of queries) {
      expect(query.params).toEqual(
        expect.arrayContaining([
          INPUT.organizationId,
          INPUT.propertyId,
          INPUT.sourceEpoch,
          INPUT.reviewAnalysisEpoch,
        ]),
      )
      expect(query.params).not.toContain(9)
    }
  })
})
