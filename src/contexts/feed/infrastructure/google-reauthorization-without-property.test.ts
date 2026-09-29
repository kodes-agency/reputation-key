// Google can need reconnecting before the Organization has an active Property:
// the whole window between connecting Google and the first successful import,
// and an Organization whose Properties are all archived. The notice then has
// no Property to anchor its mail on, and used to reach nobody at all.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { googleConnectionId, organizationId, userId } from '#/shared/domain/ids'
import { createNotificationConsumerDeps } from './notification-consumer-test-fixtures'
import {
  handleNotificationGoogleReauthorizationRequired,
  ON_GOOGLE_REAUTHORIZATION_REQUIRED_CONSUMER,
} from './integration-outbox-consumers'

const EVENT_ID = '83100000-0000-4000-8000-000000000001'
const ORG = organizationId('org-google-reauth-without-property')
const CONNECTION = googleConnectionId('83100000-0000-4000-8000-000000000002')
const ADMIN = userId('admin-google-reauth-without-property')
const OTHER_ADMIN = userId('other-admin-google-reauth-without-property')

const event = (): ConsumerEvent => ({
  eventId: EVENT_ID,
  eventType: 'integration.google_account.reauthorization_required',
  eventVersion: 1,
  payload: {
    connectionId: CONNECTION,
    organizationId: ORG,
    cause: 'provider_revoked',
    occurredAt: '2026-09-28T03:00:00.000Z',
  },
  organizationId: ORG,
  propertyId: null,
  sourceContext: 'integration',
  sourceAggregateId: CONNECTION,
  recordedAt: '2026-09-28T03:00:00.000Z',
})

describe('Google reauthorization with no active Property', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })
  afterEach(() => clearEventSchemas())

  it('tells every AccountAdmin in the bell at Organization scope', async () => {
    const fakes = createNotificationConsumerDeps()
    fakes.userLookup.findByRole.mockResolvedValue([ADMIN, OTHER_ADMIN])
    const deps = {
      queue: fakes.queue,
      userLookup: fakes.userLookup,
      googleConnectionProperties: {
        findGoogleNotificationAnchor: vi.fn(async () => null),
      },
      logger: fakes.logger,
      receipts: { insertReceipt: vi.fn(async () => undefined) },
    }

    await expect(
      handleNotificationGoogleReauthorizationRequired(deps, event()),
    ).resolves.toEqual({ status: 'applied' })

    expect(fakes.jobs.map((job) => job.data)).toEqual(
      [ADMIN, OTHER_ADMIN].map((recipient) =>
        expect.objectContaining({
          userId: recipient,
          organizationId: ORG,
          propertyId: null,
          type: 'integration.reauthorization_required',
          resourceType: 'integration',
          resourceId: CONNECTION,
          payload: { reauthorizationCause: 'provider_revoked' },
          audience: { kind: 'organization_account_admin' },
        }),
      ),
    )
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      ON_GOOGLE_REAUTHORIZATION_REQUIRED_CONSUMER,
      'applied',
    )
  })
})
