import { describe, expect, it } from 'vitest'
import {
  CURRENT_RELEASE_POSTURE,
  RELEASE_POSTURES,
  isPostureAtLeast,
  releasePostureRank,
} from './release-posture'

describe('release posture', () => {
  it('orders postures from narrowest audience to widest', () => {
    // Order is load-bearing: every "is this gate armed?" answer is a rank
    // comparison, so reordering this array silently rearms or disarms gates.
    expect(RELEASE_POSTURES).toEqual(['closed-beta', 'open-beta', 'ga'])
  })

  it('ranks a wider audience above a narrower one', () => {
    expect(releasePostureRank('closed-beta')).toBeLessThan(
      releasePostureRank('open-beta'),
    )
    expect(releasePostureRank('open-beta')).toBeLessThan(releasePostureRank('ga'))
  })

  it('treats a posture as at least itself', () => {
    for (const posture of RELEASE_POSTURES) {
      expect(isPostureAtLeast(posture, posture)).toBe(true)
    }
  })

  it('is true only when the actual audience is at least as wide as required', () => {
    expect(isPostureAtLeast('ga', 'closed-beta')).toBe(true)
    expect(isPostureAtLeast('open-beta', 'closed-beta')).toBe(true)
    expect(isPostureAtLeast('closed-beta', 'open-beta')).toBe(false)
    expect(isPostureAtLeast('open-beta', 'ga')).toBe(false)
  })

  it('declares the product to be in a closed beta', () => {
    // This assertion is the point of the module. Widening the audience means
    // changing BOTH the constant and this line, in one reviewable diff, which
    // is the whole difference between a posture-scoped gate and a deleted one.
    expect(CURRENT_RELEASE_POSTURE).toBe('closed-beta')
  })
})
