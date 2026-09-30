import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import {
  createConsumerRegistry,
  type ConsumerRegistry,
} from '#/shared/outbox/consumer-registry'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  BETA_FEEDBACK_OUTCOME_CONSUMER,
  handleBetaFeedbackOutcomeEvent,
  handleIdentityAccountNotificationEvent,
  handleOrganizationPurgePendingNotice,
  IDENTITY_ACCOUNT_NOTIFICATION_CONSUMERS,
  ORGANIZATION_PURGE_PENDING_CONSUMER,
  registerIdentityAccountNotificationConsumers,
} from './identity-account-outbox-consumers'
import { INVITATION_ACCEPTED_INVITER_CONSUMER } from './invitation-accepted-inviter-notice'
import { createNotificationConsumerDeps } from './notification-consumer-test-fixtures'

// ARC-03-T7: a fresh container-scoped registry per test.
let consumerRegistry: ConsumerRegistry = createConsumerRegistry()

const ORG = 'org-account-notice'
const EVENT_ID = '91000000-0000-4000-8000-000000000001'

const event = (overrides: Partial<ConsumerEvent> = {}): ConsumerEvent => ({
  eventId: EVENT_ID,
  eventType: 'identity.member.role_changed',
  eventVersion: 1,
  payload: {
    organizationId: ORG,
    userId: 'admin-actor',
    memberUserId: 'affected-user',
    previousRole: 'Member',
    newRole: 'PropertyManager',
  },
  organizationId: ORG,
  propertyId: null,
  sourceContext: 'identity',
  sourceAggregateId: 'affected-user',
  recordedAt: '2026-08-28T00:00:00.000Z',
  ...overrides,
})

const makeDeps = () => {
  const fakes = createNotificationConsumerDeps()
  return {
    queue: fakes.queue,
    receipts: { insertReceipt: vi.fn(async () => undefined) },
    userLookup: fakes.userLookup,
    displayNames: fakes.displayNames,
    logger: fakes.logger,
    fakes,
  }
}

