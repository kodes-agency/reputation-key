import { describe, expect, it } from 'vitest'
import { CLEARED_INBOX_LIST_FILTERS } from './inbox-filters'
import {
  activeInboxFilterChips,
  ratingPatch,
  ratingValue,
  SORT_OPTIONS,
} from './inbox-filter-options'

describe('ratingPatch', () => {
  it('maps each rating choice to the min and max it filters by', () => {
    // toStrictEqual: an explicit `undefined` key is the contract. The router
    // drops a bound only when the patch names it, so `{ ratingMin: 4 }` would
    // leave an earlier `ratingMax: 5` standing.
    expect(ratingPatch('5')).toStrictEqual({ ratingMin: 5, ratingMax: 5 })
    expect(ratingPatch('4-plus')).toStrictEqual({ ratingMin: 4, ratingMax: undefined })
    expect(ratingPatch('3-minus')).toStrictEqual({ ratingMin: undefined, ratingMax: 3 })
    expect(ratingPatch('all')).toStrictEqual({
      ratingMin: undefined,
      ratingMax: undefined,
    })
  })

  it('round-trips through ratingValue', () => {
    for (const choice of ['5', '4-plus', '3-minus', 'all']) {
      const patch = ratingPatch(choice)
      expect(ratingValue({ ...CLEARED_INBOX_LIST_FILTERS, ...patch })).toBe(choice)
    }
  })

  it('replaces a previously chosen rating, whichever bounds it had set', () => {
    const fiveStars = { ...CLEARED_INBOX_LIST_FILTERS, ratingMin: 5, ratingMax: 5 }
    expect(ratingValue({ ...fiveStars, ...ratingPatch('4-plus') })).toBe('4-plus')
    expect(ratingValue({ ...fiveStars, ...ratingPatch('3-minus') })).toBe('3-minus')
    expect(ratingValue({ ...fiveStars, ...ratingPatch('all') })).toBe('all')
    const threeAndBelow = { ...CLEARED_INBOX_LIST_FILTERS, ratingMax: 3 }
    expect(ratingValue({ ...threeAndBelow, ...ratingPatch('5') })).toBe('5')
    expect(ratingValue({ ...threeAndBelow, ...ratingPatch('4-plus') })).toBe('4-plus')
  })
})

describe('SORT_OPTIONS', () => {
  it('offers newest first, then oldest', () => {
    expect(SORT_OPTIONS).toEqual([
      { value: 'newest', label: 'Newest' },
      { value: 'oldest', label: 'Oldest' },
    ])
  })
})

