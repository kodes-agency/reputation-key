// A failed results read stays on the page while Try again reads. TanStack Query
// drops a first load's error the moment it refetches, so the state carries the
// retry itself: without it the strip would flip to loading and the button the
// person pressed would leave the page.
import { describe, expect, it } from 'vitest'
import { resultsStateOf } from './portal-overview-results'

describe('resultsStateOf while Try again reads', () => {
  it('keeps the failure, though the query has no error to report any more', () => {
    expect(resultsStateOf({ allowed: true, error: null, retrying: true }, null)).toEqual({
      status: 'failed',
      retrying: true,
    })
  })

  it('does not call a first load a retry', () => {
    expect(resultsStateOf({ allowed: true, error: null, retrying: false }, null)).toEqual(
      { status: 'loading' },
    )
  })

  it('shows the figures once the retry has brought them', () => {
    const index = { portal: () => null, group: () => null, ungrouped: () => null }
    expect(
      resultsStateOf(
        { allowed: true, error: null, retrying: true },
        index as unknown as Parameters<typeof resultsStateOf>[1],
      ),
    ).toMatchObject({ status: 'ready' })
  })

  it('stays off for a reader who may not read results, retry or not', () => {
    expect(resultsStateOf({ allowed: false, error: null, retrying: true }, null)).toEqual(
      { status: 'off' },
    )
  })
})
