import { describe, it, expect } from 'vitest'
import {
  checkPropertyAccess,
  assertPropertyAccess,
  type PropertyAccessInput,
} from './property-access-policy'

const baseInput: PropertyAccessInput = {
  propertyOrganizationId: 'org-a',
  actorOrganizationId: 'org-a',
  isPropertyBlocked: false,
  propertyId: 'prop-1',
  assignedPropertyIds: new Set(['prop-1']),
  hasOrgWideAccess: false,
}

describe('property-access-policy (B1.4)', () => {
  describe('checkPropertyAccess — tenant consistency', () => {
    it('allows access when property belongs to actor org', () => {
      expect(checkPropertyAccess(baseInput)).toBeNull()
    })

    it('denies access when property belongs to different org', () => {
      const error = checkPropertyAccess({
        ...baseInput,
        propertyOrganizationId: 'org-b',
        actorOrganizationId: 'org-a',
      })
      expect(error).toEqual({
        code: 'wrong_organization',
        propertyOrg: 'org-b',
        actorOrg: 'org-a',
      })
    })
  })

  describe('checkPropertyAccess — lifecycle blocked', () => {
    it('allows access when property is not blocked', () => {
      expect(checkPropertyAccess({ ...baseInput, isPropertyBlocked: false })).toBeNull()
    })

    it('denies access when property is blocked', () => {
      const error = checkPropertyAccess({ ...baseInput, isPropertyBlocked: true })
      expect(error?.code).toBe('property_blocked')
    })
  })

  describe('checkPropertyAccess — assignment scope', () => {
    it('allows access when actor is assigned to the property', () => {
      expect(
        checkPropertyAccess({
          ...baseInput,
          assignedPropertyIds: new Set(['prop-1', 'prop-2']),
        }),
      ).toBeNull()
    })

    it('denies access when actor is not assigned', () => {
      const error = checkPropertyAccess({
        ...baseInput,
        assignedPropertyIds: new Set(['prop-2']),
      })
      expect(error?.code).toBe('not_assigned')
      if (error?.code === 'not_assigned') {
        expect(error.propertyId).toBe('prop-1')
      }
    })

    it('allows access when actor has org-wide access even if not assigned', () => {
      expect(
        checkPropertyAccess({
          ...baseInput,
          assignedPropertyIds: new Set<string>(),
          hasOrgWideAccess: true,
        }),
      ).toBeNull()
    })
  })

  describe('checkPropertyAccess — combined scenarios', () => {
    it('checks tenant first before lifecycle', () => {
      const error = checkPropertyAccess({
        ...baseInput,
        propertyOrganizationId: 'org-b',
        isPropertyBlocked: true,
      })
      expect(error?.code).toBe('wrong_organization')
    })

    it('checks lifecycle before assignment', () => {
      const error = checkPropertyAccess({
        ...baseInput,
        isPropertyBlocked: true,
        assignedPropertyIds: new Set<string>(),
      })
      expect(error?.code).toBe('property_blocked')
    })

    it('org-wide admin can access any active property in their org', () => {
      expect(
        checkPropertyAccess({
          ...baseInput,
          propertyId: 'prop-999',
          assignedPropertyIds: new Set<string>(),
          hasOrgWideAccess: true,
        }),
      ).toBeNull()
    })

    it('org-wide admin cannot access property in different org', () => {
      const error = checkPropertyAccess({
        ...baseInput,
        propertyOrganizationId: 'org-b',
        hasOrgWideAccess: true,
      })
      expect(error?.code).toBe('wrong_organization')
    })
  })

  describe('assertPropertyAccess', () => {
    it('does not throw when access is allowed', () => {
      expect(() => assertPropertyAccess(baseInput)).not.toThrow()
    })

    it('throws when access is denied', () => {
      expect(() =>
        assertPropertyAccess({ ...baseInput, isPropertyBlocked: true }),
      ).toThrow()
    })
  })
})
