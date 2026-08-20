import { describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import { createDigestNotificationJobHandler } from './digest-notification.job'
import {
  buildNotification,
  buildNotificationEmail,
  createFakeJobLogger,
} from './test-fixtures'
import {
  organizationId,
  userId,
  type NotificationId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { Notification, NotificationEmail } from '../../domain/types'
import type { EmailSendRequest } from '../../application/ports/email-sender.port'
import type { NotificationDeliveryOutcome } from '../../domain/notification-delivery-policy'

const ORG = 'org-1'
const USER = 'user-1'
const PROP_A = '11111111-1111-4111-8111-111111111111'
const PROP_B = '22222222-2222-4222-8222-222222222222'
const BASE_URL = 'https://app.example.com'
// 08:00 UTC — inside the digest window for a UTC recipient.
const NOW = new Date('2026-07-11T08:00:00.000Z')

const entryFor = (property: string, user = USER): NotificationEmail =>
  buildNotificationEmail({
    id: `email-${property}-${user}`,
    notificationId: `notification-${property}-${user}`,
    userId: user,
    organizationId: ORG,
    propertyId: property,
    category: 'recognition',
    cadence: 'daily',
  })

const notificationFor = (entry: NotificationEmail): Notification =>
  buildNotification({
    id: entry.notificationId as string,
    userId: entry.userId as string,
    organizationId: entry.organizationId as string,
    propertyId: entry.propertyId as string,
    type: 'goal.completed',
    category: 'recognition',
    resourceType: 'goal',
    resourceId: `goal-${entry.propertyId as string}`,
    payload: {
      propertyName: (entry.propertyId as string) === PROP_A ? 'Riverside' : 'Hillcrest',
      goalName: 'Reply within 24h',
    },
  })

type Options = Readonly<{
  now?: Date
  recipients?: ReadonlyArray<Readonly<{ organizationId: string; userId: string }>>
  dueByUser?: readonly NotificationEmail[]
  userTimezone?: string | null
  orgTimezone?: string | null
  immediateOrphans?: readonly NotificationEmail[]
}>

function baseDeps(options: Options = {}) {
  const now = options.now ?? NOW
  const due = options.dueByUser ?? [entryFor(PROP_A), entryFor(PROP_B)]
  const send = vi.fn(
    async (_params: EmailSendRequest): Promise<NotificationDeliveryOutcome> => ({
      kind: 'accepted' as const,
      providerMessageId: crypto.randomUUID(),
      acceptedAt: now,
    }),
  )
  return {
    pool: {
      query: vi.fn(async () => ({
        rows: [
          { organization_id: ORG, property_id: PROP_A },
          { organization_id: ORG, property_id: PROP_B },
        ],
      })),
    },
    emailRepo: {
      findDueRecipients: vi.fn(
        async () => options.recipients ?? [{ organizationId: ORG, userId: USER }],
      ),
      findDueByUser: vi.fn(async () => due),
      findDueByProperty: vi.fn(async () => options.immediateOrphans ?? []),
      markSuppressed: vi.fn(async () => {}),
      markDelayed: vi.fn(async () => {}),
      markAccepted: vi.fn(async (_id: string) => {}),
      markFailed: vi.fn(async () => {}),
      isRecipientSuppressed: vi.fn(async () => false),
    },
    preferenceRepo: {
      findForDelivery: vi.fn(async () => ({
        enabled: true,
        quietHoursStart: null,
        quietHoursEnd: null,
      })),
      getUserSettings: vi.fn(async () =>
        options.userTimezone === undefined
          ? { timezone: 'UTC' }
          : options.userTimezone === null
            ? null
            : { timezone: options.userTimezone },
      ),
    },
    notifRepo: {
      findByIdsForProperty: vi.fn(
        async (ids: readonly NotificationId[], _org: unknown, property: PropertyId) =>
          new Map(
            ids.map((id) => [
              id as string,
              notificationFor(entryFor(property as string)),
            ]),
          ),
      ),
    },
    userLookup: {
      getEmail: vi.fn(async (): Promise<string | null> => 'manager@example.com'),
      getName: vi.fn(async (): Promise<string | null> => 'Alex'),
    },
    emailSender: { send },
    resolveOrganizationScope: vi.fn(async () => ({
      timezone: options.orgTimezone ?? 'UTC',
      propertyNames: new Map([
        [PROP_A, 'Riverside'],
        [PROP_B, 'Hillcrest'],
      ]),
    })),
    logger: createFakeJobLogger(),
    clock: () => now,
    authorizeScope: vi.fn(async (_org: string, _property: string) => true),
    baseUrl: BASE_URL,
    enqueueImmediate: vi.fn(async () => {}),
  }
}

const runHandler = (deps: ReturnType<typeof baseDeps>) =>
  createDigestNotificationJobHandler(
    deps as unknown as Parameters<typeof createDigestNotificationJobHandler>[0],
  )({} as Job<void>)

describe('digest notification job — one email per user (ADR 0046 r.4)', () => {
  it('sends exactly one digest to a multi-property user, grouped by property', async () => {
    const deps = baseDeps()

    await runHandler(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
    const payload = deps.emailSender.send.mock.calls[0]![0]
    expect(payload.html).toContain('Riverside')
    expect(payload.html).toContain('Hillcrest')
    expect(payload.text).toContain('Riverside')
    expect(payload.text).toContain('Hillcrest')
  })

  it('reads due rows per recipient, never per property', async () => {
    const deps = baseDeps()

    await runHandler(deps)

    expect(deps.emailRepo.findDueByUser).toHaveBeenCalledWith(
      organizationId(ORG),
      userId(USER),
      'daily',
      NOW,
    )
  })

  it('sends one digest per recipient when several are due', async () => {
    const deps = baseDeps({
      recipients: [
        { organizationId: ORG, userId: 'user-1' },
        { organizationId: ORG, userId: 'user-2' },
      ],
    })

    await runHandler(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(2)
  })

  it('still authorizes every concrete property before including its rows', async () => {
    const deps = baseDeps()
    deps.authorizeScope.mockImplementation(async (_org, property) => property === PROP_A)

    await runHandler(deps)

    const payload = deps.emailSender.send.mock.calls[0]![0]
    expect(payload.html).toContain('Riverside')
    expect(payload.html).not.toContain('Hillcrest')
  })

  it('sends nothing when no property is authorized', async () => {
    const deps = baseDeps()
    deps.authorizeScope.mockResolvedValue(false)

    await runHandler(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('keeps one bad recipient from aborting the sweep for everyone else', async () => {
    const deps = baseDeps({
      recipients: [
        { organizationId: ORG, userId: 'user-1' },
        { organizationId: ORG, userId: 'user-2' },
      ],
    })
    deps.userLookup.getName.mockRejectedValueOnce(new Error('identity read failed'))

    await runHandler(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error) }),
      'Daily digest failed for recipient',
    )
  })
})

describe('digest subject and body', () => {
  it('carries a count and a date instead of a static subject', async () => {
    const deps = baseDeps()

    await runHandler(deps)

    const { subject } = deps.emailSender.send.mock.calls[0]![0]
    expect(subject).not.toBe('Your daily digest — Reputation Key')
    expect(subject).toMatch(/\d+ updates?/)
    expect(subject).toContain('July')
  })

  it('never emits the literal two-character backslash-n that joined the old items', async () => {
    // The old digestHtml did `items.join('\\n')` — a literal backslash + n,
    // rendered verbatim between every paragraph.
    const deps = baseDeps()

    await runHandler(deps)

    const { html, text } = deps.emailSender.send.mock.calls[0]![0]
    expect(html).not.toContain(String.raw`\n`)
    expect(text).not.toContain(String.raw`\n`)
  })

  it('renders from type + payload, never the stored raw-id title', async () => {
    const deps = baseDeps()

    await runHandler(deps)

    const { html, text, subject } = deps.emailSender.send.mock.calls[0]![0]
    for (const rendered of [html, text, subject]) {
      expect(rendered).not.toContain('61ed98fc')
    }
  })

  it('ships a plain-text twin', async () => {
    const deps = baseDeps()

    await runHandler(deps)

    expect(deps.emailSender.send.mock.calls[0]![0].text.length).toBeGreaterThan(0)
  })
})

describe('digest idempotency (ADR 0046 r.5)', () => {
  it('keys on (organization, user, local date) — never on property', async () => {
    const deps = baseDeps()

    await runHandler(deps)

    const { idempotencyKey } = deps.emailSender.send.mock.calls[0]![0]
    expect(idempotencyKey).toBe(`digest:${ORG}:${USER}:2026-07-11`)
    expect(idempotencyKey).not.toContain(PROP_A)
    expect(idempotencyKey).not.toContain(PROP_B)
  })

  it('recomputes the identical key on a retry hours later, outliving the provider 24h window', async () => {
    const first = baseDeps({ now: new Date('2026-07-11T08:00:00.000Z') })
    const retry = baseDeps({ now: new Date('2026-07-11T08:59:00.000Z') })

    await runHandler(first)
    await runHandler(retry)

    expect(first.emailSender.send.mock.calls[0]![0].idempotencyKey).toBe(
      retry.emailSender.send.mock.calls[0]![0].idempotencyKey,
    )
  })

  it('accepted rows leave the due set, so the durable guard survives past 24h', async () => {
    // The key covers the provider's dedupe window; `markAccepted` covers the
    // rest, because an accepted row is no longer returned by findDueByUser.
    const deps = baseDeps()

    await runHandler(deps)

    expect(deps.emailRepo.markAccepted).toHaveBeenCalledTimes(2)
    for (const call of deps.emailRepo.markAccepted.mock.calls) {
      expect(call[0]).toMatch(/^email-/)
    }
  })
})

describe('digest timing in the recipient timezone (ADR 0046 r.3)', () => {
  it('uses the user timezone for the 08:00 window, not UTC', async () => {
    // 12:00Z is 08:00 in New York on a DST date — in window for the user even
    // though it is midday UTC.
    const deps = baseDeps({
      now: new Date('2026-07-11T12:00:00.000Z'),
      userTimezone: 'America/New_York',
    })

    await runHandler(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
  })

  it('does not send outside the recipient window', async () => {
    const deps = baseDeps({
      now: new Date('2026-07-11T08:00:00.000Z'),
      userTimezone: 'America/New_York',
    })

    await runHandler(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('respects DST: the same UTC hour is in-window before the shift and out after it', async () => {
    // US DST 2026 starts Sunday 8 March. 13:00Z = 08:00 EST on the 7th,
    // but 09:00 EDT on the 8th.
    const beforeShift = baseDeps({
      now: new Date('2026-03-07T13:00:00.000Z'),
      userTimezone: 'America/New_York',
    })
    const afterShift = baseDeps({
      now: new Date('2026-03-08T13:00:00.000Z'),
      userTimezone: 'America/New_York',
    })

    await runHandler(beforeShift)
    await runHandler(afterShift)

    expect(beforeShift.emailSender.send).toHaveBeenCalledTimes(1)
    expect(afterShift.emailSender.send).not.toHaveBeenCalled()
  })

  it('keys the local date on the recipient timezone across a UTC date boundary', async () => {
    // 03:30Z on the 12th is still 23:30 on the 11th in New York. Outside the
    // 08:00 window only quiet-hours-parked rows are eligible, and releasing
    // one must use the RECIPIENT's date — keying on UTC would let the same
    // digest send twice across midnight.
    const deps = baseDeps({
      now: new Date('2026-07-12T03:30:00.000Z'),
      userTimezone: 'America/New_York',
      dueByUser: [{ ...entryFor(PROP_A), status: 'delayed' }],
    })

    await runHandler(deps)

    expect(deps.emailSender.send.mock.calls[0]![0].idempotencyKey).toBe(
      `digest:${ORG}:${USER}:2026-07-11`,
    )
  })

  it('falls back to the organization timezone when the user never chose one', async () => {
    const deps = baseDeps({
      now: new Date('2026-07-11T12:00:00.000Z'),
      userTimezone: null,
      orgTimezone: 'America/New_York',
    })

    await runHandler(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
  })

  it('defers on quiet hours measured in the recipient timezone', async () => {
    const deps = baseDeps({ userTimezone: 'UTC' })
    deps.preferenceRepo.findForDelivery.mockResolvedValue({
      enabled: true,
      quietHoursStart: '07:00',
      quietHoursEnd: '09:00',
    } as never)

    await runHandler(deps)

    expect(deps.emailRepo.markDelayed).toHaveBeenCalledTimes(2)
    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'quiet_hours', timezone: 'UTC' }),
      'Digest entry deferred',
    )
  })
})

describe('digest preferences link (ADR 0046 r.7)', () => {
  it('sets List-Unsubscribe and the one-click directive', async () => {
    const deps = baseDeps()

    await runHandler(deps)

    expect(deps.emailSender.send.mock.calls[0]![0].headers).toEqual({
      'List-Unsubscribe': `<${BASE_URL}/settings/notifications>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })
  })

  it('refuses to send when the base URL cannot form an absolute preferences link', async () => {
    const deps = baseDeps()
    deps.baseUrl = ''

    await runHandler(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.anything() }),
      'Daily digest failed for recipient',
    )
  })
})

describe('digest suppression and failure visibility (ADR 0046 r.6)', () => {
  it('suppresses without sending when the recipient already bounced', async () => {
    const deps = baseDeps()
    deps.emailRepo.isRecipientSuppressed.mockResolvedValue(true)

    await runHandler(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(deps.emailRepo.markSuppressed).toHaveBeenCalledTimes(2)
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'recipient_bounced' }),
      'Digest entry suppressed',
    )
  })

  it('suppresses and logs when the recipient has no address', async () => {
    const deps = baseDeps()
    deps.userLookup.getEmail.mockResolvedValue(null)

    await runHandler(deps)

    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'recipient_unavailable' }),
      'Digest entry suppressed',
    )
  })

  it('logs and marks every row failed when the provider call throws', async () => {
    const deps = baseDeps()
    deps.emailSender.send.mockRejectedValue(new Error('socket hang up'))

    await runHandler(deps)

    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ entries: 2 }),
      'Daily digest provider call failed',
    )
    expect(deps.emailRepo.markFailed).toHaveBeenCalledTimes(2)
  })

  it('logs a provider rejection instead of treating it as a send', async () => {
    const deps = baseDeps()
    deps.emailSender.send.mockResolvedValue({
      kind: 'rejected',
      classification: 'permanent',
      providerCode: 'invalid_recipient',
    } as never)

    await runHandler(deps)

    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ classification: 'permanent' }),
      'Daily digest rejected by provider',
    )
    expect(deps.emailRepo.markAccepted).not.toHaveBeenCalled()
  })

  it('suppresses a preference-disabled row with a visible reason', async () => {
    const deps = baseDeps()
    deps.preferenceRepo.findForDelivery.mockResolvedValue({ enabled: false } as never)

    await runHandler(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'preference_disabled' }),
      'Digest entry suppressed',
    )
  })
})

describe('immediate orphan sweep', () => {
  it('re-enqueues immediate-cadence rows the urgent path never picked up', async () => {
    const orphan = buildNotificationEmail({
      id: 'orphan-1',
      propertyId: PROP_A,
      cadence: 'immediate',
    })
    const deps = baseDeps({ immediateOrphans: [orphan] })

    await runHandler(deps)

    expect(deps.enqueueImmediate).toHaveBeenCalledWith({
      notificationEmailId: 'orphan-1',
      organizationId: ORG,
      propertyId: PROP_A,
    })
    expect(deps.logger.info).toHaveBeenCalledWith(
      { orphans: 1 },
      'Re-enqueued immediate notification emails missed by the urgent path',
    )
  })

  it('skips properties that fail the scope gate', async () => {
    const deps = baseDeps({
      immediateOrphans: [
        buildNotificationEmail({
          id: 'orphan-1',
          propertyId: PROP_A,
          cadence: 'immediate',
        }),
      ],
    })
    deps.authorizeScope.mockResolvedValue(false)

    await runHandler(deps)

    expect(deps.enqueueImmediate).not.toHaveBeenCalled()
  })
})
