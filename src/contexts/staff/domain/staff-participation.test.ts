import { describe, it, expect } from 'vitest'
import {
  type StaffParticipation,
  createParticipation,
  deactivate,
  reactivate,
  archive,
  updateProfile,
  isActive,
  isValidTransition,
} from './staff-participation'

describe('StaffParticipation', () => {
  const NOW = new Date('2026-01-15T12:00:00Z')

  const baseParams = {
    id: 'part-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    userId: 'user-1',
    displayName: 'Jane Doe',
    createdBy: 'admin-1',
    now: NOW,
  }

  describe('createParticipation', () => {
    it('creates an active participation', () => {
      const p = createParticipation(baseParams)
      expect(p.status).toBe('active')
      expect(isActive(p)).toBe(true)
      expect(p.startedAt).toEqual(NOW)
      expect(p.endedAt).toBeNull()
    })
  })

  describe('deactivate', () => {
    it('deactivates an active participation', () => {
      const p = createParticipation(baseParams)
      const result = deactivate(p, NOW)
      expect(result).toHaveProperty('status', 'inactive')
      if (!('code' in result)) {
        expect(result.endedAt).toEqual(NOW)
        expect(isActive(result)).toBe(false)
      }
    })

    it('prevents deactivating an archived participation', () => {
      const p = archive(createParticipation(baseParams), NOW) as StaffParticipation
      const result = deactivate(p, NOW)
      expect(result).toHaveProperty('code', 'already_archived')
    })
  })

  describe('reactivate', () => {
    it('reactivates an inactive participation', () => {
      const p = createParticipation(baseParams)
      const inactive = deactivate(p, NOW) as StaffParticipation
      const result = reactivate(inactive, NOW)
      expect(result).toHaveProperty('status', 'active')
      if (!('code' in result)) {
        expect(result.endedAt).toBeNull()
      }
    })

    it('cannot reactivate an archived participation', () => {
      const p = archive(createParticipation(baseParams), NOW) as StaffParticipation
      const result = reactivate(p, NOW)
      expect(result).toHaveProperty('code', 'invalid_transition')
    })
  })

  describe('archive', () => {
    it('archives an active participation', () => {
      const p = createParticipation(baseParams)
      const result = archive(p, NOW)
      expect(result).toHaveProperty('status', 'archived')
    })

    it('archives an inactive participation', () => {
      const p = deactivate(createParticipation(baseParams), NOW) as StaffParticipation
      const result = archive(p, NOW)
      expect(result).toHaveProperty('status', 'archived')
    })

    it('prevents archiving an already-archived participation', () => {
      const p = archive(createParticipation(baseParams), NOW) as StaffParticipation
      const result = archive(p, NOW)
      expect(result).toHaveProperty('code', 'already_archived')
    })
  })

  describe('updateProfile', () => {
    it('updates display name', () => {
      const p = createParticipation(baseParams)
      const updated = updateProfile(p, 'New Name', NOW)
      expect(updated.displayName).toBe('New Name')
      expect(updated.id).toBe(p.id)
      expect(updated.updatedAt).toEqual(NOW)
    })
  })

  describe('isValidTransition', () => {
    it('allows active -> inactive', () => {
      expect(isValidTransition('active', 'inactive')).toBe(true)
    })

    it('allows inactive -> active', () => {
      expect(isValidTransition('inactive', 'active')).toBe(true)
    })

    it('allows active -> archived', () => {
      expect(isValidTransition('active', 'archived')).toBe(true)
    })

    it('forbids archived -> active', () => {
      expect(isValidTransition('archived', 'active')).toBe(false)
    })

    it('forbids active -> active', () => {
      expect(isValidTransition('active', 'active')).toBe(false)
    })
  })
})
