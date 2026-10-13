// SourceContentPolicy — what the policy object carries.
//
// docs/BETA.md §2: a field no code consults is a claim, not a control. The
// policy holds the two lifecycle timings its readers use and the version
// stored with derived data. It holds no permission flag: whether a review may
// be analysed, aggregated per Property, or have its derived metadata kept is
// decided where each is enforced, not asserted here.

import { describe, expect, it } from 'vitest'
import {
  contentExpiresAtFromFetch,
  contentRefreshDueThreshold,
  createGoogleSourceContentPolicy,
} from './source-content-policy'

const DAY_MS = 24 * 60 * 60 * 1000
const FETCHED_AT = new Date('2026-10-13T09:00:00.000Z')
const NOW = new Date('2026-10-20T09:00:00.000Z')

describe('Google source content policy', () => {
  it('carries the source, the two lifecycle timings and the policy version, and nothing else', () => {
    expect(createGoogleSourceContentPolicy()).toEqual({
      source: 'google',
      rawContentTtlMs: 30 * DAY_MS,
      rawRefreshDueBeforeMs: 25 * DAY_MS,
      policyVersion: 1,
    })
  })

  it('expires content 30 days after its fetch, and looks 5 days ahead of now for content due a refresh', () => {
    expect(contentExpiresAtFromFetch(FETCHED_AT)).toEqual(
      new Date(FETCHED_AT.getTime() + 30 * DAY_MS),
    )
    // The upper bound of the refresh scan, measured from now and not from any
    // one row's fetch: a row is due once its expiry falls inside the window.
    expect(contentRefreshDueThreshold(NOW)).toEqual(new Date(NOW.getTime() + 5 * DAY_MS))
  })
})
