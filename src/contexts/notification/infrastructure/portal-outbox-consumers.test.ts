import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod/v4'
import type { ConsumerEvent } from '#/shared/outbox/consumer-registry'
import {
  clearConsumers,
  listRegisteredConsumers,
} from '#/shared/outbox/consumer-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { createEventHandlerDeps, NOTIF_TEST_IDS } from './event-handlers/test-fixtures'
import {
  handleNotificationPortalResponsibilityNeeded,
  ON_PORTAL_RESPONSIBILITY_NEEDED_CONSUMER,
  registerPortalNotificationConsumers,
} from './portal-outbox-consumers'
import { unbrand } from '#/shared/domain/ids'

const EVENT_ID = '30000000-0000-4000-8000-000000000002'

const event = (overrides: Partial<ConsumerEvent> = {}): ConsumerEvent => ({
  eventId: EVENT_ID,
  eventType: 'portal.responsibility_became_needed',
  eventVersion: 2,
  payload: {
    portalId: 'portal-1',
    organizationId: unbrand(NOTIF_TEST_IDS.orgId),
    propertyId: unbrand(NOTIF_TEST_IDS.propId),
    sourceAggregateVersion: NOTIF_TEST_IDS.now.toISOString(),
    occurredAt: NOTIF_TEST_IDS.now.toISOString(),
  },
  organizationId: unbrand(NOTIF_TEST_IDS.orgId),
  propertyId: unbrand(NOTIF_TEST_IDS.propId),
  sourceContext: 'portal',
  sourceAggregateId: 'portal-1',
  recordedAt: '2026-06-01T11:59:00.000Z',
  ...overrides,
})

const makeDeps = () => {
  const fakes = createEventHandlerDeps()
  return {
    queue: fakes.queue,
    userLookup: fakes.userLookup,
    logger: fakes.logger,
    receipts: { insertReceipt: vi.fn(async () => {}) },
    fakes,
  }
}

describe('portal notification durable consumer', () => {
  beforeEach(() => {
    clearConsumers()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  afterEach(() => {
    clearConsumers()
    clearEventSchemas()
  })

  it('registers under its portal-gated consumer identity', () => {
    registerPortalNotificationConsumers(makeDeps())
    expect(listRegisteredConsumers()).toContainEqual({
      eventType: 'portal.responsibility_became_needed',
      consumerName: 'notification.on-portal-responsibility-needed',
    })
  })

  it('fans out deterministically and writes an applied receipt', async () => {
    const deps = makeDeps()
    deps.fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])

    await expect(
      handleNotificationPortalResponsibilityNeeded(deps, event()),
    ).resolves.toEqual({ status: 'applied' })

    expect(deps.fakes.jobs[0]?.opts).toEqual({
      jobId: `${EVENT_ID}-${NOTIF_TEST_IDS.admin1}`,
    })
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      ON_PORTAL_RESPONSIBILITY_NEEDED_CONSUMER,
      'applied',
    )
  })

  it('replays a legacy v1 envelope using its occurrence as the historical version', async () => {
    const deps = makeDeps()
    deps.fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])
    const legacy = event({
      eventVersion: 1,
      payload: {
        portalId: 'portal-1',
        organizationId: unbrand(NOTIF_TEST_IDS.orgId),
        propertyId: unbrand(NOTIF_TEST_IDS.propId),
        occurredAt: NOTIF_TEST_IDS.now.toISOString(),
      },
    })

    await expect(
      handleNotificationPortalResponsibilityNeeded(deps, legacy),
    ).resolves.toEqual({ status: 'applied' })
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      ON_PORTAL_RESPONSIBILITY_NEEDED_CONSUMER,
      'applied',
    )
  })

  it('rejects a v2 envelope without the committed aggregate revision', async () => {
    const deps = makeDeps()
    const { sourceAggregateVersion: _omitted, ...payload } = event().payload as Record<
      string,
      unknown
    >

    await expect(
      handleNotificationPortalResponsibilityNeeded(deps, event({ payload })),
    ).rejects.toThrowError(ZodError)
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })

  it('fails closed on organization or property attribution mismatch', async () => {
    const deps = makeDeps()
    await expect(
      handleNotificationPortalResponsibilityNeeded(
        deps,
        event({ organizationId: 'another-org' }),
      ),
    ).rejects.toThrow('attribution mismatch')
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })
})
