import { describe, it, expect } from 'vitest'
import {
  createActivation,
  suspendActivation,
  resumeActivation,
  isActivationActive,
  type BadgeActivation,
} from './badge-definition'

describe('BadgeDefinition & Activation', () => {
  describe('createActivation', () => {
    it('creates an active activation', () => {
      const result = createActivation({
        id: 'act-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
        definitionId: 'def-1',
        definitionVersion: 1,
        activatedBy: 'admin-1',
        activationReason: 'Workforce opted in',
        audience: 'recipient_and_managers',
        reviewExpiryDays: 90,
      })
      expect(result).toHaveProperty('status', 'active')
      if (!('code' in result)) {
        expect(isActivationActive(result as BadgeActivation)).toBe(true)
        expect(result.acknowledgementNoEmploymentDecision).toBe(true)
      }
    })
  })

  describe('suspendActivation', () => {
    it('suspends an active activation', () => {
      const activation = createActivation({
        id: 'act-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
        definitionId: 'def-1',
        definitionVersion: 1,
        activatedBy: 'admin-1',
        activationReason: 'test',
        audience: 'recipient_only',
        reviewExpiryDays: 90,
      }) as BadgeActivation
      const result = suspendActivation(activation)
      expect(result).toHaveProperty('status', 'suspended')
    })

    it('prevents suspending a non-active activation', () => {
      const activation = createActivation({
        id: 'act-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
        definitionId: 'def-1',
        definitionVersion: 1,
        activatedBy: 'admin-1',
        activationReason: 'test',
        audience: 'recipient_only',
        reviewExpiryDays: 90,
      }) as BadgeActivation
      const suspended = suspendActivation(activation) as BadgeActivation
      const result = suspendActivation(suspended)
      expect(result).toHaveProperty('code', 'not_active')
    })
  })

  describe('resumeActivation', () => {
    it('resumes a suspended activation', () => {
      const activation = createActivation({
        id: 'act-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
        definitionId: 'def-1',
        definitionVersion: 1,
        activatedBy: 'admin-1',
        activationReason: 'test',
        audience: 'recipient_only',
        reviewExpiryDays: 90,
      }) as BadgeActivation
      const suspended = suspendActivation(activation) as BadgeActivation
      const result = resumeActivation(suspended)
      expect(result).toHaveProperty('status', 'active')
    })

    it('prevents resuming an already-active activation', () => {
      const activation = createActivation({
        id: 'act-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
        definitionId: 'def-1',
        definitionVersion: 1,
        activatedBy: 'admin-1',
        activationReason: 'test',
        audience: 'recipient_only',
        reviewExpiryDays: 90,
      }) as BadgeActivation
      const result = resumeActivation(activation)
      expect(result).toHaveProperty('code', 'not_active')
    })
  })
})
