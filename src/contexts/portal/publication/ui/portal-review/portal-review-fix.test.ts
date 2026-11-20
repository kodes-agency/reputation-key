import { describe, expect, it } from 'vitest'
import {
  describeFixLink,
  describeWhoCanFix,
  joinPeopleNames,
  resolveFixPeople,
} from './portal-review-checks'

describe('describeWhoCanFix', () => {
  const people = [
    { userId: 'me', name: 'Eli Petrova' },
    { userId: 'u2', name: 'Georgi Ivanov' },
    { userId: 'u3', name: 'Maria Koleva' },
    { userId: 'u4', name: 'Ivan Dimov' },
    { userId: 'u5', name: 'Nora Stoyanova' },
  ]

  it('names the viewer first as "you"', () => {
    expect(describeWhoCanFix('me', people.slice(0, 2))).toBe('you or Georgi Ivanov')
    expect(describeWhoCanFix('u2', people.slice(0, 2))).toBe('you or Eli Petrova')
  })

  it('names one person, or several with the last joined by "or"', () => {
    expect(describeWhoCanFix('x', [people[1]!])).toBe('Georgi Ivanov')
    expect(describeWhoCanFix('x', people.slice(1, 4))).toBe(
      'Georgi Ivanov, Maria Koleva or Ivan Dimov',
    )
  })

  it('counts the rest when the list is long', () => {
    expect(describeWhoCanFix('x', people)).toBe(
      'Eli Petrova, Georgi Ivanov, Maria Koleva or 2 more',
    )
  })

  it('says nothing when no one is known', () => {
    expect(describeWhoCanFix('me', [])).toBeNull()
  })
})

describe('joinPeopleNames', () => {
  it('joins names with "or", naming three and counting the rest', () => {
    expect(joinPeopleNames(['Georgi Ivanov'])).toBe('Georgi Ivanov')
    expect(joinPeopleNames(['Georgi Ivanov', 'Eli Petrova'])).toBe(
      'Georgi Ivanov or Eli Petrova',
    )
    expect(joinPeopleNames(['A', 'B', 'C', 'D'])).toBe('A, B, C or 1 more')
    expect(joinPeopleNames([])).toBeNull()
  })
})

describe('describeFixLink', () => {
  it('names the section the link opens, on the Page tab', () => {
    expect(describeFixLink({ tab: 'page', section: 'languages' })).toEqual({
      label: 'Open Languages',
      search: { tab: 'page', section: 'languages' },
    })
    expect(describeFixLink({ tab: 'page', section: 'responsible' })).toEqual({
      label: 'Open Responsible',
      search: { tab: 'page', section: 'responsible' },
    })
  })

  it('opens the Share tab', () => {
    expect(describeFixLink({ tab: 'share' })).toEqual({
      label: 'Open Share',
      search: { tab: 'share' },
    })
  })
})

describe('resolveFixPeople', () => {
  const members = [
    {
      userId: 'u1',
      name: 'Georgi Ivanov',
      email: 'g@example.test',
      role: 'PropertyManager',
    },
    {
      userId: 'u2',
      name: 'Elena Petrova',
      email: 'e@example.test',
      role: 'AccountAdmin',
    },
  ]
  const state = (assigned: string[], eligible: string[]) => ({
    assignments: assigned.map((userId) => ({ userId })),
    eligibleManagers: eligible.map((userId) => ({
      userId,
      role: 'PropertyManager' as const,
    })),
    revision: 1,
    responsibilityNeeded: false,
    responsibilityNeededSince: null,
  })

  it('names the responsible managers', () => {
    expect(resolveFixPeople(state(['u1'], ['u1', 'u2']), members)).toEqual([
      { userId: 'u1', name: 'Georgi Ivanov' },
    ])
  })

  it('names the managers who could be made responsible when no one is', () => {
    expect(resolveFixPeople(state([], ['u1', 'u2']), members)).toEqual([
      { userId: 'u1', name: 'Georgi Ivanov' },
      { userId: 'u2', name: 'Elena Petrova' },
    ])
  })

  it('leaves out a person the member list cannot name', () => {
    expect(resolveFixPeople(state(['gone', 'u2'], []), members)).toEqual([
      { userId: 'u2', name: 'Elena Petrova' },
    ])
  })
})
