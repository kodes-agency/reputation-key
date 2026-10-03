import { describe, expect, it } from 'vitest'
import type { PortalGroupHistoryEntry } from '#/contexts/portal/application/public-api'
import { organizationId, portalGroupId, portalId, propertyId } from '#/shared/domain/ids'
import { buildPortalGroupHistory, type HistoryNames } from './portal-group-history-view'

const GROUP = portalGroupId('pool-side')
const WELLNESS = portalGroupId('wellness')

const entry = (
  id: string,
  at: string,
  overrides: Partial<Omit<PortalGroupHistoryEntry, 'id' | 'occurredAt'>> &
    Pick<PortalGroupHistoryEntry, 'kind'>,
): PortalGroupHistoryEntry => ({
  id,
  organizationId: organizationId('org-1'),
  propertyId: propertyId('prop-1'),
  portalGroupId: GROUP,
  portalId: null,
  otherGroupId: null,
  name: null,
  previousName: null,
  actorUserId: 'elena',
  occurredAt: new Date(at),
  ...overrides,
})

const names: HistoryNames = {
  actor: (userId) =>
    ({ elena: 'Elena Petrova', georgi: 'Georgi Ivanov' })[userId] ?? null,
  portal: (id) =>
    ({
      pool: 'Pool & Terrace',
      spa: 'Spa & thermal pools',
      bar: 'Pool bar',
    })[id] ?? null,
  group: (id) => (id === WELLNESS ? 'Wellness' : null),
}

const frame = {
  groupName: 'Pool side',
  timezone: 'Europe/Sofia',
  now: new Date('2026-09-30T10:00:00.000Z'),
}

// What the create-with-move wrote on 12 Aug, then a rename on 14 Aug.
const created = [
  entry('c', '2026-08-12T09:00:00.000Z', { kind: 'created', name: 'Pools' }),
  entry('a1', '2026-08-12T09:00:00.000Z', {
    kind: 'portal_added',
    portalId: portalId('pool'),
  }),
  entry('m1', '2026-08-12T09:00:00.000Z', {
    kind: 'portal_moved_in',
    portalId: portalId('spa'),
    otherGroupId: WELLNESS,
  }),
  entry('a2', '2026-08-12T09:00:00.000Z', {
    kind: 'portal_added',
    portalId: portalId('bar'),
  }),
]
const renamed = entry('r', '2026-08-14T08:00:00.000Z', {
  kind: 'renamed',
  name: 'Pool side',
  previousName: 'Pools',
  actorUserId: 'georgi',
})

