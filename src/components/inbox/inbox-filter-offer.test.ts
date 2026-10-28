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
    'does not offer the topics in %s, which hold no analysis to read',
    (queue) => {
      expect(filtersOffered(queue).topics).toBe(false)
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
  ] as const)('offers the topics in %s', (queue) => {
    expect(filtersOffered(queue).topics).toBe(true)
  })

  it('offers Priority in every queue, private feedback included (ADR 0071)', () => {
    for (const queue of INBOX_QUEUES) expect(filtersOffered(queue).priority).toBe(true)
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

  it('keeps only Rating and Priority in a private feedback queue', () => {
    const kept = { ...CLEARED_INBOX_LIST_FILTERS, ratingMin: 4, attention: 'urgent' }

    expect(offeredListFilters('feedback', EVERYTHING)).toEqual(kept)
    expect(offeredListFilters('handled', EVERYTHING)).toEqual(kept)
  })
})
