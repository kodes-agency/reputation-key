import { describe, expect, it } from 'vitest'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import { selectedItemPresenceAction } from './inbox-state-helpers'

const item = { id: 'item-1' } as InboxItem

describe('selectedItemPresenceAction', () => {
  it('keeps an absent direct-link item while its detail loads independently', () => {
    expect(selectedItemPresenceAction(undefined, 'item-1', false, [])).toBe('keep')
  })

  it('remembers a selected row and closes it only after it leaves the queue', () => {
    expect(selectedItemPresenceAction(undefined, 'item-1', false, [item])).toBe(
      'remember',
    )
    expect(selectedItemPresenceAction('item-1', 'item-1', false, [])).toBe('close')
  })

  it('resets the observation when selection is cleared', () => {
    expect(selectedItemPresenceAction('item-1', undefined, false, [item])).toBe('reset')
  })
})
