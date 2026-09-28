import { describe, it, expect } from 'vitest'
import { createParticipation } from './staff-participation'

describe('StaffParticipation', () => {
  const NOW = new Date('2026-01-15T12:00:00Z')

  const baseParams = {
    id: 'part-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    staffParticipantId: 'participant-1',
    displayName: 'Jane Doe',
    createdBy: 'admin-1',
    now: NOW,
  }

  describe('createParticipation', () => {
    it('creates an active participation', () => {
      const p = createParticipation(baseParams)
      expect(p.status).toBe('active')
      expect(p.startedAt).toEqual(NOW)
      expect(p.endedAt).toBeNull()
      expect(p.linkedUserId).toBeNull()
      expect(p.revision).toBe(1)
    })
  })
})
