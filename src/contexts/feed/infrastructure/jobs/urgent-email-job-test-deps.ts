// The immediate-email job's collaborators as test doubles, shared by its
// focused test files. Every double answers "deliverable" until a test says
// otherwise.

import { vi } from 'vitest'
import type { UrgentEmailJobData } from './urgent-email.job'
import {
  buildNotification,
  buildNotificationEmail,
  createFakeJobLogger,
  waitingWorkState,
} from './test-fixtures'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { NotificationDeliveryOutcome } from '../../domain/notification-delivery-policy'
import type { EmailSendRequest } from '../../application/ports/email-sender.port'
import type { Notification, NotificationEmail } from '../../domain/notification-types'

export const NOW = new Date('2026-01-15T15:00:00.000Z')
export const ORG = organizationId('org-1')
export const PROPERTY = propertyId('11111111-1111-4111-8111-111111111111')
export const BASE_URL = 'https://app.example.com'

export const entry = buildNotificationEmail({
  id: 'email-1',
  propertyId: PROPERTY as string,
  category: 'urgent_operational',
  cadence: 'immediate',
  priority: 'urgent',
})
// A pre-template row: `title` is a raw identifier. The renderer must replace it.
export const notification = buildNotification({
  propertyId: PROPERTY as string,
  type: 'reply.publish_failed',
  category: 'urgent_operational',
  priority: 'urgent',
  resourceType: 'reply',
  resourceId: 'reply-1',
  payload: { propertyName: 'Riverside Hotel', platform: 'google', waitingHours: 5 },
  title: 'Reply publication failed 61ed98fc-1c2b-4d6e-9f00-000000000001',
})

export const job = {
  data: {
    notificationEmailId: entry.id as string,
    organizationId: ORG as string,
    propertyId: PROPERTY as string,
    capability: 'notification.send_email',
    policyVersionAtEnqueue: 'test',
    initiator: { kind: 'system', id: 'test' },
  } as unknown as UrgentEmailJobData,
}

export function fakeDeps() {
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
      resolveForDelivery: vi.fn(async () => ({
        enabled: true,
        cadence: 'immediate' as const,
      })),
      // Quiet hours are the person's, with a Property override applied by the
      // resolver (ADR 0046, amended 2026-09-23).
      resolveDeliveryWindow: vi.fn(async () => ({
        quietHoursStart: null,
        quietHoursEnd: null,
        urgentBypassEnabled: false,
      })),
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
    workState: waitingWorkState(),
    logger: createFakeJobLogger(),
    clock: () => NOW,
    baseUrl: BASE_URL,
    oneClickUnsubscribeUrl: vi.fn(
      (target: { kind: string; id: string }) =>
        `${BASE_URL}/api/notifications/unsubscribe?token=${target.kind}-${target.id}`,
    ),
  }
}
