import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import {
  clearConsumers,
  listRegisteredConsumers,
} from '#/shared/outbox/consumer-registry'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { inboxItemId, propertyId, userId } from '#/shared/domain/ids'
import {
  handleNotificationInboxEscalationResolved,
  ON_INBOX_ESCALATION_RESOLVED_CONSUMER,
  registerEscalationResolutionNotificationConsumer,
} from './escalation-resolution-outbox-consumers'

const EVENT_ID = '92000000-0000-4000-8000-000000000001'
const ITEM = inboxItemId('92000000-0000-4000-8000-000000000002')
const PROPERTY = propertyId('92000000-0000-4000-8000-000000000003')
const ORG = 'organization-resolution-notification'
const RESOLVER = userId('resolver-resolution-notification')
const ASSIGNEE = userId('assignee-resolution-notification')
const MANAGER = userId('manager-resolution-notification')
const RESOLVED_AT = new Date('2026-08-27T08:00:00.000Z')

const event = (overrides: Partial<ConsumerEvent> = {}): ConsumerEvent => ({
  eventId: EVENT_ID,
  eventType: 'inbox.inbox_item.escalation_resolved',
  eventVersion: 1,
  payload: {
    inboxItemId: ITEM,
    organizationId: ORG,
    propertyId: PROPERTY,
    userId: RESOLVER,
    source: 'web',
    occurredAt: RESOLVED_AT.toISOString(),
  },
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceContext: 'inbox',
  sourceAggregateId: ITEM,
  occurredAt: RESOLVED_AT.toISOString(),
  recordedAt: RESOLVED_AT.toISOString(),
  ...overrides,
})

const makeDeps = () => {
  const jobs: Array<{ name: string; data: unknown; opts?: unknown }> = []
  return {
    queue: {
      add: vi.fn(async (name: string, data: unknown, opts?: unknown) => {
        jobs.push({ name, data, opts })
      }),
    },
    escalationResolutions: {
      findEscalationResolutionFacts: vi.fn(async () => ({
        propertyId: PROPERTY,
        assignedTo: ASSIGNEE,
        propertyName: 'Riverside Hotel',
        isEscalated: false,
        resolvedAt: RESOLVED_AT,
        resolvedBy: RESOLVER,
      })),
    },
    responsibleManagers: {
      findForProperty: vi.fn(async () => [MANAGER]),
      findForPortal: vi.fn(async () => []),
      findForPortalGroup: vi.fn(async () => []),
      isEligibleForProperty: vi.fn(async (_org, _property, candidate) =>
        [ASSIGNEE, MANAGER].includes(candidate),
      ),
    },
    receipts: { insertReceipt: vi.fn(async () => undefined) },
    jobs,
  }
}

