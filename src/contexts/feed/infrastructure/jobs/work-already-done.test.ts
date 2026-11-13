// A notice whose work was finished before it landed, or before its mail left.
//
// Settlement retires the rows that exist when the settling fact is handled.
// An escalation resolved (or a reply approved) after its notice was written
// can leave a row, or a queued mail, that asks for work nobody is waiting on.

import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { type NotificationWorkState } from '../../application/ports/notification-work-state.port'
import { createNotificationWorkState } from '../../notify/settle.server'
import {
  createSendEmailsHandler,
  type SendEmailJobData,
} from '../../email/send-emails.server'
import {
  loadItems,
  type DigestEntryDeps,
  type RecipientContext,
} from './digest-entry-selection'
import {
  buildNotification,
  buildNotificationEmail,
  createFakeJobLogger,
} from './test-fixtures'

const ORG = organizationId('org-1')
const PROPERTY = propertyId('11111111-1111-4111-8111-111111111111')
const NOW = new Date('2026-01-15T15:00:00.000Z')

const workState = (
  answer: Awaited<ReturnType<NotificationWorkState['isWaiting']>>,
): NotificationWorkState => ({
  isWaiting: vi.fn(async () => answer),
  isWaitingMany: vi.fn(async (subjects: ReadonlyArray<unknown>) =>
    subjects.map(() => answer),
  ),
  finished: vi.fn(async ({ types }) => types),
})

describe('an immediate email whose work was done after its row was written', () => {
  const entry = buildNotificationEmail({
    propertyId: PROPERTY as string,
    cadence: 'immediate',
    priority: 'urgent',
  })
  const row = buildNotification({
    propertyId: PROPERTY as string,
    type: 'reply.pending_approval',
    category: 'urgent_operational',
    priority: 'urgent',
    resourceType: 'inbox_item',
    resourceId: 'item-1',
    payload: { propertyName: 'Riverside Hotel', platform: 'google' },
  })

  const deps = (work: NotificationWorkState) => ({
    emailRepo: {
      findById: vi.fn(async () => entry),
      markSuppressed: vi.fn(async () => {}),
      freezeProviderRequest: vi.fn(async (_id, _org, _prop, request) => request),
      markAccepted: vi.fn(async () => {}),
      recordEmailUnsubscribeScope: vi.fn(async () => {}),
      isAddressSuppressed: vi.fn(async () => false),
    },
    preferenceRepo: {
      resolveForDelivery: vi.fn(async () => ({ enabled: true, cadence: 'immediate' })),
      resolveDeliveryWindow: vi.fn(async () => ({
        quietHoursStart: null,
        quietHoursEnd: null,
        urgentBypassEnabled: false,
      })),
      getUserSettings: vi.fn(async () => null),
    },
    notifRepo: { findByIdForProperty: vi.fn(async () => row) },
    userLookup: { getEmail: vi.fn(async () => 'manager@example.com') },
    emailSender: {
      send: vi.fn(async () => ({
        kind: 'accepted' as const,
        providerMessageId: 'provider-1',
        acceptedAt: NOW,
      })),
    },
    resolvePropertyScope: vi.fn(async () => ({
      organizationId: ORG as string,
      propertyId: PROPERTY as string,
      timezone: 'Europe/London',
    })),
    resolveOrganizationScope: vi.fn(async () => ({ timezone: 'Europe/London' })),
    authorizeScope: vi.fn(async () => true),
    isRecipientEligible: vi.fn(async () => true),
    workState: work,
    logger: createFakeJobLogger(),
    clock: () => NOW,
    baseUrl: 'https://app.example.com',
    oneClickUnsubscribeUrl: () => 'https://app.example.com/unsubscribe',
  })

  const job = {
    data: {
      notificationEmailId: entry.id as string,
      organizationId: ORG as string,
      propertyId: PROPERTY as string,
    } as unknown as SendEmailJobData,
  }
  const run = (built: ReturnType<typeof deps>) =>
    createSendEmailsHandler(
      built as unknown as Parameters<typeof createSendEmailsHandler>[0],
    )(job)

  it('is retired, not sent, once the reply was decided', async () => {
    const built = deps(workState(false))

    await run(built)

    expect(built.emailSender.send).not.toHaveBeenCalled()
    expect(built.emailRepo.markSuppressed).toHaveBeenCalledWith(
      entry.id,
      ORG,
      PROPERTY,
      'work_no_longer_waiting',
      NOW,
    )
  })

  it('still goes out while the reply waits for approval', async () => {
    const built = deps(workState(true))

    await run(built)

    expect(built.emailSender.send).toHaveBeenCalledTimes(1)
  })
})

