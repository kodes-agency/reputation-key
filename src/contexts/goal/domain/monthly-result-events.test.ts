import { describe, expect, it } from 'vitest'
import {
  goalMonthlyResultClosed,
  goalMonthlyResultReconciled,
  goalMonthlyResultRevised,
} from './events'

const IDS = {
  propertyId: '10000000-0000-4000-8000-000000000002',
  programId: '10000000-0000-4000-8000-000000000003',
  programVersionId: '10000000-0000-4000-8000-000000000004',
  assignmentId: '10000000-0000-4000-8000-000000000005',
  monthlyResultId: '10000000-0000-4000-8000-000000000006',
} as const

const PERIOD_START = new Date('2026-07-01T00:00:00.000Z')
const PERIOD_END = new Date('2026-08-01T00:00:00.000Z')
const OCCURRED_AT = new Date('2026-08-02T12:00:00.000Z')

describe('Goal monthly-result events', () => {
  it('creates a deterministic identifier-only closed fact', () => {
    const event = goalMonthlyResultClosed({
      ...IDS,
      organizationId: 'organization-1',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      evaluationState: 'eligible',
      achieved: true,
      occurredAt: OCCURRED_AT,
      correlationId: 'correlation-1',
    })

    expect(event).toEqual({
      _tag: 'goal.monthly_result.closed',
      eventId: expect.any(String),
      ...IDS,
      organizationId: 'organization-1',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      status: 'closed',
      evaluationState: 'eligible',
      achieved: true,
      occurredAt: OCCURRED_AT,
      correlationId: 'correlation-1',
    })
    expect(event).not.toHaveProperty('programName')
    expect(event).not.toHaveProperty('subject')
  })

  it('creates a reconciling fact with a constructor-owned event identity', () => {
    const event = goalMonthlyResultReconciled({
      ...IDS,
      organizationId: 'organization-1',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      evaluationState: 'updating',
      achieved: null,
      occurredAt: OCCURRED_AT,
    })

    expect(event).toMatchObject({
      _tag: 'goal.monthly_result.reconciled',
      eventId: expect.any(String),
      monthlyResultId: IDS.monthlyResultId,
      status: 'reconciling',
      correlationId: null,
    })
  })

  it('creates an identifier-only revision fact with notification-change flags', () => {
    const event = goalMonthlyResultRevised({
      ...IDS,
      organizationId: 'organization-1',
      revisionId: '10000000-0000-4000-8000-000000000007',
      revision: 2,
      supersedesRevisionId: '10000000-0000-4000-8000-000000000008',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      evaluationState: 'unavailable',
      achieved: null,
      outcomeChanged: true,
      availabilityChanged: true,
      occurredAt: OCCURRED_AT,
    })

    expect(event).toMatchObject({
      _tag: 'goal.monthly_result.revised',
      status: 'closed',
      revision: 2,
      outcomeChanged: true,
      availabilityChanged: true,
    })
    expect(event).not.toHaveProperty('value')
    expect(event).not.toHaveProperty('reason')
  })

  it.each([
    {
      name: 'an eligible result without an achievement decision',
      evaluationState: 'eligible' as const,
      achieved: null,
    },
    {
      name: 'an unavailable result carrying an achievement decision',
      evaluationState: 'unavailable' as const,
      achieved: false,
    },
    {
      name: 'a closed result that is still updating',
      evaluationState: 'updating' as const,
      achieved: null,
    },
  ])('rejects $name', ({ evaluationState, achieved }) => {
    expect(() =>
      goalMonthlyResultClosed({
        ...IDS,
        organizationId: 'organization-1',
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        evaluationState,
        achieved,
        occurredAt: OCCURRED_AT,
      }),
    ).toThrow(/monthly result/i)
  })
})