describe('activeInboxFilterChips', () => {
  it('returns nothing when no filter is set and the sort is the default', () => {
    expect(activeInboxFilterChips(CLEARED_INBOX_LIST_FILTERS, 'newest')).toEqual([])
  })

  it('labels the source filter from the option list and clears just that filter', () => {
    expect(
      activeInboxFilterChips(
        { ...CLEARED_INBOX_LIST_FILTERS, sourceType: 'review' },
        'newest',
      ),
    ).toStrictEqual([
      { key: 'source', label: 'Reviews', clear: { filters: { sourceType: undefined } } },
    ])
  })

  it('labels the priority filter', () => {
    expect(
      activeInboxFilterChips(
        { ...CLEARED_INBOX_LIST_FILTERS, attention: 'urgent' },
        'newest',
      ),
    ).toStrictEqual([
      { key: 'priority', label: 'Urgent', clear: { filters: { attention: undefined } } },
    ])
  })

  it('labels the combined priority choice', () => {
    expect(
      activeInboxFilterChips(
        { ...CLEARED_INBOX_LIST_FILTERS, attention: 'urgent_high' },
        'newest',
      ),
    ).toStrictEqual([
      {
        key: 'priority',
        label: 'Urgent and High',
        clear: { filters: { attention: undefined } },
      },
    ])
  })

  it('labels the rating filter and clears both bounds', () => {
    expect(
      activeInboxFilterChips({ ...CLEARED_INBOX_LIST_FILTERS, ratingMin: 4 }, 'newest'),
    ).toStrictEqual([
      {
        key: 'rating',
        label: '4 stars and up',
        clear: { filters: { ratingMin: undefined, ratingMax: undefined } },
      },
    ])
    expect(
      activeInboxFilterChips({ ...CLEARED_INBOX_LIST_FILTERS, ratingMax: 3 }, 'newest')[0]
        ?.label,
    ).toBe('3 stars and below')
    expect(
      activeInboxFilterChips(
        { ...CLEARED_INBOX_LIST_FILTERS, ratingMin: 5, ratingMax: 5 },
        'newest',
      )[0]?.label,
    ).toBe('5 stars')
  })

  it('labels the polarity filter with its inbox wording', () => {
    expect(
      activeInboxFilterChips(
        { ...CLEARED_INBOX_LIST_FILTERS, polarity: 'negative' },
        'newest',
      ),
    ).toStrictEqual([
      {
        key: 'polarity',
        label: 'Complaints',
        clear: { filters: { polarity: undefined } },
      },
    ])
  })

  it('labels the aspect filter', () => {
    expect(
      activeInboxFilterChips(
        { ...CLEARED_INBOX_LIST_FILTERS, aspect: 'wait_time' },
        'newest',
      ),
    ).toStrictEqual([
      { key: 'aspect', label: 'Wait time', clear: { filters: { aspect: undefined } } },
    ])
  })

  it('words the dates a drill-down was counted over and clears both together', () => {
    expect(
      activeInboxFilterChips(
        { ...CLEARED_INBOX_LIST_FILTERS, since: '2026-06-13', until: '2026-09-10' },
        'newest',
      ),
    ).toStrictEqual([
      {
        key: 'dates',
        label: 'Jun 13, 2026 to Sep 10, 2026',
        clear: { filters: { since: undefined, until: undefined } },
      },
    ])
  })

  it('words a window with one end', () => {
    expect(
      activeInboxFilterChips(
        { ...CLEARED_INBOX_LIST_FILTERS, since: '2026-06-13' },
        'newest',
      )[0]?.label,
    ).toBe('From Jun 13, 2026')
    expect(
      activeInboxFilterChips(
        { ...CLEARED_INBOX_LIST_FILTERS, until: '2026-09-10' },
        'newest',
      )[0]?.label,
    ).toBe('Until Sep 10, 2026')
  })

  it('adds a sort chip only for the non-default sort, clearing back to newest', () => {
    expect(activeInboxFilterChips(CLEARED_INBOX_LIST_FILTERS, 'oldest')).toStrictEqual([
      { key: 'sort', label: 'Oldest first', clear: { sort: 'newest' } },
    ])
  })

  it('orders chips source, priority, rating, polarity, aspect, issue, dates, sort', () => {
    const chips = activeInboxFilterChips(
      {
        sourceType: 'feedback',
        attention: 'high',
        ratingMin: undefined,
        ratingMax: 3,
        polarity: 'positive',
        aspect: 'staff',
        issue: 'a0000000-0000-4000-8000-000000000001',
        since: '2026-06-13',
        until: '2026-09-10',
      },
      'oldest',
    )
    expect(chips.map((chip) => chip.key)).toEqual([
      'source',
      'priority',
      'rating',
      'polarity',
      'aspect',
      'issue',
      'dates',
      'sort',
    ])
    expect(chips.map((chip) => chip.label)).toEqual([
      'Feedback',
      'High',
      '3 stars and below',
      'Praise',
      'Staff',
      'One issue',
      'Jun 13, 2026 to Sep 10, 2026',
      'Oldest first',
    ])
  })

  it('offers the issue a link named as a chip that lifts it', () => {
    const chips = activeInboxFilterChips(
      { ...CLEARED_INBOX_LIST_FILTERS, issue: 'a0000000-0000-4000-8000-000000000001' },
      'newest',
    )

    expect(chips).toStrictEqual([
      {
        key: 'issue',
        label: 'One issue',
        clear: { filters: { issue: undefined } },
      },
    ])
  })
})
