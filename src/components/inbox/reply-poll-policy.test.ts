import { describe, expect, it } from 'vitest'
import {
  replyRefetchInterval,
  REPLY_POLL_INTERVAL_MS,
  REPLY_POLL_MAX_AGE_MS,
} from './inbox-cache-policy'

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
