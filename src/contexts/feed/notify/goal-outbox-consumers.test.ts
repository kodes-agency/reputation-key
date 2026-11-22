import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import {
  createConsumerRegistry,
  type ConsumerRegistry,
} from '#/shared/outbox/consumer-registry'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { userId, type UserId } from '#/shared/domain/ids'
import type {
  MonthlyResultNotificationFactsLookup,
  MonthlyResultRevisionNotificationFacts,
} from '#/contexts/reporting/public-api'
import {
  handleNotificationGoalMonthlyResultClosed,
  handleNotificationGoalMonthlyResultRevised,
  ON_GOAL_MONTHLY_RESULT_CLOSED_CONSUMER,
  ON_GOAL_MONTHLY_RESULT_REVISED_CONSUMER,
} from './goals.server'
import { registerGoalNotificationConsumer } from './goal-notice-routes.server'
import { noticeWriterOver } from '../infrastructure/notification-consumer-test-fixtures'

// ARC-03-T7: a fresh container-scoped registry per test.
let consumerRegistry: ConsumerRegistry = createConsumerRegistry()

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
/** A Property count goal's month: 41 private ratings against 40. */
const FIGURES: Pick<
  MonthlyResultRevisionNotificationFacts,
  'metric' | 'value' | 'target' | 'subjectName'
> = {
  metric: 'portal_rating_count',
  value: 41,
  target: 40,
  subjectName: null,
}
const MANAGER = userId('manager-goal-notification')
const ADMIN = userId('admin-goal-notification')
const PORTAL_MANAGER = userId('portal-manager-goal-notification')
const PORTAL = '91000000-0000-4000-8000-000000000008'
const PORTAL_GROUP = '91000000-0000-4000-8000-000000000009'
/** What the closed-result lookup answers, so a test can put the goal on any subject. */
type ClosedFacts = NonNullable<
  Awaited<
    ReturnType<MonthlyResultNotificationFactsLookup['findMonthlyResultNotificationFacts']>
  >
>

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

const closedFacts = (overrides: Partial<ClosedFacts> = {}): ClosedFacts => ({
  programId: IDS.program,
  monthlyResultId: IDS.result,
  assignmentId: IDS.assignment,
  programName: 'Monthly guest engagement',
  periodMonth: '2026-10',
  subject: { kind: 'property', propertyId: IDS.property },
  setDuringMonth: false,
  targetChangedInMonth: false,
  ...FIGURES,
  ...overrides,
})

const revisionFacts = (
  overrides: Partial<MonthlyResultRevisionNotificationFacts> = {},
): MonthlyResultRevisionNotificationFacts => ({
  programId: IDS.program,
  programVersionId: IDS.version,
  monthlyResultId: IDS.result,
  assignmentId: IDS.assignment,
  revisionId: IDS.revision,
  revision: 1,
  evaluationState: 'eligible',
  achieved: true,
  programName: 'Monthly guest engagement',
  periodMonth: '2026-10',
  subject: { kind: 'property', propertyId: IDS.property },
  setDuringMonth: false,
  targetChangedInMonth: false,
  ...FIGURES,
  ...overrides,
})

/** The payload the first queued job carries. */
const firstPayload = (deps: { jobs: ReadonlyArray<{ data: unknown }> }) =>
  (deps.jobs[0]?.data as { payload: Record<string, unknown> }).payload

/** The notice payload of the default met Property goal, plus any extra fields. */
const completedPayload = (extra: Readonly<Record<string, unknown>> = {}) => ({
  goalName: 'Monthly guest engagement',
  propertyName: 'Riverside Hotel',
  goalMonth: '2026-10',
  goalSubjectKind: 'property',
  goalOutcome: 'met',
  goalMeasure: 'portal_rating_count',
  goalCount: 41,
  goalTargetCount: 40,
  ...extra,
})

const makeDeps = () => {
  const jobs: Array<{ name: string; data: unknown; opts?: unknown }> = []
  const queue = {
    add: vi.fn(async (name: string, data: unknown, opts?: unknown) => {
      jobs.push({ name, data, opts })
    }),
  }
  const receipts = { insertReceipt: vi.fn(async () => undefined) }
  return {
    queue,
    noticeWriter: noticeWriterOver(queue, receipts),
    monthlyResultFacts: {
      findMonthlyResultNotificationFacts: vi.fn(async (): Promise<ClosedFacts> =>
        closedFacts(),
      ),
      findMonthlyResultRevisionNotificationFacts: vi.fn(
        async (): Promise<MonthlyResultRevisionNotificationFacts | null> =>
          revisionFacts(),
      ),
    },
    responsibleManagers: {
      findForProperty: vi.fn(async (): Promise<readonly UserId[]> => [MANAGER]),
      findForPortal: vi.fn(async (): Promise<readonly UserId[]> => []),
      findForPortalGroup: vi.fn(async (): Promise<readonly UserId[]> => []),
      isEligibleForProperty: vi.fn(async () => true),
    },
    userLookup: { findByRole: vi.fn(async () => [ADMIN]) },
    displayNames: { findPropertyName: vi.fn(async () => 'Riverside Hotel') },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    },
    receipts,
    jobs,
  }
}

