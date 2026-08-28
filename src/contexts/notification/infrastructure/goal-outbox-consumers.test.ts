import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import {
  clearConsumers,
  listRegisteredConsumers,
} from '#/shared/outbox/consumer-registry'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { userId } from '#/shared/domain/ids'
import type { MonthlyResultRevisionNotificationFacts } from '#/contexts/goal/application/public-api'
import {
  handleNotificationGoalMonthlyResultClosed,
  handleNotificationGoalMonthlyResultRevised,
  ON_GOAL_MONTHLY_RESULT_CLOSED_CONSUMER,
  ON_GOAL_MONTHLY_RESULT_REVISED_CONSUMER,
  registerGoalNotificationConsumer,
} from './goal-outbox-consumers'

const IDS = {
  event: '91000000-0000-4000-8000-000000000001',
  property: '91000000-0000-4000-8000-000000000002',
  program: '91000000-0000-4000-8000-000000000003',
  version: '91000000-0000-4000-8000-000000000004',
  assignment: '91000000-0000-4000-8000-000000000005',
  result: '91000000-0000-4000-8000-000000000006',
  revision: '91000000-0000-4000-8000-000000000007',
} as const
const ORG = 'organization-goal-notification'
const MANAGER = userId('manager-goal-notification')
const ADMIN = userId('admin-goal-notification')

const event = (
  payloadOverrides: Readonly<Record<string, unknown>> = {},
  envelopeOverrides: Partial<ConsumerEvent> = {},
): ConsumerEvent => ({
  eventId: IDS.event,
  eventType: 'goal.monthly_result.closed',
  eventVersion: 1,
  payload: {
    organizationId: ORG,
    propertyId: IDS.property,
    programId: IDS.program,
    programVersionId: IDS.version,
    assignmentId: IDS.assignment,
    monthlyResultId: IDS.result,
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-08-01T00:00:00.000Z',
    status: 'closed',
    evaluationState: 'eligible',
    achieved: true,
    occurredAt: '2026-08-27T08:00:00.000Z',
    ...payloadOverrides,
  },
  organizationId: ORG,
  propertyId: IDS.property,
  sourceContext: 'goal',
  sourceAggregateId: IDS.result,
  recordedAt: '2026-08-27T08:00:00.000Z',
  ...envelopeOverrides,
})

const revisedEvent = (
  payloadOverrides: Readonly<Record<string, unknown>> = {},
  envelopeOverrides: Partial<ConsumerEvent> = {},
): ConsumerEvent => ({
  ...event(
    {
      revisionId: IDS.revision,
      revision: 1,
      supersedesRevisionId: null,
      outcomeChanged: true,
      availabilityChanged: false,
      ...payloadOverrides,
    },
    envelopeOverrides,
  ),
  eventType: 'goal.monthly_result.revised',
})

const makeDeps = () => {
  const jobs: Array<{ name: string; data: unknown; opts?: unknown }> = []
  const queue = {
    add: vi.fn(async (name: string, data: unknown, opts?: unknown) => {
      jobs.push({ name, data, opts })
    }),
  }
  return {
    queue,
    monthlyResultFacts: {
      findMonthlyResultNotificationFacts: vi.fn(async () => ({
        programId: IDS.program,
        monthlyResultId: IDS.result,
        assignmentId: IDS.assignment,
        programName: 'Monthly guest engagement',
        subject: { kind: 'property' as const, propertyId: IDS.property },
      })),
      findMonthlyResultRevisionNotificationFacts: vi.fn(
        async () =>
          ({
            programId: IDS.program,
            programVersionId: IDS.version,
            monthlyResultId: IDS.result,
            assignmentId: IDS.assignment,
            revisionId: IDS.revision,
            revision: 1,
            evaluationState: 'eligible' as const,
            achieved: true,
            programName: 'Monthly guest engagement',
            subject: { kind: 'property' as const, propertyId: IDS.property },
          }) as MonthlyResultRevisionNotificationFacts | null,
      ),
    },
    responsibleManagers: {
      findForProperty: vi.fn(async () => [MANAGER]),
      findForPortal: vi.fn(async () => []),
      findForPortalGroup: vi.fn(async () => []),
      isEligibleForProperty: vi.fn(async () => true),
    },
    userLookup: { findByRole: vi.fn(async () => [ADMIN]) },
    receipts: { insertReceipt: vi.fn(async () => undefined) },
    jobs,
  }
}

