// A rated notice is filed twice on purpose (ADR 0046, amended 2026-09-30): the
// in-app row under the category of the channel that shows it, the queued email
// under the category of the channel that sends it. A reader whose Low ratings
// answer differs by channel gets a row and an email under two categories, and
// the immediate job used to read that as a notification that does not belong to
// its email and suppress the mail for good.

import { beforeEach, describe, expect, it } from 'vitest'
import { createUrgentEmailJobHandler } from './urgent-email.job'
import { buildNotification, buildNotificationEmail } from './test-fixtures'
import { entry, fakeDeps, job, NOW, ORG, PROPERTY } from './urgent-email-job-test-deps'
import type {
  NotificationCategory,
  NotificationType,
} from '../../domain/notification-types'

describe('the immediate email of a rated notice', () => {
  let deps: ReturnType<typeof fakeDeps>

  beforeEach(() => {
    deps = fakeDeps()
  })

  const run = () =>
    createUrgentEmailJobHandler(
      deps as unknown as Parameters<typeof createUrgentEmailJobHandler>[0],
    )(job)

  const filed = (
    type: NotificationType,
    rowCategory: NotificationCategory,
    emailCategory: NotificationCategory,
  ) => {
    deps.emailRepo.findById.mockResolvedValue(
      buildNotificationEmail({
        id: entry.id as string,
        propertyId: PROPERTY as string,
        category: emailCategory,
        cadence: 'immediate',
      }),
    )
    deps.notifRepo.findByIdForProperty.mockResolvedValue(
      buildNotification({
        propertyId: PROPERTY as string,
        type,
        category: rowCategory,
        resourceType: 'inbox_item',
        resourceId: 'item-1',
        payload: { propertyName: 'Riverside Hotel' },
      }),
    )
  }

  it('is sent when the row is Low ratings in the app and the email was admitted as New reviews', async () => {
    // New reviews email on at once, Low ratings left at 3 stars in the app and
    // 2 by email: a 3-star review is low in the app only.
    filed('review.created', 'low_ratings', 'arrivals')

    await run()

    expect(deps.emailRepo.markSuppressed).not.toHaveBeenCalled()
    expect(deps.emailSender.send).toHaveBeenCalledOnce()
  })

  it('is sent when the row is New reviews in the app and the email was admitted as Low ratings', async () => {
    // The mirror: a Low ratings threshold of 1 in the app, 2 by email.
    filed('review.updated', 'arrivals', 'low_ratings')

    await run()

    expect(deps.emailRepo.markSuppressed).not.toHaveBeenCalled()
    expect(deps.emailSender.send).toHaveBeenCalledOnce()
  })

  it('still suppresses a rated notice whose email sits under an unrelated category', async () => {
    filed('review.created', 'low_ratings', 'urgent_operational')

    await run()

    expect(deps.emailRepo.markSuppressed).toHaveBeenCalledWith(
      entry.id,
      ORG,
      PROPERTY,
      'notification_unavailable',
      NOW,
    )
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('still suppresses a notice that is not rated when its categories differ', async () => {
    // Only the rated types are filed twice; for any other the two must agree.
    filed('reply.publish_failed', 'urgent_operational', 'arrivals')

    await run()

    expect(deps.emailRepo.markSuppressed).toHaveBeenCalledWith(
      entry.id,
      ORG,
      PROPERTY,
      'notification_unavailable',
      NOW,
    )
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })
})
