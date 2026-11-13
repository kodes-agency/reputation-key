// A grouped reopen mailed hours after it was written.
//
// The insert job recounted the items that still stood; the send never did.
// A manager whose "5 items reopened" email waited for quiet hours to end was
// told about five items after all five were handled, or five after two.

import { afterEach, describe, expect, it } from 'vitest'
import { organizationId, userId } from '#/shared/domain/ids'
import { type NotificationWorkDecision } from '../../domain/notification-actionable'
import { findNotificationEmailById } from '../../email/notification-email-queue.server'
import { loadItems, type RecipientContext } from './digest-entry-selection'
import {
  NOW,
  ORG,
  PROPERTY,
  USER,
  openSendWorld,
  type SendWorld,
} from './send-emails-test-deps'

const notice = {
  type: 'inbox.bulk_reopened' as const,
  category: 'urgent_operational' as const,
  resourceType: 'inbox_item' as const,
  resourceId: 'item-1',
  payload: { propertyName: 'Riverside Hotel', itemCount: 5 },
}

let world: SendWorld

afterEach(async () => {
  await world.rollBack()
})

const answering = (answer: NotificationWorkDecision) => {
  const deps = world.deps()
  deps.workState.isWaiting.mockResolvedValue(answer)
  deps.workState.isWaitingMany.mockImplementation(async (subjects) =>
    subjects.map(() => answer),
  )
  return deps
}

describe('the immediate email of a grouped reopen', () => {
  it('says how many items still wait when it is sent', async () => {
    world = await openSendWorld({ notice })
    const deps = answering({ itemCount: 2 })

    await world.run(deps)

    expect(deps.emailSender.send.mock.calls[0]![0].subject).toContain('2 items reopened')
  })

  it('is retired once none of them does', async () => {
    world = await openSendWorld({ notice })
    const deps = answering(false)

    await world.run(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(await world.email()).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'work_no_longer_waiting',
    })
  })
})

describe('the digest line of a grouped reopen', () => {
  it('says how many items still wait', async () => {
    world = await openSendWorld({ notice: { ...notice, email: { cadence: 'daily' } } })
    const entry = await findNotificationEmailById(
      world.db,
      world.notice.emailId,
      ORG,
      PROPERTY,
    )
    const ctx = {
      orgId: organizationId(ORG),
      userId: userId(USER),
      rawOrgId: ORG,
      now: NOW,
      timezone: 'UTC',
      timezoneSource: 'fallback',
      quietHours: { quietHoursStart: null, quietHoursEnd: null },
    } as unknown as RecipientContext

    const [item] = await loadItems(answering({ itemCount: 3 }), ctx, [entry!])

    expect(item!.notification.payload).toMatchObject({ itemCount: 3 })
  })
})
