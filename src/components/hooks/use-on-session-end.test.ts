import { describe, expect, it } from 'vitest'
import { sessionEnded } from './use-on-session-end'

describe('sessionEnded', () => {
  it('is true when a session that was active is gone', () => {
    expect(sessionEnded(true, false)).toBe(true)
  })

  // The client's session state starts empty and is not told about a sign-in the
  // server made. No session yet is not a session that ended.
  it('is false for a session the client never saw', () => {
    expect(sessionEnded(false, false)).toBe(false)
  })

  it('is false while the session is active', () => {
    expect(sessionEnded(true, true)).toBe(false)
  })

  it('is false when the session has just appeared', () => {
    expect(sessionEnded(false, true)).toBe(false)
  })
})
