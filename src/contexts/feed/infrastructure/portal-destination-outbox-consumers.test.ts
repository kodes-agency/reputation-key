import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod/v4'
import type { ConsumerEvent } from '#/shared/outbox/consumer-registry'
import {
  createConsumerRegistry,
  type ConsumerRegistry,
} from '#/shared/outbox/consumer-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { portalId, propertyId, unbrand, userId } from '#/shared/domain/ids'
import type { PortalDestinationApprovalFacts } from '#/contexts/portal/application/public-api'
import {
  createNotificationConsumerDeps,
  NOTIF_TEST_IDS,
} from './notification-consumer-test-fixtures'
import {
  handleNotificationPortalDestinationPending,
  ON_PORTAL_DESTINATION_PENDING_CONSUMER,
  registerPortalDestinationNotificationConsumer,
} from './portal-destination-outbox-consumers'

const EVENT_ID = '31000000-0000-4000-8000-000000000002'
const SITE = '31000000-0000-4000-8000-000000000003'
const LOBBY = portalId('31000000-0000-4000-8000-000000000004')
const MANAGER = userId('manager-who-asked')

const event = (
  overrides: Partial<ConsumerEvent> = {},
  approvalState = 'pending',
): ConsumerEvent => ({
  eventId: EVENT_ID,
  eventType: 'portal.approved_destination.updated',
  eventVersion: 1,
  payload: {
    approvedDestinationId: SITE,
    organizationId: unbrand(NOTIF_TEST_IDS.orgId),
    propertyId: unbrand(NOTIF_TEST_IDS.propId),
    approvalState,
    sourceAggregateVersion: NOTIF_TEST_IDS.now.toISOString(),
    occurredAt: NOTIF_TEST_IDS.now.toISOString(),
  },
  organizationId: unbrand(NOTIF_TEST_IDS.orgId),
  propertyId: unbrand(NOTIF_TEST_IDS.propId),
  sourceContext: 'portal',
  sourceAggregateId: SITE,
  recordedAt: '2026-06-01T11:59:00.000Z',
  ...overrides,
})

const waitingSite = (
  overrides: Partial<PortalDestinationApprovalFacts> = {},
): PortalDestinationApprovalFacts => ({
  propertyId: NOTIF_TEST_IDS.propId,
  hostname: 'menu.example.com',
  approvalState: 'pending',
  requestedBy: MANAGER,
  portal: { id: LOBBY, name: 'Lobby' },
  otherPortalCount: 0,
  ...overrides,
})

const makeDeps = (site: PortalDestinationApprovalFacts | null = waitingSite()) => {
  const fakes = createNotificationConsumerDeps()
  const findDestinationApprovalNotificationFacts = vi.fn(async () => site)
  return {
    queue: fakes.queue,
    userLookup: fakes.userLookup,
    displayNames: fakes.displayNames,
    destinations: { findDestinationApprovalNotificationFacts },
    logger: fakes.logger,
    receipts: { insertReceipt: vi.fn(async () => {}) },
    fakes,
    findDestinationApprovalNotificationFacts,
  }
}

