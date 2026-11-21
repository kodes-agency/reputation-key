// The Inbox list and count server functions, called as signed-in members over
// PostgreSQL with the real tenant resolution, execution policy and Inbox API,
// with reply publication on. Reply publication off is
// inbox-queries.reply-off.integration.test.ts.

import { describe, expect, it, vi } from 'vitest'
import {
  setupServerFunctionHarness,
  type TestProperty,
} from '#/shared/testing/server-function-harness'
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

const harness = setupServerFunctionHarness({ cleanupTables: [...REVIEW_SEED_TABLES] })

async function hotel(property: { timezone?: string } = {}) {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const hotelProperty = await harness.seedProperty(organization, property)
  await harness.grantProperty(manager, hotelProperty)
  return { organization, admin, manager, property: hotelProperty }
}

/** An open Review item, with the reply the stage names. */
async function reviewItem(
  property: TestProperty,
  options: { reply?: 'pending_approval' | 'approved'; sourceDate?: Date } = {},
) {
  const review = await harness.seedReview(property)
  const item = await harness.seedInboxItem(
    { review },
    options.sourceDate ? { sourceDate: options.sourceDate } : {},
  )
  if (options.reply) await harness.seedReply(review, { status: options.reply })
  return item
}

async function itemsOf(
  caller: Parameters<typeof harness.callAs>[0],
  data: Parameters<typeof getInboxItemsFn>[0]['data'],
) {
  const page = await harness.callAs(caller, () => getInboxItemsFn({ data }))
  return page.items.map((item) => item.id)
}

