import { describe, expect, it, vi } from 'vitest'
import { applyResendEvent, type ResendEventDeps } from './resend-event-handler'
import { createFakeJobLogger } from '../jobs/test-fixtures'
import {
  notificationEmailId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'

const OCCURRED_AT = new Date('2026-08-21T09:05:00Z')

const movedRow = (user = 'user-1', org = 'org-1') => ({
  emailId: notificationEmailId('email-1'),
  userId: userId(user),
  organizationId: organizationId(org),
  propertyId: propertyId('prop-a'),
})

function fakeDeps(
  overrides: Partial<{ moved: ReturnType<typeof movedRow>[]; suppressed: number }> = {},
) {
  const emailRepo = {
    recordProviderState: vi.fn(async () => overrides.moved ?? [movedRow()]),
    suppressRecipient: vi.fn(async () => overrides.suppressed ?? 3),
    suppressAddress: vi.fn(async () => {}),
  }
  return {
    emailRepo,
    userLookup: {
      getEmail: vi.fn(
        async (user: string): Promise<string | null> => `${user}@example.com`,
      ),
    },
    logger: createFakeJobLogger(),
  }
}

const run = (deps: ReturnType<typeof fakeDeps>, type: string, bounceType?: string) =>
  applyResendEvent(deps as unknown as ResendEventDeps, {
    type,
    providerMessageId: 'prov-1',
    occurredAt: OCCURRED_AT,
    eventId: 'msg_2abc',
    ...(bounceType === undefined ? {} : { bounceType }),
  })

describe('resend delivery event handler (ADR 0046 r.6)', () => {
  it('records a delivery without suppressing the recipient', async () => {
    const deps = fakeDeps()

    const result = await run(deps, 'email.delivered')

    expect(deps.emailRepo.recordProviderState).toHaveBeenCalledWith(
      'prov-1',
      'delivered',
      OCCURRED_AT,
    )
    expect(deps.emailRepo.suppressRecipient).not.toHaveBeenCalled()
    expect(result).toEqual({ applied: true, rows: 1, suppressed: 0 })
  })

  it('suppresses the recipient on a bounce so we stop mailing a dead address', async () => {
    const deps = fakeDeps()

    const result = await run(deps, 'email.bounced')

    expect(deps.emailRepo.recordProviderState).toHaveBeenCalledWith(
      'prov-1',
      'bounced',
      OCCURRED_AT,
    )
    expect(deps.emailRepo.suppressRecipient).toHaveBeenCalledWith(
      userId('user-1'),
      organizationId('org-1'),
      'provider_bounced',
      OCCURRED_AT,
    )
    expect(result).toEqual({ applied: true, rows: 1, suppressed: 3 })
  })

  it('keeps a permanent bounce, keyed by address, beyond the queue rows retention deletes', async () => {
    const deps = fakeDeps()

    await run(deps, 'email.bounced', 'Permanent')

    expect(deps.userLookup.getEmail).toHaveBeenCalledWith(userId('user-1'))
    expect(deps.emailRepo.suppressAddress).toHaveBeenCalledWith(
      'user-1@example.com',
      'bounced',
      OCCURRED_AT,
    )
  })

  it('records a transient bounce without suppressing the recipient', async () => {
    // A full mailbox must not stop every notice, mandatory ones included.
    for (const bounceType of ['Transient', 'Undetermined']) {
      const deps = fakeDeps()

      const result = await run(deps, 'email.bounced', bounceType)

      expect(deps.emailRepo.recordProviderState).toHaveBeenCalledWith(
        'prov-1',
        'bounced',
        OCCURRED_AT,
      )
      expect(deps.emailRepo.suppressRecipient).not.toHaveBeenCalled()
      expect(deps.emailRepo.suppressAddress).not.toHaveBeenCalled()
      expect(result).toEqual({ applied: true, rows: 1, suppressed: 0 })
    }
  })

  it('keeps a complaint and a provider suppression by address too', async () => {
    const complained = fakeDeps()
    const suppressed = fakeDeps()

    await run(complained, 'email.complained')
    await run(suppressed, 'email.suppressed')

    expect(complained.emailRepo.suppressAddress).toHaveBeenCalledWith(
      'user-1@example.com',
      'complained',
      OCCURRED_AT,
    )
    expect(suppressed.emailRepo.suppressAddress).toHaveBeenCalledWith(
      'user-1@example.com',
      'suppressed',
      OCCURRED_AT,
    )
  })

  it('suppresses the recipient on a spam complaint', async () => {
    const deps = fakeDeps()

    await run(deps, 'email.complained')

    expect(deps.emailRepo.suppressRecipient).toHaveBeenCalledWith(
      userId('user-1'),
      organizationId('org-1'),
      'provider_complained',
      OCCURRED_AT,
    )
  })

  it('suppresses the recipient when the provider suppressed the message', async () => {
    // Resend accepts the send (200, id stored), then drops it because the
    // address is on its suppression list and says so only by this webhook.
    const deps = fakeDeps()

    const result = await run(deps, 'email.suppressed')

    expect(deps.emailRepo.recordProviderState).toHaveBeenCalledWith(
      'prov-1',
      'suppressed',
      OCCURRED_AT,
    )
    expect(deps.emailRepo.suppressRecipient).toHaveBeenCalledWith(
      userId('user-1'),
      organizationId('org-1'),
      'provider_suppressed',
      OCCURRED_AT,
    )
    expect(result).toEqual({ applied: true, rows: 1, suppressed: 3 })
  })

  it('records a failure after acceptance as terminal, loudly, without suppressing the address', async () => {
    const deps = fakeDeps()

    const result = await run(deps, 'email.failed')

    expect(deps.emailRepo.recordProviderState).toHaveBeenCalledWith(
      'prov-1',
      'failed',
      OCCURRED_AT,
    )
    expect(deps.emailRepo.suppressRecipient).not.toHaveBeenCalled()
    expect(result).toEqual({ applied: true, rows: 1, suppressed: 0 })
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryState: 'failed', rows: 1 }),
      'Email failed at the provider after it was accepted',
    )
  })

  it('records a provider delivery delay without suppressing anyone', async () => {
    const deps = fakeDeps()

    const result = await run(deps, 'email.delivery_delayed')

    expect(deps.emailRepo.recordProviderState).toHaveBeenCalledWith(
      'prov-1',
      'delivery_delayed',
      OCCURRED_AT,
    )
    expect(deps.emailRepo.suppressRecipient).not.toHaveBeenCalled()
    expect(result).toEqual({ applied: true, rows: 1, suppressed: 0 })
  })

  it('cascades once per recipient even when the event moves several rows', async () => {
    const deps = fakeDeps({
      moved: [movedRow('user-1'), movedRow('user-1'), movedRow('user-2')],
    })

    await run(deps, 'email.bounced')

    expect(deps.emailRepo.suppressRecipient).toHaveBeenCalledTimes(2)
  })

  it('logs a bounce at error level — an invisible bounce is the original defect', async () => {
    const deps = fakeDeps()

    await run(deps, 'email.bounced')

    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryState: 'bounced', suppressed: 3 }),
      expect.stringContaining('undeliverable'),
    )
  })

  it('ignores engagement events without touching the queue', async () => {
    const deps = fakeDeps()

    for (const type of ['email.sent', 'email.opened', 'email.clicked']) {
      const result = await run(deps, type)
      expect(result.reason).toBe('ignored_event_type')
    }
    expect(deps.emailRepo.recordProviderState).not.toHaveBeenCalled()
  })

  it('warns rather than silently no-ops when the event matches no row', async () => {
    const deps = fakeDeps({ moved: [] })

    const result = await run(deps, 'email.delivered')

    expect(result).toEqual({
      applied: false,
      rows: 0,
      suppressed: 0,
      reason: 'unknown_message',
    })
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryState: 'delivered' }),
      expect.stringContaining('matched no queue row'),
    )
    expect(deps.emailRepo.suppressRecipient).not.toHaveBeenCalled()
  })
})