describe('escalation-resolution notification consumer', () => {
  beforeEach(() => {
    clearConsumers()
    clearEventSchemas()
    registerAllEventSchemas()
  })
  afterEach(() => {
    clearConsumers()
    clearEventSchemas()
  })

  it('registers under one stable durable identity', () => {
    registerEscalationResolutionNotificationConsumer(makeDeps())
    expect(listRegisteredConsumers()).toEqual([
      {
        eventType: 'inbox.inbox_item.escalation_resolved',
        consumerName: ON_INBOX_ESCALATION_RESOLVED_CONSUMER,
      },
    ])
  })

  it('notifies the current eligible assignee with gentle content-free facts', async () => {
    const deps = makeDeps()
    await expect(
      handleNotificationInboxEscalationResolved(deps, event()),
    ).resolves.toEqual({ status: 'applied' })

    expect(deps.responsibleManagers.findForProperty).not.toHaveBeenCalled()
    expect(deps.jobs).toEqual([
      {
        name: 'insert-notification',
        data: {
          userId: ASSIGNEE,
          organizationId: ORG,
          propertyId: PROPERTY,
          type: 'inbox.escalation_resolved',
          resourceType: 'inbox_item',
          resourceId: ITEM,
          eventId: EVENT_ID,
          payload: { propertyName: 'Riverside Hotel' },
          audience: {
            kind: 'escalation_resolution',
            inboxItemId: ITEM,
            resolvedAt: RESOLVED_AT.toISOString(),
            resolvedBy: RESOLVER,
          },
        },
        opts: { jobId: `${EVENT_ID}-${ASSIGNEE}` },
      },
    ])
    expect(JSON.stringify(deps.jobs[0]?.data)).not.toMatch(
      /snippet|reviewer|guest|rating|content|reason/i,
    )
  })

  it('falls back to current eligible responsible managers when no eligible assignee remains', async () => {
    const deps = makeDeps()
    deps.responsibleManagers.isEligibleForProperty.mockImplementation(
      async (_org, _property, candidate) => candidate === MANAGER,
    )

    await handleNotificationInboxEscalationResolved(deps, event())

    expect(deps.jobs.map((job) => (job.data as { userId: string }).userId)).toEqual([
      MANAGER,
    ])
  })

  it('suppresses the resolving actor without broadening to the fallback tier', async () => {
    const deps = makeDeps()
    deps.escalationResolutions.findEscalationResolutionFacts.mockResolvedValue({
      propertyId: PROPERTY,
      assignedTo: RESOLVER,
      propertyName: 'Riverside Hotel',
      isEscalated: false,
      resolvedAt: RESOLVED_AT,
      resolvedBy: RESOLVER,
    })
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)

    await handleNotificationInboxEscalationResolved(deps, event())

    expect(deps.jobs).toEqual([])
    expect(deps.responsibleManagers.findForProperty).not.toHaveBeenCalled()
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      ON_INBOX_ESCALATION_RESOLVED_CONSUMER,
      'applied',
    )
  })

  it.each([
    ['re-escalated', { isEscalated: true }],
    ['later resolution', { resolvedAt: new Date('2026-08-27T09:00:00.000Z') }],
    ['different resolver', { resolvedBy: userId('another-resolver') }],
    [
      'different Property',
      { propertyId: propertyId('92000000-0000-4000-8000-000000000099') },
    ],
  ] as const)('marks a %s event obsolete without delivery', async (_label, change) => {
    const deps = makeDeps()
    deps.escalationResolutions.findEscalationResolutionFacts.mockResolvedValue({
      propertyId: PROPERTY,
      assignedTo: ASSIGNEE,
      propertyName: 'Riverside Hotel',
      isEscalated: false,
      resolvedAt: RESOLVED_AT,
      resolvedBy: RESOLVER,
      ...change,
    })

    await expect(
      handleNotificationInboxEscalationResolved(deps, event()),
    ).resolves.toEqual({ status: 'obsolete' })
    expect(deps.jobs).toEqual([])
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      ON_INBOX_ESCALATION_RESOLVED_CONSUMER,
      'obsolete',
    )
  })

  it('rejects cross-tenant or Property attribution before current-state lookup', async () => {
    const deps = makeDeps()
    await expect(
      handleNotificationInboxEscalationResolved(
        deps,
        event({ organizationId: 'another-organization' }),
      ),
    ).rejects.toThrow('attribution mismatch')
    await expect(
      handleNotificationInboxEscalationResolved(
        deps,
        event({ propertyId: '92000000-0000-4000-8000-000000000098' }),
      ),
    ).rejects.toThrow('attribution mismatch')
    expect(
      deps.escalationResolutions.findEscalationResolutionFacts,
    ).not.toHaveBeenCalled()
  })

  it('uses stable job ids on replay and writes no receipt after an enqueue failure', async () => {
    const deps = makeDeps()
    await handleNotificationInboxEscalationResolved(deps, event())
    await handleNotificationInboxEscalationResolved(deps, event())
    expect(deps.jobs.map((job) => job.opts)).toEqual([
      { jobId: `${EVENT_ID}-${ASSIGNEE}` },
      { jobId: `${EVENT_ID}-${ASSIGNEE}` },
    ])

    deps.receipts.insertReceipt.mockClear()
    deps.queue.add.mockRejectedValue(new Error('queue unavailable'))
    await expect(
      handleNotificationInboxEscalationResolved(deps, event()),
    ).rejects.toThrow('queue unavailable')
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })
})
