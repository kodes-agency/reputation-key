import { describe, expect, it } from 'vitest'
import { errorFactTags } from '#/shared/observability/error-facts'
import { scrubErrorEvent } from '#/shared/observability/sentry-event-scrub'
import { SYNC_FAILURE_CODES } from '#/shared/observability/sync-failure-codes'
import type { ReviewProviderSnapshotFailureCode } from '../../application/ports/review-provider-snapshot.repository'
import { ReviewProviderSnapshotFailure } from './review-provider-snapshot-failure'

/**
 * Every code a snapshot run can fail with. The `satisfies` makes a code added
 * to the union a compile error here until it is listed, so the shape check
 * below always covers the whole set.
 */
const FAILURE_CODES = {
  source_changed: true,
  authorization_changed: true,
  authorization_denied: true,
  runtime_unavailable: true,
  stale_source: true,
  provider_failure: true,
  cursor_failure: true,
  cursor_lost: true,
  malformed_page: true,
  total_changed: true,
  average_changed: true,
  duplicate_resource: true,
  resource_collision: true,
  review_mutation: true,
  page_cap_exceeded: true,
  review_cap_exceeded: true,
  set_mismatch: true,
  confirmation_deadline_elapsed: true,
  confirmation_set_changed: true,
  listing_changed: true,
  observation_failed: true,
} as const satisfies Record<ReviewProviderSnapshotFailureCode, true>

const ALL_CODES = Object.keys(FAILURE_CODES) as ReviewProviderSnapshotFailureCode[]

describe('ReviewProviderSnapshotFailure', () => {
  it('keeps the name and message the issue has always been filed under', () => {
    const failure = new ReviewProviderSnapshotFailure('authorization_denied')

    expect(failure).toBeInstanceOf(Error)
    expect(failure.name).toBe('ReviewProviderSnapshotFailure')
    expect(failure.message).toBe('authorization_denied')
    expect(failure.failureCode).toBe('authorization_denied')
  })

  it('starts its stack at the code that raised it, so the issue keeps its grouping', () => {
    const failure = new ReviewProviderSnapshotFailure('provider_failure')

    const [, firstFrame = ''] = (failure.stack ?? '').split('\n')
    expect(firstFrame).not.toContain('review-provider-snapshot-failure.ts')
  })

  it.each(ALL_CODES)('is tagged with %s', (code) => {
    expect(errorFactTags(new ReviewProviderSnapshotFailure(code))).toEqual({
      failure_code: code,
    })
  })

  it('reaches the event as a tag while the message is still replaced', () => {
    const failure = new ReviewProviderSnapshotFailure('malformed_page')

    const scrubbed = scrubErrorEvent(
      {
        message: failure.message,
        exception: {
          values: [{ type: failure.name, value: failure.message }],
        },
        tags: { runtime_source: 'bullmq-job', job_name: 'sync-property-reviews' },
      },
      { originalException: failure },
    ) as Record<string, unknown>

    expect(scrubbed.tags).toEqual({
      runtime_source: 'bullmq-job',
      job_name: 'sync-property-reviews',
      failure_code: 'malformed_page',
    })
    expect(scrubbed.message).toBe('[REDACTED]')
    expect(JSON.stringify(scrubbed.exception)).not.toContain('malformed_page')
  })
})

describe('the sync failure codes the health snapshot counts', () => {
  it("are the snapshot codes plus the discovery sweep's own enqueue_failed, no more and no fewer", () => {
    expect([...SYNC_FAILURE_CODES].sort()).toEqual(
      [...ALL_CODES, 'enqueue_failed'].sort(),
    )
  })
})