describe('Identity account mandatory notification consumers', () => {
  beforeEach(() => {
    consumerRegistry = createConsumerRegistry()
    clearEventSchemas()
    registerAllEventSchemas()
  })
  afterEach(() => {
    consumerRegistry = createConsumerRegistry()
    clearEventSchemas()
  })

  it('registers the durable affected-account facts and the inviter notice, and not an invitation being sent', () => {
    registerIdentityAccountNotificationConsumers(consumerRegistry, makeDeps())

    expect(consumerRegistry.list()).toEqual(
      expect.arrayContaining(
        IDENTITY_ACCOUNT_NOTIFICATION_CONSUMERS.map(({ eventType, consumerName }) => ({
          eventType,
          consumerName,
        })),
      ),
    )
    expect(consumerRegistry.list()).toContainEqual({
      eventType: 'identity.member.property_access_changed',
      consumerName: 'notification.on-identity-member-property-access-changed',
    })
    expect(consumerRegistry.list()).toContainEqual({
      eventType: 'identity.invitation.accepted',
      consumerName: INVITATION_ACCEPTED_INVITER_CONSUMER,
    })
    expect(consumerRegistry.list()).not.toContainEqual(
      expect.objectContaining({ eventType: 'identity.member.invited' }),
    )
  })

  it('names the organization in every account notice, and carries nothing when its name is unknown', async () => {
    const deps = makeDeps()
    deps.fakes.displayNames.findOrganizationName.mockResolvedValue('Riverside Group')
    await handleIdentityAccountNotificationEvent(
      deps,
      event({
        eventType: 'identity.invitation.accepted',
        payload: { organizationId: ORG, userId: 'affected-user', invitationId: 'inv-1' },
      }),
    )
    expect(deps.queue.add).toHaveBeenLastCalledWith(
      'insert-notification',
      expect.objectContaining({
        type: 'account.organization_access_granted',
        payload: { organizationName: 'Riverside Group' },
      }),
      expect.anything(),
    )

    const unnamed = makeDeps()
    await handleIdentityAccountNotificationEvent(
      unnamed,
      event({
        eventType: 'identity.invitation.accepted',
        payload: { organizationId: ORG, userId: 'affected-user', invitationId: 'inv-1' },
      }),
    )
    // A failed or empty name lookup degrades the copy, never the notice.
    expect(vi.mocked(unnamed.queue.add).mock.calls[0]?.[1]).not.toHaveProperty('payload')
  })

  it.each([
    ['PropertyManager', 'property_manager'],
    ['AccountAdmin', 'account_admin'],
  ])('tells a member who is now a %s which role that is', async (newRole, memberRole) => {
    const deps = makeDeps()
    deps.fakes.displayNames.findOrganizationName.mockResolvedValue('Riverside Group')

    await handleIdentityAccountNotificationEvent(
      deps,
      event({
        payload: {
          organizationId: ORG,
          userId: 'admin-actor',
          memberUserId: 'affected-user',
          previousRole: 'Member',
          newRole,
        },
      }),
    )

    expect(deps.queue.add).toHaveBeenCalledWith(
      'insert-notification',
      expect.objectContaining({
        type: 'account.organization_role_changed',
        payload: { organizationName: 'Riverside Group', memberRole },
      }),
      expect.anything(),
    )
  })

  it('names no role for one the copy has no phrase for, and never the actor', async () => {
    const deps = makeDeps()

    await handleIdentityAccountNotificationEvent(
      deps,
      event({
        payload: {
          organizationId: ORG,
          userId: 'admin-actor',
          memberUserId: 'affected-user',
          previousRole: 'PropertyManager',
          newRole: 'Member',
        },
      }),
    )

    const job = vi.mocked(deps.queue.add).mock.calls[0]?.[1]
    expect(job).not.toHaveProperty('payload')
    expect(JSON.stringify(job)).not.toContain('admin-actor')
  })

  it('keeps the self-leave flag beside the organization name on an access removal', async () => {
    const deps = makeDeps()
    deps.fakes.displayNames.findOrganizationName.mockResolvedValue('Riverside Group')

    await handleIdentityAccountNotificationEvent(
      deps,
      event({
        eventType: 'identity.member.removed',
        payload: {
          organizationId: ORG,
          userId: 'affected-user',
          removedBy: 'affected-user',
        },
      }),
    )

    expect(deps.queue.add).toHaveBeenCalledWith(
      'insert-notification',
      expect.objectContaining({
        payload: { organizationName: 'Riverside Group', leftOrganization: true },
      }),
      expect.anything(),
    )
  })

  describe("a PropertyManager's property access changed", () => {
    const accessEvent = (overrides: Partial<ConsumerEvent> = {}): ConsumerEvent =>
      event({
        eventType: 'identity.member.property_access_changed',
        payload: {
          organizationId: ORG,
          userId: 'admin-actor',
          memberUserId: 'affected-user',
          grantedPropertyIds: ['4d1f0c1e-2b7a-4c55-9a51-000000000001'],
          revokedPropertyIds: [],
        },
        ...overrides,
      })

    it('notifies the member, never the AccountAdmin who changed it, at Organization scope', async () => {
      const deps = makeDeps()
      deps.fakes.displayNames.findOrganizationName.mockResolvedValue('Riverside Group')

      await expect(
        handleIdentityAccountNotificationEvent(deps, accessEvent()),
      ).resolves.toEqual({ status: 'applied' })

      expect(deps.queue.add).toHaveBeenCalledWith(
        'insert-notification',
        {
          userId: 'affected-user',
          organizationId: ORG,
          propertyId: null,
          type: 'account.organization_property_access_changed',
          resourceType: 'organization',
          resourceId: ORG,
          eventId: EVENT_ID,
          payload: { organizationName: 'Riverside Group' },
          audience: {
            kind: 'affected_organization_user',
            eventId: EVENT_ID,
            eventType: 'identity.member.property_access_changed',
          },
        },
        { jobId: `${EVENT_ID}-affected-user` },
      )
      expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
        EVENT_ID,
        'notification.on-identity-member-property-access-changed',
        'applied',
      )
    })

    it('carries no Property, count or actor into the queued notice', async () => {
      const deps = makeDeps()

      await handleIdentityAccountNotificationEvent(deps, accessEvent())

      const job = JSON.stringify(vi.mocked(deps.queue.add).mock.calls)
      expect(job).not.toContain('admin-actor')
      expect(job).not.toContain('4d1f0c1e-2b7a-4c55-9a51-000000000001')
    })

    it('fails closed on a fact attributed to a Property or to another Organization', async () => {
      const deps = makeDeps()

      await expect(
        handleIdentityAccountNotificationEvent(
          deps,
          accessEvent({ propertyId: 'property-1' }),
        ),
      ).rejects.toThrow('attribution mismatch')
      await expect(
        handleIdentityAccountNotificationEvent(
          deps,
          accessEvent({ organizationId: 'another-org' }),
        ),
      ).rejects.toThrow('attribution mismatch')
      expect(deps.queue.add).not.toHaveBeenCalled()
      expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
    })
  })

  it('enqueues the role-change notice for the target, never the actor', async () => {
    const deps = makeDeps()

    await expect(handleIdentityAccountNotificationEvent(deps, event())).resolves.toEqual({
      status: 'applied',
    })

    expect(deps.queue.add).toHaveBeenCalledWith(
      'insert-notification',
      {
        userId: 'affected-user',
        organizationId: ORG,
        propertyId: null,
        type: 'account.organization_role_changed',
        resourceType: 'organization',
        resourceId: ORG,
        eventId: EVENT_ID,
        // The role the member now holds, never the administrator who set it.
        payload: { memberRole: 'property_manager' },
        audience: {
          kind: 'affected_organization_user',
          eventId: EVENT_ID,
          eventType: 'identity.member.role_changed',
        },
      },
      { jobId: `${EVENT_ID}-affected-user` },
    )
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      'notification.on-identity-member-role-changed',
      'applied',
    )
  })

  it.each([
    {
      eventType: 'identity.invitation.accepted',
      payload: {
        organizationId: ORG,
        userId: 'affected-user',
        invitationId: 'invitation-1',
      },
      type: 'account.organization_access_granted',
    },
    {
      eventType: 'identity.member.removed',
      payload: { organizationId: ORG, userId: 'affected-user' },
      type: 'account.organization_access_removed',
    },
  ])('maps $eventType to $type', async ({ eventType, payload, type }) => {
    const deps = makeDeps()
    await handleIdentityAccountNotificationEvent(deps, event({ eventType, payload }))

    expect(deps.queue.add).toHaveBeenCalledWith(
      'insert-notification',
      expect.objectContaining({ type, userId: 'affected-user' }),
      { jobId: `${EVENT_ID}-affected-user` },
    )
  })

  it('fails closed before enqueue or receipt on envelope attribution mismatch', async () => {
    const deps = makeDeps()
    await expect(
      handleIdentityAccountNotificationEvent(
        deps,
        event({ organizationId: 'another-org' }),
      ),
    ).rejects.toThrow('attribution mismatch')
    expect(deps.queue.add).not.toHaveBeenCalled()
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })
})

