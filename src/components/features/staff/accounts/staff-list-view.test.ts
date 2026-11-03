import { expect, it } from 'vitest'
import { staffInNameOrder, filterStaff, staffRosterSummary } from './staff-list-view'
import type { StaffMember } from './staff-account-view'
const person = (
  displayName: string,
  access: StaffMember['access'],
  group?: StaffMember['group'],
): StaffMember => ({
  participationId: displayName,
  displayName,
  access,
  group,
  portalId: null,
  operationId: null,
  code: null,
  step: null,
})
it('puts people who have not joined first, then A to Z in each section', () => {
  const people = [
    person('Bob', 'active'),
    person('Zoe', 'invited'),
    person('Ana', 'active'),
    person('Tom', 'invite_expired'),
  ]
  expect(staffInNameOrder(people).map((row) => row.displayName)).toEqual([
    'Tom',
    'Zoe',
    'Ana',
    'Bob',
  ])
  expect(people[0]?.displayName).toBe('Bob')
})
it('combines group and joining filters', () => {
  const group = { id: 'desk', name: 'Desk' }
  const people = [
    person('Ana', 'active', group),
    person('Bob', 'invited'),
    person('Zoe', 'invited', group),
  ]
  expect(filterStaff(people, 'pending', 'desk').map((row) => row.displayName)).toEqual([
    'Zoe',
  ])
  expect(filterStaff(people, 'all', 'none').map((row) => row.displayName)).toEqual([
    'Bob',
  ])
})

it('says one person has not joined, and several people have not joined', () => {
  expect(staffRosterSummary([person('Ana', 'invited')])).toBe(
    "1 person, 1 hasn't joined yet",
  )
  expect(
    staffRosterSummary([person('Ana', 'invited'), person('Zoe', 'invite_expired')]),
  ).toBe("2 people, 2 haven't joined yet")
})
