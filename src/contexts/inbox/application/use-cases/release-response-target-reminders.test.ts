import { describe, expect, it, vi } from 'vitest'
import { inboxItemId, organizationId, propertyId } from '#/shared/domain/ids'
import type { GoogleReviewCheckOutcome } from '../ports/google-review-check.port'
import type { GoogleReplyHead } from '../ports/reply-lookup.port'
import type {
  DueReminderCandidate,
  ReminderSlotReleaseResult,
} from '../ports/response-target.store'
import {
  RESPONSE_TARGET_REMINDER_GOOGLE_READ_CAP,
  RESPONSE_TARGET_REMINDER_RELEASE_LIMIT,
  RESPONSE_TARGET_REMINDER_TICK_BUDGET_MS,
  releaseDueResponseTargetReminders,
} from './release-response-target-reminders'

const MINUTE = 60_000
const START = new Date('2026-09-01T08:00:00.000Z')
const DUE = new Date('2026-09-03T08:00:00.000Z')
const ORG = organizationId('org-reminder-precheck')
const OTHER_ORG = organizationId('org-reminder-precheck-other')
const PROPERTY = propertyId('78000000-0000-4000-8000-0000000000a1')
const REVIEW_REVISION = 4

const itemId = (n: number) =>
  inboxItemId(`78000000-0000-4000-8000-${String(n).padStart(12, '0')}`)
const reviewIdFor = (n: number) =>
  `79000000-0000-4000-8000-${String(n).padStart(12, '0')}` as GoogleReplyHead['reviewId']

const candidate = (
  n: number,
  overrides: Partial<DueReminderCandidate> = {},
): DueReminderCandidate => ({
  key: { inboxItemId: itemId(n), cycleNumber: 1, reminderKind: 'target_passed' },
  organizationId: ORG,
  propertyId: PROPERTY,
  targetKind: 'google_review_response',
  scheduledFor: DUE,
  targetStartAt: START,
  targetDueAt: DUE,
  sourceId: reviewIdFor(n),
  sourceRevision: REVIEW_REVISION,
  ...overrides,
})

const answeringHead = (n: number, overrides: Partial<GoogleReplyHead> = {}) =>
  ({
    reviewId: reviewIdFor(n),
    propertyId: PROPERTY,
    observationRevision: 2,
    sourceEpoch: 1,
    materialReviewRevision: REVIEW_REVISION,
    state: 'live',
    change: 'added',
    resolution: 'external_current_live',
    provenance: 'external_or_unknown',
    matchedReplyId: null,
    matchedPublicationCycle: null,
    observedAt: new Date(START.getTime() + 60 * MINUTE),
    ...overrides,
  }) satisfies GoogleReplyHead

type Harness = ReturnType<typeof setup>

function setup(
  input: Readonly<{
    candidates: ReadonlyArray<DueReminderCandidate>
    now?: Date
    heads?: ReadonlyArray<GoogleReplyHead>
    /** Per review number: what the Google read does. Default: read ok. */
    check?: (n: number, harness: Harness) => Promise<GoogleReviewCheckOutcome>
    release?: (key: DueReminderCandidate['key']) => Promise<ReminderSlotReleaseResult>
    /** How far one Google read moves the clock. */
    readTakesMs?: number
  }>,
) {
  let current = input.now ?? new Date(DUE.getTime() + MINUTE)
  const heads = new Map<string, GoogleReplyHead>(
    (input.heads ?? []).map((head) => [String(head.reviewId), head]),
  )
  const calls: string[] = []
  const listDueReminderCandidates = vi.fn(async () => input.candidates)
  const releaseReminderSlot = vi.fn(
    async ({ key }: { key: DueReminderCandidate['key'] }) => {
      calls.push(`release:${key.inboxItemId.slice(-4)}`)
      return (await input.release?.(key)) ?? ('released' as const)
    },
  )
  const getGoogleReplyHeadsByReviewIds = vi.fn(
    async (ids: ReadonlyArray<string>, orgId: string) => {
      calls.push(`heads:${orgId}:${ids.length}`)
      return new Map(ids.flatMap((id) => (heads.has(id) ? [[id, heads.get(id)!]] : [])))
    },
  )
  const check = vi.fn(async (request: { reviewId: string }) => {
    const n = Number(request.reviewId.slice(-12))
    calls.push(`check:${n}`)
    current = new Date(current.getTime() + (input.readTakesMs ?? 0))
    return (await input.check?.(n, harness)) ?? ({ status: 'read' } as const)
  })
  const warn = vi.fn()
  const run = releaseDueResponseTargetReminders({
    logger: { warn },
    targetStore: { listDueReminderCandidates, releaseReminderSlot },
    replyLookup: { getGoogleReplyHeadsByReviewIds },
    googleReviewCheck: { check },
    clock: () => current,
  })
  const harness = {
    run,
    calls,
    heads,
    listDueReminderCandidates,
    releaseReminderSlot,
    getGoogleReplyHeadsByReviewIds,
    check,
    warn,
    setNow: (next: Date) => {
      current = next
    },
    now: () => current,
  }
  return harness
}

