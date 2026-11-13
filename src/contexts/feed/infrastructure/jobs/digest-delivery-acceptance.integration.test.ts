import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { notificationDigestBatchMembers } from '#/shared/db/schema'
import { seedPropertyPreference, seedUserSettings } from './delivery-seed'
import { freezeBatchAtFirstSweep } from './digest-retry-seed'
import {
  HOUR,
  NOW,
  openDigestWorld,
  ORG,
  PROP_A,
  PROP_B,
  USER,
  type DigestWorld,
} from './digest-job-test-deps'

let world: DigestWorld

afterEach(async () => {
  await world.rollBack()
})

describe('daily digest delivery acceptance', () => {
  beforeEach(async () => {
    world = await openDigestWorld()
  })

  it('sends only opted-in Property lines and freezes only those members', async () => {
    await seedPropertyPreference(world.db, {
      userId: USER,
      organizationId: ORG,
      propertyId: PROP_B,
      category: 'recognition',
      enabled: false,
      cadence: 'daily',
    })
    const deps = world.deps()

    await world.run(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
    const sent = deps.emailSender.send.mock.calls[0]![0]
    expect(sent.html).toContain('Riverside')
    expect(sent.text).toContain('Riverside')
    expect(sent.html).not.toContain('Hillcrest')
    expect(sent.text).not.toContain('Hillcrest')
    const [batch] = await world.batches()
    const members = await world.db
      .select()
      .from(notificationDigestBatchMembers)
      .where(eq(notificationDigestBatchMembers.batchId, batch!.id))
    expect(members.map((member) => member.notificationEmailId)).toEqual([
      world.entries[0]!.emailId,
    ])
    expect(await world.email(world.entries[1]!)).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'preference_disabled',
    })
  })
})

describe('a quiet-hours digest across a daylight-saving change', () => {
  it.each([
    ['spring forward', '2026-03-08T06:30:00.000Z', '03:30', '2026-03-08T07:30:00.000Z'],
    ['fall back', '2026-11-01T05:30:00.000Z', '02:30', '2026-11-01T07:30:00.000Z'],
  ])(
    'releases it at its local end across %s',
    async (_shift, heldAt, quietHoursEnd, releasedAt) => {
      world = await openDigestWorld({
        entries: false,
        userTimezone: null,
        now: new Date(heldAt),
      })
      await seedUserSettings(world.db, {
        userId: USER,
        organizationId: ORG,
        timezone: 'America/New_York',
        quietHoursStart: '22:00',
        quietHoursEnd,
      })
      const entry = await world.entry({
        property: PROP_A,
        status: 'delayed',
        createdAt: new Date(new Date(heldAt).getTime() - 60 * 60_000),
      })

      const held = world.deps({ now: new Date(heldAt) })
      await world.run(held)

      expect(held.emailSender.send).not.toHaveBeenCalled()
      expect(await world.email(entry)).toMatchObject({
        status: 'delayed',
        notBefore: new Date(releasedAt),
      })

      const released = world.deps({ now: new Date(releasedAt) })
      await world.run(released)

      expect(released.emailSender.send).toHaveBeenCalledTimes(1)
      expect(await world.email(entry)).toMatchObject({ status: 'accepted' })
    },
  )
})

describe('retrying a frozen digest', () => {
  beforeEach(async () => {
    world = await openDigestWorld()
  })

  it('retries every frozen request field and key without rendering again', async () => {
    const { batch, firstRequest } = await freezeBatchAtFirstSweep(world)
    // The hourly retry: the first sweep's backoff has passed.
    const retry = world.deps({ now: new Date(NOW.getTime() + HOUR) })
    retry.userLookup.getName.mockRejectedValue(new Error('display name unavailable'))

    await world.run(retry)

    expect(retry.emailSender.send).toHaveBeenCalledExactlyOnceWith({
      ...firstRequest,
      idempotencyKey: batch.providerIdempotencyKey,
    })
    expect(retry.userLookup.getName).not.toHaveBeenCalled()
    expect(await world.batches()).toHaveLength(1)
  })
})
