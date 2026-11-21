import { describe, expect, it } from 'vitest'
import {
  REVIEW_DESTRUCTIVE_LIFECYCLE_QUARANTINE,
  isLegacyDestructiveReviewLifecycleEnabled,
} from './review-lifecycle-safety.server'

// The scans that keep Review deletion behind this authority live in
// src/shared/architecture/single-entry-authorities.test.ts.
describe('Review lifecycle safety cutover', () => {
  it('keeps legacy destructive schedules disabled behind an explicit release condition', () => {
    expect(isLegacyDestructiveReviewLifecycleEnabled()).toBe(false)
    expect(REVIEW_DESTRUCTIVE_LIFECYCLE_QUARANTINE).toEqual(
      expect.objectContaining({
        owner: 'review-context',
        releaseDecision: 'explicit-reviewed-cutover',
      }),
    )
    expect(REVIEW_DESTRUCTIVE_LIFECYCLE_QUARANTINE.releaseCondition).toContain(
      'external zero-difference shadow window',
    )
  })
})
