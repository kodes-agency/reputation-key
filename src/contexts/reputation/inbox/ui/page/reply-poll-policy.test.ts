import { describe, expect, it } from 'vitest'
import {
  replyRefetchInterval,
  inboxListPagesRefetchInterval,
  inboxListReplyRefetchInterval,
  isReplyPolled,
  INBOX_LIST_REPLY_POLL_INTERVAL_MS,
  REPLY_POLL_INTERVAL_MS,
  REPLY_POLL_MAX_AGE_MS,
  UNCERTAIN_REPLY_LIST_DUE_SLACK_MS,
  UNCERTAIN_REPLY_POLL_INTERVAL_MS,
} from './inbox-cache-policy'
import type { InboxItemReplyState } from '#/contexts/inbox/application/public-api'

describe('replyRefetchInterval', () => {
  const nowMs = Date.parse('2025-06-01T12:30:00.000Z')
  const stillFresh = new Date(nowMs - REPLY_POLL_MAX_AGE_MS + 1)

  it.each(['requested', 'authorized', 'sending', 'pending_observation'])(
    'polls fresh %s work while a background owner can still advance it',
    (publicationState) => {
      expect(
        replyRefetchInterval(
          { status: 'approved', publicationState, updatedAt: stillFresh },
          nowMs,
        ),
      ).toBe(REPLY_POLL_INTERVAL_MS)
    },
  )

  it('stops at the 30-minute browser polling ceiling', () => {
    expect(
      replyRefetchInterval(
        {
          status: 'approved',
          publicationState: 'sending',
          updatedAt: new Date(nowMs - REPLY_POLL_MAX_AGE_MS),
        },
        nowMs,
      ),
    ).toBe(false)
  })

  it.each(['published', 'terminal', 'ambiguous', 'cancelled'])(
    'stops when publication state is %s',
    (publicationState) => {
      expect(
        replyRefetchInterval(
          { status: 'approved', publicationState, updatedAt: stillFresh },
          nowMs,
        ),
      ).toBe(false)
    },
  )

  it('does not poll without a reply or a valid publication timestamp', () => {
    expect(replyRefetchInterval(undefined, nowMs)).toBe(false)
    expect(replyRefetchInterval(null, nowMs)).toBe(false)
    expect(
      replyRefetchInterval(
        {
          status: 'approved',
          publicationState: 'authorized',
          updatedAt: 'not-a-date',
        },
        nowMs,
      ),
    ).toBe(false)
  })
})

describe('inboxListReplyRefetchInterval', () => {
  const nowMs = Date.parse('2025-06-01T12:30:00.000Z')
  const row = (replyState: InboxItemReplyState) => ({ replyState })

  it('polls while a loaded row is awaiting Google observation within the age bound', () => {
    expect(
      inboxListReplyRefetchInterval(
        [
          row({
            status: 'approved',
            publicationState: 'pending_observation',
            publicationLastErrorClass: null,
            reconcileDueAt: null,
            updatedAt: new Date(nowMs - REPLY_POLL_MAX_AGE_MS + 1),
          }),
        ],
        nowMs,
      ),
    ).toBe(INBOX_LIST_REPLY_POLL_INTERVAL_MS)
  })

  it('stops once the loaded in-flight row reaches the age bound', () => {
    expect(
      inboxListReplyRefetchInterval(
        [
          row({
            status: 'approved',
            publicationState: 'pending_observation',
            publicationLastErrorClass: null,
            reconcileDueAt: null,
            updatedAt: new Date(nowMs - REPLY_POLL_MAX_AGE_MS),
          }),
        ],
        nowMs,
      ),
    ).toBe(false)
  })

  it('does not let pending approval drive background polling', () => {
    expect(
      inboxListReplyRefetchInterval(
        [
          row({
            status: 'pending_approval',
            publicationState: 'pending_observation',
            publicationLastErrorClass: null,
            reconcileDueAt: null,
            updatedAt: new Date(nowMs - 1),
          }),
        ],
        nowMs,
      ),
    ).toBe(false)
  })

  it('does not poll when no loaded row is in flight', () => {
    expect(inboxListReplyRefetchInterval([], nowMs)).toBe(false)
    expect(
      inboxListReplyRefetchInterval(
        [
          row({
            status: 'publish_failed',
            publicationState: 'terminal',
            publicationLastErrorClass: 'retryable',
            reconcileDueAt: null,
            updatedAt: new Date(nowMs - 1),
          }),
        ],
        nowMs,
      ),
    ).toBe(false)
  })
})

