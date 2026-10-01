import { describe, expect, it } from 'vitest'
import { organizationRoster, readablePropertyIds } from './portal-results-roster'

const row = (portalId: string, propertyId: string, group: string | null = null) => ({
  portalId,
  propertyId,
  group: group === null ? null : { id: group },
})

describe('organizationRoster', () => {
  it('lists every Portal with its group, and one zone per Property that has one', () => {
    const roster = organizationRoster(
      [row('p1', 'a', 'g1'), row('p2', 'a'), row('p3', 'b')],
      new Map([
        ['a', 'Europe/Sofia'],
        ['b', 'America/New_York'],
      ]),
    )

    expect(roster.portals).toEqual([
      { portalId: 'p1', propertyId: 'a', groupId: 'g1' },
      { portalId: 'p2', propertyId: 'a', groupId: null },
      { portalId: 'p3', propertyId: 'b', groupId: null },
    ])
    expect(roster.properties).toEqual([
      { propertyId: 'a', timezone: 'Europe/Sofia' },
      { propertyId: 'b', timezone: 'America/New_York' },
    ])
  })

  it('leaves out a Property with no time zone rather than reading it in a guessed one', () => {
    const roster = organizationRoster(
      [row('p1', 'a'), row('p2', 'b')],
      new Map<string, string | null>([
        ['a', 'Europe/Sofia'],
        ['b', null],
      ]),
    )

    expect(roster.portals.map((entry) => entry.portalId)).toEqual(['p1'])
    expect(roster.properties.map((zone) => zone.propertyId)).toEqual(['a'])
  })

  it('names no Property that has no Portal in the roster', () => {
    const roster = organizationRoster(
      [row('p1', 'a')],
      new Map([
        ['a', 'Europe/Sofia'],
        ['unused', 'UTC'],
      ]),
    )

    expect(roster.properties).toEqual([{ propertyId: 'a', timezone: 'Europe/Sofia' }])
  })

  it('answers an empty roster for no Portals', () => {
    expect(organizationRoster([], new Map())).toEqual({ portals: [], properties: [] })
  })
})

describe('readablePropertyIds', () => {
  it('keeps only the Properties every question allows, in the order given', async () => {
    const allowed = await readablePropertyIds(
      ['a', 'b', 'c'],
      [async (id) => id !== 'b', async (id) => id !== 'c'],
    )

    expect(allowed).toEqual(['a'])
  })

  it('keeps every Property when there is nothing to ask', async () => {
    expect(await readablePropertyIds(['a', 'b'], [])).toEqual(['a', 'b'])
  })
})
