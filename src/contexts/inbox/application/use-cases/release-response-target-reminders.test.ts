import { describe, expect, it, vi } from 'vitest'
import {
  releaseDueResponseTargetReminders,
  RESPONSE_TARGET_REMINDER_RELEASE_LIMIT,
} from './release-response-target-reminders'

describe('releaseDueResponseTargetReminders', () => {
  it('uses one clock instant and a fixed bounded batch', async () => {
    const now = new Date('2026-08-28T12:00:00.000Z')
    const clock = vi.fn(() => now)
    const releaseDueReminders = vi.fn(async () => ({ released: 7 }))
    const release = releaseDueResponseTargetReminders({
      targetStore: { releaseDueReminders },
      clock,
    })

    await expect(release()).resolves.toEqual({ released: 7 })
    expect(clock).toHaveBeenCalledTimes(1)
    expect(releaseDueReminders).toHaveBeenCalledWith({
      now,
      limit: RESPONSE_TARGET_REMINDER_RELEASE_LIMIT,
    })
    expect(RESPONSE_TARGET_REMINDER_RELEASE_LIMIT).toBe(100)
  })
})
