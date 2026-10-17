// Who a goal is for, by name: never a count of subjects.
import { describe, expect, it } from 'vitest'
import type { GoalSubject } from '#/contexts/reporting/application/public-api'
import { goalListSubjectText } from './goal-assignment-subject-label'

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

  // The server and the browser order the names alike, whatever the browser's
  // own language: a Cyrillic name after a Latin one, and "Bar 2" before "Bar 10".
  it('orders names the same for every reader, numbers by value', () => {
    const named = (names: Readonly<Record<string, string>>) => (subject: GoalSubject) =>
      subject.kind === 'portal' ? (names[subject.portalId] ?? 'Portal') : 'Portal'
    const portal = (portalId: string): GoalSubject => ({ kind: 'portal', portalId })

    expect(
      goalListSubjectText(
        [portal('reception'), portal('spa')],
        named({ reception: 'Рецепция', spa: 'Spa' }),
      ),
    ).toBe('Spa and Рецепция')
    expect(
      goalListSubjectText(
        [portal('bar-10'), portal('bar-2'), portal('bar-1')],
        named({ 'bar-10': 'Bar 10', 'bar-2': 'Bar 2', 'bar-1': 'Bar 1' }),
      ),
    ).toBe('Bar 1 and 2 more')
    expect(
      goalListSubjectText(
        [portal('bar-10'), portal('bar-2')],
        named({ 'bar-10': 'Bar 10', 'bar-2': 'Bar 2' }),
      ),
    ).toBe('Bar 2 and Bar 10')
  })

  it('says nothing for a goal with no subject', () => {
    expect(goalListSubjectText([], nameOf)).toBeNull()
  })

  it('never counts subjects', () => {
    expect(goalListSubjectText([reception], nameOf)).not.toMatch(/subject/u)
  })
})
