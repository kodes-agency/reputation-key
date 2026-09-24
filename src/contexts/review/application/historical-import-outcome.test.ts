import { describe, expect, it } from 'vitest'
import type { ReviewProviderSnapshotFailureCode } from './ports/review-provider-snapshot.repository'
import { historyImportFailureReason } from './historical-import-outcome'

const ALL_CODES: ReadonlyArray<ReviewProviderSnapshotFailureCode> = [
  'source_changed',
  'authorization_changed',
  'authorization_denied',
  'runtime_unavailable',
  'stale_source',
  'provider_failure',
  'cursor_failure',
  'malformed_page',
  'total_changed',
  'average_changed',
  'duplicate_resource',
  'resource_collision',
  'review_mutation',
  'page_cap_exceeded',
  'review_cap_exceeded',
  'set_mismatch',
  'confirmation_deadline_elapsed',
  'confirmation_set_changed',
  'observation_failed',
]

describe('history import failure reason', () => {
  it('tells a reader to reconnect Google when the grant is what stopped the import', () => {
    expect(historyImportFailureReason('authorization_changed')).toBe(
      'google_authorization',
    )
    expect(historyImportFailureReason('authorization_denied')).toBe(
      'google_authorization',
    )
  })

  it('tells a reader the location moved when the Property source changed underneath', () => {
    expect(historyImportFailureReason('source_changed')).toBe('property_source_changed')
    expect(historyImportFailureReason('stale_source')).toBe('property_source_changed')
  })

  it('does not promise a retry for a location the snapshot caps refuse', () => {
    expect(historyImportFailureReason('page_cap_exceeded')).toBe('location_too_large')
    expect(historyImportFailureReason('review_cap_exceeded')).toBe('location_too_large')
  })

  it('treats every other snapshot failure as one RepKey retries itself', () => {
    expect(historyImportFailureReason('provider_failure')).toBe('temporary')
    expect(historyImportFailureReason('cursor_failure')).toBe('temporary')
    expect(historyImportFailureReason('confirmation_deadline_elapsed')).toBe('temporary')
  })

  it('answers for every failure code the snapshot run can end with', () => {
    expect(
      ALL_CODES.filter((code) => historyImportFailureReason(code) === undefined),
    ).toEqual([])
  })
})
