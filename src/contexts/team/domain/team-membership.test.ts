import { describe, it, expect } from 'vitest'
import {
  type TeamMembership,
  createMembership,
  endMembership,
  changeRole,
  isActive,
  isLead,
  intervalsOverlap,
  validateNoOverlap,
  validateLeadUniqueness,
} from './team-membership'

describe('TeamMembership', () => {
  const baseParams = {
    id: 'memb-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    teamId: 'team-1',
    staffParticipationId: 'part-1',
    role: 'member' as const,
    effectiveFrom: new Date('2026-01-01'),
    createdBy: 'admin-1',
  }

  describe('createMembership', () => {
    it('creates an active membership', () => {
      const m = createMembership(baseParams)
      expect(m.role).toBe('member')
      expect(m.effectiveTo).toBeNull()
      expect(isActive(m, new Date('2026-03-01'))).toBe(true)
    })
  })

  describe('endMembership', () => {
    it('ends an active membership', () => {
      const m = createMembership(baseParams)
      const result = endMembership(m, new Date('2026-06-01'), 'team_restructure')
      expect(result).toHaveProperty('effectiveTo')
      if (!('code' in result) && result.effectiveTo) {
        expect(result.effectiveTo).toEqual(new Date('2026-06-01'))
        expect(result.endReason).toBe('team_restructure')
      }
    })

    it('prevents ending an already-ended membership', () => {
      const m = createMembership(baseParams)
      const ended = endMembership(m, new Date('2026-06-01'), 'test') as TeamMembership
      const result = endMembership(ended, new Date('2026-07-01'), 'again')
      expect(result).toHaveProperty('code', 'already_ended')
    })

    it('prevents ending before start', () => {
      const m = createMembership(baseParams)
      const result = endMembership(m, new Date('2025-12-31'), 'test')
      expect(result).toHaveProperty('code', 'start_after_end')
    })
  })

  describe('changeRole', () => {
    it('ends old membership and starts new with new role', () => {
      const m = createMembership(baseParams)
      const result = changeRole(m, 'lead', new Date('2026-03-01'), 'memb-2')
      expect(result).toHaveProperty('ended')
      if ('ended' in result) {
        expect(result.ended.effectiveTo).toEqual(new Date('2026-03-01'))
        expect(result.ended.endReason).toBe('role_changed')
        expect(result.started.role).toBe('lead')
        expect(result.started.effectiveFrom).toEqual(new Date('2026-03-01'))
      }
    })

    it('prevents changing role on ended membership', () => {
      const m = endMembership(
        createMembership(baseParams),
        new Date('2026-06-01'),
        'done',
      ) as TeamMembership
      const result = changeRole(m, 'lead', new Date('2026-07-01'), 'memb-2')
      expect(result).toHaveProperty('code', 'cannot_change_role_on_ended')
    })
  })

  describe('isActive', () => {
    it('active when within interval', () => {
      const m = createMembership(baseParams)
      expect(isActive(m, new Date('2026-03-01'))).toBe(true)
    })

    it('inactive after effective_to', () => {
      const m = endMembership(
        createMembership(baseParams),
        new Date('2026-06-01'),
        'test',
      ) as TeamMembership
      expect(isActive(m, new Date('2026-07-01'))).toBe(false)
    })

    it('inactive before effective_from', () => {
      const m = createMembership({ ...baseParams, effectiveFrom: new Date('2026-06-01') })
      expect(isActive(m, new Date('2026-01-01'))).toBe(false)
    })

    it('active at effective_from (half-open includes start)', () => {
      const m = createMembership(baseParams)
      expect(isActive(m, new Date('2026-01-01'))).toBe(true)
    })

    it('inactive at effective_to (half-open excludes end)', () => {
      const m = endMembership(
        createMembership(baseParams),
        new Date('2026-06-01'),
        'test',
      ) as TeamMembership
      expect(isActive(m, new Date('2026-06-01'))).toBe(false)
    })
  })

  describe('intervalsOverlap', () => {
    it('detects overlapping intervals', () => {
      expect(
        intervalsOverlap(
          { from: new Date('2026-01-01'), to: new Date('2026-06-01') },
          { from: new Date('2026-03-01'), to: new Date('2026-09-01') },
        ),
      ).toBe(true)
    })

    it('non-overlapping sequential intervals do not overlap', () => {
      expect(
        intervalsOverlap(
          { from: new Date('2026-01-01'), to: new Date('2026-03-01') },
          { from: new Date('2026-03-01'), to: new Date('2026-06-01') },
        ),
      ).toBe(false)
    })

    it('open-ended interval overlaps anything after its start', () => {
      expect(
        intervalsOverlap(
          { from: new Date('2026-01-01'), to: null },
          { from: new Date('2026-06-01'), to: null },
        ),
      ).toBe(true)
    })
  })

  describe('validateNoOverlap', () => {
    it('returns null when no overlap', () => {
      const existing = [
        endMembership(
          createMembership(baseParams),
          new Date('2026-03-01'),
          'done',
        ) as TeamMembership,
      ]
      const result = validateNoOverlap(existing, new Date('2026-03-01'))
      expect(result).toBeNull()
    })

    it('returns error when overlap detected', () => {
      const existing = [createMembership(baseParams)]
      const result = validateNoOverlap(existing, new Date('2026-02-01'))
      expect(result).toHaveProperty('code', 'overlap_detected')
    })
  })

  describe('validateLeadUniqueness', () => {
    it('returns null when no active lead exists', () => {
      const existing = [createMembership(baseParams)]
      expect(
        validateLeadUniqueness(existing, 'team-1', new Date('2026-02-01')),
      ).toBeNull()
    })

    it('returns error when active lead exists', () => {
      const existing = [createMembership({ ...baseParams, role: 'lead' as const })]
      const result = validateLeadUniqueness(existing, 'team-1', new Date('2026-02-01'))
      expect(result).toHaveProperty('code', 'lead_exists')
    })

    it('ignores ended lead', () => {
      const lead = endMembership(
        createMembership({ ...baseParams, role: 'lead' as const }),
        new Date('2026-03-01'),
        'done',
      ) as TeamMembership
      expect(validateLeadUniqueness([lead], 'team-1', new Date('2026-04-01'))).toBeNull()
    })
  })

  describe('isLead', () => {
    it('returns true for lead role', () => {
      const m = createMembership({ ...baseParams, role: 'lead' as const })
      expect(isLead(m)).toBe(true)
    })

    it('returns false for member role', () => {
      const m = createMembership(baseParams)
      expect(isLead(m)).toBe(false)
    })
  })
})
