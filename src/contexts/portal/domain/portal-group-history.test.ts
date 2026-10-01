// Portal context — Portal Group history ledger entries.

import { describe, expect, it } from 'vitest'
import { organizationId, portalGroupId, portalId, propertyId } from '#/shared/domain/ids'
import {
  groupMovementEntries,
  portalGroupHistoryEntry,
  PORTAL_GROUP_HISTORY_KINDS,
} from './portal-group-history'
import { isPortalError } from './errors'

const ORG = organizationId('org-history-0000000000000000001')
const PROPERTY = propertyId('6a000000-0000-4000-8000-000000000001')
const GROUP_A = portalGroupId('6f000000-0000-4000-8000-000000000001')
const GROUP_B = portalGroupId('6f000000-0000-4000-8000-000000000002')
const PORTAL = portalId('6b000000-0000-4000-8000-000000000001')
const AT = new Date('2026-09-30T10:00:00.000Z')
const base = {
  organizationId: ORG,
  propertyId: PROPERTY,
  portalGroupId: GROUP_A,
  actorUserId: 'manager-1',
  occurredAt: AT,
}

describe('portalGroupHistoryEntry', () => {
  it('records a creation with the name at the time', () => {
    expect(
      portalGroupHistoryEntry({ ...base, kind: 'created', name: ' Front Desk ' }),
    ).toEqual({
      ...base,
      kind: 'created',
      portalId: null,
      otherGroupId: null,
      name: 'Front Desk',
      previousName: null,
    })
  })

  it('records a rename with the previous and the new name', () => {
    const entry = portalGroupHistoryEntry({
      ...base,
      kind: 'renamed',
      name: 'Lobby',
      previousName: 'Front Desk',
    })
    expect(entry.name).toBe('Lobby')
    expect(entry.previousName).toBe('Front Desk')
  })

  it('records an archive without names or a Portal', () => {
    const entry = portalGroupHistoryEntry({ ...base, kind: 'archived' })
    expect(entry).toMatchObject({ portalId: null, otherGroupId: null, name: null })
  })

  it.each(['portal_added', 'portal_removed'] as const)(
    '%s names the Portal and no other group',
    (kind) => {
      const entry = portalGroupHistoryEntry({ ...base, kind, portalId: PORTAL })
      expect(entry).toMatchObject({ kind, portalId: PORTAL, otherGroupId: null })
    },
  )

  it.each(['portal_moved_in', 'portal_moved_out'] as const)(
    '%s names the Portal and the group on the other side',
    (kind) => {
      const entry = portalGroupHistoryEntry({
        ...base,
        kind,
        portalId: PORTAL,
        otherGroupId: GROUP_B,
      })
      expect(entry).toMatchObject({ kind, portalId: PORTAL, otherGroupId: GROUP_B })
    },
  )

  it.each([
    ['created without a name', { kind: 'created' as const }],
    ['a blank name', { kind: 'created' as const, name: '   ' }],
    ['a rename without the previous name', { kind: 'renamed' as const, name: 'X' }],
    ['a membership fact without a Portal', { kind: 'portal_added' as const }],
    [
      'a move without the other group',
      { kind: 'portal_moved_in' as const, portalId: PORTAL },
    ],
    ['an archive that names a Portal', { kind: 'archived' as const, portalId: PORTAL }],
    [
      'a plain membership fact that names another group',
      { kind: 'portal_added' as const, portalId: PORTAL, otherGroupId: GROUP_B },
    ],
  ])('rejects %s', (_label, extra) => {
    try {
      portalGroupHistoryEntry({ ...base, ...extra })
      expect.unreachable('expected the entry to be rejected')
    } catch (error) {
      expect(isPortalError(error)).toBe(true)
    }
  })

  it('knows exactly the seven kinds the table admits', () => {
    expect([...PORTAL_GROUP_HISTORY_KINDS]).toEqual([
      'created',
      'renamed',
      'archived',
      'portal_added',
      'portal_removed',
      'portal_moved_in',
      'portal_moved_out',
    ])
  })
})

describe('groupMovementEntries', () => {
  it('writes one entry to each side of a move', () => {
    const entries = groupMovementEntries({
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      fromGroupId: GROUP_A,
      toGroupId: GROUP_B,
      actorUserId: 'manager-1',
      occurredAt: AT,
    })
    expect(entries).toEqual([
      expect.objectContaining({
        portalGroupId: GROUP_A,
        kind: 'portal_moved_out',
        otherGroupId: GROUP_B,
      }),
      expect.objectContaining({
        portalGroupId: GROUP_B,
        kind: 'portal_moved_in',
        otherGroupId: GROUP_A,
      }),
    ])
  })

  it('writes a plain addition when the Portal had no group', () => {
    const entries = groupMovementEntries({
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      fromGroupId: null,
      toGroupId: GROUP_B,
      actorUserId: 'manager-1',
      occurredAt: AT,
    })
    expect(entries).toEqual([
      expect.objectContaining({ portalGroupId: GROUP_B, kind: 'portal_added' }),
    ])
  })
})
