import { describe, expect, it } from 'vitest'
import { moveToInboxQueue, replaceInboxSearch } from './inbox-navigation'

describe('replaceInboxSearch', () => {
  it('replaces typeahead history and closes stale detail state', () => {
    const command = replaceInboxSearch('service')

    expect(command.replace).toBe(true)
    expect(command.search({ q: 'old', itemId: 'item-1', queue: 'reply' })).toEqual({
      q: 'service',
      itemId: undefined,
      queue: 'reply',
    })
  })
})

describe('moveToInboxQueue', () => {
  const search = {
    queue: 'open',
    itemId: 'item-1',
    q: 'breakfast',
    sort: 'oldest',
    sourceType: 'review',
    ratingMin: 4,
    attention: 'urgent',
    aspect: 'service',
    polarity: 'negative',
  } as const

  it('closes the open item and keeps the search, the rating and the sort', () => {
    const next = moveToInboxQueue('escalated').search(search)

    expect(next).toMatchObject({
      queue: 'escalated',
      itemId: undefined,
      q: 'breakfast',
      sort: 'oldest',
      ratingMin: 4,
    })
  })

  it('keeps every filter in a queue that offers them all', () => {
    expect(moveToInboxQueue('open').search(search)).toMatchObject({
      sourceType: 'review',
      attention: 'urgent',
      aspect: 'service',
      polarity: 'negative',
    })
  })

  it('drops the Source filter on the way into a section queue', () => {
    const next = moveToInboxQueue('reply').search(search)

    expect(next.sourceType).toBeUndefined()
    expect(next).toMatchObject({ attention: 'urgent', aspect: 'service' })
  })

  it('drops the Source filter and the topics, and keeps Priority, on the way into the private feedback queues', () => {
    for (const queue of ['feedback', 'handled'] as const) {
      const next = moveToInboxQueue(queue).search(search)

      expect(next).toMatchObject({
        queue,
        ratingMin: 4,
        q: 'breakfast',
        attention: 'urgent',
      })
      expect(next.sourceType).toBeUndefined()
      expect(next.aspect).toBeUndefined()
      expect(next.polarity).toBeUndefined()
    }
  })
})