// LIF-01 program bullet 5 — the mandatory final notice at Purge Pending.
describe('Purge Pending final-notice consumer', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })
  afterEach(() => {
    clearEventSchemas()
  })

  const lifecycleEvent = (state: string): ConsumerEvent => ({
    eventId: EVENT_ID,
    eventType: 'identity.organization_lifecycle.changed',
    eventVersion: 1,
    payload: {
      organizationId: ORG,
      closureLineageId: '11111111-1111-4111-8111-111111111111',
      state,
      revision: 4,
      reactivationRequired: true,
      recoverableUntil: '2026-09-27T09:30:00.000Z',
      occurredAt: '2026-09-27T09:30:00.000Z',
    },
    organizationId: ORG,
    propertyId: null,
    sourceContext: 'identity',
    sourceAggregateId: ORG,
    recordedAt: '2026-09-27T09:30:00.000Z',
  })

  it('sends the notice at purge_pending, naming the organization', async () => {
    const deps = makeDeps()
    deps.fakes.userLookup.findByRole.mockResolvedValue(['admin-1'])
    deps.fakes.displayNames.findOrganizationName.mockResolvedValue('Riverside Group')

    const result = await handleOrganizationPurgePendingNotice(
      deps,
      lifecycleEvent('purge_pending'),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(deps.fakes.displayNames.findOrganizationName).toHaveBeenCalledWith(ORG)
    expect(deps.queue.add).toHaveBeenCalledWith(
      'insert-notification',
      expect.objectContaining({
        userId: 'admin-1',
        type: 'account.organization_purge_pending',
        eventId: EVENT_ID,
        payload: { organizationName: 'Riverside Group' },
      }),
      { jobId: `${EVENT_ID}-admin-1` },
    )
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      ORGANIZATION_PURGE_PENDING_CONSUMER,
      'applied',
    )
  })

  it.each(['closure_requested', 'closing', 'purging', 'closed', 'active'])(
    'records an obsolete receipt and sends nothing for %s',
    async (state) => {
      const deps = makeDeps()

      const result = await handleOrganizationPurgePendingNotice(
        deps,
        lifecycleEvent(state),
      )

      expect(result).toEqual({ status: 'obsolete' })
      expect(deps.queue.add).not.toHaveBeenCalled()
      expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
        EVENT_ID,
        ORGANIZATION_PURGE_PENDING_CONSUMER,
        'obsolete',
      )
    },
  )

  it('refuses a mis-attributed envelope rather than notifying the wrong tenant', async () => {
    const deps = makeDeps()

    await expect(
      handleOrganizationPurgePendingNotice(deps, {
        ...lifecycleEvent('purge_pending'),
        organizationId: 'org-other',
      }),
    ).rejects.toThrow('attribution mismatch')
    expect(deps.queue.add).not.toHaveBeenCalled()
  })
})