describe('getInboxQueueCountsFn', () => {
  it('counts each queue of a named Property and says reply stages are on', async () => {
    const { manager, property } = await hotel()
    await reviewItem(property)
    await reviewItem(property, { reply: 'pending_approval' })
    await reviewItem(property, { reply: 'approved' })
    await harness.seedInboxItem({ feedback: property })

    const counts = await harness.callAs(manager, () =>
      getInboxQueueCountsFn({ data: { propertyId: property.id } }),
    )

    expect(counts).toMatchObject({
      replyStages: true,
      reply: 1,
      approval: 1,
      waiting: 1,
      feedback: 1,
      open: 4,
      replied: null,
      closed: null,
    })
  })

  it('refuses a PropertyManager the Property was not granted to', async () => {
    const { organization, property } = await hotel()
    const outsider = await harness.seedMember(organization, 'PropertyManager')

    await expect(
      harness.callAs(outsider, () =>
        getInboxQueueCountsFn({ data: { propertyId: property.id } }),
      ),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const { organization, property } = await hotel()
    const member = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(member, () =>
        getInboxQueueCountsFn({ data: { propertyId: property.id } }),
      ),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
  })

  it('refuses a caller with no session', async () => {
    const { property } = await hotel()

    await expect(
      harness.callAs(null, () =>
        getInboxQueueCountsFn({ data: { propertyId: property.id } }),
      ),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })

  it('counts nothing of another Organization’s Property for its AccountAdmin', async () => {
    const { property } = await hotel()
    await reviewItem(property)
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    const counts = await harness.callAs(otherAdmin, () =>
      getInboxQueueCountsFn({ data: { propertyId: property.id } }),
    )

    expect(counts).toMatchObject({ reply: 0, open: 0, feedback: 0 })
  })
})

describe('getInboxItemsFn: reply queues', () => {
  async function staged() {
    const rows = await hotel()
    const needsReply = await reviewItem(rows.property)
    const awaiting = await reviewItem(rows.property, { reply: 'pending_approval' })
    const waiting = await reviewItem(rows.property, { reply: 'approved' })
    return { ...rows, needsReply, awaiting, waiting }
  }

  it('serves Needs reply without the Reviews that have a reply in flight', async () => {
    const { manager, property, needsReply } = await staged()

    expect(await itemsOf(manager, { queue: 'reply', propertyId: property.id })).toEqual([
      needsReply.id,
    ])
  })

  it('serves the approval and waiting queues with their stages', async () => {
    const { admin, property, awaiting, waiting } = await staged()

    expect(await itemsOf(admin, { queue: 'approval', propertyId: property.id })).toEqual([
      awaiting.id,
    ])
    expect(await itemsOf(admin, { queue: 'waiting', propertyId: property.id })).toEqual([
      waiting.id,
    ])
  })

  it('serves a queue that depends on no reply', async () => {
    const { manager, property } = await staged()
    const feedback = await harness.seedInboxItem({ feedback: property })

    expect(await itemsOf(manager, { queue: 'feedback' })).toEqual([feedback.id])
    expect(await itemsOf(manager, { queue: 'replied' })).toEqual([])
  })

  it('refuses a PropertyManager the Property was not granted to', async () => {
    const { organization, property } = await staged()
    const outsider = await harness.seedMember(organization, 'PropertyManager')

    await expect(
      harness.callAs(outsider, () =>
        getInboxItemsFn({ data: { queue: 'approval', propertyId: property.id } }),
      ),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const { organization } = await staged()
    const member = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(member, () => getInboxItemsFn({ data: { queue: 'reply' } })),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
  })

  it('refuses a caller with no session', async () => {
    await expect(
      harness.callAs(null, () => getInboxItemsFn({ data: {} })),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })

  it('serves an AccountAdmin of another Organization none of these items', async () => {
    await staged()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    expect(await itemsOf(otherAdmin, { queue: 'reply' })).toEqual([])
  })

  it('refuses a queue the Inbox does not have, before reading anything', async () => {
    const { admin } = await staged()

    await expect(
      harness.callAs(admin, () =>
        getInboxItemsFn({ data: { queue: 'everything' as 'reply' } }),
      ),
    ).rejects.toThrow(/queue/)
  })
})

describe('getInboxItemsFn: the days a drill-down was counted over', () => {
  const at = (iso: string) => new Date(iso)

  async function around(property: TestProperty) {
    const beforeStart = await reviewItem(property, {
      sourceDate: at('2026-06-12T20:59:59.000Z'),
    })
    const atStart = await reviewItem(property, {
      sourceDate: at('2026-06-12T21:00:00.000Z'),
    })
    const atEnd = await reviewItem(property, {
      sourceDate: at('2026-09-10T20:59:59.000Z'),
    })
    const afterEnd = await reviewItem(property, {
      sourceDate: at('2026-09-10T21:00:00.000Z'),
    })
    return { beforeStart, atStart, atEnd, afterEnd }
  }

  it('narrows the list to the Property’s own days: Sofia’s 13 June begins at 21:00 UTC on the 12th', async () => {
    const { admin, property } = await hotel({ timezone: 'Europe/Sofia' })
    const { atStart, atEnd } = await around(property)

    const ids = await itemsOf(admin, {
      propertyId: property.id,
      since: '2026-06-13',
      until: '2026-09-10',
      sort: 'oldest',
    })

    expect(ids).toEqual([atStart.id, atEnd.id])
  })

  it('reads the days of a UTC Property in UTC', async () => {
    const { admin, property } = await hotel({ timezone: 'UTC' })
    const { atStart, atEnd, afterEnd } = await around(property)

    const ids = await itemsOf(admin, {
      propertyId: property.id,
      since: '2026-06-13',
      sort: 'oldest',
    })

    expect(ids).toEqual([atEnd.id, afterEnd.id])
    expect(ids).not.toContain(atStart.id)
  })

  it('reads the days in UTC when no Property is named', async () => {
    const { admin, property } = await hotel({ timezone: 'Europe/Sofia' })
    const inside = await reviewItem(property, {
      sourceDate: at('2026-06-13T23:59:59.000Z'),
    })
    await reviewItem(property, { sourceDate: at('2026-06-12T23:59:59.000Z') })
    await reviewItem(property, { sourceDate: at('2026-06-14T00:00:00.000Z') })

    expect(await itemsOf(admin, { since: '2026-06-13', until: '2026-06-13' })).toEqual([
      inside.id,
    ])
  })

  it('bounds nothing when no day is named', async () => {
    const { admin, property } = await hotel({ timezone: 'Europe/Sofia' })
    const { beforeStart, atStart, atEnd, afterEnd } = await around(property)

    const ids = await itemsOf(admin, { propertyId: property.id, sort: 'oldest' })

    expect(ids).toEqual([beforeStart.id, atStart.id, atEnd.id, afterEnd.id])
  })

  it('takes only calendar days', async () => {
    const { admin } = await hotel()

    for (const day of ['last week', '2026-13-45', '20260613', '']) {
      await expect(
        harness.callAs(admin, () => getInboxItemsFn({ data: { since: day } })),
      ).rejects.toThrow(/since/)
      await expect(
        harness.callAs(admin, () => getInboxItemsFn({ data: { until: day } })),
      ).rejects.toThrow(/until/)
    }
  })
})

describe('getInboxPropertyCountsFn', () => {
  it('counts a queue per visible Property and across them', async () => {
    const { organization, admin, property } = await hotel()
    const second = await harness.seedProperty(organization)
    await harness.seedInboxItem({ feedback: property })
    await harness.seedInboxItem({ feedback: property })
    await harness.seedInboxItem({ feedback: second })

    const counts = await harness.callAs(admin, () =>
      getInboxPropertyCountsFn({ data: { queue: 'feedback' } }),
    )

    expect(counts).toEqual({
      queue: 'feedback',
      total: 3,
      byProperty: { [property.id]: 2, [second.id]: 1 },
    })
  })

  it('counts only the Properties a PropertyManager was granted', async () => {
    const { organization, manager, property } = await hotel()
    const ungranted = await harness.seedProperty(organization)
    await harness.seedInboxItem({ feedback: property })
    await harness.seedInboxItem({ feedback: ungranted })

    const counts = await harness.callAs(manager, () =>
      getInboxPropertyCountsFn({ data: { queue: 'feedback' } }),
    )

    expect(counts).toEqual({
      queue: 'feedback',
      total: 1,
      byProperty: { [property.id]: 1 },
    })
  })

  it('counts a reply-stage queue per Property', async () => {
    const { admin, property } = await hotel()
    await reviewItem(property)
    await reviewItem(property, { reply: 'pending_approval' })
    await reviewItem(property, { reply: 'approved' })

    const [reply, approval, waiting] = await Promise.all(
      (['reply', 'approval', 'waiting'] as const).map((queue) =>
        harness.callAs(admin, () => getInboxPropertyCountsFn({ data: { queue } })),
      ),
    )

    expect([reply?.total, approval?.total, waiting?.total]).toEqual([1, 1, 1])
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const { organization } = await hotel()
    const member = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(member, () =>
        getInboxPropertyCountsFn({ data: { queue: 'feedback' } }),
      ),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
  })

  it('refuses a caller with no session', async () => {
    await expect(
      harness.callAs(null, () =>
        getInboxPropertyCountsFn({ data: { queue: 'feedback' } }),
      ),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })

  it('counts nothing of another Organization for its AccountAdmin', async () => {
    const { property } = await hotel()
    await harness.seedInboxItem({ feedback: property })
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    const counts = await harness.callAs(otherAdmin, () =>
      getInboxPropertyCountsFn({ data: { queue: 'feedback' } }),
    )

    expect(counts).toEqual({ queue: 'feedback', total: 0, byProperty: {} })
  })

  it('admits only a known queue at the boundary', async () => {
    const { admin } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        getInboxPropertyCountsFn({ data: { queue: 'everything' as 'reply' } }),
      ),
    ).rejects.toThrow(/queue/)
    await expect(
      harness.callAs(admin, () =>
        getInboxPropertyCountsFn({ data: {} as { queue: 'reply' } }),
      ),
    ).rejects.toThrow(/queue/)
  })
})
