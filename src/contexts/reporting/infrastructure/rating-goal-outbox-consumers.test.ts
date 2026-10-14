import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import type { ConsumerRegistry } from '#/shared/outbox'

const mocks = vi.hoisted(() => ({
  registerConsumer: vi.fn(),
  validateEventPayload: vi.fn(
    (_type: string, _version: number, payload: unknown) => payload,
  ),
}))

vi.mock('#/shared/events/schema-registry', () => ({
  validateEventPayload: mocks.validateEventPayload,
}))

import {
  RATING_GOAL_EVALUATION_CONSUMER,
  handleRatingGoalEvaluation,
  registerRatingGoalEvaluationConsumer,
} from './rating-goal-outbox-consumers'

const consumerRegistry = {
  registerConsumer: mocks.registerConsumer,
} as unknown as ConsumerRegistry

const ORG = 'org-rating-goal-consumer'
const PROPERTY = '57000000-0000-4000-8000-000000000001'
const EVENT_ID = '57000000-0000-4000-8000-000000000002'

const envelope = (overrides: Record<string, unknown> = {}) => ({
  eventId: EVENT_ID,
  eventType: 'review.google_reputation_snapshot.verified',
  eventVersion: 1,
  payload: { organizationId: ORG, propertyId: PROPERTY },
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceContext: 'review',
  sourceAggregateId: '57000000-0000-4000-8000-000000000003',
  occurredAt: '2026-10-14T12:00:00.000Z',
  ...overrides,
})

function receiptsDb() {
  const receipts: unknown[] = []
  const db = {
    insert: () => ({
      values: (row: unknown) => ({
        onConflictDoNothing: async () => {
          receipts.push(row)
        },
      }),
    }),
  } as unknown as Database
  return { db, receipts }
}

describe('the rating goal evaluation consumer', () => {
  beforeEach(() => vi.clearAllMocks())

  it('registers on verified Google numbers under its own catalogue row', () => {
    registerRatingGoalEvaluationConsumer(consumerRegistry, {
      evaluate: vi.fn(),
      db: receiptsDb().db,
    })

    expect(mocks.registerConsumer.mock.calls[0]?.[0]).toMatchObject({
      eventType: 'review.google_reputation_snapshot.verified',
      consumerName: RATING_GOAL_EVALUATION_CONSUMER,
      module: 'goal.google-rating-evaluation',
    })
  })

  it('evaluates the Property named by the fact, then writes its receipt', async () => {
    const evaluate = vi.fn(async () => null)
    const { db, receipts } = receiptsDb()

    await expect(
      handleRatingGoalEvaluation({ evaluate, db }, envelope() as never),
    ).resolves.toEqual({ status: 'applied' })

    expect(evaluate).toHaveBeenCalledWith(ORG, PROPERTY)
    expect(receipts).toEqual([
      {
        eventId: EVENT_ID,
        consumerName: 'goal.google-rating-evaluation',
        status: 'applied',
      },
    ])
  })

  it('writes no receipt when the evaluation fails, so the fact comes again', async () => {
    const evaluate = vi.fn(async () => {
      throw new Error('database unavailable')
    })
    const { db, receipts } = receiptsDb()

    await expect(
      handleRatingGoalEvaluation({ evaluate, db }, envelope() as never),
    ).rejects.toThrow(/database unavailable/u)
    expect(receipts).toEqual([])
  })

  it('refuses a fact whose payload names another tenant than its envelope', async () => {
    const evaluate = vi.fn()
    const { db } = receiptsDb()

    await expect(
      handleRatingGoalEvaluation(
        { evaluate, db },
        envelope({ organizationId: 'another-organization' }) as never,
      ),
    ).rejects.toThrow(/attribution mismatch/u)
    await expect(
      handleRatingGoalEvaluation(
        { evaluate, db },
        envelope({ eventType: 'review.created' }) as never,
      ),
    ).rejects.toThrow(/wrong event type/u)
    expect(evaluate).not.toHaveBeenCalled()
  })
})
