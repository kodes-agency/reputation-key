import { describe, expect, it } from 'vitest'
import { INBOX_QUEUES } from '#/contexts/inbox/application/inbox-queues'
import { filtersOffered, offeredListFilters } from './inbox-filter-offer'
import { CLEARED_INBOX_LIST_FILTERS, type InboxListFilterValues } from './inbox-filters'

const EVERYTHING: InboxListFilterValues = {
  sourceType: 'review',
  ratingMin: 4,
  ratingMax: undefined,
  attention: 'urgent',
  aspect: 'service',
  polarity: 'negative',
}

describe('filtersOffered', () => {
  it.each(['mine', 'escalated', 'open', 'closed'] as const)(
    'offers Source in %s, which holds both kinds',
    (queue) => {
      expect(filtersOffered(queue).source).toBe(true)
    },
  )

  it.each(['reply', 'approval', 'waiting', 'replied', 'feedback', 'handled'] as const)(
    'does not offer Source in %s, a queue of one kind',
    (queue) => {
      expect(filtersOffered(queue).source).toBe(false)
    },
  )

  it.each(['feedback', 'handled'] as const)(
    'does not offer the topics or the AI Priority in %s',
    (queue) => {
      expect(filtersOffered(queue)).toMatchObject({ topics: false, priority: false })
    },
  )

  it.each([
    'reply',
    'approval',
    'waiting',
    'replied',
    'mine',
    'escalated',
    'open',
  ] as const)('offers the topics and the AI Priority in %s', (queue) => {
    expect(filtersOffered(queue)).toMatchObject({ topics: true, priority: true })
  })

  it('offers Rating in every queue', () => {
    for (const queue of INBOX_QUEUES) expect(filtersOffered(queue).rating).toBe(true)
  })
})

describe('offeredListFilters', () => {
  it('keeps every filter in a shared view', () => {
    expect(offeredListFilters('open', EVERYTHING)).toEqual(EVERYTHING)
  })

  it('drops Source in a section queue and keeps the rest', () => {
    expect(offeredListFilters('reply', EVERYTHING)).toEqual({
      ...EVERYTHING,
      sourceType: undefined,
    })
  })

  it('keeps only Rating in a private feedback queue', () => {
    expect(offeredListFilters('feedback', EVERYTHING)).toEqual({
      ...CLEARED_INBOX_LIST_FILTERS,
      ratingMin: 4,
    })
    expect(offeredListFilters('handled', EVERYTHING)).toEqual({
      ...CLEARED_INBOX_LIST_FILTERS,
      ratingMin: 4,
    })
  })
})