describe('uncertain publish polling (D8)', () => {
  const nowMs = Date.parse('2026-09-14T12:30:00.000Z')
  const due = new Date('2026-09-14T13:00:00.000Z')
  // Hours old on purpose: the automatic read ladder runs for up to 72 hours, so
  // the in-flight 30-minute browser ceiling must not stop this cadence.
  const longAgo = new Date(nowMs - 6 * 60 * 60 * 1000)
  const uncertain = (reconcileDueAt: Date | null): InboxItemReplyState => ({
    status: 'publish_failed',
    publicationState: 'ambiguous',
    publicationLastErrorClass: 'ambiguous',
    reconcileDueAt,
    updatedAt: longAgo,
  })

  it('counts a still-checked row as polled for list settlement, without the age ceiling', () => {
    expect(isReplyPolled(uncertain(due))).toBe(true)
    expect(isReplyPolled(uncertain(null))).toBe(false)
    expect(
      isReplyPolled({
        status: 'approved',
        publicationState: 'sending',
        reconcileDueAt: null,
        updatedAt: longAgo,
      }),
    ).toBe(true)
    expect(isReplyPolled(null)).toBe(false)
  })

  it('pins the cadences', () => {
    expect(REPLY_POLL_INTERVAL_MS).toBe(3_000)
    expect(UNCERTAIN_REPLY_POLL_INTERVAL_MS).toBe(60_000)
  })

  it('polls a detail reply every minute while automatic checks continue', () => {
    expect(replyRefetchInterval(uncertain(due), nowMs)).toBe(
      UNCERTAIN_REPLY_POLL_INTERVAL_MS,
    )
  })

  it('stops once automatic checks have stopped or the reply was never sent', () => {
    expect(replyRefetchInterval(uncertain(null), nowMs)).toBe(false)
    expect(
      replyRefetchInterval(
        {
          status: 'publish_failed',
          publicationState: 'terminal',
          reconcileDueAt: null,
          updatedAt: new Date(nowMs - 1),
        },
        nowMs,
      ),
    ).toBe(false)
  })

  it('keeps the in-flight cadence for an approved send with a due time', () => {
    expect(
      replyRefetchInterval(
        {
          status: 'approved',
          publicationState: 'sending',
          reconcileDueAt: due,
          updatedAt: new Date(nowMs - 1),
        },
        nowMs,
      ),
    ).toBe(REPLY_POLL_INTERVAL_MS)
  })

  const inFlight: InboxItemReplyState = {
    status: 'approved',
    publicationState: 'sending',
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    updatedAt: new Date(nowMs - 1),
  }
  const dueIn = (ms: number) => uncertain(new Date(nowMs + ms))

  it('polls the list faster for an in-flight row than for a checked one', () => {
    expect(inboxListReplyRefetchInterval([{ replyState: uncertain(null) }], nowMs)).toBe(
      false,
    )
    expect(
      inboxListReplyRefetchInterval(
        [{ replyState: uncertain(due) }, { replyState: inFlight }],
        nowMs,
      ),
    ).toBe(INBOX_LIST_REPLY_POLL_INTERVAL_MS)
  })

  /**
   * Only the sweep moves a still-checked row, and only at its due time (the
   * ladder's 15 minutes to 72 hours). A list read every minute for 72 hours
   * re-reads every loaded page ~4,300 times to learn nothing, so the list waits
   * for the due time, then reads each minute while the five-minute sweep takes
   * it — and stops once the row is two sweeps overdue, which no read can fix.
   */
  it("reads the list at a checked row's due time rather than every minute", () => {
    const thirtyMinutes = 30 * 60_000
    expect(
      inboxListReplyRefetchInterval([{ replyState: dueIn(thirtyMinutes) }], nowMs),
    ).toBe(thirtyMinutes)
    expect(inboxListReplyRefetchInterval([{ replyState: dueIn(10_000) }], nowMs)).toBe(
      UNCERTAIN_REPLY_POLL_INTERVAL_MS,
    )
    expect(
      inboxListReplyRefetchInterval([{ replyState: dueIn(-5 * 60_000) }], nowMs),
    ).toBe(UNCERTAIN_REPLY_POLL_INTERVAL_MS)
    expect(
      inboxListReplyRefetchInterval(
        [{ replyState: dueIn(-UNCERTAIN_REPLY_LIST_DUE_SLACK_MS - 1) }],
        nowMs,
      ),
    ).toBe(false)
    expect(
      inboxListReplyRefetchInterval(
        [{ replyState: dueIn(thirtyMinutes) }, { replyState: dueIn(2 * 60_000) }],
        nowMs,
      ),
    ).toBe(2 * 60_000)
  })

  it('takes the fastest cadence across every loaded page, not the first page that polls', () => {
    const pages = [
      { items: [{ replyState: uncertain(due) }] },
      { items: [{ replyState: inFlight }] },
    ]
    expect(inboxListPagesRefetchInterval(pages, nowMs)).toBe(
      INBOX_LIST_REPLY_POLL_INTERVAL_MS,
    )
    expect(inboxListPagesRefetchInterval([], nowMs)).toBe(false)
    expect(inboxListPagesRefetchInterval(undefined, nowMs)).toBe(false)
  })
})
