import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { buildConsumerEvent } from '#/shared/outbox/envelope'
import { organizationId, userId } from '#/shared/domain/ids'
import { identityMemberRemoved } from '#/contexts/identity/domain/events'
import { handleIdentityAccountNotificationEvent } from './identity-account-outbox-consumers'
import { createNotificationConsumerDeps } from './notification-consumer-test-fixtures'
import { parseNotificationPayload } from '../domain/notification-payload'
import { renderNotification } from '../domain/notification-templates'
import type { InsertNotificationJobData } from './jobs/insert-notification.job'

const ORG = organizationId('org-departure-notice')
const MEMBER = userId('departing-member')
const ADMIN = userId('account-admin')

/** Runs the fact through the real outbox adapter, as the relay would. */
async function noticeFor(removedBy: typeof MEMBER) {
  const fact = identityMemberRemoved({
    organizationId: ORG,
    userId: MEMBER,
    removedBy,
    occurredAt: new Date('2026-09-28T09:00:00.000Z'),
  })
  const row = toOutboxEvent(fact)
  const fakes = createNotificationConsumerDeps()
  await handleIdentityAccountNotificationEvent(
    {
      queue: fakes.queue,
      receipts: { insertReceipt: vi.fn(async () => {}) },
      displayNames: fakes.displayNames,
      logger: fakes.logger,
    },
    buildConsumerEvent({
      id: fact.eventId,
      eventType: row.eventType,
      eventVersion: row.eventVersion ?? 1,
      payload: row.payload,
      organizationId: row.organizationId,
      propertyId: row.propertyId ?? null,
      sourceContext: row.sourceContext,
      sourceAggregateId: row.sourceAggregateId,
      recordedAt: new Date('2026-09-28T09:00:01.000Z'),
    }),
  )
  expect(fakes.jobs).toHaveLength(1)
  const data = fakes.jobs[0]!.data as InsertNotificationJobData
  expect(data.userId).toBe(MEMBER)
  return {
    rendered: renderNotification(
      'account.organization_access_removed',
      parseNotificationPayload(data.payload ?? {}),
    ),
    payload: data.payload ?? {},
  }
}

// Leaving is recorded as identity.member.removed with the member as its own
// actor. The mandatory notice must not tell them an administrator did it.
describe('the access-removed notice after a member leaves', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })

  it('tells a member who left that they left', async () => {
    const { rendered } = await noticeFor(MEMBER)

    expect(rendered.title).toBe('You left the organization')
    expect(rendered.body).not.toContain('contact an account administrator')
  })

  it('keeps the removal copy when an administrator removed them', async () => {
    const { rendered } = await noticeFor(ADMIN)

    expect(rendered.title).toBe('Organization access removed')
  })

  // A repeat removal folds into the unread notice and its payload is merged as
  // `old || new` (ADR 0046 r.2). Left on their own, re-invited, then removed by
  // an administrator: unless the removal writes the flag as false, the merged
  // notice keeps the earlier `leftOrganization: true` and says "You left".
  it('reads as a removal when an administrator removal folds into a self-leave notice', async () => {
    const left = await noticeFor(MEMBER)
    const removed = await noticeFor(ADMIN)
    const merged = { ...left.payload, ...removed.payload }

    const rendered = renderNotification(
      'account.organization_access_removed',
      parseNotificationPayload(merged),
    )

    expect(rendered.title).toBe('Organization access removed')
  })
})
