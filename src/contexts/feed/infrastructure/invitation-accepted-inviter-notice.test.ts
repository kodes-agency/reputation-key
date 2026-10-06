import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { parseNotificationAudience } from '../application/notification-audience'
import {
  handleInvitationAcceptedInviterNotice,
  INVITATION_ACCEPTED_INVITER_CONSUMER,
} from './invitation-accepted-inviter-notice'
import { createNotificationConsumerDeps } from './notification-consumer-test-fixtures'

const ORG = 'org-inviter-notice'
const EVENT_ID = '92000000-0000-4000-8000-000000000001'
const INVITER = 'inviter-admin'
const ACCEPTER = 'the-person-who-joined'

const accepted = (
  payload: Record<string, unknown> = {},
  overrides: Partial<ConsumerEvent> = {},
): ConsumerEvent => ({
  eventId: EVENT_ID,
  eventType: 'identity.invitation.accepted',
  eventVersion: 1,
  payload: {
    organizationId: ORG,
    userId: ACCEPTER,
    invitationId: 'invitation-1',
    inviterId: INVITER,
    ...payload,
  },
  organizationId: ORG,
  propertyId: null,
  sourceContext: 'identity',
  sourceAggregateId: 'invitation-1',
  recordedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
})

const makeDeps = () => {
  const fakes = createNotificationConsumerDeps()
  return {
    queue: fakes.queue,
    receipts: { insertReceipt: vi.fn(async () => undefined) },
    displayNames: fakes.displayNames,
    logger: fakes.logger,
    fakes,
  }
}

// An accepted invitation tells its inviter, at the Organization, and never says
// who accepted it (ADR 0046 r.8).
describe('the accepted-invitation notice to the inviter', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })
  afterEach(() => {
    clearEventSchemas()
  })

  it('queues an Organization-scoped notice for the inviter, admitted as an AccountAdmin', async () => {
    const deps = makeDeps()
    deps.fakes.displayNames.findOrganizationName.mockResolvedValue('Riverside Group')

    await expect(
      handleInvitationAcceptedInviterNotice(deps, accepted()),
    ).resolves.toEqual({ status: 'applied' })

    expect(deps.queue.add).toHaveBeenCalledWith(
      'insert-notification',
      {
        userId: INVITER,
        organizationId: ORG,
        propertyId: null,
        type: 'account.invitation_accepted',
        resourceType: 'organization',
        resourceId: ORG,
        eventId: EVENT_ID,
        payload: { organizationName: 'Riverside Group' },
        audience: { kind: 'account_admin' },
      },
      // Distinct from the new member's own job for this same fact.
      { jobId: `${EVENT_ID}-inviter-${INVITER}` },
    )
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      INVITATION_ACCEPTED_INVITER_CONSUMER,
      'applied',
    )
  })

  it('queues an audience the delivery check reads back as AccountAdmin', async () => {
    const deps = makeDeps()

    await handleInvitationAcceptedInviterNotice(deps, accepted())

    const job = vi.mocked(deps.queue.add).mock.calls[0]?.[1] as { audience: unknown }
    expect(parseNotificationAudience(job.audience)).toEqual({ kind: 'account_admin' })
  })

  it('never names the person who joined, and omits an unknown organization name', async () => {
    const deps = makeDeps()

    await handleInvitationAcceptedInviterNotice(deps, accepted())

    const job = vi.mocked(deps.queue.add).mock.calls[0]?.[1]
    expect(JSON.stringify(job)).not.toContain(ACCEPTER)
    expect(job).not.toHaveProperty('payload')
  })

  it('records an obsolete receipt and sends nothing for a fact recorded before it named its inviter', async () => {
    const deps = makeDeps()

    await expect(
      handleInvitationAcceptedInviterNotice(deps, accepted({ inviterId: undefined })),
    ).resolves.toEqual({ status: 'obsolete' })

    expect(deps.queue.add).not.toHaveBeenCalled()
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      INVITATION_ACCEPTED_INVITER_CONSUMER,
      'obsolete',
    )
  })

  it.each([
    ['a Property', { propertyId: 'property-1' }],
    ['another Organization in the envelope', { organizationId: 'another-org' }],
    ['another context', { sourceContext: 'inbox' }],
  ])('fails closed on a fact attributed to %s', async (_label, overrides) => {
    const deps = makeDeps()

    await expect(
      handleInvitationAcceptedInviterNotice(deps, accepted({}, overrides)),
    ).rejects.toThrow('attribution mismatch')
    expect(deps.queue.add).not.toHaveBeenCalled()
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })

  it('fails closed when the payload names another Organization than its envelope', async () => {
    const deps = makeDeps()

    await expect(
      handleInvitationAcceptedInviterNotice(
        deps,
        accepted({ organizationId: 'another-org' }),
      ),
    ).rejects.toThrow('attribution mismatch')
    expect(deps.queue.add).not.toHaveBeenCalled()
  })
})
