import { describe, it, expect } from 'vitest'
import {
  createActivation,
  suspendActivation,
  resumeActivation,
  isActivationActive,
  type BadgeActivation,
} from './badge-definition'

describe('BadgeDefinition & Activation', () => {
  const NOW = new Date('2026-01-15T12:00:00Z')

  function makeActivation(
    overrides: Partial<Parameters<typeof createActivation>[0]> = {},
  ): BadgeActivation {
    return createActivation({
      id: 'act-1',
      organizationId: 'org-1',
      propertyId: 'prop-1',
      definitionId: 'def-1',
      definitionVersion: 1,
      activatedBy: 'admin-1',
      activationReason: 'test',
      audience: 'recipient_only',
      reviewExpiryDays: 90,
      now: NOW,
      ...overrides,
    }) as BadgeActivation
  }

  describe('createActivation', () => {
    it('creates an active activation', () => {
      const result = makeActivation({
        activationReason: 'Workforce opted in',
        audience: 'recipient_and_managers',
      })
      expect(result).toHaveProperty('status', 'active')
      expect(result.effectiveFrom).toEqual(NOW)
      expect(result.reviewExpiryDate).toEqual(new Date(NOW.getTime() + 90 * 86400000))
      expect(isActivationActive(result, NOW)).toBe(true)
      expect(result.acknowledgementNoEmploymentDecision).toBe(true)
    })
  })

  describe('suspendActivation', () => {
    it('suspends an active activation', () => {
      const result = suspendActivation(makeActivation())
      expect(result).toHaveProperty('status', 'suspended')
    })

    it('prevents suspending a non-active activation', () => {
      const suspended = suspendActivation(makeActivation()) as BadgeActivation
      const result = suspendActivation(suspended)
      expect(result).toHaveProperty('code', 'not_active')
    })
  })

  describe('resumeActivation', () => {
    it('resumes a suspended activation', () => {
      const suspended = suspendActivation(makeActivation()) as BadgeActivation
      const result = resumeActivation(suspended)
      expect(result).toHaveProperty('status', 'active')
    })

    it('prevents resuming an already-active activation', () => {
      const result = resumeActivation(makeActivation())
      expect(result).toHaveProperty('code', 'not_active')
    })
  })
})
