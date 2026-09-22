import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createUrgentEmailJobHandler, type UrgentEmailJobData } from './urgent-email.job'
import {
  buildNotification,
  buildNotificationEmail,
  createFakeJobLogger,
  createResendSenderAnswering,
  RESEND_NETWORK_FAILURE,
} from './test-fixtures'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { NotificationDeliveryOutcome } from '../../domain/notification-delivery-policy'
import type { EmailSendRequest } from '../../application/ports/email-sender.port'
import type { Notification, NotificationEmail } from '../../domain/notification-types'

const NOW = new Date('2026-01-15T15:00:00.000Z')
const ORG = organizationId('org-1')
const PROPERTY = propertyId('11111111-1111-4111-8111-111111111111')
const BASE_URL = 'https://app.example.com'

const entry = buildNotificationEmail({
  id: 'email-1',
  propertyId: PROPERTY as string,
  category: 'urgent_operational',
  cadence: 'immediate',
  priority: 'urgent',
})
// A pre-template row: `title` is a raw identifier. The renderer must replace it.
const notification = buildNotification({
  propertyId: PROPERTY as string,
  type: 'reply.publish_failed',
  category: 'urgent_operational',
  priority: 'urgent',
  resourceType: 'reply',
  resourceId: 'reply-1',
  payload: { propertyName: 'Riverside Hotel', platform: 'google', waitingHours: 5 },
  title: 'Reply publication failed 61ed98fc-1c2b-4d6e-9f00-000000000001',
})

const job = {
  data: {
    notificationEmailId: entry.id as string,
    organizationId: ORG as string,
    propertyId: PROPERTY as string,
    capability: 'notification.send_email',
    policyVersionAtEnqueue: 'test',
    initiator: { kind: 'system', id: 'test' },
  } as unknown as UrgentEmailJobData,
}

function fakeDeps() {
  const send = vi.fn(
    async (_params: EmailSendRequest): Promise<NotificationDeliveryOutcome> => ({
      kind: 'accepted',
      providerMessageId: 'provider-1',
      acceptedAt: NOW,
    }),
  )
  return {
    emailRepo: {
      findById: vi.fn(async (): Promise<NotificationEmail | null> => entry),
      markAccepted: vi.fn(async () => {}),
      markAttemptStarted: vi.fn(async () => {}),
      markDelayed: vi.fn(async () => {}),
      markFailed: vi.fn(async () => {}),
      markSuppressed: vi.fn(async () => {}),
      recordEmailUnsubscribeScope: vi.fn(async () => {}),
      isAddressSuppressed: vi.fn(async (_address: string) => false),
    },
    preferenceRepo: {
      findForDelivery: vi.fn(async () => null),
      getUserSettings: vi.fn(async () => null),
    },
    notifRepo: {
      findById: vi.fn(async (): Promise<Notification | null> => notification),
      findByIdForProperty: vi.fn(async (): Promise<Notification | null> => notification),
    },
    userLookup: {
      getEmail: vi.fn(async (): Promise<string | null> => 'manager@example.com'),
    },
    emailSender: { send },
    resolvePropertyScope: vi.fn(
      async (): Promise<{
        organizationId: string
        propertyId: string
        timezone: string
      } | null> => ({
        organizationId: ORG as string,
        propertyId: PROPERTY as string,
        timezone: 'America/New_York',
      }),
    ),
    resolveOrganizationScope: vi.fn(async () => ({
      timezone: 'Europe/London',
      propertyNames: new Map([[PROPERTY as string, 'Riverside Hotel']]),
    })),
    authorizeScope: vi.fn(async () => true),
    organizationEmailStop: vi.fn(
      async (_organizationId: string): Promise<'none' | 'optional' | 'all'> => 'none',
    ),
    isRecipientEligible: vi.fn(async () => true),
    logger: createFakeJobLogger(),
    clock: () => NOW,
    baseUrl: BASE_URL,
    oneClickUnsubscribeUrl: vi.fn(
      (target: { kind: string; id: string }) =>
        `${BASE_URL}/api/notifications/unsubscribe?token=${target.kind}-${target.id}`,
    ),
  }
}

