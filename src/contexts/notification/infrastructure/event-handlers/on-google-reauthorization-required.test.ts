import { describe, expect, it, vi } from 'vitest'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { integrationGoogleAccountReauthorizationRequired } from '#/contexts/integration/domain/events'
import { createEventHandlerDeps } from './test-fixtures'
import { onGoogleReauthorizationRequired } from './on-google-reauthorization-required'

const ORG = organizationId('org-google-reauth-notification')
const CONNECTION = googleConnectionId('82000000-0000-4000-8000-000000000001')
const PROPERTY_A = propertyId('82000000-0000-4000-8000-000000000010')
const ADMIN = userId('user-google-reauth-notification-admin')

const event = integrationGoogleAccountReauthorizationRequired({
  connectionId: CONNECTION,
  organizationId: ORG,
  cause: 'member_removed',
  occurredAt: new Date('2026-08-27T02:00:00.000Z'),
})

describe('onGoogleReauthorizationRequired', () => {
  it('notifies current AccountAdmins once using a stable affected-Property anchor', async () => {
    const deps = createEventHandlerDeps()
    deps.userLookup.findByRole.mockResolvedValue([ADMIN])
    const findGoogleNotificationAnchor = vi.fn(async () => PROPERTY_A)

    await onGoogleReauthorizationRequired({
      queue: deps.queue,
      userLookup: deps.userLookup,
      googleConnectionProperties: { findGoogleNotificationAnchor },
      logger: deps.logger,
    })(event)

    expect(findGoogleNotificationAnchor).toHaveBeenCalledWith(CONNECTION, ORG)
    expect(deps.userLookup.findByRole).toHaveBeenCalledWith(ORG, 'AccountAdmin')
    expect(deps.jobs).toEqual([
      {
        name: 'insert-notification',
        data: {
          userId: ADMIN,
          organizationId: ORG,
          propertyId: PROPERTY_A,
          type: 'integration.reauthorization_required',
          resourceType: 'integration',
          resourceId: CONNECTION,
          eventId: event.eventId,
          payload: {},
          audience: { kind: 'account_admin' },
        },
        opts: { jobId: `${event.eventId}-${ADMIN}` },
      },
    ])
  })

  it('does not create an invalid property-scoped row when no Property is linked', async () => {
    const deps = createEventHandlerDeps()
    deps.userLookup.findByRole.mockResolvedValue([ADMIN])

    await onGoogleReauthorizationRequired({
      queue: deps.queue,
      userLookup: deps.userLookup,
      googleConnectionProperties: {
        findGoogleNotificationAnchor: async () => null,
      },
      logger: deps.logger,
    })(event)

    expect(deps.jobs).toEqual([])
    expect(deps.userLookup.findByRole).not.toHaveBeenCalled()
    expect(deps.logger.warn).toHaveBeenCalledOnce()
  })
})
