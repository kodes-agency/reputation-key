import { describe, expect, it } from 'vitest'
import { importItemAdmitsAttempt } from './google-import-item-attempt'
import { GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS } from './ports/google-import-v2-store.port'

describe('importItemAdmitsAttempt', () => {
  it('admits only the first attempt on an item nobody has claimed', () => {
    expect(importItemAdmitsAttempt(0, 1)).toBe(true)
    expect(importItemAdmitsAttempt(0, 0)).toBe(false)
    expect(importItemAdmitsAttempt(0, 2)).toBe(false)
  })

  it('admits the next attempt and the last one again', () => {
    // The last one again is a stalled job BullMQ re-runs: same attemptsMade.
    expect(importItemAdmitsAttempt(2, 3)).toBe(true)
    expect(importItemAdmitsAttempt(2, 2)).toBe(true)
  })

  it('refuses an older attempt and one that skips ahead', () => {
    expect(importItemAdmitsAttempt(2, 1)).toBe(false)
    expect(importItemAdmitsAttempt(2, 4)).toBe(false)
  })

  it('refuses an attempt past the budget, and re-admits the last one within it', () => {
    const last = GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS

    expect(importItemAdmitsAttempt(last, last + 1)).toBe(false)
    expect(importItemAdmitsAttempt(last, last)).toBe(true)
  })
})
