import { describe, expect, it } from 'vitest'
import {
  attentionQualifiers,
  attentionTarget,
  googleLinkNotice,
  type PropertyAttention,
} from './property-list-view'

const attention = (overrides: Partial<PropertyAttention> = {}): PropertyAttention => ({
  total: 0,
  overdue: 0,
  itemsToTriage: 0,
  escalated: 0,
  goalsBehindPace: 0,
  ...overrides,
})

describe('attention', () => {
  it('names the qualifiers that matter, never the parts of a sum', () => {
    expect(
      attentionQualifiers(
        attention({
          total: 7,
          overdue: 3,
          itemsToTriage: 6,
          escalated: 1,
          goalsBehindPace: 1,
        }),
      ),
    ).toEqual([
      { text: '3 overdue', urgent: true },
      { text: '1 escalated', urgent: false },
      { text: '1 goal behind pace', urgent: false },
    ])
    expect(attentionQualifiers(attention({ total: 2, goalsBehindPace: 2 }))).toEqual([
      { text: '2 goals behind pace', urgent: false },
    ])
    expect(attentionQualifiers(attention({ total: 4, itemsToTriage: 4 }))).toEqual([])
  })

  it('opens the queue that holds the count', () => {
    expect(attentionTarget(attention({ total: 3, itemsToTriage: 2, escalated: 1 }))).toBe(
      'open',
    )
    // A closed but unresolved escalation is outside the open queue.
    expect(attentionTarget(attention({ total: 1, escalated: 1 }))).toBe('escalated')
    expect(attentionTarget(attention({ total: 1, goalsBehindPace: 1 }))).toBe('goals')
    expect(attentionTarget(attention())).toBeNull()
  })
})

describe('googleLinkNotice', () => {
  it('says nothing for a linked property and names what to do otherwise', () => {
    expect(googleLinkNotice('active')).toBeNull()
    expect(googleLinkNotice('unbound')).toBe('Google not linked')
    expect(googleLinkNotice('account_confirmation_required')).toBe(
      'Confirm the Google account',
    )
    expect(googleLinkNotice('disconnected')).toBe('Reconnect Google')
  })
})
