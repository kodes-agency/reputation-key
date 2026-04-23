// Identity context — domain permissions tests
// Per Phase 3 gate: "Permission functions in domain layer have 100% test coverage"

import { describe, it, expect } from 'vitest'
import {
  canManageUsers,
  canCreatePortals,
  canDeleteProperties,
  canManageOrganization,
  canViewAllProperties,
  canInviteMembers,
  canApproveReplies,
  canUseAI,
  canManageGamification,
  canManageIntegrations,
  checkPermission,
} from './permissions'
import type { Role } from '#/shared/domain/roles'

// ── Permission matrix ───────────────────────────────────────────────
// Full coverage: every permission × every role

describe('permission functions', () => {
  const roles: Role[] = ['AccountAdmin', 'PropertyManager', 'Staff']

  describe('canManageUsers', () => {
    it('allows PropertyManager and AccountAdmin', () => {
      expect(canManageUsers('AccountAdmin')).toBe(true)
      expect(canManageUsers('PropertyManager')).toBe(true)
      expect(canManageUsers('Staff')).toBe(false)
    })
  })

  describe('canCreatePortals', () => {
    it('allows PropertyManager and AccountAdmin', () => {
      expect(canCreatePortals('AccountAdmin')).toBe(true)
      expect(canCreatePortals('PropertyManager')).toBe(true)
      expect(canCreatePortals('Staff')).toBe(false)
    })
  })

  describe('canDeleteProperties', () => {
    it('allows only AccountAdmin', () => {
      expect(canDeleteProperties('AccountAdmin')).toBe(true)
      expect(canDeleteProperties('PropertyManager')).toBe(false)
      expect(canDeleteProperties('Staff')).toBe(false)
    })
  })

  describe('canManageOrganization', () => {
    it('allows only AccountAdmin', () => {
      expect(canManageOrganization('AccountAdmin')).toBe(true)
      expect(canManageOrganization('PropertyManager')).toBe(false)
      expect(canManageOrganization('Staff')).toBe(false)
    })
  })

  describe('canViewAllProperties', () => {
    it('allows only AccountAdmin', () => {
      expect(canViewAllProperties('AccountAdmin')).toBe(true)
      expect(canViewAllProperties('PropertyManager')).toBe(false)
      expect(canViewAllProperties('Staff')).toBe(false)
    })
  })

  describe('canInviteMembers', () => {
    it('allows PropertyManager and AccountAdmin', () => {
      expect(canInviteMembers('AccountAdmin')).toBe(true)
      expect(canInviteMembers('PropertyManager')).toBe(true)
      expect(canInviteMembers('Staff')).toBe(false)
    })
  })

  describe('canApproveReplies', () => {
    it('allows PropertyManager and AccountAdmin', () => {
      expect(canApproveReplies('AccountAdmin')).toBe(true)
      expect(canApproveReplies('PropertyManager')).toBe(true)
      expect(canApproveReplies('Staff')).toBe(false)
    })
  })

  describe('canUseAI', () => {
    it('allows PropertyManager and AccountAdmin', () => {
      expect(canUseAI('AccountAdmin')).toBe(true)
      expect(canUseAI('PropertyManager')).toBe(true)
      expect(canUseAI('Staff')).toBe(false)
    })
  })

  describe('canManageGamification', () => {
    it('allows PropertyManager and AccountAdmin', () => {
      expect(canManageGamification('AccountAdmin')).toBe(true)
      expect(canManageGamification('PropertyManager')).toBe(true)
      expect(canManageGamification('Staff')).toBe(false)
    })
  })

  describe('canManageIntegrations', () => {
    it('allows only AccountAdmin', () => {
      expect(canManageIntegrations('AccountAdmin')).toBe(true)
      expect(canManageIntegrations('PropertyManager')).toBe(false)
      expect(canManageIntegrations('Staff')).toBe(false)
    })
  })

  describe('checkPermission', () => {
    it('delegates to the correct function for every permission', () => {
      const permissions = [
        'manageUsers',
        'createPortals',
        'deleteProperties',
        'manageOrganization',
        'viewAllProperties',
        'inviteMembers',
        'approveReplies',
        'useAI',
        'manageGamification',
        'manageIntegrations',
      ] as const

      // Verify checkPermission matches the direct function for every permission × role
      for (const permission of permissions) {
        for (const role of roles) {
          const direct = checkPermission(role, permission)
          const viaFn = {
            manageUsers: canManageUsers(role),
            createPortals: canCreatePortals(role),
            deleteProperties: canDeleteProperties(role),
            manageOrganization: canManageOrganization(role),
            viewAllProperties: canViewAllProperties(role),
            inviteMembers: canInviteMembers(role),
            approveReplies: canApproveReplies(role),
            useAI: canUseAI(role),
            manageGamification: canManageGamification(role),
            manageIntegrations: canManageIntegrations(role),
          }[permission]
          expect(direct).toBe(viaFn)
        }
      }
    })
  })
})
