import { describe, expect, it } from 'vitest'
import { memberRowsWithProperties, propertyIdsByUser } from './member-rows'

const MEMBERS = [
  {
    id: 'm1',
    userId: 'u1',
    name: 'Ada',
    email: 'ada@x.test',
    role: 'AccountAdmin' as const,
    rawRole: 'owner',
  },
  {
    id: 'm2',
    userId: 'u2',
    name: 'Maria',
    email: 'maria@x.test',
    role: 'PropertyManager' as const,
    rawRole: 'admin',
  },
  {
    id: 'm3',
    userId: 'u3',
    name: 'Nikolay',
    email: 'nik@x.test',
    role: 'PropertyManager' as const,
    rawRole: 'admin',
  },
]
const PROPERTIES = [
  { id: 'p1', name: 'Sofia' },
  { id: 'p2', name: 'Varna' },
  { id: 'p3', name: 'Burgas' },
]

describe('memberRowsWithProperties', () => {
  it('leaves the rows without properties when the viewer cannot see access', () => {
    const rows = memberRowsWithProperties(MEMBERS, undefined, PROPERTIES)
    expect(rows.every((row) => row.properties === undefined)).toBe(true)
  })

  it("names each manager's properties in the Organization's order", () => {
    const rows = memberRowsWithProperties(
      MEMBERS,
      [{ userId: 'u2', propertyIds: ['p3', 'p1'] }],
      PROPERTIES,
    )
    expect(rows[1]?.properties).toEqual([
      { id: 'p1', name: 'Sofia' },
      { id: 'p3', name: 'Burgas' },
    ])
  })

  it('gives a manager with no grants an empty list, not a missing one', () => {
    const rows = memberRowsWithProperties(MEMBERS, [], PROPERTIES)
    expect(rows[2]?.properties).toEqual([])
  })

  it('drops a grant on a property that is no longer listed', () => {
    const rows = memberRowsWithProperties(
      MEMBERS,
      [{ userId: 'u2', propertyIds: ['p-archived', 'p2'] }],
      PROPERTIES,
    )
    expect(rows[1]?.properties).toEqual([{ id: 'p2', name: 'Varna' }])
  })

  it('does not mutate the members it is given', () => {
    const before = JSON.stringify(MEMBERS)
    memberRowsWithProperties(MEMBERS, [], PROPERTIES)
    expect(JSON.stringify(MEMBERS)).toBe(before)
  })
})

describe('propertyIdsByUser', () => {
  it('indexes the grants by user', () => {
    const byUser = propertyIdsByUser([
      { userId: 'u2', propertyIds: ['p1'] },
      { userId: 'u3', propertyIds: [] },
    ])
    expect(byUser.get('u2')).toEqual(['p1'])
    expect(byUser.get('u3')).toEqual([])
    expect(byUser.get('u1')).toBeUndefined()
  })

  it('is empty when access is not visible', () => {
    expect(propertyIdsByUser(undefined).size).toBe(0)
  })
})
