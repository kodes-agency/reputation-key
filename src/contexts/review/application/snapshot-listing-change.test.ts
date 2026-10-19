import { describe, expect, it } from 'vitest'
import {
  LISTING_CHANGE_QUIET_RUNS,
  listingChangeFailureCode,
} from './snapshot-listing-change'

describe('the code a run whose listing changed between its two scans ends with', () => {
  it('is quiet for a Property with no earlier run', () => {
    expect(listingChangeFailureCode([])).toBe('listing_changed')
  })

  it('is quiet after a completed run', () => {
    expect(listingChangeFailureCode([null, 'listing_changed'])).toBe('listing_changed')
  })

  // A guest who posts while a run is between its two listings changes the set
  // once; the fresh run that follows lists a set that holds still.
  it('is quiet for the second change in a row', () => {
    expect(listingChangeFailureCode(['listing_changed', null])).toBe('listing_changed')
  })

  // Three in a row is not guests posting but a listing that does not page the
  // same way twice: loud, as every set change was before.
  it('is loud for the third change in a row', () => {
    expect(listingChangeFailureCode(['listing_changed', 'listing_changed'])).toBe(
      'confirmation_set_changed',
    )
  })

  it('stays loud while the changes go on', () => {
    expect(
      listingChangeFailureCode(['confirmation_set_changed', 'listing_changed']),
    ).toBe('confirmation_set_changed')
    expect(
      listingChangeFailureCode(['confirmation_set_changed', 'confirmation_set_changed']),
    ).toBe('confirmation_set_changed')
  })

  it('starts counting again after a run that ended any other way', () => {
    expect(listingChangeFailureCode(['total_changed', 'listing_changed'])).toBe(
      'listing_changed',
    )
    expect(listingChangeFailureCode(['listing_changed', 'provider_failure'])).toBe(
      'listing_changed',
    )
  })

  // A run that completed before the two changes does not excuse the third.
  it('reads no further back than the quiet runs it allows', () => {
    expect(LISTING_CHANGE_QUIET_RUNS).toBe(2)
    expect(
      listingChangeFailureCode(['listing_changed', 'listing_changed', null, null]),
    ).toBe('confirmation_set_changed')
  })
})