describe('canonical Goal monthly-result notification consumer', () => {
  beforeEach(() => {
    consumerRegistry = createConsumerRegistry()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  afterEach(() => {
    consumerRegistry = createConsumerRegistry()
    clearEventSchemas()
  })

  it('registers closed and revised results, never reconciled or a notification type', () => {
    registerGoalNotificationConsumer(consumerRegistry, makeDeps())
    expect(consumerRegistry.list()).toEqual(
      expect.arrayContaining([
        {
          eventType: 'goal.monthly_result.revised',
          consumerName: ON_GOAL_MONTHLY_RESULT_REVISED_CONSUMER,
        },
      ]),
    )
    expect(consumerRegistry.list()).toContainEqual({
      eventType: 'goal.monthly_result.closed',
      consumerName: ON_GOAL_MONTHLY_RESULT_CLOSED_CONSUMER,
    })
    expect(consumerRegistry.list()).toHaveLength(2)
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
          payload: {
            goalName: 'Monthly guest engagement',
            propertyName: 'Riverside Hotel',
            goalMonth: '2026-10',
            goalSubjectKind: 'property',
            goalOutcome: 'met',
            goalMeasure: 'portal_rating_count',
            goalCount: 41,
            goalTargetCount: 40,
          },
          // Delivery rechecks the result itself, not only responsibility: a
          // correction may un-achieve the month before the job runs.
          audience: {
            kind: 'goal_completion',
            programId: IDS.program,
            assignmentId: IDS.assignment,
            monthlyResultId: IDS.result,
          },
        },
        opts: { jobId: `${IDS.event}-${MANAGER}` },
      },
    ])
    expect(firstPayload(deps)).not.toHaveProperty('targetValue')
    expect(firstPayload(deps)).not.toHaveProperty('completedValue')
    expect(firstPayload(deps)).not.toHaveProperty('sampleCount')
    expect(order).toEqual(['enqueue', 'receipt'])
  })

  // A goal set on the 20th that is already reached produces "goal met" for
  // every responsible manager. The notice says so, from the fact Reporting
  // reads when the notice is raised; the event itself carries nothing new.
  // The month judged against a target changed while it ran says more about
  // "goal met" than when the goal was set, so it is the one marker the notice
  // carries when both are true.
  it.each([
    [
      'marks a completion whose goal was set after its month began',
      { setDuringMonth: true },
      'set_in_month',
    ],
    [
      'the goal-met notice says the target was changed during the month',
      { targetChangedInMonth: true },
      'target_changed',
    ],
    [
      'a changed target wins over a goal set during the month',
      { setDuringMonth: true, targetChangedInMonth: true },
      'target_changed',
    ],
  ] as const)('%s', async (_title, flags, goalMarker) => {
    const deps = makeDeps()
    deps.monthlyResultFacts.findMonthlyResultNotificationFacts.mockResolvedValue(
      closedFacts(flags),
    )

    await expect(
      handleNotificationGoalMonthlyResultClosed(deps, event()),
    ).resolves.toEqual({ status: 'applied' })

    expect(firstPayload(deps)).toEqual(completedPayload({ goalMarker }))
  })

  it.each([
    [
      'marks a corrected result whose target was changed during its month',
      { setDuringMonth: true, targetChangedInMonth: true },
      'target_changed',
    ],
    [
      'marks a corrected result whose goal was set after its month began',
      { setDuringMonth: true },
      'set_in_month',
    ],
  ] as const)('%s', async (_title, flags, goalMarker) => {
    const deps = makeDeps()
    deps.monthlyResultFacts.findMonthlyResultRevisionNotificationFacts.mockResolvedValue(
      revisionFacts(flags),
    )

    await expect(
      handleNotificationGoalMonthlyResultRevised(deps, revisedEvent()),
    ).resolves.toEqual({ status: 'applied' })

    expect(firstPayload(deps)).toMatchObject({ goalOutcome: 'met', goalMarker })
  })

  // ADR 0046, amended 2026-10-17: a portal goal's notice states the month's
  // count, its target and whose goal it is, read from Reporting when it is
  // raised. The events still carry identifiers only (ADR 0030).
  it("a count goal's notice carries its figures and its portal's name", async () => {
    const deps = makeDeps()
    deps.monthlyResultFacts.findMonthlyResultNotificationFacts.mockResolvedValue(
      closedFacts({
        subject: { kind: 'portal', portalId: PORTAL },
        metric: 'qualified_scans',
        value: 22,
        target: 20,
        subjectName: 'Reception',
      }),
    )

    await handleNotificationGoalMonthlyResultClosed(deps, event())

    expect(firstPayload(deps)).toEqual({
      ...completedPayload(),
      goalSubjectKind: 'portal',
      goalMeasure: 'qualified_scans',
      goalCount: 22,
      goalTargetCount: 20,
      goalSubjectName: 'Reception',
    })
  })

  it('an average carries none', async () => {
    const deps = makeDeps()
    deps.monthlyResultFacts.findMonthlyResultNotificationFacts.mockResolvedValue(
      closedFacts({ metric: 'portal_rating_average', value: 4.6, target: 4.5 }),
    )

    await handleNotificationGoalMonthlyResultClosed(deps, event())

    const payload = firstPayload(deps)
    expect(payload).toMatchObject({ goalMeasure: 'portal_rating_average' })
    expect(payload).not.toHaveProperty('goalCount')
    expect(payload).not.toHaveProperty('goalTargetCount')
  })

  it('a correction with no usable figure states only its target', async () => {
    const deps = makeDeps()
    deps.monthlyResultFacts.findMonthlyResultRevisionNotificationFacts.mockResolvedValue(
      revisionFacts({ evaluationState: 'unavailable', achieved: null, value: null }),
    )

    await handleNotificationGoalMonthlyResultRevised(
      deps,
      revisedEvent({
        evaluationState: 'unavailable',
        achieved: null,
        outcomeChanged: false,
        availabilityChanged: true,
      }),
    )

    const payload = firstPayload(deps)
    expect(payload).toMatchObject({ goalOutcome: 'unavailable', goalTargetCount: 40 })
    expect(payload).not.toHaveProperty('goalCount')
  })

  // PROPOSAL §4.5, approved under P-8: a goal's results are the Property's
  // news, so every Portal-goal notice reaches the Property's responsible
  // managers, never one outlet's manager.
  it("a single-portal goal's notice goes to the Property's responsible managers", async () => {
    const deps = makeDeps()
    deps.monthlyResultFacts.findMonthlyResultNotificationFacts.mockResolvedValue(
      closedFacts({
        subject: { kind: 'portal', portalId: PORTAL },
        subjectName: 'Reception',
      }),
    )
    deps.responsibleManagers.findForPortal.mockResolvedValue([PORTAL_MANAGER])

    await handleNotificationGoalMonthlyResultClosed(deps, event())

    expect(deps.responsibleManagers.findForProperty).toHaveBeenCalledWith(
      ORG,
      IDS.property,
    )
    expect(deps.responsibleManagers.findForPortal).not.toHaveBeenCalled()
    expect(deps.jobs.map((job) => (job.data as { userId: string }).userId)).toEqual([
      MANAGER,
    ])
  })

  it('AccountAdmins when the Property has none', async () => {
    const deps = makeDeps()
    deps.monthlyResultFacts.findMonthlyResultNotificationFacts.mockResolvedValue(
      closedFacts({
        subject: { kind: 'portal_group', portalGroupId: PORTAL_GROUP },
        subjectName: 'Front desk',
      }),
    )
    deps.responsibleManagers.findForProperty.mockResolvedValue([])
    deps.responsibleManagers.findForPortalGroup.mockResolvedValue([PORTAL_MANAGER])

    await handleNotificationGoalMonthlyResultClosed(deps, event())

    expect(deps.responsibleManagers.findForPortalGroup).not.toHaveBeenCalled()
    expect(deps.userLookup.findByRole).toHaveBeenCalledWith(ORG, 'AccountAdmin')
    expect(deps.jobs.map((job) => (job.data as { userId: string }).userId)).toEqual([
      ADMIN,
    ])
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
      ...closedFacts(),
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

  it('settles through the notice writer alone, without queueing or a separate receipt', async () => {
    const deps = makeDeps()
    const write = vi.fn(async () => 'applied' as const)
    const result = await handleNotificationGoalMonthlyResultClosed(
      { ...deps, noticeWriter: { write } },
      event(),
    )
    expect(result).toEqual({ status: 'applied' })
    expect(write).toHaveBeenCalledTimes(1)
    expect(deps.queue.add).not.toHaveBeenCalled()
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })

  it('leaves the event unsettled when the notice writer fails, so redelivery retries it', async () => {
    const deps = makeDeps()
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error('write rolled back'))
      .mockResolvedValueOnce('applied')
    const withWriter = { ...deps, noticeWriter: { write } }
    await expect(
      handleNotificationGoalMonthlyResultClosed(withWriter, event()),
    ).rejects.toThrow('write rolled back')
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
    await expect(
      handleNotificationGoalMonthlyResultClosed(withWriter, event()),
    ).resolves.toEqual({ status: 'applied' })
    expect(write).toHaveBeenCalledTimes(2)
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
          payload: {
            goalName: 'Monthly guest engagement',
            propertyName: 'Riverside Hotel',
            goalMonth: '2026-10',
            goalSubjectKind: 'property',
            goalOutcome: 'met',
            goalMeasure: 'portal_rating_count',
            goalCount: 41,
            goalTargetCount: 40,
          },
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
    deps.monthlyResultFacts.findMonthlyResultRevisionNotificationFacts.mockResolvedValue(
      revisionFacts({ evaluationState: 'unavailable', achieved: null }),
    )

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

  // Revision flags compare each correction with the one before it, so a
  // smaller follow-up correction carries none. When one lands before this
  // correction's notice is handled, the notice must still go out as long as
  // the current head says the same thing; otherwise "Goal completed" stands.
  it('notifies a superseded correction whose outcome the current head still holds', async () => {
    const deps = makeDeps()
    const laterRevision = '91000000-0000-4000-8000-000000000008'
    deps.monthlyResultFacts.findMonthlyResultRevisionNotificationFacts.mockResolvedValue(
      revisionFacts({ revisionId: laterRevision, revision: 2, achieved: false }),
    )

    await expect(
      handleNotificationGoalMonthlyResultRevised(deps, revisedEvent({ achieved: false })),
    ).resolves.toEqual({ status: 'applied' })

    expect(deps.jobs).toHaveLength(1)
    expect(deps.jobs[0]?.data).toMatchObject({
      type: 'goal.result_revised',
      audience: {
        kind: 'goal_result_revision',
        revisionId: IDS.revision,
        revision: 1,
        evaluationState: 'eligible',
        achieved: false,
      },
    })
  })

  // Under consumer lag an earlier correction and a later one can both be
  // handled after the later one committed, and both still agree with the head.
  // The durable bridge records an enqueue receipt for each event, so each must
  // own a queued job carrying its delivery: an event whose add converged on
  // another event's job never settles, and the repair sweep replays it minutes
  // later as a second notice. r.2 coalescing folds the two into one unread row.
  it('gives every lagging correction the head agrees with a delivery of its own', async () => {
    const deps = makeDeps()
    const laterEvent = '91000000-0000-4000-8000-000000000009'
    const laterRevision = '91000000-0000-4000-8000-000000000008'
    deps.monthlyResultFacts.findMonthlyResultRevisionNotificationFacts.mockResolvedValue(
      revisionFacts({ revisionId: laterRevision, revision: 3, achieved: false }),
    )
    // Like BullMQ, an add under an id the queue still holds is a no-op.
    const held = new Map<string, unknown>()
    const enqueueReceipts: string[] = []
    const queue = {
      add: async (_name: string, data: unknown, opts?: unknown) => {
        const jobId = (opts as { jobId: string }).jobId
        if (!held.has(jobId)) held.set(jobId, data)
      },
    }
    const noticeWriter = noticeWriterOver(queue, {
      insertReceipt: async (eventId: string) => void enqueueReceipts.push(eventId),
    })

    await handleNotificationGoalMonthlyResultRevised(
      { ...deps, noticeWriter },
      revisedEvent({ achieved: false, revision: 1 }),
    )
    await handleNotificationGoalMonthlyResultRevised(
      { ...deps, noticeWriter },
      revisedEvent(
        {
          achieved: false,
          revision: 3,
          revisionId: laterRevision,
          supersedesRevisionId: '91000000-0000-4000-8000-00000000000a',
        },
        { eventId: laterEvent },
      ),
    )

    const carried = [...held.values()].map(
      (data) => (data as { eventId: string }).eventId,
    )
    expect(carried.sort()).toEqual([...enqueueReceipts].sort())
    expect(carried.sort()).toEqual([IDS.event, laterEvent].sort())
  })

  it('drops a correction whose outcome a later correction reversed', async () => {
    const deps = makeDeps()
    deps.monthlyResultFacts.findMonthlyResultRevisionNotificationFacts.mockResolvedValue(
      revisionFacts({
        revisionId: '91000000-0000-4000-8000-000000000008',
        revision: 2,
        achieved: true,
      }),
    )

    await expect(
      handleNotificationGoalMonthlyResultRevised(deps, revisedEvent({ achieved: false })),
    ).resolves.toEqual({ status: 'obsolete' })
    expect(deps.jobs).toEqual([])
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