describe('immediate notification email job', () => {
  let deps: ReturnType<typeof fakeDeps>

  beforeEach(() => {
    deps = fakeDeps()
  })

  const run = () =>
    createUrgentEmailJobHandler(
      deps as unknown as Parameters<typeof createUrgentEmailJobHandler>[0],
    )(job)

  const sentPayload = () => deps.emailSender.send.mock.calls[0]![0]

  it('resolves and authorizes the concrete property before any notification read or effect', async () => {
    deps.authorizeScope.mockResolvedValue(false)
    await run()
    expect(deps.resolvePropertyScope).toHaveBeenCalledWith(ORG, PROPERTY)
    expect(deps.emailRepo.findById).not.toHaveBeenCalled()
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('holds, without reading or settling it, a row for a Property that is not active', async () => {
    // The digest holds these rows the same way (digest-notification.job.test).
    deps.resolvePropertyScope.mockResolvedValue(null)

    await run()

    expect(deps.emailRepo.findById).not.toHaveBeenCalled()
    expect(deps.emailRepo.markSuppressed).not.toHaveBeenCalled()
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('stops optional mail once the Organization has asked to close', async () => {
    // Nothing sets an Organization suspension on a closure request: the send
    // path reads the lifecycle authority itself.
    deps.organizationEmailStop.mockResolvedValue('optional')

    await run()

    expect(deps.organizationEmailStop).toHaveBeenCalledWith(ORG)
    expect(deps.emailRepo.markSuppressed).toHaveBeenCalledWith(
      entry.id,
      ORG,
      PROPERTY,
      'organization_closing',
      NOW,
    )
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('suppresses, and never sends, a row queued weeks before email was admitted', async () => {
    // The Organization ran in-app only for two months, then was allowlisted:
    // the backlog must not arrive as a burst of "act now" mail.
    deps.emailRepo.findById.mockResolvedValue({
      ...entry,
      createdAt: new Date(NOW.getTime() - 60 * 24 * 60 * 60_000),
    })

    await run()

    expect(deps.emailRepo.markSuppressed).toHaveBeenCalledWith(
      entry.id,
      ORG,
      PROPERTY,
      'stale',
      NOW,
    )
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('still sends a day-old row whose quiet-hours deferral has just ended', async () => {
    deps.emailRepo.findById.mockResolvedValue({
      ...entry,
      status: 'delayed',
      createdAt: new Date(NOW.getTime() - 30 * 60 * 60_000),
      notBefore: new Date(NOW.getTime() - 5 * 60_000),
    })

    await run()

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
  })

  it('suppresses mail to a recipient removed after the email was queued', async () => {
    // Deferred by quiet hours at 21:00, removed from the Organization at 22:00:
    // at 07:00 the Property's name must not reach a former employee.
    const audience = {
      kind: 'responsible_scope',
      scope: { kind: 'property', propertyId: PROPERTY as string },
    }
    deps.emailRepo.findById.mockResolvedValue({ ...entry, recipientAudience: audience })
    deps.isRecipientEligible.mockResolvedValue(false)

    await run()

    expect(deps.isRecipientEligible).toHaveBeenCalledWith({
      organizationId: ORG,
      propertyId: PROPERTY,
      userId: entry.userId,
      audience,
    })
    expect(deps.emailRepo.markSuppressed).toHaveBeenCalledWith(
      entry.id,
      ORG,
      PROPERTY,
      'recipient_ineligible',
      NOW,
    )
    expect(deps.userLookup.getEmail).not.toHaveBeenCalled()
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('suppresses delivery when the current property preference is disabled', async () => {
    deps.preferenceRepo.findForDelivery.mockResolvedValue({ enabled: false } as never)
    await run()
    expect(deps.emailRepo.markSuppressed).toHaveBeenCalledWith(
      entry.id,
      ORG,
      PROPERTY,
      'preference_disabled',
      NOW,
    )
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('records that an attempt started before it calls the provider', async () => {
    // The first attempt starts the provider's 24-hour idempotency window; a
    // worker that dies mid-call must not leave that start unrecorded.
    await run()

    expect(deps.emailRepo.markAttemptStarted).toHaveBeenCalledWith(
      entry.id,
      ORG,
      PROPERTY,
      NOW,
    )
    expect(deps.emailRepo.markAttemptStarted.mock.invocationCallOrder[0]!).toBeLessThan(
      deps.emailSender.send.mock.invocationCallOrder[0]!,
    )
  })

  it('suppresses, and never retries, a row first attempted 23 hours ago', async () => {
    deps.emailRepo.findById.mockResolvedValue({
      ...entry,
      status: 'failed',
      lastErrorClass: 'transient',
      retryCount: 2,
      createdAt: new Date(NOW.getTime() - 23.5 * 60 * 60_000),
      attemptedAt: new Date(NOW.getTime() - 23 * 60 * 60_000),
    })

    await run()

    expect(deps.emailRepo.markSuppressed).toHaveBeenCalledWith(
      entry.id,
      ORG,
      PROPERTY,
      'stale',
      NOW,
    )
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('records provider acceptance and message id only after acceptance', async () => {
    await run()
    expect(deps.emailRepo.markAccepted).toHaveBeenCalledWith(
      entry.id,
      ORG,
      PROPERTY,
      'provider-1',
      NOW,
    )
  })

  it('classifies transient rejection for retry and never marks accepted', async () => {
    deps.emailSender.send.mockResolvedValue({
      kind: 'rejected',
      classification: 'transient',
      providerCode: 'rate_limit_exceeded',
    })
    await expect(run()).rejects.toThrow('Transient email provider rejection')
    expect(deps.emailRepo.markFailed).toHaveBeenCalledWith(
      entry.id,
      ORG,
      PROPERTY,
      'transient',
      new Date('2026-01-15T15:00:30.000Z'),
      NOW,
    )
    expect(deps.emailRepo.markAccepted).not.toHaveBeenCalled()
  })

  it('hands a network failure back to the queue instead of dropping the email', async () => {
    // Real adapter, real classification: the SDK answers a connectivity blip
    // with statusCode null, and that used to end here as failed/permanent with
    // no BullMQ retry and no sweep ever picking the row up again.
    const wired = {
      ...deps,
      emailSender: createResendSenderAnswering(RESEND_NETWORK_FAILURE, () => NOW),
    }

    await expect(
      createUrgentEmailJobHandler(
        wired as unknown as Parameters<typeof createUrgentEmailJobHandler>[0],
      )(job),
    ).rejects.toThrow('Transient email provider rejection')
    expect(deps.emailRepo.markFailed).toHaveBeenCalledWith(
      entry.id,
      ORG,
      PROPERTY,
      'transient',
      new Date('2026-01-15T15:00:30.000Z'),
      NOW,
    )
  })

  it('persists provider suppression without retrying', async () => {
    deps.emailSender.send.mockResolvedValue({
      kind: 'rejected',
      classification: 'suppressed',
      providerCode: 'recipient_suppressed',
    })
    await run()
    expect(deps.emailRepo.markFailed).toHaveBeenCalledWith(
      entry.id,
      ORG,
      PROPERTY,
      'suppressed',
      null,
      NOW,
    )
    expect(deps.emailRepo.markAccepted).not.toHaveBeenCalled()
  })

  // ── ADR 0046 r.8: render, never concatenate ───────────────────────

  it('renders from type + payload and never ships the stored raw-id title', async () => {
    await run()

    const payload = sentPayload()
    expect(payload.subject).not.toContain('61ed98fc')
    expect(payload.html).not.toContain('61ed98fc')
    expect(payload.text).not.toContain('61ed98fc')
    expect(payload.subject).toContain('Riverside Hotel')
  })

  it('sends a plain-text twin alongside the HTML', async () => {
    await run()

    const payload = sentPayload()
    expect(payload.text.length).toBeGreaterThan(0)
    expect(payload.text).not.toContain('<p>')
  })

  it('links the action to an absolute deep link on the injected base URL', async () => {
    await run()

    expect(sentPayload().html).toContain(`${BASE_URL}/`)
  })

  // ── ADR 0046 r.7: preferences link + one-click unsubscribe ─────────

  it('keeps what the unsubscribe link stands for before the mail leaves', async () => {
    // Retention deletes the queue row after 90 days; the link must still work.
    await run()

    expect(deps.emailRepo.recordEmailUnsubscribeScope).toHaveBeenCalledWith(
      entry.id,
      ORG,
      NOW,
    )
    expect(
      deps.emailRepo.recordEmailUnsubscribeScope.mock.invocationCallOrder[0],
    ).toBeLessThan(deps.emailSender.send.mock.invocationCallOrder[0]!)
  })

  it('sets List-Unsubscribe and the one-click directive for optional mail', async () => {
    await run()

    expect(sentPayload().headers).toEqual({
      'List-Unsubscribe': `<${BASE_URL}/api/notifications/unsubscribe?token=email-${entry.id as string}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })
  })

  it('includes the preferences URL in the body', async () => {
    await run()

    expect(sentPayload().html).toContain(`${BASE_URL}/settings/notifications`)
    expect(sentPayload().text).toContain(`${BASE_URL}/settings/notifications`)
  })

  it('opens the preferences of the Property the email is about', async () => {
    // Without the Property the settings page opens on the organization's
    // first Property, and a manager of many has to hunt for the right one.
    await run()

    const preferencesUrl = `${BASE_URL}/settings/notifications?propertyId=${PROPERTY as string}`
    expect(sentPayload().html).toContain(preferencesUrl)
    expect(sentPayload().text).toContain(preferencesUrl)
  })

  it('refuses to dispatch optional mail when the base URL cannot form a preferences link', async () => {
    // The guard is in the job, not a template convention: a relative or empty
    // base URL must fail the send rather than ship an email with no way out.
    deps.baseUrl = ''

    await expect(run()).rejects.toThrow(
      expect.objectContaining({
        _tag: 'NotificationError',
        message: expect.stringContaining('ADR 0046 r.7'),
      }),
    )
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('sends mandatory Organization mail without Property authority, preferences, or unsubscribe', async () => {
    const mandatoryEntry = buildNotificationEmail({
      id: 'email-1',
      propertyId: null,
      category: 'mandatory',
      cadence: 'immediate',
      priority: 'normal',
    })
    const mandatoryNotification = buildNotification({
      propertyId: null,
      type: 'account.organization_access_removed',
      category: 'mandatory',
      priority: 'normal',
      resourceType: 'organization',
      resourceId: ORG,
    })
    deps.emailRepo.findById.mockResolvedValue(mandatoryEntry)
    deps.notifRepo.findById.mockResolvedValue(mandatoryNotification)
    const organizationJob = {
      data: {
        notificationEmailId: mandatoryEntry.id as string,
        organizationId: ORG as string,
        capability: 'notification.send_email',
        policyVersionAtEnqueue: 'test',
        initiator: { kind: 'system', id: 'test' },
      } as unknown as UrgentEmailJobData,
    }

    await createUrgentEmailJobHandler(
      deps as unknown as Parameters<typeof createUrgentEmailJobHandler>[0],
    )(organizationJob)

    expect(deps.resolvePropertyScope).not.toHaveBeenCalled()
    expect(deps.authorizeScope).not.toHaveBeenCalled()
    // `organization_access_removed` is addressed to someone no longer a member.
    expect(deps.isRecipientEligible).not.toHaveBeenCalled()
    expect(deps.emailRepo.recordEmailUnsubscribeScope).not.toHaveBeenCalled()
    expect(deps.preferenceRepo.findForDelivery).not.toHaveBeenCalled()
    expect(deps.preferenceRepo.getUserSettings).not.toHaveBeenCalled()
    expect(deps.emailRepo.markAccepted).toHaveBeenCalledWith(
      mandatoryEntry.id,
      ORG,
      null,
      'provider-1',
      NOW,
    )
    expect(sentPayload().headers).toEqual({})
    expect(sentPayload().html).not.toContain('/settings/notifications')
    expect(sentPayload().text).not.toContain('/settings/notifications')
  })

  it('lets a mandatory notice through a closing Organization until it is purged', async () => {
    const mandatoryEntry = buildNotificationEmail({
      id: 'email-1',
      propertyId: null,
      category: 'mandatory',
      cadence: 'immediate',
      priority: 'normal',
    })
    deps.emailRepo.findById.mockResolvedValue(mandatoryEntry)
    deps.notifRepo.findById.mockResolvedValue(
      buildNotification({
        propertyId: null,
        type: 'account.organization_access_removed',
        category: 'mandatory',
        priority: 'normal',
        resourceType: 'organization',
        resourceId: ORG,
      }),
    )
    const handler = createUrgentEmailJobHandler(
      deps as unknown as Parameters<typeof createUrgentEmailJobHandler>[0],
    )
    const organizationJob = {
      data: {
        ...job.data,
        propertyId: undefined,
        notificationEmailId: mandatoryEntry.id as string,
      } as unknown as UrgentEmailJobData,
    }

    deps.organizationEmailStop.mockResolvedValue('optional')
    await handler(organizationJob)
    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)

    deps.organizationEmailStop.mockResolvedValue('all')
    await handler(organizationJob)
    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
    expect(deps.emailRepo.markSuppressed).toHaveBeenCalledWith(
      mandatoryEntry.id,
      ORG,
      null,
      'organization_closing',
      NOW,
    )
  })

  // ── ADR 0046 r.3: recipient timezone ──────────────────────────────

  it('applies quiet hours in the USER timezone, not the property timezone', async () => {
    // 15:00Z is 10:00 in New York (property) but 17:00 in Sofia (user).
    // Quiet hours 16:00-08:00 must therefore defer.
    deps.preferenceRepo.getUserSettings.mockResolvedValue({
      timezone: 'Europe/Sofia',
    } as never)
    deps.preferenceRepo.findForDelivery.mockResolvedValue({
      enabled: true,
      quietHoursStart: '16:00',
      quietHoursEnd: '08:00',
      urgentBypassEnabled: false,
    } as never)

    await run()

    expect(deps.emailRepo.markDelayed).toHaveBeenCalled()
    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: 'Europe/Sofia', timezoneSource: 'user' }),
      'Urgent notification email deferred',
    )
  })

  it('falls back to the organization timezone when the user never chose one', async () => {
    // 15:00Z is 15:00 in London. Quiet hours 14:00-08:00 defer there but not
    // in New York (10:00), so the deferral proves which clock was used.
    deps.preferenceRepo.findForDelivery.mockResolvedValue({
      enabled: true,
      quietHoursStart: '14:00',
      quietHoursEnd: '08:00',
      urgentBypassEnabled: false,
    } as never)

    await run()

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        timezone: 'Europe/London',
        timezoneSource: 'organization',
      }),
      'Urgent notification email deferred',
    )
  })

  // ── ADR 0046 r.6: bounced recipients ──────────────────────────────

  it('suppresses instead of sending when the provider already refused the address', async () => {
    deps.emailRepo.isAddressSuppressed.mockResolvedValue(true)

    await run()

    // Keyed by the address mail would go to, not by the user or the org.
    expect(deps.emailRepo.isAddressSuppressed).toHaveBeenCalledWith('manager@example.com')
    expect(deps.emailRepo.markSuppressed).toHaveBeenCalledWith(
      entry.id,
      ORG,
      PROPERTY,
      'recipient_bounced',
      NOW,
    )
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  // ── No invisible failure ──────────────────────────────────────────

  it('logs every suppression with its reason and the shared correlation id', async () => {
    deps.notifRepo.findByIdForProperty.mockResolvedValue(null)

    await run()

    expect(deps.logger.warn).toHaveBeenCalledWith(
      {
        correlationId: `notification-email:${entry.id as string}`,
        reason: 'notification_unavailable',
      },
      'Urgent notification email suppressed',
    )
  })

  it('logs a provider rejection rather than failing silently', async () => {
    deps.emailSender.send.mockResolvedValue({
      kind: 'rejected',
      classification: 'permanent',
      providerCode: 'invalid_recipient',
    })

    await run()

    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        classification: 'permanent',
        providerCode: 'invalid_recipient',
      }),
      'Urgent notification email rejected by provider',
    )
  })
})
