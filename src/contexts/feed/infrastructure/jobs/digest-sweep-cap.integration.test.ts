// A sweep that reads as many recipients as its cap allows may have left some
// unread. That used to be silent; at scale it is the first sign that some
// recipients are not being visited in their 08:00 hour.

import { afterEach, describe, expect, it } from 'vitest'
import { notificationEmailQueue } from '#/shared/db/schema'
import { DUE_RECIPIENT_SWEEP_CAP } from '../repositories/notification-due-recipients.query'
import { stableUuid } from './delivery-seed'
import { openDigestWorld, ORG, PROP_A, type DigestWorld } from './digest-job-test-deps'

// 12:00 UTC: outside every UTC recipient's digest window, so a visit is cheap.
const MIDDAY = new Date('2026-07-11T12:00:00.000Z')
const CAP_MESSAGE = 'Digest sweep read as many recipients as its cap allows'
const INSERT_CHUNK = 1_000

let world: DigestWorld

afterEach(async () => {
  await world.rollBack()
})

async function dueRecipients(count: number) {
  world = await openDigestWorld({ entries: false, now: MIDDAY })
  const rows = Array.from({ length: count }, (_, index) => ({
    id: stableUuid('capped-email', String(index)),
    notificationId: stableUuid('capped-notification', String(index)),
    userId: `capped-user-${index}`,
    organizationId: ORG,
    propertyId: PROP_A,
    category: 'recognition',
    cadence: 'daily',
    status: 'pending',
    priority: 'normal',
    idempotencyKey: `capped-${index}`,
    createdAt: new Date(MIDDAY.getTime() - 60 * 60_000),
    updatedAt: new Date(MIDDAY.getTime() - 60 * 60_000),
  }))
  for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
    await world.db
      .insert(notificationEmailQueue)
      .values(rows.slice(start, start + INSERT_CHUNK))
  }
}

describe('the digest sweep recipient cap', () => {
  it('warns when a sweep reads a full cap of recipients', async () => {
    await dueRecipients(DUE_RECIPIENT_SWEEP_CAP)
    const deps = world.deps({ now: MIDDAY })

    await world.run(deps)

    expect(deps.logger.warn).toHaveBeenCalledWith(
      { recipients: DUE_RECIPIENT_SWEEP_CAP, cap: DUE_RECIPIENT_SWEEP_CAP },
      CAP_MESSAGE,
    )
  })

  it('stays quiet below the cap', async () => {
    await dueRecipients(3)
    const deps = world.deps({ now: MIDDAY })

    await world.run(deps)

    expect(deps.logger.warn).not.toHaveBeenCalledWith(expect.anything(), CAP_MESSAGE)
  })
})
