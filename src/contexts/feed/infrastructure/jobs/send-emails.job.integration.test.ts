// The immediate-email job against real PostgreSQL: who is mailed, what the mail
// says, and what is left in the queue row afterwards.

import { afterEach, describe, expect, it } from 'vitest'
import { seedPropertyPreference, seedUserSettings } from './delivery-seed'
import {
  ADDRESS,
  BASE_URL,
  HOUR_MS,
  NOW,
  ORG,
  PROPERTY,
  USER,
  acceptedOutcome,
  openSendWorld,
  seedPropertyWindow,
  type SendWorld,
  type SendWorldOptions,
} from './send-emails-test-deps'
import { suppressEmailAddress } from '../../email/notification-email-suppression.server'
import { createResendSenderAnswering, RESEND_NETWORK_FAILURE } from './test-fixtures'
import { createSendEmailsHandler, type SendEmailsDeps } from './send-emails.job'
import type { NoticeSeed } from './delivery-seed'

let world: SendWorld

const open = async (options?: SendWorldOptions) => {
  world = await openSendWorld(options)
  return world
}

afterEach(async () => {
  await world.rollBack()
})

const sentPayload = (deps: ReturnType<SendWorld['deps']>) =>
  deps.emailSender.send.mock.calls[0]![0]

const emailOverrides = (email: NonNullable<NoticeSeed['email']>) => ({
  notice: { email },
})