describe('a site waiting for approval tells the account admins', () => {
  let consumerRegistry: ConsumerRegistry

  beforeEach(() => {
    consumerRegistry = createConsumerRegistry()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  afterEach(() => {
    clearEventSchemas()
  })

  it('registers under its own consumer identity', () => {
    registerPortalDestinationNotificationConsumer(consumerRegistry, makeDeps())

    expect(consumerRegistry.list()).toContainEqual({
      eventType: 'portal.approved_destination.updated',
      consumerName: 'notification.on-portal-destination-pending',
    })
  })

  it('queues one notice for the site to every account admin, and only them', async () => {
    const deps = makeDeps()
    deps.fakes.userLookup.findByRole.mockResolvedValue([
      NOTIF_TEST_IDS.admin1,
      NOTIF_TEST_IDS.admin2,
    ])

    await expect(
      handleNotificationPortalDestinationPending(deps, event()),
    ).resolves.toEqual({ status: 'applied' })

    expect(deps.fakes.userLookup.findByRole).toHaveBeenCalledWith(
      NOTIF_TEST_IDS.orgId,
      'AccountAdmin',
    )
    expect(deps.fakes.jobs.map((job) => job.data)).toEqual(
      [NOTIF_TEST_IDS.admin1, NOTIF_TEST_IDS.admin2].map((recipient) =>
        expect.objectContaining({
          userId: recipient,
          propertyId: NOTIF_TEST_IDS.propId,
          type: 'portal.link_approval',
          // Filed under the site: several links and Portals can open one.
          resourceType: 'portal_destination',
          resourceId: SITE,
          eventId: EVENT_ID,
          audience: { kind: 'account_admin' },
        }),
      ),
    )
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      ON_PORTAL_DESTINATION_PENDING_CONSUMER,
      'applied',
    )
  })

  it('never asks the Property’s responsible managers or the manager who asked', async () => {
    const deps = makeDeps(waitingSite({ requestedBy: NOTIF_TEST_IDS.admin1 }))
    deps.fakes.userLookup.findByRole.mockResolvedValue([
      NOTIF_TEST_IDS.admin1,
      NOTIF_TEST_IDS.admin2,
    ])

    await handleNotificationPortalDestinationPending(deps, event())

    // An admin who asked for the site from the list is looking at it.
    expect(deps.fakes.jobs.map((job) => (job.data as { userId: string }).userId)).toEqual(
      [NOTIF_TEST_IDS.admin2],
    )
    expect(deps.fakes.responsibleManagers.findForProperty).not.toHaveBeenCalled()
    expect(deps.fakes.responsibleManagers.findForPortal).not.toHaveBeenCalled()
  })

  it('names the site by its host, the Portal to open, and the others, never the address', async () => {
    const deps = makeDeps(
      waitingSite({ otherPortalCount: 2, portal: { id: LOBBY, name: 'Lobby' } }),
    )
    deps.fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])

    await handleNotificationPortalDestinationPending(deps, event())

    const payload = (deps.fakes.jobs[0]?.data as { payload: Record<string, unknown> })
      .payload
    expect(payload).toEqual({
      propertyName: 'Riverside Hotel',
      siteHost: 'menu.example.com',
      portalName: 'Lobby',
      portalId: LOBBY,
      otherPortalCount: 2,
    })
    expect(JSON.stringify(deps.fakes.jobs)).not.toContain('https://')
  })

  it('says nothing about other Portals when none opens the site', async () => {
    const deps = makeDeps()
    deps.fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])

    await handleNotificationPortalDestinationPending(deps, event())

    expect(deps.fakes.jobs[0]?.data).toMatchObject({
      payload: expect.not.objectContaining({ otherPortalCount: expect.anything() }),
    })
  })

  it('queues deterministically, so a redelivery cannot notify twice', async () => {
    const deps = makeDeps()
    deps.fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])

    await handleNotificationPortalDestinationPending(deps, event())
    await handleNotificationPortalDestinationPending(deps, event())

    const ids = deps.fakes.jobs.map((job) => (job.opts as { jobId: string }).jobId)
    expect(ids).toEqual([
      `${EVENT_ID}-${NOTIF_TEST_IDS.admin1}`,
      `${EVENT_ID}-${NOTIF_TEST_IDS.admin1}`,
    ])
  })

  it('warns, and writes the receipt, when the Organization has no account admin', async () => {
    const deps = makeDeps()
    deps.fakes.userLookup.findByRole.mockResolvedValue([])

    await expect(
      handleNotificationPortalDestinationPending(deps, event()),
    ).resolves.toEqual({ status: 'applied' })

    expect(deps.fakes.jobs).toEqual([])
    expect(deps.fakes.logger.warn).toHaveBeenCalled()
  })

  it.each(['approved', 'disabled', 'quarantined'])(
    'queues nothing for the %s state, which is a decision and not news',
    async (state) => {
      const deps = makeDeps()
      deps.fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])

      await expect(
        handleNotificationPortalDestinationPending(deps, event({}, state)),
      ).resolves.toEqual({ status: 'obsolete' })

      expect(deps.fakes.jobs).toEqual([])
      expect(deps.findDestinationApprovalNotificationFacts).not.toHaveBeenCalled()
      expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
        EVENT_ID,
        ON_PORTAL_DESTINATION_PENDING_CONSUMER,
        'obsolete',
      )
    },
  )

  it.each([
    ['is gone', null],
    ['was decided while the event waited', waitingSite({ approvalState: 'approved' })],
    ['has no live Portal to be decided on', waitingSite({ portal: null })],
    [
      'belongs to another Property than the event says',
      waitingSite({ propertyId: propertyId('another-property') }),
    ],
  ] as const)('queues nothing for a site that %s', async (_case, site) => {
    const deps = makeDeps(site)
    deps.fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])

    await expect(
      handleNotificationPortalDestinationPending(deps, event()),
    ).resolves.toEqual({ status: 'obsolete' })

    expect(deps.fakes.jobs).toEqual([])
  })

  it('fails closed on organization or property attribution mismatch', async () => {
    const deps = makeDeps()

    await expect(
      handleNotificationPortalDestinationPending(
        deps,
        event({ organizationId: 'another-org' }),
      ),
    ).rejects.toThrow('attribution mismatch')
    await expect(
      handleNotificationPortalDestinationPending(
        deps,
        event({ propertyId: 'another-property' }),
      ),
    ).rejects.toThrow('attribution mismatch')
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })

  it('rejects a payload that is not a site fact', async () => {
    const deps = makeDeps()

    await expect(
      handleNotificationPortalDestinationPending(
        deps,
        event({ payload: { organizationId: 'x', propertyId: 'y' } }),
      ),
    ).rejects.toThrowError(ZodError)
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })
})
