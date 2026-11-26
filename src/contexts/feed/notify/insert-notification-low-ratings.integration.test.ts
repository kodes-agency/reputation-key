import { beforeEach, describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { SETTLED_EMAIL_REASON } from '../domain/notification-actionable'
import {
  insertNotification,
  type InsertNotificationDeps,
} from './insert-notification.server'
import {
  lowRatings,
  useInsertNotificationHarness,
  type StoredAnswer,
} from './insert-notification.test-fixtures'

const harness = useInsertNotificationHarness({
  orgId: organizationId('org-insert-notification-low'),
  propertyId: propertyId('86100000-0000-4000-8000-000000000002'),
  userId: userId('user-insert-notification-low'),
})
const { input, seed, noticeRows, emailRows, noticeById } = harness
const {
  ids: { orgId: ORG_ID },
} = harness

describe.sequential('insertNotification low ratings (real PostgreSQL)', () => {
  let deps: InsertNotificationDeps
  beforeEach(() => {
    deps = harness.deps
  })

  // ADR 0046, amended 2026-09-30: how low is the reader's, per channel —
  // 3★ or lower in the app and 2★ or lower by email unless they chose.
  describe('a low rating', () => {
    const feedback = (guestRating: number) => ({
      ...input,
      type: 'feedback.created' as const,
      eventId: `feedback-${guestRating}`,
      payload: {
        propertyName: 'Riverside Hotel',
        platform: 'portal' as const,
        guestRating,
      },
    })
    const review = { ...input, type: 'review.created' as const, eventId: 'review-low' }
    const DEFAULT_THRESHOLDS = lowRatings(
      { enabled: true, maxRating: 3 },
      { enabled: true, maxRating: 2 },
    )
    const arrivalsInApp: StoredAnswer = {
      category: 'arrivals',
      channel: 'in_app',
      enabled: true,
    }

    it('files private feedback rated 1 as Low ratings, in the app and by email', async () => {
      const { notification: result } = await insertNotification(deps)(feedback(1))

      expect(result).toMatchObject({
        category: 'low_ratings',
        title: 'Low-rated guest feedback at Riverside Hotel',
      })
      expect(result?.payload).toMatchObject({ lowRating: true, guestRating: 1 })
      expect(await emailRows()).toHaveLength(1)
    })

    it('tells about 3-star feedback in the app only, since email is 2 stars or lower by default', async () => {
      const { notification: result } = await insertNotification(deps)(feedback(3))

      expect(result).toMatchObject({ category: 'low_ratings' })
      // Above the email threshold, the reader's New reviews answer stands:
      // off by default.
      expect(await emailRows()).toHaveLength(0)
    })

    it('files feedback above both thresholds as an arrival, off by default', async () => {
      await expect(insertNotification(deps)(feedback(4))).resolves.toMatchObject({
        notification: null,
      })

      expect(await noticeRows()).toHaveLength(0)
    })

    it("routes a Google review by Review's eligible rating and keeps only the outcome", async () => {
      vi.mocked(deps.ratingForRouting).mockResolvedValue(2)

      const { notification: result } = await insertNotification(deps)(review)

      expect(deps.ratingForRouting).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        inboxItemId: 'item-1',
      })
      expect(result).toMatchObject({
        category: 'low_ratings',
        title: 'Low-rated review at Riverside Hotel',
      })
      // The flag, never the stars: a Google rating stays in Review (ADR 0031).
      expect(result?.payload).toEqual({
        propertyName: 'Riverside Hotel',
        platform: 'google',
        lowRating: true,
      })
      expect((await noticeRows())[0]?.payload).toEqual(result?.payload)
      expect(JSON.stringify(await emailRows())).not.toContain('"rating"')
    })

    it('stores nothing for a Google review above both thresholds, like any new review', async () => {
      vi.mocked(deps.ratingForRouting).mockResolvedValue(4)

      await expect(insertNotification(deps)(review)).resolves.toMatchObject({
        notification: null,
      })

      expect(await noticeRows()).toHaveLength(0)
    })

    it('routes a review whose rating Review no longer holds as a new review', async () => {
      // Past Google's cache window the eligible read answers null.
      vi.mocked(deps.ratingForRouting).mockResolvedValue(null)

      await expect(insertNotification(deps)(review)).resolves.toMatchObject({
        notification: null,
      })

      expect(await noticeRows()).toHaveLength(0)
    })

    it("follows the reader's own thresholds: off in the app still mails a 1-star review", async () => {
      await seed(
        ...lowRatings({ enabled: false, maxRating: 3 }, { enabled: true, maxRating: 1 }),
      )
      vi.mocked(deps.ratingForRouting).mockResolvedValue(1)

      // Not shown in the app, so nothing comes back to display.
      await expect(insertNotification(deps)(review)).resolves.toMatchObject({
        notification: null,
      })

      expect(await noticeRows()).toEqual([
        expect.objectContaining({
          category: 'low_ratings',
          status: 'read',
          readAt: null,
        }),
      ])
      expect(await emailRows()).toEqual([
        expect.objectContaining({ category: 'low_ratings', cadence: 'immediate' }),
      ])
    })

    // Each channel admits a rated notice under its own category, and the
    // later checks read exactly that one: the feed the row's, the pre-send
    // recheck and the unsubscribe link the email's.
    it('files the row as the arrival its reader shows, and mails it as a low rating', async () => {
      await seed(
        ...lowRatings({ enabled: true, maxRating: 1 }, { enabled: true, maxRating: 3 }),
        arrivalsInApp,
      )
      vi.mocked(deps.ratingForRouting).mockResolvedValue(2)

      const { notification: result } = await insertNotification(deps)(review)

      expect(result).toMatchObject({ category: 'arrivals' })
      expect(result?.payload).not.toHaveProperty('lowRating')
      expect(await emailRows()).toEqual([
        expect.objectContaining({ category: 'low_ratings', cadence: 'immediate' }),
      ])
    })

    it('files the row as a low rating, and mails it under the New reviews answer', async () => {
      await seed(
        ...lowRatings({ enabled: true, maxRating: 3 }, { enabled: true, maxRating: 1 }),
        { category: 'arrivals', channel: 'email', enabled: true, cadence: 'daily' },
      )
      vi.mocked(deps.ratingForRouting).mockResolvedValue(3)

      const { notification: result } = await insertNotification(deps)(review)

      expect(result).toMatchObject({ category: 'low_ratings' })
      expect(await emailRows()).toEqual([
        expect.objectContaining({ category: 'arrivals', cadence: 'daily' }),
      ])
    })

    describe('an edit to a review whose notice still waits', () => {
      const edit = (eventId: string) => ({
        ...review,
        type: 'review.updated' as const,
        eventId,
      })

      it("replaces the waiting row when the edit crosses the reader's threshold", async () => {
        // The first edit, to four stars, is an arrival the reader shows and
        // is mailed.
        await seed(...DEFAULT_THRESHOLDS, arrivalsInApp, {
          category: 'arrivals',
          channel: 'email',
          enabled: true,
          cadence: 'daily',
        })
        vi.mocked(deps.ratingForRouting).mockResolvedValue(4)
        const waiting = (await insertNotification(deps)(edit('edit-1'))).notification!
        expect(waiting).toMatchObject({ category: 'arrivals' })
        expect(await emailRows()).toEqual([
          expect.objectContaining({ status: 'pending' }),
        ])
        vi.mocked(deps.ratingForRouting).mockResolvedValue(1)

        const { notification: result } = await insertNotification(deps)(edit('edit-2'))

        expect(result).toMatchObject({
          category: 'low_ratings',
          title: 'Review edited to a low rating at Riverside Hotel',
        })
        // Dismissed, not settled: the review still waits for a reply.
        expect(await noticeById(waiting.id)).toMatchObject({
          status: 'dismissed',
          resolvedAt: null,
        })
        const emails = await emailRows()
        expect(emails.find((email) => email.notificationId === waiting.id)).toMatchObject(
          {
            status: 'cancelled',
            suppressionReason: SETTLED_EMAIL_REASON,
          },
        )
        expect(await noticeRows()).toHaveLength(2)
      })

      it('folds an edit that stays on the same side of the threshold', async () => {
        vi.mocked(deps.ratingForRouting).mockResolvedValue(2)
        const waiting = (await insertNotification(deps)(edit('edit-1'))).notification!
        vi.mocked(deps.ratingForRouting).mockResolvedValue(1)

        const { notification: result } = await insertNotification(deps)(edit('edit-2'))

        expect(result).toMatchObject({
          id: waiting.id,
          category: 'low_ratings',
          coalescedCount: 2,
        })
        expect(await noticeRows()).toEqual([
          expect.objectContaining({ id: waiting.id, status: 'unread' }),
        ])
      })
    })

    it('is not low for a reader whose thresholds are lower than the rating', async () => {
      await seed(
        ...lowRatings({ enabled: true, maxRating: 1 }, { enabled: true, maxRating: 1 }),
      )
      vi.mocked(deps.ratingForRouting).mockResolvedValue(2)

      await expect(insertNotification(deps)(review)).resolves.toMatchObject({
        notification: null,
      })
    })

    it('does not look for a rating on a notice that has none', async () => {
      await insertNotification(deps)(input)

      expect(deps.ratingForRouting).not.toHaveBeenCalled()
    })
  })

  // ── Channel reads on a lent transaction ─────────────────────────────

  describe('channel reads on a lent transaction', () => {
    it.each(['inbox_note.added', 'feedback.created'] as const)(
      'resolves %s without overlapping preference reads',
      async (type) => {
        const query = harness.held.client.query.bind(harness.held.client) as (
          ...args: unknown[]
        ) => Promise<unknown>
        let active = 0
        let peak = 0
        let reads = 0
        const spy = vi.spyOn(harness.held.client, 'query').mockImplementation(((
          ...args: unknown[]
        ) => {
          const first = args[0]
          const text =
            typeof first === 'string' ? first : ((first as { text?: string }).text ?? '')
          if (/notification_(preferences|category_defaults)/.test(text)) reads++
          active++
          peak = Math.max(peak, active)
          return query(...args).finally(() => {
            active--
          })
        }) as never)

        try {
          const { notification: notice } = await insertNotification(deps)({
            ...input,
            type,
            payload: {
              propertyName: 'Hotel',
              platform: type === 'feedback.created' ? 'portal' : 'google',
              guestRating: 1,
            },
          })

          expect(notice).toMatchObject({
            category:
              type === 'feedback.created' ? 'low_ratings' : 'workflow_collaboration',
          })
        } finally {
          spy.mockRestore()
        }
        expect(reads).toBeGreaterThan(1)
        expect(peak).toBe(1)
      },
    )
  })
})
