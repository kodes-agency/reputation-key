// A rated notice is filed twice on purpose: the in-app row under the category
// of the channel that shows it, the queued email under the category of the
// channel that sends it. A reader whose Low ratings answer differs by channel
// gets a row and an email under two categories, and the immediate job used to
// read that as a notification that does not belong to its email and suppress
// the mail for good.

import { afterEach, describe, expect, it } from 'vitest'
import { seedPropertyPreference } from './delivery-seed'
import {
  openSendWorld,
  ORG,
  PROPERTY,
  USER,
  type SendWorld,
} from './send-emails-test-deps'
import type {
  NotificationCategory,
  NotificationType,
} from '../../domain/notification-types'

let world: SendWorld

afterEach(async () => {
  await world.rollBack()
})

const filed = async (
  type: NotificationType,
  rowCategory: NotificationCategory,
  emailCategory: NotificationCategory,
) => {
  world = await openSendWorld({
    notice: {
      type,
      category: rowCategory,
      priority: 'normal',
      resourceType: 'inbox_item',
      resourceId: 'item-1',
      payload: { propertyName: 'Riverside Hotel' },
      email: { category: emailCategory, priority: 'normal' },
    },
  })
  // The email's own category is switched on at once, as it was when it was queued.
  await seedPropertyPreference(world.db, {
    userId: USER,
    organizationId: ORG,
    propertyId: PROPERTY,
    category: emailCategory,
    enabled: true,
    cadence: 'immediate',
    ...(emailCategory === 'low_ratings' ? { maxRating: 2 } : {}),
  })
  return world.deps()
}

describe('the immediate email of a rated notice', () => {
  it('is sent when the row is Low ratings in the app and the email was admitted as New reviews', async () => {
    // New reviews email on at once, Low ratings left at 3 stars in the app and
    // 2 by email: a 3-star review is low in the app only.
    const deps = await filed('review.created', 'low_ratings', 'arrivals')

    await world.run(deps)

    expect(await world.email()).toMatchObject({
      status: 'accepted',
      suppressionReason: null,
    })
    expect(deps.emailSender.send).toHaveBeenCalledOnce()
  })

  it('is sent when the row is New reviews in the app and the email was admitted as Low ratings', async () => {
    // The mirror: a Low ratings threshold of 1 in the app, 2 by email.
    const deps = await filed('review.updated', 'arrivals', 'low_ratings')

    await world.run(deps)

    expect(await world.email()).toMatchObject({
      status: 'accepted',
      suppressionReason: null,
    })
    expect(deps.emailSender.send).toHaveBeenCalledOnce()
  })

  it('still suppresses a rated notice whose email sits under an unrelated category', async () => {
    const deps = await filed('review.created', 'low_ratings', 'urgent_operational')

    await world.run(deps)

    expect(await world.email()).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'notification_unavailable',
    })
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('still suppresses a notice that is not rated when its categories differ', async () => {
    // Only the rated types are filed twice; for any other the two must agree.
    const deps = await filed('reply.publish_failed', 'urgent_operational', 'arrivals')

    await world.run(deps)

    expect(await world.email()).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'notification_unavailable',
    })
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })
})
