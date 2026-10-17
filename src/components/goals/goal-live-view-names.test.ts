// The words a Goals row uses for who a goal is for and for the days left in
// its month: names, never a count of subjects, and today counted as a day left.
import { describe, expect, it } from 'vitest'
import type { GoalSubject } from '#/contexts/reporting/application/public-api'
import { daysLeftWords, goalListSubjectText } from './goal-live-view'

describe('who a row says its goal is for', () => {
  const property: GoalSubject = { kind: 'property', propertyId: 'property-1' }
  const reception: GoalSubject = { kind: 'portal', portalId: 'portal-reception' }
  const spa: GoalSubject = { kind: 'portal', portalId: 'portal-spa' }
  const restaurant: GoalSubject = { kind: 'portal', portalId: 'portal-restaurant' }
  const rooms: GoalSubject = { kind: 'portal_group', portalGroupId: 'group-rooms' }
  const NAMES: Readonly<Record<string, string>> = {
    'property-1': 'Seaview Hotel',
    'portal-reception': 'Reception',
    'portal-spa': 'Spa',
    'portal-restaurant': 'Restaurant',
    'group-rooms': 'Rooms',
  }
  const nameOf = (subject: GoalSubject): string =>
    NAMES[
      subject.kind === 'property'
        ? subject.propertyId
        : subject.kind === 'portal_group'
          ? subject.portalGroupId
          : subject.portalId
    ] ?? 'Portal'

  it('names the one portal a goal counts', () => {
    expect(goalListSubjectText([reception], nameOf)).toBe('Reception')
    expect(goalListSubjectText([property], nameOf)).toBe('Seaview Hotel')
    expect(goalListSubjectText([rooms], nameOf)).toBe('Rooms (group)')
  })

  it('names two and counts the rest', () => {
    expect(goalListSubjectText([spa, reception], nameOf)).toBe('Reception and Spa')
    expect(goalListSubjectText([spa, restaurant, reception], nameOf)).toBe(
      'Reception and 2 more',
    )
  })

  it('names the property first, then groups, then portals, each by name', () => {
    expect(goalListSubjectText([spa, rooms, property], nameOf)).toBe(
      'Seaview Hotel and 2 more',
    )
    expect(goalListSubjectText([spa, rooms], nameOf)).toBe('Rooms (group) and Spa')
  })

  it('says nothing for a goal with no subject', () => {
    expect(goalListSubjectText([], nameOf)).toBeNull()
  })

  it('never counts subjects', () => {
    expect(goalListSubjectText([reception], nameOf)).not.toMatch(/subject/u)
  })
})

describe('the days left in a month', () => {
  it('counts today as a day left: 9 on Nov 22', () => {
    // Nov 22 of a 30-day month: 8 whole days begin after today.
    expect(daysLeftWords(8)).toBe('9 days left')
  })

  it('the last day says last day', () => {
    expect(daysLeftWords(0)).toBe('last day')
  })

  it('says 2 days left the day before the last', () => {
    expect(daysLeftWords(1)).toBe('2 days left')
  })
})
