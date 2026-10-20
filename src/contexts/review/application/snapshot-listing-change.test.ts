import { describe, expect, it } from 'vitest'
import {
  LISTING_CHANGE_QUIET_RUNS,
  isListingMove,
  listingChangeFailureCode,
  storedFailureCode,
} from './snapshot-listing-change'

describe('the code a run whose listing changed under it ends with', () => {
  it('is quiet for a Property with no earlier run', () => {
    expect(listingChangeFailureCode('confirmation_set_changed', [])).toBe(
      'listing_changed',
    )
  })

  it('is quiet after a completed run', () => {
    expect(
      listingChangeFailureCode('confirmation_set_changed', [null, 'listing_changed']),
    ).toBe('listing_changed')
  })

  // A guest who posts while a run is between its two listings changes the set
  // once; the fresh run that follows lists a set that holds still.
  it('is quiet for the second change in a row', () => {
    expect(
      listingChangeFailureCode('confirmation_set_changed', ['listing_changed', null]),
    ).toBe('listing_changed')
  })

  // Three in a row is not guests posting but a listing that does not page the
  // same way twice: loud, as every set change was before.
  it('is loud for the third change in a row', () => {
    expect(
      listingChangeFailureCode('confirmation_set_changed', [
        'listing_changed',
        'listing_changed',
      ]),
    ).toBe('confirmation_set_changed')
  })

  it('stays loud while the changes go on', () => {
    expect(
      listingChangeFailureCode('confirmation_set_changed', [
        'confirmation_set_changed',
        'listing_changed',
      ]),
    ).toBe('confirmation_set_changed')
    expect(
      listingChangeFailureCode('confirmation_set_changed', [
        'confirmation_set_changed',
        'confirmation_set_changed',
      ]),
    ).toBe('confirmation_set_changed')
  })

  it('starts counting again after a run that ended any other way', () => {
    expect(
      listingChangeFailureCode('confirmation_set_changed', [
        'provider_failure',
        'listing_changed',
      ]),
    ).toBe('listing_changed')
    expect(
      listingChangeFailureCode('confirmation_set_changed', [
        'listing_changed',
        'set_mismatch',
      ]),
    ).toBe('listing_changed')
  })

  // A run that completed before the two changes does not excuse the third.
  it('reads no further back than the quiet runs it allows', () => {
    expect(LISTING_CHANGE_QUIET_RUNS).toBe(2)
    expect(
      listingChangeFailureCode('confirmation_set_changed', [
        'listing_changed',
        'listing_changed',
        null,
        null,
      ]),
    ).toBe('confirmation_set_changed')
  })
})

// Google's total (and the average with it) moves when a guest posts, deletes
// or re-rates a review while a run is reading the listing: on the closed beta
// the largest location failed two runs in a row as `total_changed` on
// 2026-10-20 (3,716 then 3,717), and its next two runs completed.
describe('the code a run whose Google total or average moved mid-scan ends with', () => {
  it.each(['total_changed', 'average_changed'] as const)(
    'is quiet for the first %s',
    (request) => {
      expect(listingChangeFailureCode(request, [])).toBe('listing_changed')
      expect(listingChangeFailureCode(request, [null, null])).toBe('listing_changed')
    },
  )

  it.each(['total_changed', 'average_changed'] as const)(
    'is quiet for the second %s in a row',
    (request) => {
      expect(listingChangeFailureCode(request, [request, null])).toBe('listing_changed')
      expect(listingChangeFailureCode(request, ['listing_changed', null])).toBe(
        'listing_changed',
      )
    },
  )

  it.each(['total_changed', 'average_changed'] as const)(
    'is loud for the third change in a row, under its own code (%s)',
    (request) => {
      expect(
        listingChangeFailureCode(request, ['listing_changed', 'listing_changed']),
      ).toBe(request)
    },
  )

  // Every way the listing can move counts towards the same run of changes, so
  // a Property whose listing keeps moving turns loud on its third run whatever
  // the three runs saw.
  it('counts the changes of every kind together', () => {
    const kinds = [
      'listing_changed',
      'confirmation_set_changed',
      'total_changed',
      'average_changed',
      'duplicate_resource',
    ] as const
    for (const earlier of kinds) {
      for (const before of kinds) {
        expect(listingChangeFailureCode('total_changed', [earlier, before])).toBe(
          'total_changed',
        )
        expect(
          listingChangeFailureCode('confirmation_set_changed', [earlier, before]),
        ).toBe('confirmation_set_changed')
        expect(listingChangeFailureCode('average_changed', [earlier, before])).toBe(
          'average_changed',
        )
        expect(listingChangeFailureCode('page_overlap', [earlier, before])).toBe(
          'duplicate_resource',
        )
      }
    }
  })

  it('starts counting again after a completed run or one that ended another way', () => {
    expect(listingChangeFailureCode('total_changed', ['listing_changed', null])).toBe(
      'listing_changed',
    )
    expect(
      listingChangeFailureCode('total_changed', ['listing_changed', 'cursor_failure']),
    ).toBe('listing_changed')
    expect(
      listingChangeFailureCode('total_changed', ['malformed_page', 'total_changed']),
    ).toBe('listing_changed')
  })
})

// A review posted (or edited, which moves it to the top of Google's list) while
// the main scan is between two pages shifts the page boundary by one, so the
// last review of one page is the first of the next.
describe('the code a run that read one review on two main-scan pages ends with', () => {
  it('is quiet for the first and second run, then loud as duplicate_resource', () => {
    expect(listingChangeFailureCode('page_overlap', [])).toBe('listing_changed')
    expect(listingChangeFailureCode('page_overlap', ['listing_changed', null])).toBe(
      'listing_changed',
    )
    expect(
      listingChangeFailureCode('page_overlap', ['listing_changed', 'total_changed']),
    ).toBe('duplicate_resource')
  })
})

describe('which failures are a listing that moved', () => {
  it.each([
    'confirmation_set_changed',
    'total_changed',
    'average_changed',
    'page_overlap',
  ] as const)('%s is', (request) => {
    expect(isListingMove(request)).toBe(true)
  })

  // A review twice on ONE page, or one review id linked to two provider
  // resources, are not a listing moving under the run: Google's page, or our
  // mapping, is broken. They stay loud on their first run.
  it.each([
    'duplicate_resource',
    'resource_collision',
    'set_mismatch',
    'malformed_page',
    'listing_changed',
    'cursor_lost',
    'provider_failure',
  ] as const)('%s is not', (request) => {
    expect(isListingMove(request)).toBe(false)
  })
})

describe('the code a request is stored with once nothing makes it quiet', () => {
  it('is the request itself, except for a page overlap', () => {
    expect(storedFailureCode('total_changed')).toBe('total_changed')
    expect(storedFailureCode('confirmation_set_changed')).toBe('confirmation_set_changed')
    expect(storedFailureCode('set_mismatch')).toBe('set_mismatch')
    expect(storedFailureCode('page_overlap')).toBe('duplicate_resource')
  })
})
