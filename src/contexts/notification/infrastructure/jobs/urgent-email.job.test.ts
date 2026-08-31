import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createUrgentEmailJobHandler, type UrgentEmailJobData } from './urgent-email.job'
import {
  buildNotification,
  buildNotificationEmail,
  createFakeJobLogger,
} from './test-fixtures'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { NotificationDeliveryOutcome } from '../../domain/notification-delivery-policy'
import type { EmailSendRequest } from '../../application/ports/email-sender.port'
import type { Notification, NotificationEmail } from '../../domain/types'

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
      markDelayed: vi.fn(async () => {}),
      markFailed: vi.fn(async () => {}),
      markSuppressed: vi.fn(async () => {}),
      isRecipientSuppressed: vi.fn(async () => false),
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
    resolvePropertyScope: vi.fn(async () => ({
      organizationId: ORG as string,
      propertyId: PROPERTY as string,
      timezone: 'America/New_York',
    })),
    resolveOrganizationScope: vi.fn(async () => ({
      timezone: 'Europe/London',
      propertyNames: new Map([[PROPERTY as string, 'Riverside Hotel']]),
    })),
    authorizeScope: vi.fn(async () => true),
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

  it('suppresses instead of sending when the provider already reported a bounce', async () => {
    deps.emailRepo.isRecipientSuppressed.mockResolvedValue(true)

    await run()

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
