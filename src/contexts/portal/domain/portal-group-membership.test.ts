import { describe, it, expect } from 'vitest'
import {
  type PortalGroupMembership,
  createMembership,
  endMembership,
  movePortalToGroup,
  isActive,
  validateGroupUniqueness,
  resolveGroupAt,
} from './portal-group-membership'

describe('PortalGroupMembership', () => {
  const baseParams = {
    id: 'gm-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    portalId: 'portal-1',
    portalGroupId: 'group-1',
    effectiveFrom: new Date('2026-01-01'),
    createdBy: 'admin-1',
  }

  describe('createMembership', () => {
    it('creates an active membership', () => {
      const m = createMembership(baseParams)
      expect(m.portalGroupId).toBe('group-1')
      expect(m.effectiveTo).toBeNull()
      expect(isActive(m, new Date('2026-03-01'))).toBe(true)
    })
  })

  describe('endMembership', () => {
    it('ends an active membership', () => {
      const m = createMembership(baseParams)
      const result = endMembership(m, new Date('2026-06-01'), 'group_dissolved')
      expect(result).toHaveProperty('effectiveTo')
      if ('effectiveTo' in result && result.effectiveTo) {
        expect(result.endReason).toBe('group_dissolved')
      }
    })

    it('prevents ending an already-ended membership', () => {
      const m = endMembership(
        createMembership(baseParams),
        new Date('2026-06-01'),
        'done',
      ) as PortalGroupMembership
      const result = endMembership(m, new Date('2026-07-01'), 'again')
      expect(result).toHaveProperty('code', 'already_ended')
    })
  })

  describe('movePortalToGroup', () => {
    it('ends old membership and starts new group membership', () => {
      const m = createMembership(baseParams)
      const result = movePortalToGroup(
        m,
        'group-2',
        new Date('2026-03-01'),
        'gm-2',
        'org-1',
        'prop-1',
        'admin-1',
      )
      if ('ended' in result) {
        expect(result.ended.effectiveTo).toEqual(new Date('2026-03-01'))
        expect(result.ended.endReason).toBe('moved_to_new_group')
        expect(result.started.portalGroupId).toBe('group-2')
        expect(result.started.effectiveFrom).toEqual(new Date('2026-03-01'))
      }
    })
  })

  describe('isActive', () => {
    it('active within interval', () => {
      const m = createMembership(baseParams)
      expect(isActive(m, new Date('2026-03-01'))).toBe(true)
    })

    it('inactive after end', () => {
      const m = endMembership(
        createMembership(baseParams),
        new Date('2026-06-01'),
        'done',
      ) as PortalGroupMembership
      expect(isActive(m, new Date('2026-07-01'))).toBe(false)
    })

    it('half-open: active at start, inactive at end', () => {
      const m = endMembership(
        createMembership(baseParams),
        new Date('2026-06-01'),
        'done',
      ) as PortalGroupMembership
      expect(isActive(m, new Date('2026-01-01'))).toBe(true)
      expect(isActive(m, new Date('2026-06-01'))).toBe(false)
    })
  })

  describe('validateGroupUniqueness', () => {
    it('returns null when no active group exists', () => {
      const existing = [
        endMembership(
          createMembership(baseParams),
          new Date('2026-03-01'),
          'done',
        ) as PortalGroupMembership,
      ]
      expect(
        validateGroupUniqueness(existing, 'portal-1', new Date('2026-04-01')),
      ).toBeNull()
    })

    it('returns error when active group exists', () => {
      const existing = [createMembership(baseParams)]
      const result = validateGroupUniqueness(existing, 'portal-1', new Date('2026-02-01'))
      expect(result).toHaveProperty('code', 'group_exists')
    })
  })

  describe('resolveGroupAt (event-time attribution)', () => {
    it('returns exact quality when interval covers the time', () => {
      const m = createMembership(baseParams)
      const result = resolveGroupAt([m], 'portal-1', new Date('2026-03-01'))
      expect(result.portalGroupId).toBe('group-1')
      expect(result.quality).toBe('exact')
      expect(result.membershipId).toBe('gm-1')
    })

    it('returns exact quality after a move (new interval)', () => {
      const m1 = createMembership(baseParams)
      const move = movePortalToGroup(
        m1,
        'group-2',
        new Date('2026-03-01'),
        'gm-2',
        'org-1',
        'prop-1',
        'admin-1',
      )
      if ('started' in move) {
        const result = resolveGroupAt(
          [move.ended, move.started],
          'portal-1',
          new Date('2026-04-01'),
        )
        expect(result.portalGroupId).toBe('group-2')
        expect(result.quality).toBe('exact')
      }
    })

    it('returns current_state_backfill when event predates migration', () => {
      const m = createMembership({ ...baseParams, effectiveFrom: new Date('2026-03-01') })
      const result = resolveGroupAt([m], 'portal-1', new Date('2026-01-01'))
      expect(result.portalGroupId).toBe('group-1')
      expect(result.quality).toBe('current_state_backfill')
    })

    it('returns unresolved when no membership found', () => {
      const result = resolveGroupAt([], 'portal-1', new Date('2026-01-01'))
      expect(result.portalGroupId).toBeNull()
      expect(result.quality).toBe('unresolved')
    })

    it('event before move gets old group (non-retroactive)', () => {
      const m1 = createMembership(baseParams)
      const move = movePortalToGroup(
        m1,
        'group-2',
        new Date('2026-03-01'),
        'gm-2',
        'org-1',
        'prop-1',
        'admin-1',
      )
      if ('started' in move) {
        // Event in February should resolve to group-1, not group-2
        const result = resolveGroupAt(
          [move.ended, move.started],
          'portal-1',
          new Date('2026-02-01'),
        )
        expect(result.portalGroupId).toBe('group-1')
        expect(result.quality).toBe('exact')
      }
    })

    it('event after move gets new group (non-retroactive)', () => {
      const m1 = createMembership(baseParams)
      const move = movePortalToGroup(
        m1,
        'group-2',
        new Date('2026-03-01'),
        'gm-2',
        'org-1',
        'prop-1',
        'admin-1',
      )
      if ('started' in move) {
        const result = resolveGroupAt(
          [move.ended, move.started],
          'portal-1',
          new Date('2026-05-01'),
        )
        expect(result.portalGroupId).toBe('group-2')
        expect(result.quality).toBe('exact')
      }
    })
  })
})
