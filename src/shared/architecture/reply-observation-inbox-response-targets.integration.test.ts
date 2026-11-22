import { describe, expect, it, vi } from 'vitest'
import { getDb } from '#/shared/db'
import { createReplyRepository } from '#/contexts/reputation/replies/reply-repository.server'
import { createReplyLookupAdapter } from '#/contexts/reputation/inbox/reply-lookup.adapter.server'
import { createResponseTargetStore } from '#/contexts/reputation/response-targets/store.server'
import { releaseDueResponseTargetReminders } from '#/contexts/reputation/response-targets/release-reminders.server'
import type { InboxItem } from '#/contexts/reputation/domain/inbox-types'
import {
  useReplyObservationSuite,
  ORG,
  ITEM,
  OPENED_AT,
  OBSERVED_AT,
  EVENT_LIVE,
  EVENT_EXTERNAL_EDITED,
  logger,
  seed,
  insertObservation,
  seedDeliveryEvent,
  applyObservation,
  observation,
  reopenMeasured,
  type Observation,
} from '#/contexts/reputation/inbox/reply-observation-inbox.test-fixtures'

describe.sequential('Inbox provider-observation authority (real PostgreSQL)', () => {
  const suite = useReplyObservationSuite()
  const live = observation()

  describe('the Google pre-check on Response Target reminders', () => {
    const TARGET_PASSED_AT = new Date(OPENED_AT.getTime() + 48 * 60 * 60_000)
    const MINUTE = 60_000

    /** The reminder pass over the real store and the real Review head lookup. */
    const reminderTick = (now: Date, check = vi.fn()) => {
      const replies = createReplyRepository(getDb(), () => OBSERVED_AT)
      return releaseDueResponseTargetReminders({
        targetStore: createResponseTargetStore(getDb()),
        replyLookup: createReplyLookupAdapter({
          findCurrentGoogleReplyHeadsByReviewIds:
            replies.findCurrentGoogleReplyHeadsByReviewIds,
        } as unknown as Parameters<typeof createReplyLookupAdapter>[0]),
        googleReviewCheck: { check },
        clock: () => now,
        logger,
      })()
    }

    const reminderFacts = async () =>
      (
        await suite.pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM outbox_events
           WHERE organization_id = $1 AND event_type = 'inbox.response_target.reminder_due'`,
          [ORG],
        )
      ).rows[0]?.n

    it('holds a due reminder for a reply Review already shows; the close that follows cancels the slots and nothing is ever sent', async () => {
      const item = await seed({ measured: true })
      await insertObservation(live)
      const check = vi.fn()

      // The reply is on Google and in Review's head, but the close has not run.
      await expect(reminderTick(TARGET_PASSED_AT, check)).resolves.toMatchObject({
        heldLocal: 1,
        checked: 0,
        released: 0,
      })
      expect(check).not.toHaveBeenCalled()
      expect(await reminderFacts()).toBe(0)

      await seedDeliveryEvent(EVENT_LIVE)
      expect(await applyObservation(item, EVENT_LIVE, live)).toBe('applied')

      const slots = await suite.pool.query(
        `SELECT reminder_kind, delivered_at IS NOT NULL AS delivered, cancelled_at IS NOT NULL AS cancelled
         FROM inbox_response_target_reminders WHERE inbox_item_id = $1 ORDER BY scheduled_for`,
        [ITEM],
      )
      expect(slots.rows).toEqual([
        { reminder_kind: 'halfway', delivered: false, cancelled: true },
        { reminder_kind: 'target_passed', delivered: false, cancelled: true },
      ])
      await expect(
        reminderTick(new Date(TARGET_PASSED_AT.getTime() + 5 * MINUTE), check),
      ).resolves.toMatchObject({ heldLocal: 0, checked: 0, released: 0 })
      expect(await reminderFacts()).toBe(0)
    })

    it('still reminds when no reply is on Google', async () => {
      await seed({ measured: true })
      const check = vi.fn(async () => ({ status: 'read' as const }))

      await expect(reminderTick(TARGET_PASSED_AT, check)).resolves.toMatchObject({
        checked: 1,
        released: 1,
      })
      expect(await reminderFacts()).toBe(1)
    })

    it('still reminds after a manager reopened the item following the reply: the reply is older than the new target', async () => {
      const item = await seed({ measured: true })
      await insertObservation(live)
      await seedDeliveryEvent(EVENT_LIVE)
      expect(await applyObservation(item, EVENT_LIVE, live)).toBe('applied')

      const reopenAt = new Date(OBSERVED_AT.getTime() + 60 * MINUTE)
      await reopenMeasured(reopenAt)
      const check = vi.fn(async () => ({ status: 'read' as const }))
      const targetPassedAt = new Date(reopenAt.getTime() + 48 * 60 * MINUTE)

      await expect(reminderTick(targetPassedAt, check)).resolves.toMatchObject({
        heldLocal: 0,
        checked: 1,
        released: 1,
      })
      expect(await reminderFacts()).toBe(1)
    })
  })

  describe("the Response Target completes at the reply's time on Google", () => {
    const HOUR = 3_600_000
    const FOUR_HOURS = 240
    /** Hours after OPENED_AT (10:00), which is the target's start unless a test moves it. */
    const at = (hours: number) => new Date(OPENED_AT.getTime() + hours * HOUR)
    const EVENT_FIRST = EVENT_LIVE
    const EVENT_SECOND = EVENT_EXTERNAL_EDITED

    const targetRow = async (cycleNumber = 1) =>
      (
        await suite.pool.query(
          `SELECT start_at, due_at, completion_at, result, stop_reason, created_at, updated_at
           FROM inbox_handling_cycle_response_targets
           WHERE inbox_item_id = $1 AND cycle_number = $2`,
          [ITEM, cycleNumber],
        )
      ).rows[0]

    const itemTimes = async () =>
      (
        await suite.pool.query(
          `SELECT status, closed_at, first_reply_published_at FROM inbox_items WHERE id = $1`,
          [ITEM],
        )
      ).rows[0]

    const closeOn = async (
      item: InboxItem,
      observation: Observation,
      eventId: string,
    ) => {
      await insertObservation(observation)
      await seedDeliveryEvent(eventId)
      expect(await applyObservation(item, eventId, observation)).toBe('applied')
    }

    it('counts a reply written 2 hours after the review as on time against a 4 hour target although RepKey read it 7 hours later', async () => {
      const item = await seed({ measured: true, targetMinutes: FOUR_HOURS })
      await closeOn(
        item,
        observation({ providerUpdatedAt: at(2), observedAt: at(9) }),
        EVENT_FIRST,
      )

      expect(await targetRow()).toMatchObject({
        start_at: at(0),
        due_at: at(4),
        completion_at: at(2),
        result: 'on_time',
        stop_reason: 'confirmed_on_google',
        updated_at: at(9),
      })
      expect(await itemTimes()).toMatchObject({
        status: 'closed',
        closed_at: at(9),
        first_reply_published_at: at(2),
      })
    })

    it("counts a reply Google dates after the deadline as late, at Google's time", async () => {
      const item = await seed({ measured: true, targetMinutes: FOUR_HOURS })
      await closeOn(
        item,
        observation({ providerUpdatedAt: at(5), observedAt: at(9) }),
        EVENT_FIRST,
      )

      expect(await targetRow()).toMatchObject({
        completion_at: at(5),
        result: 'late',
      })
    })

    it.each([
      {
        name: 'a Google time before the target started clamps up to the start',
        providerUpdatedAt: at(-1),
        observedAt: at(9),
        expected: at(0),
      },
      {
        name: 'a Google time after RepKey read the reply clamps down to the read',
        providerUpdatedAt: at(12),
        observedAt: at(9),
        expected: at(9),
      },
      {
        name: 'no Google time falls back to the time RepKey read the reply',
        providerUpdatedAt: null,
        observedAt: at(9),
        expected: at(9),
      },
    ])('$name, for both the target and the first reply time', async (row) => {
      const item = await seed({ measured: true, targetMinutes: FOUR_HOURS })
      await closeOn(
        item,
        observation({
          providerUpdatedAt: row.providerUpdatedAt,
          observedAt: row.observedAt,
        }),
        EVENT_FIRST,
      )

      expect((await targetRow()).completion_at).toEqual(row.expected)
      expect((await itemTimes()).first_reply_published_at).toEqual(row.expected)
    })

    it('never moves the completion when the reply is edited on Google afterwards', async () => {
      const item = await seed({ measured: true, targetMinutes: FOUR_HOURS })
      await closeOn(
        item,
        observation({ providerUpdatedAt: at(2), observedAt: at(9) }),
        EVENT_FIRST,
      )
      const before = await targetRow()
      const firstReplyBefore = (await itemTimes()).first_reply_published_at

      await closeOn(
        item,
        observation({
          revision: 2,
          change: 'edited',
          providerUpdatedAt: at(10),
          observedAt: at(12),
        }),
        EVENT_SECOND,
      )

      expect(await targetRow()).toEqual(before)
      expect((await itemTimes()).first_reply_published_at).toEqual(firstReplyBefore)
    })

    it('clamps to the reopen instant when the reply predates a manual reopen that RepKey read after', async () => {
      const item = await seed({ measured: true, targetMinutes: FOUR_HOURS })
      await closeOn(
        item,
        observation({ providerUpdatedAt: at(2), observedAt: at(9) }),
        EVENT_FIRST,
      )
      const reopenAt = at(10)
      await reopenMeasured(reopenAt)

      await closeOn(
        item,
        observation({
          revision: 2,
          change: 'edited',
          providerUpdatedAt: at(9.5),
          observedAt: at(11),
        }),
        EVENT_SECOND,
      )

      expect(await targetRow(2)).toMatchObject({
        start_at: reopenAt,
        completion_at: reopenAt,
        result: 'on_time',
        updated_at: at(11),
      })
      expect((await targetRow(1)).completion_at).toEqual(at(2))
    })

    it('still cancels both pending reminder slots at the read, even when the reply predates the target row', async () => {
      const item = await seed({
        measured: true,
        targetMinutes: FOUR_HOURS,
        sourceCreatedAt: at(-1),
      })
      await closeOn(
        item,
        observation({ providerUpdatedAt: at(-0.5), observedAt: at(9) }),
        EVENT_FIRST,
      )

      const target = await targetRow()
      expect(target.completion_at).toEqual(at(-0.5))
      expect(target.completion_at.getTime()).toBeLessThan(target.created_at.getTime())
      expect(target).toMatchObject({ result: 'on_time', updated_at: at(9) })
      const slots = await suite.pool.query(
        `SELECT reminder_kind, delivered_at, cancelled_at, updated_at
         FROM inbox_response_target_reminders WHERE inbox_item_id = $1 ORDER BY scheduled_for`,
        [ITEM],
      )
      expect(slots.rows).toEqual([
        {
          reminder_kind: 'halfway',
          delivered_at: null,
          cancelled_at: at(9),
          updated_at: at(9),
        },
        {
          reminder_kind: 'target_passed',
          delivered_at: null,
          cancelled_at: at(9),
          updated_at: at(9),
        },
      ])
    })
  })
})
