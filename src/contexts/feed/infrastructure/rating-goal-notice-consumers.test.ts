import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import { createConsumerRegistry } from '#/shared/outbox/consumer-registry'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { userId } from '#/shared/domain/ids'
import {
  handleRatingGoalTransitioned,
  ON_RATING_GOAL_TRANSITIONED_CONSUMER,
  registerRatingGoalNoticeConsumer,
} from './rating-goal-notice-consumers'

const IDS = {
  event: '92000000-0000-4000-8000-000000000001',
  property: '92000000-0000-4000-8000-000000000002',
  goal: '92000000-0000-4000-8000-000000000003',
} as const
const ORG = 'organization-rating-goal-notice'
const MANAGER = userId('manager-rating-goal-notice')
const SECOND_MANAGER = userId('manager-rating-goal-notice-2')
const ADMIN = userId('admin-rating-goal-notice')

const NO_FIGURES = {
  shownTenths: null,
  previousTenths: null,
  pacePerWeek: null,
  recentPaceTenths: null,
  paceWindow: null,
}

const event = (
  payloadOverrides: Readonly<Record<string, unknown>> = {},
  envelopeOverrides: Partial<ConsumerEvent> = {},
): ConsumerEvent => ({
  eventId: IDS.event,
  eventType: 'goal.rating_goal.transitioned',
  eventVersion: 1,
  payload: {
    organizationId: ORG,
    propertyId: IDS.property,
    goalId: IDS.goal,
    transition: 'google_rating_changed',
    mode: 'climb',
    targetTenths: 45,
    ...NO_FIGURES,
    shownTenths: 44,
    previousTenths: 43,
    occurredAt: '2026-10-14T05:00:00.000Z',
    ...payloadOverrides,
  },
  organizationId: ORG,
  propertyId: IDS.property,
  sourceContext: 'goal',
  sourceAggregateId: IDS.property,
  recordedAt: '2026-10-14T05:00:00.000Z',
  ...envelopeOverrides,
})

const makeDeps = () => {
  const jobs: Array<{ name: string; data: Record<string, unknown>; opts?: unknown }> = []
  return {
    queue: {
      add: vi.fn(async (name: string, data: Record<string, unknown>, opts?: unknown) => {
        jobs.push({ name, data, opts })
      }),
    },
    responsibleManagers: {
      findForProperty: vi.fn(async () => [MANAGER, SECOND_MANAGER]),
      findForPortal: vi.fn(async () => []),
      findForPortalGroup: vi.fn(async () => []),
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
    receipts: { insertReceipt: vi.fn(async () => undefined) },
    jobs,
  }
}

beforeEach(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})

afterEach(() => {
  clearEventSchemas()
})