const released = (harness: Harness) =>
  harness.releaseReminderSlot.mock.calls.map(([{ key }]) =>
    Number(key.inboxItemId.slice(-4)),
  )

describe('releaseDueResponseTargetReminders', () => {
  it('lists the due slots once, bounded, with no lock held while Google is read', async () => {
    const h = setup({ candidates: [] })

    await expect(h.run()).resolves.toEqual({
      released: 0,
      checked: 0,
      heldLocal: 0,
      heldAfterRead: 0,
      deferred: 0,
      unavailable: 0,
      skippedNoProvider: 0,
      failed: 0,
    })

    expect(h.listDueReminderCandidates).toHaveBeenCalledTimes(1)
    expect(h.listDueReminderCandidates).toHaveBeenCalledWith({
      now: h.now(),
      limit: RESPONSE_TARGET_REMINDER_RELEASE_LIMIT,
    })
    expect(RESPONSE_TARGET_REMINDER_RELEASE_LIMIT).toBe(100)
    expect(RESPONSE_TARGET_REMINDER_GOOGLE_READ_CAP).toBe(20)
    expect(RESPONSE_TARGET_REMINDER_TICK_BUDGET_MS).toBe(35_000)
  })

  describe('which slots are checked', () => {
    it('releases private feedback and superseded halfway slots before any Google read, even when Google fails', async () => {
      const h = setup({
        candidates: [
          candidate(1),
          candidate(2, { targetKind: 'private_feedback_handling' }),
          candidate(3, {
            key: { inboxItemId: itemId(3), cycleNumber: 1, reminderKind: 'halfway' },
            scheduledFor: new Date(DUE.getTime() - 24 * 60 * MINUTE),
          }),
        ],
        check: async () => {
          throw new Error('Google timed out')
        },
      })

      const result = await h.run()

      expect(h.calls.filter((call) => call.startsWith('release')).slice(0, 2)).toEqual([
        'release:0002',
        'release:0003',
      ])
      expect(h.calls.indexOf('check:1')).toBeGreaterThan(h.calls.indexOf('release:0003'))
      expect(result).toMatchObject({
        released: 2,
        checked: 1,
        unavailable: 1,
        deferred: 1,
      })
      expect(h.check).toHaveBeenCalledTimes(1)
      expect(h.check).toHaveBeenCalledWith({
        organizationId: ORG,
        propertyId: PROPERTY,
        reviewId: reviewIdFor(1),
      })
    })

    it('never reads Google for a private feedback slot, whatever head exists', async () => {
      const h = setup({
        candidates: [candidate(1, { targetKind: 'private_feedback_handling' })],
        heads: [answeringHead(1)],
      })

      await h.run()

      expect(h.check).not.toHaveBeenCalled()
      expect(released(h)).toEqual([1])
    })
  })

  describe('holding', () => {
    it('holds without a Google read when Review already shows the answering reply', async () => {
      const h = setup({ candidates: [candidate(1)], heads: [answeringHead(1)] })

      const result = await h.run()

      expect(h.check).not.toHaveBeenCalled()
      expect(h.releaseReminderSlot).not.toHaveBeenCalled()
      expect(result).toMatchObject({ heldLocal: 1, checked: 0, released: 0 })
    })

    it('holds after a read that shows an answering reply, and writes nothing', async () => {
      const h = setup({
        candidates: [candidate(1)],
        check: async (n, harness) => {
          harness.heads.set(String(reviewIdFor(n)), answeringHead(n))
          return { status: 'read' }
        },
      })

      const result = await h.run()

      expect(h.releaseReminderSlot).not.toHaveBeenCalled()
      expect(result).toMatchObject({ checked: 1, heldAfterRead: 1, released: 0 })
    })

    it('releases after a read that shows no reply', async () => {
      const h = setup({ candidates: [candidate(1)] })

      const result = await h.run()

      expect(released(h)).toEqual([1])
      expect(result).toMatchObject({ checked: 1, released: 1, heldAfterRead: 0 })
    })

    it('reads Google again and releases when the live reply predates the target start', async () => {
      const staleHead = answeringHead(1, {
        observedAt: new Date(START.getTime() - MINUTE),
      })
      const h = setup({ candidates: [candidate(1)], heads: [staleHead] })

      const result = await h.run()

      expect(h.check).toHaveBeenCalledTimes(1)
      expect(released(h)).toEqual([1])
      expect(result).toMatchObject({ checked: 1, released: 1 })
    })

    it('releases when the read moved the review to a new material revision', async () => {
      const h = setup({
        candidates: [candidate(1)],
        check: async (n, harness) => {
          harness.heads.set(
            String(reviewIdFor(n)),
            answeringHead(n, { materialReviewRevision: REVIEW_REVISION + 1 }),
          )
          return { status: 'read' }
        },
      })

      await h.run()

      expect(released(h)).toEqual([1])
    })

    it('releases when Google shows a reply that cannot be read', async () => {
      const h = setup({
        candidates: [candidate(1)],
        check: async () => ({ status: 'reply_unreadable' }),
      })

      await h.run()

      expect(released(h)).toEqual([1])
    })
  })

  describe('failures and the fifteen minute cap', () => {
    const failing = (outcome: GoogleReviewCheckOutcome) => async () => outcome

    it('leaves a slot pending, writing nothing, while a transient failure is within 15 minutes of scheduled_for', async () => {
      const h = setup({
        candidates: [candidate(1)],
        now: new Date(DUE.getTime() + 5 * MINUTE),
        check: failing({ status: 'unavailable', retry: 'later' }),
      })

      const result = await h.run()

      expect(h.releaseReminderSlot).not.toHaveBeenCalled()
      expect(result).toMatchObject({
        checked: 1,
        unavailable: 1,
        deferred: 1,
        released: 0,
      })
    })

    it('releases a transient failure once 15 minutes have passed since scheduled_for', async () => {
      const h = setup({
        candidates: [candidate(1)],
        now: new Date(DUE.getTime() + 15 * MINUTE),
        check: failing({ status: 'unavailable', retry: 'later' }),
      })

      const result = await h.run()

      expect(released(h)).toEqual([1])
      expect(result).toMatchObject({ unavailable: 1, deferred: 0, released: 1 })
    })

    it('reads a slot found far past the cap once and releases it at once when the read fails', async () => {
      const h = setup({
        candidates: [candidate(1)],
        now: new Date(DUE.getTime() + 6 * 60 * MINUTE),
        check: failing({ status: 'unavailable', retry: 'later' }),
      })

      await h.run()

      expect(h.check).toHaveBeenCalledTimes(1)
      expect(released(h)).toEqual([1])
    })

    it('defers a 404 for the review like any transient failure', async () => {
      const h = setup({
        candidates: [candidate(1)],
        check: failing({ status: 'review_missing' }),
      })

      const result = await h.run()

      expect(h.releaseReminderSlot).not.toHaveBeenCalled()
      expect(result).toMatchObject({ deferred: 1 })
    })

    it('releases at once, with no wait, when the provider refuses permanently', async () => {
      const h = setup({
        candidates: [candidate(1)],
        check: failing({ status: 'unavailable', retry: 'never' }),
      })

      const result = await h.run()

      expect(released(h)).toEqual([1])
      expect(result).toMatchObject({ unavailable: 1, deferred: 0, released: 1 })
    })

    it.each([
      'content_expired',
      'review_unavailable',
      'capability_off',
      'property_not_bound',
    ] as const)(
      'releases at once when the review is not checkable (%s)',
      async (reason) => {
        const h = setup({
          candidates: [candidate(1)],
          check: failing({ status: 'not_checkable', reason }),
        })

        const result = await h.run()

        expect(released(h)).toEqual([1])
        expect(result).toMatchObject({ released: 1, skippedNoProvider: 0 })
      },
    )

    it('counts a missing Google provider and keeps the old timing', async () => {
      const h = setup({
        candidates: [candidate(1)],
        check: failing({ status: 'not_checkable', reason: 'no_provider' }),
      })

      const result = await h.run()

      expect(released(h)).toEqual([1])
      expect(result).toMatchObject({ skippedNoProvider: 1, released: 1, unavailable: 0 })
    })

    it('treats a check that throws as a transient failure', async () => {
      const h = setup({
        candidates: [candidate(1)],
        check: async () => {
          throw new Error('socket hang up')
        },
      })

      const result = await h.run()

      expect(h.releaseReminderSlot).not.toHaveBeenCalled()
      expect(result).toMatchObject({ unavailable: 1, deferred: 1 })
    })
  })

  describe('limits', () => {
    const many = (count: number, overrides: Partial<DueReminderCandidate> = {}) =>
      Array.from({ length: count }, (_, i) => candidate(i + 1, overrides))

    it('reads at most 20 reviews per tick and leaves the rest pending for the next tick', async () => {
      const h = setup({ candidates: many(25) })

      const result = await h.run()

      expect(h.check).toHaveBeenCalledTimes(20)
      expect(released(h)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
      expect(result).toMatchObject({ checked: 20, released: 20, deferred: 5 })
    })

    it('defers a slot past the read cap even when it is already over 15 minutes late', async () => {
      const late = (n: number) =>
        candidate(n, { scheduledFor: new Date(DUE.getTime() - 20 * MINUTE) })
      const h = setup({
        candidates: [...many(20), late(21)],
        now: new Date(DUE.getTime() + MINUTE),
      })

      const result = await h.run()

      expect(h.check).toHaveBeenCalledTimes(20)
      expect(released(h)).not.toContain(21)
      expect(result).toMatchObject({ checked: 20, released: 20, deferred: 1 })
    })

    it('reads a deferred backlog slot on the next tick, then releases it if the read fails', async () => {
      const late = (n: number) =>
        candidate(n, { scheduledFor: new Date(DUE.getTime() - 20 * MINUTE) })
      const h = setup({
        candidates: [late(21)],
        check: async () => ({ status: 'unavailable', retry: 'later' }),
      })

      const result = await h.run()

      expect(h.check).toHaveBeenCalledTimes(1)
      expect(released(h)).toEqual([21])
      expect(result).toMatchObject({ checked: 1, unavailable: 1, released: 1 })
    })

    it('spends no read on slots that never reach Google, so 25 of them all release in one tick', async () => {
      const h = setup({
        candidates: many(25),
        check: async () => ({ status: 'not_checkable', reason: 'no_provider' }),
      })

      const result = await h.run()

      expect(h.check).toHaveBeenCalledTimes(25)
      expect(released(h)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1))
      expect(result).toMatchObject({
        checked: 0,
        skippedNoProvider: 25,
        released: 25,
        deferred: 0,
      })
    })

    it('spends no read on slots whose content cannot be read, so the cap goes to real reads', async () => {
      const h = setup({
        candidates: many(30),
        check: async (n) =>
          n <= 25
            ? { status: 'not_checkable', reason: 'content_expired' }
            : { status: 'read' },
      })

      const result = await h.run()

      expect(released(h)).toHaveLength(30)
      expect(result).toMatchObject({ checked: 5, released: 30, deferred: 0 })
    })

    it('stops reading when the time budget is spent and defers what is left', async () => {
      const h = setup({
        candidates: many(5),
        readTakesMs: 20_000,
      })

      const result = await h.run()

      expect(h.check).toHaveBeenCalledTimes(2)
      expect(result).toMatchObject({ checked: 2, released: 2, deferred: 3 })
    })

    it('still holds from the local head after the read budget is gone', async () => {
      const h = setup({
        candidates: [...many(20), candidate(21)],
        heads: [answeringHead(21)],
      })

      const result = await h.run()

      expect(result).toMatchObject({ checked: 20, heldLocal: 1 })
    })
  })

  describe('failures never abort the pass', () => {
    it('keeps going after a release that throws, and counts it', async () => {
      const h = setup({
        candidates: [candidate(1), candidate(2)],
        release: async (key) => {
          if (key.inboxItemId === itemId(1)) throw new Error('deadlock detected')
          return 'released'
        },
      })

      const result = await h.run()

      expect(released(h)).toEqual([1, 2])
      expect(result).toMatchObject({ released: 1, failed: 1 })
    })

    it('does not count a slot another writer already completed as released', async () => {
      const h = setup({
        candidates: [candidate(1), candidate(2)],
        release: async (key) => (key.inboxItemId === itemId(1) ? 'skipped' : 'released'),
      })

      const result = await h.run()

      expect(result).toMatchObject({ released: 1, failed: 0 })
    })

    it('does not count a cancelled superseded halfway as released', async () => {
      const h = setup({
        candidates: [
          candidate(1, {
            key: { inboxItemId: itemId(1), cycleNumber: 1, reminderKind: 'halfway' },
          }),
        ],
        release: async () => 'cancelled_superseded',
      })

      const result = await h.run()

      expect(h.check).not.toHaveBeenCalled()
      expect(result).toMatchObject({ released: 0 })
    })

    it('leaves a slot pending when its reply head cannot be read, and goes on', async () => {
      const h = setup({
        candidates: [candidate(1, { organizationId: OTHER_ORG }), candidate(2)],
      })
      h.getGoogleReplyHeadsByReviewIds.mockImplementation(
        async (ids: ReadonlyArray<string>, orgId: string) => {
          if (orgId === OTHER_ORG) throw new Error('replica lagging')
          return new Map(
            ids.flatMap((id) => (h.heads.has(id) ? [[id, h.heads.get(id)!]] : [])),
          )
        },
      )

      const result = await h.run()

      expect(released(h)).toEqual([2])
      expect(result).toMatchObject({ released: 1, failed: 1 })
      expect(h.warn).toHaveBeenCalledWith(
        { stage: 'heads', errorName: 'Error' },
        expect.any(String),
      )
    })

    it('releases a slot whose reply heads cannot be read once it is 15 minutes late', async () => {
      const h = setup({
        candidates: [
          candidate(1, {
            organizationId: OTHER_ORG,
            scheduledFor: new Date(DUE.getTime() - 20 * MINUTE),
          }),
        ],
      })
      h.getGoogleReplyHeadsByReviewIds.mockRejectedValue(new Error('replica lagging'))

      const result = await h.run()

      expect(h.check).not.toHaveBeenCalled()
      expect(released(h)).toEqual([1])
      expect(result).toMatchObject({ released: 1, deferred: 0 })
    })

    it('leaves a slot pending while the head lookup after a read fails within 15 minutes', async () => {
      const h = setup({ candidates: [candidate(1)] })
      h.getGoogleReplyHeadsByReviewIds.mockImplementation(async () => {
        if (h.check.mock.calls.length > 0) throw new Error('replica lagging')
        return new Map()
      })

      const result = await h.run()

      expect(h.releaseReminderSlot).not.toHaveBeenCalled()
      expect(result).toMatchObject({ checked: 1, failed: 1, released: 0 })
    })

    it('releases a slot whose head lookup after a read fails once 15 minutes have passed', async () => {
      const h = setup({
        candidates: [
          candidate(1, { scheduledFor: new Date(DUE.getTime() - 20 * MINUTE) }),
        ],
      })
      h.getGoogleReplyHeadsByReviewIds.mockImplementation(async () => {
        if (h.check.mock.calls.length > 0) throw new Error('replica lagging')
        return new Map()
      })

      const result = await h.run()

      expect(released(h)).toEqual([1])
      expect(result).toMatchObject({ checked: 1, released: 1 })
    })
  })

  it('looks the heads up once per Organization for the whole batch', async () => {
    const h = setup({
      candidates: [
        candidate(1),
        candidate(2),
        candidate(3, { organizationId: OTHER_ORG }),
      ],
    })

    await h.run()

    const lookups = h.calls.filter((call) => call.startsWith('heads:')).slice(0, 2)
    expect(lookups).toEqual([`heads:${ORG}:2`, `heads:${OTHER_ORG}:1`])
  })
})
