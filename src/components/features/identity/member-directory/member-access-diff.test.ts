import { describe, expect, it } from 'vitest'
import {
  diffMemberAccess,
  diffPropertyAccess,
  joinNames,
  selectAllVisible,
  summarizeAccessChange,
  toggleId,
  type MemberAccessChange,
} from './member-access-diff'

describe('diffPropertyAccess', () => {
  it('grants what was added and revokes what was removed', () => {
    expect(diffPropertyAccess(['a', 'b'], ['b', 'c'])).toEqual({
      grantPropertyIds: ['c'],
      revokePropertyIds: ['a'],
    })
  })

  it('reports nothing when the selection is the initial access, in any order', () => {
    expect(diffPropertyAccess(['a', 'b'], ['b', 'a'])).toEqual({
      grantPropertyIds: [],
      revokePropertyIds: [],
    })
  })

  it('grants everything for a member with no access yet', () => {
    expect(diffPropertyAccess([], ['a', 'b'])).toEqual({
      grantPropertyIds: ['a', 'b'],
      revokePropertyIds: [],
    })
  })

  it('revokes everything when the selection is cleared', () => {
    expect(diffPropertyAccess(['a', 'b'], [])).toEqual({
      grantPropertyIds: [],
      revokePropertyIds: ['a', 'b'],
    })
  })

  it('never lists an id twice, and never grants and revokes the same id', () => {
    const { grantPropertyIds, revokePropertyIds } = diffPropertyAccess(
      ['a', 'a', 'b'],
      ['b', 'c', 'c'],
    )
    expect(grantPropertyIds).toEqual(['c'])
    expect(revokePropertyIds).toEqual(['a'])
  })

  it('does not mutate its inputs', () => {
    const initial = Object.freeze(['a'])
    const selected = Object.freeze(['b'])
    expect(() => diffPropertyAccess(initial, selected)).not.toThrow()
  })
})

describe('diffMemberAccess', () => {
  const none = { propertyIds: [], responsibleIds: [] }

  it('is empty when nothing changed', () => {
    const state = { propertyIds: ['a', 'b'], responsibleIds: ['a'] }
    expect(diffMemberAccess(state, state).isEmpty).toBe(true)
  })

  it('carries the access change and is not empty', () => {
    const change = diffMemberAccess(
      { propertyIds: ['a'], responsibleIds: [] },
      { propertyIds: ['a', 'b'], responsibleIds: [] },
    )
    expect(change).toMatchObject({
      grantPropertyIds: ['b'],
      revokePropertyIds: [],
      responsibleOnPropertyIds: [],
      responsibleOffPropertyIds: [],
      isEmpty: false,
    })
  })

  it('makes a member responsible for a newly granted property', () => {
    const change = diffMemberAccess(none, {
      propertyIds: ['a'],
      responsibleIds: ['a'],
    })
    expect(change.grantPropertyIds).toEqual(['a'])
    expect(change.responsibleOnPropertyIds).toEqual(['a'])
  })

  it('releases responsibility the member had and keeps the access', () => {
    const change = diffMemberAccess(
      { propertyIds: ['a'], responsibleIds: ['a'] },
      { propertyIds: ['a'], responsibleIds: [] },
    )
    expect(change.responsibleOffPropertyIds).toEqual(['a'])
    expect(change.revokePropertyIds).toEqual([])
    expect(change.isEmpty).toBe(false)
  })

  it('leaves responsibility on a revoked property to the server, which releases it', () => {
    const change = diffMemberAccess(
      { propertyIds: ['a', 'b'], responsibleIds: ['a'] },
      { propertyIds: ['b'], responsibleIds: [] },
    )
    expect(change.revokePropertyIds).toEqual(['a'])
    expect(change.responsibleOffPropertyIds).toEqual([])
  })

  it('ignores responsibility chosen on a property the member will not have', () => {
    const change = diffMemberAccess(none, {
      propertyIds: [],
      responsibleIds: ['a'],
    })
    expect(change.responsibleOnPropertyIds).toEqual([])
    expect(change.isEmpty).toBe(true)
  })
})

describe('toggleId', () => {
  it('adds an absent id and removes a present one, leaving the input alone', () => {
    const ids = Object.freeze(['a', 'b'])
    expect(toggleId(ids, 'c')).toEqual(['a', 'b', 'c'])
    expect(toggleId(ids, 'a')).toEqual(['b'])
    expect(ids).toEqual(['a', 'b'])
  })
})

describe('selectAllVisible', () => {
  it('adds every visible id to the selection', () => {
    expect(selectAllVisible(['a'], ['a', 'b', 'c'], true)).toEqual(['a', 'b', 'c'])
  })

  it('removes only the visible ids, keeping a filtered-out selection', () => {
    expect(selectAllVisible(['a', 'b', 'z'], ['a', 'b'], false)).toEqual(['z'])
  })
})

describe('joinNames', () => {
  it('reads as a plain list', () => {
    expect(joinNames([])).toBe('')
    expect(joinNames(['Sofia'])).toBe('Sofia')
    expect(joinNames(['Sofia', 'Varna'])).toBe('Sofia and Varna')
    expect(joinNames(['Sofia', 'Varna', 'Burgas'])).toBe('Sofia, Varna and Burgas')
  })
})

describe('summarizeAccessChange', () => {
  const nameOf = (id: string) => ({ a: 'Sofia', b: 'Varna', c: 'Burgas' })[id] ?? id
  const change = (overrides: Partial<MemberAccessChange> = {}): MemberAccessChange => ({
    grantPropertyIds: [],
    revokePropertyIds: [],
    responsibleOnPropertyIds: [],
    responsibleOffPropertyIds: [],
    isEmpty: false,
    ...overrides,
  })

  it('says nothing for no change', () => {
    expect(summarizeAccessChange(change({ isEmpty: true }), nameOf, 'Maria')).toEqual([])
  })

  it('names the properties granted and that the member is told', () => {
    expect(
      summarizeAccessChange(change({ grantPropertyIds: ['a', 'b'] }), nameOf, 'Maria'),
    ).toEqual([
      'Gives Maria access to Sofia and Varna.',
      'We tell Maria in the app and by email.',
    ])
  })

  it('warns what a revoke costs: the Inbox and the Responsible manager role', () => {
    const lines = summarizeAccessChange(
      change({ revokePropertyIds: ['c'] }),
      nameOf,
      'Maria',
    )
    expect(lines[0]).toBe(
      'Removes access to Burgas. Maria loses its Inbox, and any Responsible manager role there is released.',
    )
  })

  it('reports a responsibility change without announcing an access notice', () => {
    expect(
      summarizeAccessChange(
        change({ responsibleOnPropertyIds: ['a'], responsibleOffPropertyIds: ['b'] }),
        nameOf,
        'Maria',
      ),
    ).toEqual([
      'Makes Maria responsible for Sofia: Maria gets its review, feedback and health updates.',
      'Maria stops being responsible for Varna.',
    ])
  })
})