describe('a digest line whose work was done after its row was written', () => {
  const ctx = {
    orgId: ORG,
    userId: userId('user-1'),
    rawOrgId: ORG as string,
    now: NOW,
    timezone: 'UTC',
    timezoneSource: 'fallback',
    quietHours: { quietHoursStart: null, quietHoursEnd: null },
  } as unknown as RecipientContext
  const entry = buildNotificationEmail({ propertyId: PROPERTY as string })
  const row = buildNotification({
    propertyId: PROPERTY as string,
    type: 'inbox.escalated',
    resourceType: 'inbox_item',
    resourceId: 'item-1',
  })
  const deps = (work: NotificationWorkState) =>
    ({
      emailRepo: { markSuppressed: vi.fn(async () => {}), markDelayed: vi.fn() },
      preferenceRepo: { resolveForDelivery: vi.fn() },
      notifRepo: {
        findByIdsForProperty: vi.fn(async () => new Map([[row.id as string, row]])),
      },
      logger: createFakeJobLogger(),
      resolvePropertyScope: vi.fn(),
      authorizeScope: vi.fn(),
      isRecipientEligible: vi.fn(),
      workState: work,
    }) as unknown as DigestEntryDeps & {
      emailRepo: { markSuppressed: ReturnType<typeof vi.fn> }
    }

  it('is dropped with a visible reason', async () => {
    const built = deps(workState(false))

    const items = await loadItems(built, ctx, [entry])

    expect(items).toEqual([])
    expect(built.emailRepo.markSuppressed).toHaveBeenCalledWith(
      entry.id,
      ORG,
      PROPERTY,
      'work_no_longer_waiting',
      NOW,
    )
  })

  it('is kept while the escalation stands', async () => {
    const items = await loadItems(deps(workState(true)), ctx, [entry])

    expect(items).toHaveLength(1)
  })
})

