import { describe, expect, it } from 'vitest'
import type { ReviewProviderSnapshotFailureCode } from './ports/review-provider-snapshot.repository'
import { isParkedSnapshotFailure } from './parked-snapshot-failure'

/**
 * Every code a snapshot run can fail with, against whether the sync job parks
 * it (records it and ends normally) or fails the job. The `satisfies` makes a
 * code added to the union a compile error here until its row says which.
 */
const PARKED = {
  source_changed: false,
  authorization_changed: false,
  authorization_denied: false,
  connection_unusable: false,
  runtime_unavailable: false,
  stale_source: false,
  provider_failure: false,
  provider_rejected: true,
  cursor_failure: false,
  cursor_lost: false,
  malformed_page: false,
  total_changed: false,
  average_changed: false,
  duplicate_resource: false,
  resource_collision: false,
  review_mutation: false,
  page_cap_exceeded: true,
  review_cap_exceeded: true,
  set_mismatch: false,
  confirmation_deadline_elapsed: false,
  confirmation_set_changed: false,
  listing_changed: false,
  observation_failed: false,
} as const satisfies Record<ReviewProviderSnapshotFailureCode, boolean>

describe('isParkedSnapshotFailure', () => {
  it.each(Object.entries(PARKED) as [ReviewProviderSnapshotFailureCode, boolean][])(
    'answers %s with %s',
    (code, parked) => {
      expect(isParkedSnapshotFailure(code)).toBe(parked)
    },
  )
})
