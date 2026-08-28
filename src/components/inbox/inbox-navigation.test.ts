import { describe, expect, it } from 'vitest'
import { replaceInboxSearch } from './inbox-navigation'

describe('replaceInboxSearch', () => {
  it('replaces typeahead history and closes stale detail state', () => {
    const command = replaceInboxSearch('service')

    expect(command.replace).toBe(true)
    expect(command.search({ q: 'old', itemId: 'item-1', folder: 'open' })).toEqual({
      q: 'service',
      itemId: undefined,
      folder: 'open',
    })
  })
})
