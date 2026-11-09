import { beforeEach, describe, expect, it } from 'vitest'
import { createSendEmailsHandler } from './send-emails.server'
import {
  entry,
  fakeDeps,
  job,
  NOW,
  ORG,
  PROPERTY,
} from '../infrastructure/jobs/send-emails-test-deps'
import { buildNotification } from '../infrastructure/jobs/test-fixtures'
import type { FrozenEmailRequest } from '../domain/notification-types'

const HOUR_MS = 60 * 60_000

const FROZEN: FrozenEmailRequest = {
  to: 'manager@example.com',
  subject: 'Frozen subject',
  html: '<p>frozen wording</p>',
  text: 'frozen wording',
  headers: { 'List-Unsubscribe': '<https://app.example.com/u?token=1>' },
  replyTo: 'replies@example.com',
}

describe('immediate email frozen request', () => {
  let deps: ReturnType<typeof fakeDeps>

  beforeEach(() => {
    deps = fakeDeps()
  })

  const run = () =>
    createSendEmailsHandler(
      deps as unknown as Parameters<typeof createSendEmailsHandler>[0],
    )(job)

  const attempted = (overrides: Record<string, unknown> = {}) => ({
    ...entry,
    status: 'failed' as const,
    lastErrorClass: 'transient' as const,
    retryCount: 1,
    attemptedAt: new Date(NOW.getTime() - HOUR_MS),
    providerRequest: FROZEN,
    ...overrides,
  })

  it('sends the request it froze, under the row key', async () => {
    await run()

    const frozen = deps.emailRepo.freezeProviderRequest.mock.calls[0]![3]
    expect(deps.emailSender.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: frozen.to,
        subject: frozen.subject,
        html: frozen.html,
        text: frozen.text,
        headers: frozen.headers,
        idempotencyKey: entry.idempotencyKey,
      }),
    )
  })

  it('sends the stored request when another worker froze first', async () => {
    deps.emailRepo.freezeProviderRequest.mockResolvedValue(FROZEN)

    await run()

    expect(deps.emailSender.send).toHaveBeenCalledWith({
      to: FROZEN.to,
      subject: FROZEN.subject,
      html: FROZEN.html,
      text: FROZEN.text,
      headers: FROZEN.headers,
      replyTo: FROZEN.replyTo,
      idempotencyKey: entry.idempotencyKey,
    })
  })

  it('sends nothing when the row can no longer be sent at the freeze', async () => {
    deps.emailRepo.freezeProviderRequest.mockResolvedValue(null)

    await run()

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(deps.emailRepo.markAccepted).not.toHaveBeenCalled()
  })

  it('retries verbatim, without rendering again, under the same key', async () => {
    deps.emailRepo.findById.mockResolvedValue(attempted())

    await run()

    expect(deps.emailRepo.freezeProviderRequest).not.toHaveBeenCalled()
    expect(deps.emailSender.send).toHaveBeenCalledWith({
      to: FROZEN.to,
      subject: FROZEN.subject,
      html: FROZEN.html,
      text: FROZEN.text,
      headers: FROZEN.headers,
      replyTo: FROZEN.replyTo,
      idempotencyKey: entry.idempotencyKey,
    })
    expect(deps.emailRepo.markAccepted).toHaveBeenCalledTimes(1)
  })

  describe.each([
    ['settled', { resolvedAt: new Date('2026-01-15T14:00:00.000Z') }],
    ['read in the app', { status: 'read' as const }],
  ])('retry of a notice that was %s since the first attempt', (_label, change) => {
    it('suppresses it and sends nothing', async () => {
      deps.emailRepo.findById.mockResolvedValue(attempted())
      deps.notifRepo.findByIdForProperty.mockResolvedValue(
        buildNotification({
          propertyId: PROPERTY as string,
          type: 'reply.pending_approval',
          category: 'urgent_operational',
          priority: 'urgent',
          ...change,
        }),
      )

      await run()

      expect(deps.emailRepo.markSuppressed).toHaveBeenCalledWith(
        entry.id,
        ORG,
        PROPERTY,
        'work_no_longer_waiting',
        NOW,
      )
      expect(deps.emailSender.send).not.toHaveBeenCalled()
    })
  })

  it('suppresses a retry whose work was completed', async () => {
    deps.emailRepo.findById.mockResolvedValue(attempted())
    deps.workState.isWaiting.mockResolvedValue(false)

    await run()

    expect(deps.emailRepo.markSuppressed).toHaveBeenCalledWith(
      entry.id,
      ORG,
      PROPERTY,
      'work_no_longer_waiting',
      NOW,
    )
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('keeps an unknown provider outcome retryable with the same request', async () => {
    deps.emailRepo.findById.mockResolvedValue(attempted({ retryCount: 0 }))
    deps.emailSender.send.mockRejectedValueOnce(new Error('socket hang up'))

    await expect(run()).rejects.toThrow('socket hang up')
    expect(deps.emailRepo.markFailed).toHaveBeenCalledWith(
      entry.id,
      ORG,
      PROPERTY,
      'transient',
      expect.any(Date),
      NOW,
    )
    expect(deps.emailRepo.markAccepted).not.toHaveBeenCalled()

    await run()

    expect(deps.emailSender.send).toHaveBeenCalledTimes(2)
    const [first, second] = deps.emailSender.send.mock.calls.map(([params]) => params)
    expect(second).toEqual(first)
  })

  it('retries a retry past the old attempt budget until the horizon', async () => {
    deps.emailRepo.findById.mockResolvedValue(
      attempted({ retryCount: 9, attemptedAt: new Date(NOW.getTime() - 22 * HOUR_MS) }),
    )

    await run()

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
  })

  it('closes, and does not send, a frozen request past the retry horizon', async () => {
    deps.emailRepo.findById.mockResolvedValue(
      attempted({ attemptedAt: new Date(NOW.getTime() - 23 * HOUR_MS) }),
    )

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

  it('rechecks the recipient before repeating a frozen request', async () => {
    deps.emailRepo.findById.mockResolvedValue(attempted())
    deps.isRecipientEligible.mockResolvedValue(false)

    await run()

    expect(deps.emailRepo.markSuppressed).toHaveBeenCalledWith(
      entry.id,
      ORG,
      PROPERTY,
      'recipient_ineligible',
      NOW,
    )
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('does not repeat a frozen request to a bounced address', async () => {
    deps.emailRepo.findById.mockResolvedValue(attempted())
    deps.emailRepo.isAddressSuppressed.mockResolvedValue(true)

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

  it('does not repeat a frozen request to an address the recipient no longer has', async () => {
    deps.emailRepo.findById.mockResolvedValue(attempted())
    deps.userLookup.getEmail.mockResolvedValue('new-address@example.com')

    await run()

    expect(deps.emailRepo.markSuppressed).toHaveBeenCalledWith(
      entry.id,
      ORG,
      PROPERTY,
      'recipient_address_changed',
      NOW,
    )
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('honours a preference switched off between attempts', async () => {
    deps.emailRepo.findById.mockResolvedValue(attempted())
    deps.preferenceRepo.resolveForDelivery.mockResolvedValue({
      enabled: false,
      cadence: 'immediate',
    } as never)

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

  it('closes an attempt made without a frozen request instead of re-rendering it', async () => {
    deps.emailRepo.findById.mockResolvedValue(attempted({ providerRequest: null }))

    await run()

    expect(deps.emailRepo.markSuppressed).toHaveBeenCalledWith(
      entry.id,
      ORG,
      PROPERTY,
      'attempt_not_frozen',
      NOW,
    )
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })
})