describe('beta feedback outcome consumer (ADR 0059)', () => {
  const REFERENCE = '00000000-0000-4000-8000-0000000000f1'
  const outcomeEvent = (overrides: Partial<ConsumerEvent> = {}): ConsumerEvent =>
    event({
      eventType: 'identity.beta_feedback.outcome_reached',
      payload: {
        organizationId: ORG,
        userId: 'reporter-user',
        reference: REFERENCE,
        outcome: 'resolved',
      },
      sourceAggregateId: REFERENCE,
      ...overrides,
    })

  beforeEach(() => {
    consumerRegistry = createConsumerRegistry()
    clearEventSchemas()
    registerAllEventSchemas()
  })
  afterEach(() => {
    consumerRegistry = createConsumerRegistry()
    clearEventSchemas()
  })

  it('is registered beside the account notices', () => {
    registerIdentityAccountNotificationConsumers(consumerRegistry, makeDeps())

    expect(consumerRegistry.list()).toContainEqual({
      eventType: 'identity.beta_feedback.outcome_reached',
      consumerName: BETA_FEEDBACK_OUTCOME_CONSUMER,
    })
  })

  it('enqueues an Organization-scoped notice for the reporter, pointing at the report', async () => {
    const deps = makeDeps()

    await expect(handleBetaFeedbackOutcomeEvent(deps, outcomeEvent())).resolves.toEqual({
      status: 'applied',
    })

    expect(deps.queue.add).toHaveBeenCalledWith(
      'insert-notification',
      {
        userId: 'reporter-user',
        organizationId: ORG,
        propertyId: null,
        type: 'beta_feedback.outcome',
        resourceType: 'beta_feedback_report',
        resourceId: REFERENCE,
        eventId: EVENT_ID,
        payload: { reportOutcome: 'resolved' },
        // The insert job re-reads this fact before writing, so a queued job
        // cannot redirect the notice to anyone else.
        audience: {
          kind: 'affected_organization_user',
          eventId: EVENT_ID,
          eventType: 'identity.beta_feedback.outcome_reached',
        },
      },
      { jobId: `${EVENT_ID}-reporter-user` },
    )
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      BETA_FEEDBACK_OUTCOME_CONSUMER,
      'applied',
    )
  })

  it('refuses a fact attributed to a Property', async () => {
    const deps = makeDeps()

    await expect(
      handleBetaFeedbackOutcomeEvent(deps, outcomeEvent({ propertyId: 'property-1' })),
    ).rejects.toThrow('Beta feedback outcome envelope attribution mismatch')
    expect(deps.queue.add).not.toHaveBeenCalled()
  })

  it('refuses a fact whose payload names another Organization', async () => {
    const deps = makeDeps()

    await expect(
      handleBetaFeedbackOutcomeEvent(
        deps,
        outcomeEvent({
          payload: {
            organizationId: 'another-org',
            userId: 'reporter-user',
            reference: REFERENCE,
            outcome: 'resolved',
          },
        }),
      ),
    ).rejects.toThrow('Beta feedback outcome envelope attribution mismatch')
    expect(deps.queue.add).not.toHaveBeenCalled()
  })

  it('carries nothing beyond identifiers and the outcome into the queued notice', async () => {
    // The outbox stores the schema-parsed payload, so extra keys never reach a
    // row; this proves the consumer would not forward one even if it did.
    const deps = makeDeps()

    await handleBetaFeedbackOutcomeEvent(
      deps,
      outcomeEvent({
        payload: {
          organizationId: ORG,
          userId: 'reporter-user',
          reference: REFERENCE,
          outcome: 'resolved',
          message: 'The reviews page crashed for guest Jane',
        },
      }),
    )

    expect(JSON.stringify(vi.mocked(deps.queue.add).mock.calls)).not.toContain(
      'guest Jane',
    )
  })
})