describe('canonical Goal monthly-result notification consumer', () => {
  beforeEach(() => {
    clearConsumers()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  afterEach(() => {
    clearConsumers()
    clearEventSchemas()
  })

  it('registers closed and revised results, never reconciled or legacy goal.completed', () => {
    registerGoalNotificationConsumer(makeDeps())
    expect(listRegisteredConsumers()).toEqual(
      expect.arrayContaining([
        {
          eventType: 'goal.monthly_result.revised',
          consumerName: ON_GOAL_MONTHLY_RESULT_REVISED_CONSUMER,
        },
      ]),
    )
    expect(listRegisteredConsumers()).toContainEqual({
      eventType: 'goal.monthly_result.closed',
      consumerName: ON_GOAL_MONTHLY_RESULT_CLOSED_CONSUMER,
    })
    expect(listRegisteredConsumers()).toHaveLength(2)
  })

  it('uses the exact achieved result lookup and enqueues privacy-safe stable jobs before receipt', async () => {
    const deps = makeDeps()
    const order: string[] = []
    deps.queue.add.mockImplementation(async (name, data, opts) => {
      order.push('enqueue')
      deps.jobs.push({ name, data, opts })
    })
    deps.receipts.insertReceipt.mockImplementation(async () => {
      order.push('receipt')
    })

    await expect(
      handleNotificationGoalMonthlyResultClosed(deps, event()),
    ).resolves.toEqual({ status: 'applied' })

    expect(
      deps.monthlyResultFacts.findMonthlyResultNotificationFacts,
    ).toHaveBeenCalledWith({
      organizationId: ORG,
      propertyId: IDS.property,
      assignmentId: IDS.assignment,
      monthlyResultId: IDS.result,
    })
    expect(deps.jobs).toEqual([
      {
        name: 'insert-notification',
        data: {
          userId: MANAGER,
          organizationId: ORG,
          propertyId: IDS.property,
          type: 'goal.completed',
          resourceType: 'goal',
          resourceId: IDS.result,
          eventId: IDS.event,
          payload: { goalName: 'Monthly guest engagement' },
          audience: {
            kind: 'responsible_scope',
            scope: { kind: 'property', propertyId: IDS.property },
          },
        },
        opts: { jobId: `${IDS.event}-${MANAGER}` },
      },
    ])
    expect(
      (deps.jobs[0]?.data as { payload: Record<string, unknown> }).payload,
    ).not.toHaveProperty('targetValue')
    expect(
      (deps.jobs[0]?.data as { payload: Record<string, unknown> }).payload,
    ).not.toHaveProperty('completedValue')
    expect(
      (deps.jobs[0]?.data as { payload: Record<string, unknown> }).payload,
    ).not.toHaveProperty('sampleCount')
    expect(order).toEqual(['enqueue', 'receipt'])
  })

  it('acknowledges an unachieved close without lookup or delivery', async () => {
    const deps = makeDeps()
    await expect(
      handleNotificationGoalMonthlyResultClosed(deps, event({ achieved: false })),
    ).resolves.toEqual({ status: 'obsolete' })

    expect(
      deps.monthlyResultFacts.findMonthlyResultNotificationFacts,
    ).not.toHaveBeenCalled()
    expect(deps.jobs).toEqual([])
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      IDS.event,
      ON_GOAL_MONTHLY_RESULT_CLOSED_CONSUMER,
      'obsolete',
    )
  })

  it.each([
    ['programId', '91000000-0000-4000-8000-000000000013'],
    ['assignmentId', '91000000-0000-4000-8000-000000000015'],
    ['monthlyResultId', '91000000-0000-4000-8000-000000000016'],
  ] as const)('rejects a lookup that returns the wrong %s', async (key, value) => {
    const deps = makeDeps()
    deps.monthlyResultFacts.findMonthlyResultNotificationFacts.mockResolvedValue({
      programId: IDS.program,
      monthlyResultId: IDS.result,
      assignmentId: IDS.assignment,
      programName: 'Monthly guest engagement',
      subject: { kind: 'property', propertyId: IDS.property },
      [key]: value,
    })

    await expect(
      handleNotificationGoalMonthlyResultClosed(deps, event()),
    ).resolves.toEqual({ status: 'obsolete' })
    expect(deps.jobs).toEqual([])
  })

  it('fails closed on tenant or Property attribution mismatch', async () => {
    const deps = makeDeps()
    await expect(
      handleNotificationGoalMonthlyResultClosed(
        deps,
        event({}, { organizationId: 'another-organization' }),
      ),
    ).rejects.toThrow('attribution mismatch')
    await expect(
      handleNotificationGoalMonthlyResultClosed(
        deps,
        event({}, { propertyId: '91000000-0000-4000-8000-000000000099' }),
      ),
    ).rejects.toThrow('attribution mismatch')
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })

  it('converges ambiguous replay on the same per-recipient job identity', async () => {
    const deps = makeDeps()
    await handleNotificationGoalMonthlyResultClosed(deps, event())
    await handleNotificationGoalMonthlyResultClosed(deps, event())
    expect(deps.jobs.map((job) => job.opts)).toEqual([
      { jobId: `${IDS.event}-${MANAGER}` },
      { jobId: `${IDS.event}-${MANAGER}` },
    ])
  })

  it('does not acknowledge when a recipient enqueue fails', async () => {
    const deps = makeDeps()
    deps.queue.add.mockRejectedValue(new Error('queue unavailable'))
    await expect(
      handleNotificationGoalMonthlyResultClosed(deps, event()),
    ).rejects.toThrow('queue unavailable')
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })

  it('notifies a current responsible recipient when a revision changes outcome', async () => {
    const deps = makeDeps()

    await expect(
      handleNotificationGoalMonthlyResultRevised(deps, revisedEvent()),
    ).resolves.toEqual({ status: 'applied' })

    expect(
      deps.monthlyResultFacts.findMonthlyResultRevisionNotificationFacts,
    ).toHaveBeenCalledWith({
      organizationId: ORG,
      propertyId: IDS.property,
      programId: IDS.program,
      programVersionId: IDS.version,
      assignmentId: IDS.assignment,
      monthlyResultId: IDS.result,
      revisionId: IDS.revision,
      revision: 1,
    })
    expect(deps.jobs).toEqual([
      {
        name: 'insert-notification',
        data: {
          userId: MANAGER,
          organizationId: ORG,
          propertyId: IDS.property,
          type: 'goal.result_revised',
          resourceType: 'goal',
          resourceId: IDS.result,
          eventId: IDS.event,
          payload: { goalName: 'Monthly guest engagement' },
          audience: {
            kind: 'goal_result_revision',
            programId: IDS.program,
            programVersionId: IDS.version,
            assignmentId: IDS.assignment,
            monthlyResultId: IDS.result,
            revisionId: IDS.revision,
            revision: 1,
            evaluationState: 'eligible',
            achieved: true,
          },
        },
        opts: { jobId: `${IDS.event}-${MANAGER}` },
      },
    ])
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      IDS.event,
      ON_GOAL_MONTHLY_RESULT_REVISED_CONSUMER,
      'applied',
    )
  })

  it('treats a revision without outcome or availability change as receipt-only', async () => {
    const deps = makeDeps()

    await expect(
      handleNotificationGoalMonthlyResultRevised(
        deps,
        revisedEvent({ outcomeChanged: false, availabilityChanged: false }),
      ),
    ).resolves.toEqual({ status: 'obsolete' })

    expect(
      deps.monthlyResultFacts.findMonthlyResultRevisionNotificationFacts,
    ).not.toHaveBeenCalled()
    expect(deps.jobs).toEqual([])
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      IDS.event,
      ON_GOAL_MONTHLY_RESULT_REVISED_CONSUMER,
      'obsolete',
    )
  })

  it('notifies an availability correction without claiming the goal was achieved', async () => {
    const deps = makeDeps()
    deps.monthlyResultFacts.findMonthlyResultRevisionNotificationFacts.mockResolvedValue({
      programId: IDS.program,
      programVersionId: IDS.version,
      monthlyResultId: IDS.result,
      assignmentId: IDS.assignment,
      revisionId: IDS.revision,
      revision: 1,
      evaluationState: 'unavailable',
      achieved: null,
      programName: 'Monthly guest engagement',
      subject: { kind: 'property', propertyId: IDS.property },
    })

    await expect(
      handleNotificationGoalMonthlyResultRevised(
        deps,
        revisedEvent({
          evaluationState: 'unavailable',
          achieved: null,
          outcomeChanged: false,
          availabilityChanged: true,
        }),
      ),
    ).resolves.toEqual({ status: 'applied' })

    expect(deps.jobs).toHaveLength(1)
    expect(deps.jobs[0]?.data).toMatchObject({
      type: 'goal.result_revised',
      audience: {
        evaluationState: 'unavailable',
        achieved: null,
      },
    })
  })

  it('suppresses a superseded or mismatched revision at durable handling time', async () => {
    const deps = makeDeps()
    deps.monthlyResultFacts.findMonthlyResultRevisionNotificationFacts.mockResolvedValue(
      null,
    )

    await expect(
      handleNotificationGoalMonthlyResultRevised(deps, revisedEvent()),
    ).resolves.toEqual({ status: 'obsolete' })
    expect(deps.jobs).toEqual([])
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      IDS.event,
      ON_GOAL_MONTHLY_RESULT_REVISED_CONSUMER,
      'obsolete',
    )
  })
})
