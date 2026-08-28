import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import {
  clearConsumers,
  listRegisteredConsumers,
} from '#/shared/outbox/consumer-registry'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { userId } from '#/shared/domain/ids'
import {
  handleNotificationPortalHealthChanged,
  ON_PORTAL_HEALTH_CHANGED_CONSUMER,
  registerPortalHealthNotificationConsumer,
} from './portal-health-outbox-consumers'

const IDS = {
  event: '85000000-0000-4000-8000-000000000001',
  portal: '85000000-0000-4000-8000-000000000002',
  property: '85000000-0000-4000-8000-000000000003',
} as const
const ORG = 'portal-health-notification-org'
const MANAGER = userId('portal-health-notification-manager')
const ADMIN = userId('portal-health-notification-admin')
const SOURCE_VERSION = 'health-source-v3'

const event = (
  payloadOverrides: Readonly<Record<string, unknown>> = {},
  envelopeOverrides: Partial<ConsumerEvent> = {},
): ConsumerEvent => ({
  eventId: IDS.event,
  eventType: 'portal.health.changed',
  eventVersion: 1,
  payload: {
    portalId: IDS.portal,
    organizationId: ORG,
    propertyId: IDS.property,
    previousStatus: 'healthy',
    previousReason: 'operational',
    status: 'degraded',
    reason: 'google_destination_unavailable',
    sourceVersion: SOURCE_VERSION,
    occurredAt: '2026-08-27T08:00:00.000Z',
    ...payloadOverrides,
  },
  organizationId: ORG,
  propertyId: IDS.property,
  sourceContext: 'portal',
  sourceAggregateId: IDS.portal,
  recordedAt: '2026-08-27T08:00:00.000Z',
  ...envelopeOverrides,
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
    responsibleManagers: {
      findForProperty: vi.fn(async () => []),
      findForPortal: vi.fn(async () => [MANAGER]),
      findForPortalGroup: vi.fn(async () => []),
      isEligibleForProperty: vi.fn(async () => true),
    },
    userLookup: { findByRole: vi.fn(async () => [ADMIN]) },
    receipts: { insertReceipt: vi.fn(async () => undefined) },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    },
    jobs,
  }
}

describe('Portal Health notification durable consumer', () => {
  beforeEach(() => {
    clearConsumers()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  afterEach(() => {
    clearConsumers()
    clearEventSchemas()
  })

  it('registers the exact durable Portal Health route', () => {
    registerPortalHealthNotificationConsumer(makeDeps())
    expect(listRegisteredConsumers()).toEqual([
      {
        eventType: 'portal.health.changed',
        consumerName: ON_PORTAL_HEALTH_CHANGED_CONSUMER,
      },
    ])
  })

  it('notifies current Portal managers for an actionable automatic degradation', async () => {
    const deps = makeDeps()

    await expect(handleNotificationPortalHealthChanged(deps, event())).resolves.toEqual({
      status: 'applied',
    })

    expect(deps.jobs).toEqual([
      {
        name: 'insert-notification',
        data: {
          userId: MANAGER,
          organizationId: ORG,
          propertyId: IDS.property,
          type: 'portal.health_attention',
          resourceType: 'portal',
          resourceId: IDS.portal,
          eventId: IDS.event,
          payload: {},
          audience: {
            kind: 'portal_health',
            portalId: IDS.portal,
            status: 'degraded',
            reason: 'google_destination_unavailable',
            sourceVersion: SOURCE_VERSION,
          },
        },
        opts: { jobId: `${IDS.event}-${MANAGER}` },
      },
    ])
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      IDS.event,
      ON_PORTAL_HEALTH_CHANGED_CONSUMER,
      'applied',
    )
  })

  it('uses AccountAdmin recovery only when no eligible Portal manager remains', async () => {
    const deps = makeDeps()
    deps.responsibleManagers.findForPortal.mockResolvedValue([])

    await handleNotificationPortalHealthChanged(deps, event())

    expect(deps.jobs).toHaveLength(1)
    expect(deps.jobs[0]?.data).toMatchObject({ userId: ADMIN })
  })

  it.each([
    ['operational', 'healthy'],
    ['publication_draft', 'unavailable'],
    ['publication_disabled', 'unavailable'],
    ['publication_archived', 'unavailable'],
    ['responsibility_needed', 'degraded'],
    ['google_destination_awaiting_refresh', 'degraded'],
  ] as const)('records %s as receipt-only', async (reason, status) => {
    const deps = makeDeps()

    await expect(
      handleNotificationPortalHealthChanged(deps, event({ reason, status })),
    ).resolves.toEqual({ status: 'obsolete' })

    expect(deps.queue.add).not.toHaveBeenCalled()
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      IDS.event,
      ON_PORTAL_HEALTH_CHANGED_CONSUMER,
      'obsolete',
    )
  })

  it('fails closed on tenant or Property attribution mismatch', async () => {
    const deps = makeDeps()

    await expect(
      handleNotificationPortalHealthChanged(
        deps,
        event({}, { organizationId: 'another-org' }),
      ),
    ).rejects.toThrow('Portal Health envelope attribution mismatch')
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })
})
