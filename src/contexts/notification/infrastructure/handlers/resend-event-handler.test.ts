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
  }
  return {
    emailRepo,
    logger: createFakeJobLogger(),
  }
}

const run = (deps: ReturnType<typeof fakeDeps>, type: string) =>
  applyResendEvent(deps as unknown as ResendEventDeps, {
    type,
    providerMessageId: 'prov-1',
    occurredAt: OCCURRED_AT,
    eventId: 'msg_2abc',
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