describe('buildPortalGroupHistory', () => {
  const lines = buildPortalGroupHistory([renamed, ...created], names, frame)

  it('writes the board lines, newest first', () => {
    expect(lines.map((line) => [line.text, line.detail, line.dateLabel])).toEqual([
      ['Georgi Ivanov renamed Pools to Pool side', null, 'Aug 14'],
      [
        'Spa & thermal pools moved here from Wellness',
        'Its results before Aug 12 stay with Wellness',
        'Aug 12',
      ],
      [
        'Elena Petrova created Pools with 3 portals',
        'Pool & Terrace, Pool bar and Spa & thermal pools',
        'Aug 12',
      ],
    ])
  })

  it('folds the portals a group was created with into its creation line', () => {
    expect(lines.filter((line) => line.kind === 'added')).toEqual([])
  })

  it('tells a move in from a move out by its kind', () => {
    const kinds = buildPortalGroupHistory(
      [
        entry('o', '2026-09-02T09:00:00.000Z', {
          kind: 'portal_moved_out',
          portalId: portalId('spa'),
          otherGroupId: WELLNESS,
        }),
        ...created,
      ],
      names,
      frame,
    ).map((line) => line.kind)

    expect(kinds).toEqual(['moved_out', 'moved_in', 'created'])
  })

  it('gives every line a stable key and a machine-readable time', () => {
    expect(lines.map((line) => line.id)).toEqual(['r', 'm1', 'c'])
    expect(lines[0]?.occurredAt).toBe('2026-08-14T08:00:00.000Z')
  })

  it('says "created X" alone when it started with no portals', () => {
    const [line] = buildPortalGroupHistory(
      [entry('c', '2026-08-12T09:00:00.000Z', { kind: 'created', name: 'Pools' })],
      names,
      frame,
    )

    expect(line?.text).toBe('Elena Petrova created Pools')
    expect(line?.detail).toBeNull()
  })

  it('says "with 1 portal", not "with 1 portals"', () => {
    const [line] = buildPortalGroupHistory([created[0]!, created[1]!], names, frame)

    expect(line?.text).toBe('Elena Petrova created Pools with 1 portal')
    expect(line?.detail).toBe('Pool & Terrace')
  })

  it('does not fold a later addition into the creation', () => {
    const later = entry('a3', '2026-08-20T09:00:00.000Z', {
      kind: 'portal_added',
      portalId: portalId('bar'),
    })

    const result = buildPortalGroupHistory([later, created[0]!], names, frame)

    expect(result.map((line) => line.text)).toEqual([
      'Pool bar added',
      'Elena Petrova created Pools',
    ])
  })

  it('says where a moved-out portal went and that its earlier results stay here', () => {
    const [line] = buildPortalGroupHistory(
      [
        entry('o', '2026-09-02T09:00:00.000Z', {
          kind: 'portal_moved_out',
          portalId: portalId('spa'),
          otherGroupId: WELLNESS,
        }),
      ],
      names,
      frame,
    )

    expect(line?.text).toBe('Spa & thermal pools moved to Wellness')
    expect(line?.detail).toBe('Its results before Sep 2 stay here')
  })

  it('says a removed portal keeps its earlier results with the group', () => {
    const [line] = buildPortalGroupHistory(
      [
        entry('x', '2026-09-02T09:00:00.000Z', {
          kind: 'portal_removed',
          portalId: portalId('bar'),
        }),
      ],
      names,
      frame,
    )

    expect(line?.text).toBe('Pool bar removed')
    expect(line?.detail).toBe('Its results before Sep 2 stay with Pool side')
  })

  it('never prints an id for a name it cannot resolve', () => {
    const lines = buildPortalGroupHistory(
      [
        entry('m', '2026-09-02T09:00:00.000Z', {
          kind: 'portal_moved_in',
          portalId: portalId('gone'),
          otherGroupId: portalGroupId('archived-group'),
          actorUserId: 'unknown-user',
        }),
        entry('c', '2026-08-12T09:00:00.000Z', {
          kind: 'created',
          name: 'Pools',
          actorUserId: 'unknown-user',
        }),
      ],
      names,
      frame,
    )

    expect(lines.map((line) => line.text)).toEqual([
      'A portal moved here from another group',
      'Someone created Pools',
    ])
    expect(lines[0]?.detail).toBe('Its results before Sep 2 stay with that group')
  })

  it('names the year of an entry from an earlier year', () => {
    const [line] = buildPortalGroupHistory(
      [entry('c', '2025-12-30T10:00:00.000Z', { kind: 'created', name: 'Pools' })],
      names,
      frame,
    )

    expect(line?.dateLabel).toBe('Dec 30, 2025')
  })

  it('dates an entry by the property day, not the UTC day', () => {
    const [line] = buildPortalGroupHistory(
      // 22:30 UTC on 31 Aug is already 1 Sep in Sofia.
      [entry('c', '2026-08-31T22:30:00.000Z', { kind: 'created', name: 'Pools' })],
      names,
      frame,
    )

    expect(line?.dateLabel).toBe('Sep 1')
  })

  it('writes the archive line for the group itself', () => {
    const [line] = buildPortalGroupHistory(
      [entry('z', '2026-09-03T09:00:00.000Z', { kind: 'archived' })],
      names,
      frame,
    )

    expect(line?.text).toBe('Elena Petrova archived Pool side')
  })
})
