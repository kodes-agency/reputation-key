// The digest job's collaborators as test doubles, shared by the digest job's
// focused test files so each one builds its recipient, rows and ports the same
// way. Every double answers "deliverable" until a test says otherwise.

import { vi } from 'vitest'
import type { Job } from 'bullmq'
import { createDigestNotificationJobHandler } from './digest-notification.job'
import {
  buildNotification,
  buildNotificationEmail,
  createFakeJobLogger,
} from './test-fixtures'
import type { NotificationId, PropertyId } from '#/shared/domain/ids'
import type {
  Notification,
  NotificationEmail,
  PersonalDeliveryWindow,
} from '../../domain/notification-types'
import type { NotificationDigestBatch } from '../../application/ports/notification-email-repository.port'
import type { EmailSendRequest } from '../../application/ports/email-sender.port'
import type { NotificationDeliveryOutcome } from '../../domain/notification-delivery-policy'

export const ORG = 'org-1'
export const USER = 'user-1'
export const PROP_A = '11111111-1111-4111-8111-111111111111'
export const PROP_B = '22222222-2222-4222-8222-222222222222'
export const BASE_URL = 'https://app.example.com'
// 08:00 UTC — inside the digest window for a UTC recipient.
export const NOW = new Date('2026-07-11T08:00:00.000Z')
export const HOUR = 60 * 60_000
export const DAY = 24 * HOUR

export const entryFor = (property: string, user = USER): NotificationEmail =>
  buildNotificationEmail({
    id: `email-${property}-${user}`,
    notificationId: `notification-${property}-${user}`,
    userId: user,
    organizationId: ORG,
    propertyId: property,
    category: 'recognition',
    cadence: 'daily',
  })

export const notificationFor = (entry: NotificationEmail): Notification =>
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

type PropertyScope = Readonly<{
  organizationId: string
  propertyId: string
  timezone: string
}>

export const activeScope = (property: string): PropertyScope | null => ({
  organizationId: ORG,
  propertyId: property,
  timezone: 'UTC',
})

export type DigestTestOptions = Readonly<{
  now?: Date
  recipients?: ReadonlyArray<Readonly<{ organizationId: string; userId: string }>>
  dueByUser?: readonly NotificationEmail[]
  userTimezone?: string | null
  orgTimezone?: string | null
  immediateOrphans?: readonly NotificationEmail[]
  organizationOrphans?: readonly NotificationEmail[]
  openBatch?: NotificationDigestBatch | null
  batchEntries?: readonly NotificationEmail[]
  activeUnsubscribeKeyVersion?: string
}>

export function baseDeps(options: DigestTestOptions = {}) {
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
      findDueOrganizationScopes: vi.fn(async () => [
        ...new Set(
          (options.organizationOrphans ?? []).map((entry) => entry.organizationId),
        ),
      ]),
      findDueByOrganization: vi.fn(async () => options.organizationOrphans ?? []),
      markSuppressed: vi.fn(async () => {}),
      markDelayed: vi.fn(async () => {}),
      markAccepted: vi.fn(async (_id: string) => {}),
      markFailed: vi.fn(async () => {}),
      isAddressSuppressed: vi.fn(async (_address: string) => false),
      findOpenDigestBatch: vi.fn(async () => options.openBatch ?? null),
      findDigestBatchEntries: vi.fn(async () => options.batchEntries ?? due),
      prepareDigestBatch: vi.fn(async (input) => ({
        batch: {
          id: input.id,
          organizationId: input.organizationId,
          userId: input.userId,
          localDate: input.localDate,
          sequence: 1,
          memberDigest: input.memberDigest,
          contentDigest: input.contentDigest,
          providerIdempotencyKey: input.providerIdempotencyKey,
          unsubscribeKeyVersion: input.unsubscribeKeyVersion,
          state: 'prepared' as const,
          retryCount: 0,
          everyAttemptRefused: false,
          createdAt: input.preparedAt,
          updatedAt: input.preparedAt,
        },
        created: true,
      })),
      startDigestAttempt: vi.fn(async () => true),
      settleDigestBatch: vi.fn(async () => true),
    },
    preferenceRepo: {
      resolveForDelivery: vi.fn(async () => ({
        enabled: true,
        cadence: 'daily' as const,
      })),
      // ADR 0046 r.4, amended 2026-09-23: ONE window for the whole digest,
      // the person's own. The digest passes no Property, so no Property
      // override can split it.
      resolveDeliveryWindow: vi.fn(async (): Promise<PersonalDeliveryWindow> => ({
        quietHoursStart: null,
        quietHoursEnd: null,
        urgentBypassEnabled: false,
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
    batchIdGen: vi.fn(() => '86000000-0000-4000-8000-000000000099'),
    resolvePropertyScope: vi.fn(async (_org: string, property: string) =>
      activeScope(property),
    ),
    organizationEmailStop: vi.fn(
      async (_organizationId: string): Promise<'none' | 'optional' | 'all'> => 'none',
    ),
    authorizeScope: vi.fn(async (_org: string, _property?: string) => true),
    authorizeMandatoryScope: vi.fn(async (_org: string) => true),
    isRecipientEligible: vi.fn(
      async (_input: { propertyId: string; audience: unknown }, _memo?: unknown) => true,
    ),
    baseUrl: BASE_URL,
    activeOneClickUnsubscribeKeyVersion: vi.fn(
      () => options.activeUnsubscribeKeyVersion ?? 'v1',
    ),
    oneClickUnsubscribeUrl: vi.fn(
      (target: { kind: string; id: string }, keyVersion: string) =>
        `${BASE_URL}/api/notifications/unsubscribe?token=${keyVersion}-${target.kind}-${target.id}`,
    ),
    enqueueImmediate: vi.fn(async () => {}),
  }
}

export const runHandler = (deps: ReturnType<typeof baseDeps>) =>
  createDigestNotificationJobHandler(
    deps as unknown as Parameters<typeof createDigestNotificationJobHandler>[0],
  )({} as Job<void>)
