import { describe, expect, it } from 'vitest'
import { lastMentionedLocalDate } from './guest-voice-v2-recency'
import { review } from './guest-voice-v2.test-fixtures'

describe('recency', () => {
  it('takes the latest member date and null only for no members', () => {
    expect(lastMentionedLocalDate([])).toBeNull()
    expect(
      lastMentionedLocalDate([
        review(1),
        review(1, { localDate: '2026-10-29' }),
        review(2, { localDate: '2026-01-01' }),
      ]),
    ).toBe('2026-10-29')
  })
})
