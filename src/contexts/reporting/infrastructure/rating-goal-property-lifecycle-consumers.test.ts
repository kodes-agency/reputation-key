import { beforeEach, describe, expect, it, vi } from 'vitest'
import { capabilityForSystemAction } from '#/shared/auth/system-execution-policy'
import type { Database } from '#/shared/db'
import { ENTRY_POINT_CATALOGUE } from '#/shared/governance/entry-point-catalogue'
import { createConsumerRegistry } from '#/shared/outbox'

const mocks = vi.hoisted(() => ({
  validateEventPayload: vi.fn(
    (_type: string, _version: number, payload: unknown) => payload,
  ),
}))

vi.mock('#/shared/events/schema-registry', () => ({
  validateEventPayload: mocks.validateEventPayload,
}))

import {
  RATING_GOAL_PROPERTY_ARCHIVED_CONSUMER,
  handleRatingGoalPropertyArchived,
  registerRatingGoalPropertyLifecycleConsumer,
} from './rating-goal-property-lifecycle-consumers'

const ORG = 'org-rating-goal-archive-consumer'
const PROPERTY = '5b000000-0000-4000-8000-000000000001'
const EVENT_ID = '5b000000-0000-4000-8000-000000000002'

const archivedFact = (overrides: Record<string, unknown> = {}) => ({
  eventId: EVENT_ID,
  eventType: 'property.archived',
  eventVersion: 1,
  payload: {
    organizationId: ORG,
    propertyId: PROPERTY,
    userId: 'admin-1',
    previousState: 'active',
    sourceEpoch: 3,
    recoveryDeadline: '2026-11-13T12:00:00.000Z',
    occurredAt: '2026-10-14T12:00:00.000Z',
  },
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceContext: 'property',
  sourceAggregateId: PROPERTY,
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

describe('the rating goal Property archive consumer', () => {
  beforeEach(() => vi.clearAllMocks())

  // The dispatcher authorizes each consumer under its own catalogue row, and a
  // denied consumer is never retried: ending the goal of an archived Property
  // must run whatever the goal.use switch says, for exactly one Property.
  it('runs on property.archived under its own ungated, Property-scoped row', () => {
    const registry = createConsumerRegistry()
    registerRatingGoalPropertyLifecycleConsumer(registry, {
      endForArchivedProperty: vi.fn(),
      db: receiptsDb().db,
    })

    const [registration] = registry.listFor('property.archived')
    const row = ENTRY_POINT_CATALOGUE.find(
      (candidate) =>
        candidate.kind === 'consumer' && candidate.name === registration!.module,
    )

    expect(registration).toMatchObject({
      consumerName: RATING_GOAL_PROPERTY_ARCHIVED_CONSUMER,
      module: 'goal.property-lifecycle',
    })
    expect(row).toEqual({
      kind: 'consumer',
      name: 'goal.property-lifecycle',
      action: 'system:goal.end_archived_property_goal',
      capability: 'none',
      resourceScope: 'property',
      externalEffect: false,
    })
    expect(capabilityForSystemAction(row!.action)).toBe('none')
  })

  it('ends the goal set before the epoch the archive moved to, then writes its receipt', async () => {
    const endForArchivedProperty = vi.fn(async () => true)
    const { db, receipts } = receiptsDb()

    await expect(
      handleRatingGoalPropertyArchived(
        { endForArchivedProperty, db },
        archivedFact() as never,
      ),
    ).resolves.toEqual({ status: 'applied' })

    expect(endForArchivedProperty).toHaveBeenCalledWith({
      organizationId: ORG,
      propertyId: PROPERTY,
      archivedEpoch: 3,
    })
    expect(receipts).toEqual([
      {
        eventId: EVENT_ID,
        consumerName: 'goal.on-property-archived',
        status: 'applied',
      },
    ])
  })

  it('writes no receipt when ending fails, so the fact comes again', async () => {
    const endForArchivedProperty = vi.fn(async () => {
      throw new Error('database unavailable')
    })
    const { db, receipts } = receiptsDb()

    await expect(
      handleRatingGoalPropertyArchived(
        { endForArchivedProperty, db },
        archivedFact() as never,
      ),
    ).rejects.toThrow(/database unavailable/u)
    expect(receipts).toEqual([])
  })

  it('refuses a fact whose payload names another tenant, or another event', async () => {
    const endForArchivedProperty = vi.fn()
    const { db } = receiptsDb()

    await expect(
      handleRatingGoalPropertyArchived(
        { endForArchivedProperty, db },
        archivedFact({ organizationId: 'another-organization' }) as never,
      ),
    ).rejects.toThrow(/attribution mismatch/u)
    await expect(
      handleRatingGoalPropertyArchived(
        { endForArchivedProperty, db },
        archivedFact({ eventType: 'property.restored' }) as never,
      ),
    ).rejects.toThrow(/wrong event type/u)
    expect(endForArchivedProperty).not.toHaveBeenCalled()
  })
})