describe('the Google rating goal notice route', () => {
  it('registers the one fact Reporting writes per notice', () => {
    const registry = createConsumerRegistry()

    registerRatingGoalNoticeConsumer(registry, makeDeps())

    expect(registry.list()).toEqual([
      {
        eventType: 'goal.rating_goal.transitioned',
        consumerName: ON_RATING_GOAL_TRANSITIONED_CONSUMER,
      },
    ])
  })

  it('queues one notice per responsible manager, keyed by the fact, then records its receipt', async () => {
    const deps = makeDeps()
    const order: string[] = []
    deps.queue.add.mockImplementation(async (name, data, opts) => {
      order.push('enqueue')
      deps.jobs.push({ name, data, opts })
    })
    deps.receipts.insertReceipt.mockImplementation(async () => {
      order.push('receipt')
    })

    await expect(handleRatingGoalTransitioned(deps, event())).resolves.toEqual({
      status: 'applied',
    })

    expect(deps.jobs).toEqual(
      [MANAGER, SECOND_MANAGER].map((recipient) => ({
        name: 'insert-notification',
        data: {
          userId: recipient,
          organizationId: ORG,
          propertyId: IDS.property,
          type: 'goal.rating_changed',
          resourceType: 'goal',
          resourceId: IDS.goal,
          eventId: IDS.event,
          payload: {
            propertyName: 'Riverside Hotel',
            ratingShownTenths: 44,
            ratingPreviousTenths: 43,
            ratingTargetTenths: 45,
            ratingGoalMode: 'climb',
          },
          // Delivery asks again who is responsible for the Property now.
          audience: {
            kind: 'responsible_scope',
            scope: { kind: 'property', propertyId: IDS.property },
          },
        },
        opts: { jobId: `${IDS.event}-${recipient}` },
      })),
    )
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      IDS.event,
      ON_RATING_GOAL_TRANSITIONED_CONSUMER,
      'applied',
    )
    expect(order).toEqual(['enqueue', 'enqueue', 'receipt'])
  })

  it('falls back to the AccountAdmins when nobody is responsible for the Property', async () => {
    const deps = makeDeps()
    deps.responsibleManagers.findForProperty.mockResolvedValue([])

    await handleRatingGoalTransitioned(deps, event())

    expect(deps.jobs.map((job) => job.data.userId)).toEqual([ADMIN])
  })

  it.each([
    [
      'reached',
      { transition: 'reached', shownTenths: 45, previousTenths: null },
      'goal.rating_reached',
      { ratingShownTenths: 45 },
    ],
    [
      'entered_below_pace',
      {
        transition: 'entered_below_pace',
        shownTenths: null,
        previousTenths: null,
        pacePerWeek: 11,
        recentPaceTenths: 65,
        paceWindow: 'last_4_weeks',
      },
      'goal.rating_below_pace',
      {
        ratingPacePerWeek: 11,
        ratingRecentPaceTenths: 65,
        ratingPaceWindow: 'last_4_weeks',
      },
    ],
    [
      'entered_cant_reach',
      {
        transition: 'entered_cant_reach',
        shownTenths: null,
        previousTenths: null,
      },
      'goal.rating_cant_reach',
      {},
    ],
    [
      'keep_dropped_below',
      {
        transition: 'keep_dropped_below',
        mode: 'keep',
        shownTenths: 44,
        previousTenths: null,
      },
      'goal.rating_keep_dropped',
      { ratingShownTenths: 44, ratingGoalMode: 'keep' },
    ],
  ] as const)(
    'tells %s as its own notice type, with only its figures',
    async (_name, fact, type, figures) => {
      const deps = makeDeps()

      await handleRatingGoalTransitioned(deps, event(fact))

      expect(deps.jobs[0]?.data).toMatchObject({ type, payload: figures })
      expect(Object.keys(deps.jobs[0]?.data.payload as object).sort()).toEqual(
        ['propertyName', 'ratingTargetTenths', 'ratingGoalMode', ...Object.keys(figures)]
          .filter((key, index, keys) => keys.indexOf(key) === index)
          .sort(),
      )
    },
  )

  it('carries no average of review ratings, even from a fact that holds one', async () => {
    const deps = makeDeps()

    await handleRatingGoalTransitioned(
      deps,
      event({
        transition: 'entered_cant_reach',
        shownTenths: null,
        previousTenths: null,
        averageHundredths: 440,
      }),
    )

    const payload = deps.jobs[0]?.data.payload as Record<string, unknown>
    expect(payload).toMatchObject({ ratingTargetTenths: 45 })
    expect(Object.keys(payload).filter((key) => /average|mix/iu.test(key))).toEqual([])
  })

  it('queues the same job ids when the fact is delivered again', async () => {
    const deps = makeDeps()

    await handleRatingGoalTransitioned(deps, event())
    await handleRatingGoalTransitioned(deps, event())

    const jobIds = deps.jobs.map((job) => (job.opts as { jobId: string }).jobId)
    expect(new Set(jobIds)).toEqual(
      new Set([`${IDS.event}-${MANAGER}`, `${IDS.event}-${SECOND_MANAGER}`]),
    )
  })

  it('refuses a fact whose envelope names another Organization or Property', async () => {
    const deps = makeDeps()

    await expect(
      handleRatingGoalTransitioned(deps, event({}, { organizationId: 'another-org' })),
    ).rejects.toThrow('attribution mismatch')
    await expect(
      handleRatingGoalTransitioned(
        deps,
        event({}, { propertyId: '92000000-0000-4000-8000-000000000009' }),
      ),
    ).rejects.toThrow('attribution mismatch')
    expect(deps.jobs).toEqual([])
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })

  it('refuses a fact without the figures its notice states', async () => {
    const deps = makeDeps()

    await expect(
      handleRatingGoalTransitioned(
        deps,
        event({ transition: 'reached', shownTenths: null }),
      ),
    ).rejects.toThrow('reached needs shownTenths')
    expect(deps.jobs).toEqual([])
  })
})