describe('immediate notification email job', () => {
  it('resolves and authorizes the concrete property before any notification read or effect', async () => {
    await open()
    const deps = world.deps()
    deps.authorizeScope.mockResolvedValue(false)

    await world.run(deps)

    expect(deps.resolvePropertyScope).toHaveBeenCalledWith(ORG, PROPERTY)
    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(await world.email()).toMatchObject({ status: 'pending', attemptedAt: null })
  })

  it('holds, without reading or settling it, a row for a Property that is not active', async () => {
    // The digest holds these rows the same way.
    await open()
    const deps = world.deps()
    deps.resolvePropertyScope.mockResolvedValue(null)

    await world.run(deps)

    expect(await world.email()).toMatchObject({ status: 'pending', attemptedAt: null })
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('suppresses, and never sends, a row queued weeks before email was admitted', async () => {
    // The Organization ran in-app only for two months, then was allowlisted:
    // the backlog must not arrive as a burst of "act now" mail.
    await open({
      notice: { createdAt: new Date(NOW.getTime() - 60 * 24 * HOUR_MS) },
    })
    const deps = world.deps()

    await world.run(deps)

    expect(await world.email()).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'stale',
    })
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('still sends a day-old row whose quiet-hours deferral has just ended', async () => {
    await open(
      emailOverrides({
        status: 'delayed',
        createdAt: new Date(NOW.getTime() - 30 * HOUR_MS),
        notBefore: new Date(NOW.getTime() - 5 * 60_000),
      }),
    )
    const deps = world.deps()

    await world.run(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
  })

  it('suppresses mail to a recipient removed after the email was queued', async () => {
    // Deferred by quiet hours at 21:00, removed from the Organization at 22:00:
    // at 07:00 the Property's name must not reach a former employee.
    const audience = {
      kind: 'responsible_scope',
      scope: { kind: 'property', propertyId: PROPERTY },
    }
    await open(emailOverrides({ recipientAudience: audience }))
    const deps = world.deps()
    deps.isRecipientEligible.mockResolvedValue(false)

    await world.run(deps)

    expect(deps.isRecipientEligible).toHaveBeenCalledWith({
      organizationId: ORG,
      propertyId: PROPERTY,
      userId: USER,
      audience,
    })
    expect(await world.email()).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'recipient_ineligible',
    })
    expect(deps.userLookup.getEmail).not.toHaveBeenCalled()
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('suppresses delivery when the current property preference is disabled', async () => {
    await open()
    await seedPropertyPreference(world.db, {
      userId: USER,
      organizationId: ORG,
      propertyId: PROPERTY,
      category: 'urgent_operational',
      enabled: false,
      cadence: 'immediate',
    })
    const deps = world.deps()

    await world.run(deps)

    expect(await world.email()).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'preference_disabled',
    })
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('freezes the request and records the attempt before it calls the provider', async () => {
    // The first attempt starts the provider's 24-hour idempotency window; a
    // worker that dies mid-call must not leave that start unrecorded.
    await open()
    const deps = world.deps()
    let duringCall: Awaited<ReturnType<SendWorld['email']>> | undefined
    deps.emailSender.send.mockImplementation(async () => {
      duringCall = await world.email()
      return acceptedOutcome()
    })

    await world.run(deps)

    expect(duringCall?.providerRequest).toMatchObject({ to: ADDRESS, replyTo: null })
    expect(duringCall?.attemptedAt).toEqual(NOW)
  })

  it('suppresses, and never retries, a row first attempted 23 hours ago', async () => {
    await open(
      emailOverrides({
        status: 'failed',
        retryCount: 2,
        createdAt: new Date(NOW.getTime() - 23.5 * HOUR_MS),
        attemptedAt: new Date(NOW.getTime() - 23 * HOUR_MS),
      }),
    )
    await world.setEmail({ lastErrorClass: 'transient' })
    const deps = world.deps()

    await world.run(deps)

    expect(await world.email()).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'stale',
    })
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('records provider acceptance and message id only after acceptance', async () => {
    await open()
    const deps = world.deps()
    let duringCall: Awaited<ReturnType<SendWorld['email']>> | undefined
    deps.emailSender.send.mockImplementation(async () => {
      duringCall = await world.email()
      return acceptedOutcome()
    })

    await world.run(deps)

    expect(duringCall?.providerMessageId).toBeNull()
    expect(await world.email()).toMatchObject({
      status: 'accepted',
      providerMessageId: 'provider-1',
      acceptedAt: NOW,
    })
  })

  it('classifies transient rejection for retry and never marks accepted', async () => {
    await open()
    const deps = world.deps()
    deps.emailSender.send.mockResolvedValue({
      kind: 'rejected',
      classification: 'transient',
      providerCode: 'rate_limit_exceeded',
    })

    await expect(world.run(deps)).rejects.toThrow('Transient email provider rejection')

    expect(await world.email()).toMatchObject({
      status: 'failed',
      lastErrorClass: 'transient',
      nextAttemptAt: new Date('2026-01-15T15:00:30.000Z'),
      failedAt: NOW,
      acceptedAt: null,
    })
  })

  it('hands a network failure back to the queue instead of dropping the email', async () => {
    // Real adapter, real classification: the SDK answers a connectivity blip
    // with statusCode null, and that used to end here as failed/permanent with
    // no BullMQ retry and no sweep ever picking the row up again.
    await open()
    const deps = {
      ...world.deps(),
      emailSender: createResendSenderAnswering(RESEND_NETWORK_FAILURE, () => NOW),
    }

    await expect(
      createSendEmailsHandler(deps as unknown as SendEmailsDeps)(world.job),
    ).rejects.toThrow('Transient email provider rejection')

    expect(await world.email()).toMatchObject({
      status: 'failed',
      lastErrorClass: 'transient',
      nextAttemptAt: new Date('2026-01-15T15:00:30.000Z'),
      failedAt: NOW,
    })
  })

  it('persists provider suppression without retrying', async () => {
    await open()
    const deps = world.deps()
    deps.emailSender.send.mockResolvedValue({
      kind: 'rejected',
      classification: 'suppressed',
      providerCode: 'recipient_suppressed',
    })

    await world.run(deps)

    expect(await world.email()).toMatchObject({
      status: 'suppressed',
      lastErrorClass: 'suppressed',
      nextAttemptAt: null,
      acceptedAt: null,
    })
  })

  // Render, never concatenate.

  it('renders from type + payload and never ships the stored raw-id title', async () => {
    await open()
    const deps = world.deps()

    await world.run(deps)

    const payload = sentPayload(deps)
    expect(payload.subject).not.toContain('61ed98fc')
    expect(payload.html).not.toContain('61ed98fc')
    expect(payload.text).not.toContain('61ed98fc')
    expect(payload.subject).toContain('Riverside Hotel')
  })

  it('sends a plain-text twin alongside the HTML', async () => {
    await open()
    const deps = world.deps()

    await world.run(deps)

    const payload = sentPayload(deps)
    expect(payload.text.length).toBeGreaterThan(0)
    expect(payload.text).not.toContain('<p>')
  })

  it('links the action to an absolute deep link on the injected base URL', async () => {
    await open()
    const deps = world.deps()

    await world.run(deps)

    expect(sentPayload(deps).html).toContain(`${BASE_URL}/`)
  })

  // Preferences link and one-click unsubscribe.

  it('keeps what the unsubscribe link stands for before the mail leaves', async () => {
    // Retention deletes the queue row after 90 days; the link must still work.
    await open()
    const deps = world.deps()
    let scopesDuringCall: Awaited<ReturnType<SendWorld['unsubscribeScopes']>> = []
    deps.emailSender.send.mockImplementation(async () => {
      scopesDuringCall = await world.unsubscribeScopes()
      return acceptedOutcome()
    })

    await world.run(deps)

    expect(scopesDuringCall).toEqual([
      expect.objectContaining({
        targetKind: 'email',
        targetId: world.notice.emailId,
        organizationId: ORG,
        userId: USER,
        propertyId: PROPERTY,
        category: 'urgent_operational',
        createdAt: NOW,
      }),
    ])
  })

  it('sets List-Unsubscribe and the one-click directive for optional mail', async () => {
    await open()
    const deps = world.deps()

    await world.run(deps)

    expect(sentPayload(deps).headers).toEqual({
      'List-Unsubscribe': `<${BASE_URL}/api/notifications/unsubscribe?token=email-${world.notice.emailId}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })
  })

  it('includes the preferences URL in the body', async () => {
    await open()
    const deps = world.deps()

    await world.run(deps)

    expect(sentPayload(deps).html).toContain(`${BASE_URL}/settings/notifications`)
    expect(sentPayload(deps).text).toContain(`${BASE_URL}/settings/notifications`)
  })

  it('opens the preferences of the Property the email is about', async () => {
    // Without the Property the settings page opens on the organization's
    // first Property, and a manager of many has to hunt for the right one.
    await open()
    const deps = world.deps()

    await world.run(deps)

    const preferencesUrl = `${BASE_URL}/settings/notifications?propertyId=${PROPERTY}`
    expect(sentPayload(deps).html).toContain(preferencesUrl)
    expect(sentPayload(deps).text).toContain(preferencesUrl)
  })

  it('refuses to dispatch optional mail when the base URL cannot form a preferences link', async () => {
    // The guard is in the job, not a template convention: a relative or empty
    // base URL must fail the send rather than ship an email with no way out.
    await open()
    const deps = world.deps()
    deps.baseUrl = ''

    await expect(world.run(deps)).rejects.toThrow(
      expect.objectContaining({
        _tag: 'NotificationError',
        message: expect.stringContaining('ADR 0046 r.7'),
      }),
    )
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  describe('mandatory Organization mail', () => {
    const mandatory = (
      type: string,
      priority: 'normal' | 'urgent',
    ): SendWorldOptions => ({
      notice: {
        propertyId: null,
        type,
        category: 'mandatory',
        priority,
        resourceType: 'organization',
        resourceId: ORG,
        payload: {},
        email: { category: 'mandatory', cadence: 'immediate', priority },
      },
    })

    it('sends without Property authority, preferences, or unsubscribe', async () => {
      await open(mandatory('account.organization_access_removed', 'normal'))
      // A Property preference that would silence optional mail changes nothing.
      await seedPropertyPreference(world.db, {
        userId: USER,
        organizationId: ORG,
        propertyId: PROPERTY,
        category: 'urgent_operational',
        enabled: false,
        cadence: 'immediate',
      })
      const deps = world.deps()

      await world.run(deps)

      expect(deps.resolvePropertyScope).not.toHaveBeenCalled()
      expect(deps.authorizeScope).not.toHaveBeenCalled()
      // `organization_access_removed` is addressed to someone no longer a member.
      expect(deps.isRecipientEligible).not.toHaveBeenCalled()
      expect(await world.unsubscribeScopes()).toEqual([])
      expect(await world.email()).toMatchObject({
        status: 'accepted',
        providerMessageId: 'provider-1',
        acceptedAt: NOW,
      })
      expect(sentPayload(deps).headers).toEqual({})
      expect(sentPayload(deps).html).not.toContain('/settings/notifications')
      expect(sentPayload(deps).text).not.toContain('/settings/notifications')
      // Nothing about an access-removed notice is answerable by mail.
      expect(sentPayload(deps).replyTo).toBeUndefined()
    })

    it('makes the final deletion notice answerable by replying to it', async () => {
      await open(mandatory('account.organization_purge_pending', 'urgent'))
      const deps = world.deps()

      await world.run(deps)

      // The copy tells the reader to answer this email; the header has to make
      // that land somewhere a person reads.
      expect(sentPayload(deps).replyTo).toBe('denev@kodes.agency')
      expect(sentPayload(deps).text).toContain('denev@kodes.agency')
    })
  })

  // Recipient timezone.

  it('applies quiet hours in the USER timezone, not the property timezone', async () => {
    // 15:00Z is 10:00 in New York (property) but 17:00 in Sofia (user).
    // Quiet hours 16:00-08:00 must therefore defer.
    await open()
    await seedUserSettings(world.db, {
      userId: USER,
      organizationId: ORG,
      timezone: 'Europe/Sofia',
      quietHoursStart: '16:00',
      quietHoursEnd: '08:00',
    })
    const deps = world.deps()

    await world.run(deps)

    expect(await world.email()).toMatchObject({ status: 'delayed' })
    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: 'Europe/Sofia', timezoneSource: 'user' }),
      'Urgent notification email deferred',
    )
  })

  it('falls back to the organization timezone when the user never chose one', async () => {
    // 15:00Z is 15:00 in London. Quiet hours 14:00-08:00 defer there but not
    // in New York (10:00), so the deferral proves which clock was used.
    await open()
    await seedPropertyWindow(world.db, {
      quietHoursStart: '14:00',
      quietHoursEnd: '08:00',
    })
    const deps = world.deps()

    await world.run(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        timezone: 'Europe/London',
        timezoneSource: 'organization',
      }),
      'Urgent notification email deferred',
    )
  })

  // The person's own window.

  it("holds the mail in the person's own window, asked for THIS property", async () => {
    // The window is one setting for every property, so one save silences
    // 03:00 email everywhere. It used to be read from the (property, category,
    // channel) preference row, which needed about sixty saves to say the same.
    await open()
    await seedUserSettings(world.db, {
      userId: USER,
      organizationId: ORG,
      timezone: 'Europe/Sofia',
      quietHoursStart: '16:00',
      quietHoursEnd: '08:00',
    })
    const deps = world.deps()

    await world.run(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(await world.email()).toMatchObject({ status: 'delayed' })
  })

  it("lets this Property's own window override the person's", async () => {
    await open()
    await seedUserSettings(world.db, {
      userId: USER,
      organizationId: ORG,
      timezone: 'Europe/Sofia',
      quietHoursStart: '16:00',
      quietHoursEnd: '08:00',
    })
    await seedPropertyWindow(world.db, {
      quietHoursStart: '02:00',
      quietHoursEnd: '03:00',
    })
    const deps = world.deps()

    await world.run(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
  })

  it('sends inside quiet hours when the person allows urgent mail through', async () => {
    await open()
    await seedUserSettings(world.db, {
      userId: USER,
      organizationId: ORG,
      timezone: 'Europe/Sofia',
      quietHoursStart: '16:00',
      quietHoursEnd: '08:00',
      urgentBypassEnabled: true,
    })
    const deps = world.deps()

    await world.run(deps)

    expect(await world.email()).toMatchObject({ status: 'accepted' })
    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
  })

  // Bounced recipients.

  it('suppresses instead of sending when the provider already refused the address', async () => {
    await open()
    const deps = world.deps()
    await suppressEmailAddress(world.db, deps.emailAddressKeys, ADDRESS, 'bounced', NOW)

    await world.run(deps)

    expect(await world.email()).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'recipient_bounced',
    })
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  // The work may already be done: a reply approved at 23:00 still produced a
  // 07:00 "Approve a reply" email, because the send re-checked the recipient's
  // scope and never the state of the work.

  const pendingApproval = { type: 'reply.pending_approval' } as const

  it('holds back an approval request whose reply was already decided', async () => {
    await open({
      notice: { ...pendingApproval, resolvedAt: new Date('2026-01-15T14:00:00.000Z') },
    })
    const deps = world.deps()

    await world.run(deps)

    expect(await world.email()).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'work_no_longer_waiting',
    })
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('holds back an approval request the reader already read in the app', async () => {
    await open({ notice: pendingApproval })
    await world.setNotice({ status: 'read', readAt: NOW })
    const deps = world.deps()

    await world.run(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('still mails a failed publication nobody has settled', async () => {
    await open({ notice: { type: 'reply.publish_failed' } })
    const deps = world.deps()

    await world.run(deps)

    expect(deps.emailSender.send).toHaveBeenCalled()
  })

  // No invisible failure.

  it('logs every suppression with its reason and the shared correlation id', async () => {
    await open({ notice: { withNotification: false } })
    const deps = world.deps()

    await world.run(deps)

    expect(deps.logger.warn).toHaveBeenCalledWith(
      {
        correlationId: `notification-email:${world.notice.emailId}`,
        reason: 'notification_unavailable',
      },
      'Urgent notification email suppressed',
    )
  })

  it('logs a provider rejection rather than failing silently', async () => {
    await open()
    const deps = world.deps()
    deps.emailSender.send.mockResolvedValue({
      kind: 'rejected',
      classification: 'permanent',
      providerCode: 'invalid_recipient',
    })

    await world.run(deps)

    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        classification: 'permanent',
        providerCode: 'invalid_recipient',
      }),
      'Urgent notification email rejected by provider',
    )
  })
})
