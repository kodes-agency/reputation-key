// The Inbox list and count server functions with reply publication off
// (BETA_CAPABILITIES_OFF=google switches the reply capability off for the whole
// process, so this is a file of its own). Counts and the Open list are still
// served, without reply stages; the stage queues are refused.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'
import { REVIEW_SEED_TABLES } from '#/shared/testing/server-function-review-seeds'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import {
  getInboxItemsFn,
  getInboxPropertyCountsFn,
  getInboxQueueCountsFn,
} from './inbox-queries'

const harness = setupServerFunctionHarness({
  env: { BETA_CAPABILITIES_OFF: 'google' },
  cleanupTables: [...REVIEW_SEED_TABLES],
})

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const property = await harness.seedProperty(organization)
  const plain = await harness.seedReview(property)
  const withReply = await harness.seedReview(property)
  const plainItem = await harness.seedInboxItem({ review: plain })
  const repliedItem = await harness.seedInboxItem({ review: withReply })
  await harness.seedReply(withReply, { status: 'pending_approval' })
  const feedback = await harness.seedInboxItem({ feedback: property })
  return { admin, property, plainItem, repliedItem, feedback }
}

describe('Inbox reads with reply publication off', () => {
  it('serves the queue counts without stages: Open holds every open Review', async () => {
    const { admin, property } = await hotel()

    const counts = await harness.callAs(admin, () =>
      getInboxQueueCountsFn({ data: { propertyId: property.id } }),
    )

    expect(counts).toMatchObject({
      replyStages: false,
      reply: 2,
      approval: null,
      waiting: null,
      feedback: 1,
      open: 3,
    })
  })

  it('serves the reply queue as every open Review, with no stage withheld', async () => {
    const { admin, property, plainItem, repliedItem } = await hotel()

    const page = await harness.callAs(admin, () =>
      getInboxItemsFn({ data: { queue: 'reply', propertyId: property.id } }),
    )

    expect(page.items.map((item) => item.id).sort()).toEqual(
      [plainItem.id, repliedItem.id].sort(),
    )
  })

  it('still serves a queue that depends on no reply', async () => {
    const { admin, feedback } = await hotel()

    const page = await harness.callAs(admin, () =>
      getInboxItemsFn({ data: { queue: 'feedback' } }),
    )

    expect(page.items.map((item) => item.id)).toEqual([feedback.id])
  })

  it.each(['approval', 'waiting'] as const)(
    'refuses the %s queue, which exists only with the stages',
    async (queue) => {
      const { admin, property } = await hotel()

      await expect(
        harness.callAs(admin, () =>
          getInboxItemsFn({ data: { queue, propertyId: property.id } }),
        ),
      ).rejects.toMatchObject({ code: 'capability_disabled', status: 403 })
    },
  )

  it('counts the reply queue per Property without stages', async () => {
    const { admin, property } = await hotel()

    const counts = await harness.callAs(admin, () =>
      getInboxPropertyCountsFn({ data: { queue: 'reply' } }),
    )

    expect(counts).toEqual({
      queue: 'reply',
      total: 2,
      byProperty: { [property.id]: 2 },
    })
  })

  it('refuses a stage queue count per Property', async () => {
    const { admin } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        getInboxPropertyCountsFn({ data: { queue: 'approval' } }),
      ),
    ).rejects.toMatchObject({ code: 'capability_disabled', status: 403 })
  })
})