describe('a Google reconnect notice, judged by the connection as it stands when sent', () => {
  const CONNECTION = 'connection-1'
  const ctx = {
    orgId: ORG,
    userId: userId('user-1'),
    rawOrgId: ORG as string,
    now: NOW,
    timezone: 'UTC',
    timezoneSource: 'fallback',
    quietHours: { quietHoursStart: null, quietHoursEnd: null },
  } as unknown as RecipientContext
  const notice = {
    propertyId: PROPERTY as string,
    type: 'integration.reauthorization_required' as const,
    category: 'urgent_operational' as const,
    priority: 'urgent' as const,
    resourceType: 'integration' as const,
    resourceId: CONNECTION,
    payload: { reauthorizationCause: 'provider_revoked' as const },
  }

  const workFor = (status: () => Promise<string | null>) =>
    createNotificationWorkState({
      googleConnectionStatus: { findStatus: vi.fn(status) },
    } as never)

  const digestDeps = (work: NotificationWorkState) => {
    const row = buildNotification(notice)
    return {
      row,
      deps: {
        emailRepo: { markSuppressed: vi.fn(async () => {}), markDelayed: vi.fn() },
        preferenceRepo: { resolveForDelivery: vi.fn() },
        notifRepo: {
          findByIdsForProperty: vi.fn(async () => new Map([[row.id as string, row]])),
        },
        logger: createFakeJobLogger(),
        resolvePropertyScope: vi.fn(),
        authorizeScope: vi.fn(),
        isRecipientEligible: vi.fn(),
        workState: work,
      } as unknown as DigestEntryDeps,
    }
  }

  const emailDeps = (work: NotificationWorkState) => {
    const entry = buildNotificationEmail({
      propertyId: PROPERTY as string,
      cadence: 'immediate',
      priority: 'urgent',
    })
    const row = buildNotification(notice)
    const built = {
      emailRepo: {
        findById: vi.fn(async () => entry),
        markSuppressed: vi.fn(async () => {}),
        freezeProviderRequest: vi.fn(async (_id, _org, _prop, request) => request),
        markAccepted: vi.fn(async () => {}),
        recordEmailUnsubscribeScope: vi.fn(async () => {}),
        isAddressSuppressed: vi.fn(async () => false),
      },
      preferenceRepo: {
        resolveForDelivery: vi.fn(async () => ({ enabled: true, cadence: 'immediate' })),
        resolveDeliveryWindow: vi.fn(async () => ({
          quietHoursStart: null,
          quietHoursEnd: null,
          urgentBypassEnabled: false,
        })),
        getUserSettings: vi.fn(async () => null),
      },
      notifRepo: { findByIdForProperty: vi.fn(async () => row) },
      userLookup: { getEmail: vi.fn(async () => 'admin@example.com') },
      emailSender: {
        send: vi.fn(async () => ({
          kind: 'accepted' as const,
          providerMessageId: 'provider-1',
          acceptedAt: NOW,
        })),
      },
      resolvePropertyScope: vi.fn(async () => ({
        organizationId: ORG as string,
        propertyId: PROPERTY as string,
        timezone: 'Europe/London',
      })),
      resolveOrganizationScope: vi.fn(async () => ({ timezone: 'Europe/London' })),
      authorizeScope: vi.fn(async () => true),
      isRecipientEligible: vi.fn(async () => true),
      workState: work,
      logger: createFakeJobLogger(),
      clock: () => NOW,
      baseUrl: 'https://app.example.com',
      oneClickUnsubscribeUrl: () => 'https://app.example.com/unsubscribe',
    }
    const job = {
      data: {
        notificationEmailId: entry.id as string,
        organizationId: ORG as string,
        propertyId: PROPERTY as string,
      } as unknown as SendEmailJobData,
    }
    return {
      built,
      entry,
      send: () =>
        createSendEmailsHandler(
          built as unknown as Parameters<typeof createSendEmailsHandler>[0],
        )(job),
    }
  }

  const digestEntry = buildNotificationEmail({ propertyId: PROPERTY as string })

  it('drops the digest line and the immediate email once the connection was reconnected', async () => {
    // Dropped at 10:00, reconnected at 10:02, sent at 11:00.
    let status: string = 'reauth_required'
    const work = workFor(async () => status)
    status = 'active'

    const digest = digestDeps(work)
    expect(await loadItems(digest.deps, ctx, [digestEntry])).toEqual([])

    const email = emailDeps(work)
    await email.send()
    expect(email.built.emailSender.send).not.toHaveBeenCalled()
    expect(email.built.emailRepo.markSuppressed).toHaveBeenCalledWith(
      email.entry.id,
      ORG,
      PROPERTY,
      'work_no_longer_waiting',
      NOW,
    )
  })

  it('notifies while the connection is still broken', async () => {
    const work = workFor(async () => 'reauth_required')

    const digest = digestDeps(work)
    expect(await loadItems(digest.deps, ctx, [digestEntry])).toHaveLength(1)

    const email = emailDeps(work)
    await email.send()
    expect(email.built.emailSender.send).toHaveBeenCalledTimes(1)
  })

  it('notifies when the integration lookup is unavailable', async () => {
    const work = workFor(async () => {
      throw new Error('integration unavailable')
    })

    const digest = digestDeps(work)
    expect(await loadItems(digest.deps, ctx, [digestEntry])).toHaveLength(1)

    const email = emailDeps(work)
    await email.send()
    expect(email.built.emailSender.send).toHaveBeenCalledTimes(1)
  })
})
