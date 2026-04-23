// Identity context — domain permissions
// Pure functions that define what each role can do.
// Per architecture: "Domain-level permission table as pure functions"
// Role hierarchy is defined in shared/domain/roles.ts (canonical source).

import type { Role } from '#/shared/domain/roles'
import { hasRole } from '#/shared/domain/roles'

// ── Permission checks (pure domain functions) ─────────────────────

/** Can this role manage users (invite, remove, change roles)? */
export function canManageUsers(role: Role): boolean {
  return hasRole(role, 'PropertyManager')
}

/** Can this role create portals? */
export function canCreatePortals(role: Role): boolean {
  return hasRole(role, 'PropertyManager')
}

/** Can this role delete properties? */
export function canDeleteProperties(role: Role): boolean {
  return hasRole(role, 'AccountAdmin')
}

/** Can this role manage organization settings? */
export function canManageOrganization(role: Role): boolean {
  return hasRole(role, 'AccountAdmin')
}

/** Can this role view all properties in the org (not just assigned)? */
export function canViewAllProperties(role: Role): boolean {
  return hasRole(role, 'AccountAdmin')
}

/** Can this role invite members? */
export function canInviteMembers(role: Role): boolean {
  return hasRole(role, 'PropertyManager')
}

/** Can this role approve replies? */
export function canApproveReplies(role: Role): boolean {
  return hasRole(role, 'PropertyManager')
}

/** Can this role access AI features? */
export function canUseAI(role: Role): boolean {
  return hasRole(role, 'PropertyManager')
}

/** Can this role manage goals and badges? */
export function canManageGamification(role: Role): boolean {
  return hasRole(role, 'PropertyManager')
}

/** Can this role set up integrations (GBP, etc.)? */
export function canManageIntegrations(role: Role): boolean {
  return hasRole(role, 'AccountAdmin')
}

/** Check a named permission by string key. Used for dynamic checks. */
export function checkPermission(
  role: Role,
  permission:
    | 'manageUsers'
    | 'createPortals'
    | 'deleteProperties'
    | 'manageOrganization'
    | 'viewAllProperties'
    | 'inviteMembers'
    | 'approveReplies'
    | 'useAI'
    | 'manageGamification'
    | 'manageIntegrations',
): boolean {
  switch (permission) {
    case 'manageUsers':
      return canManageUsers(role)
    case 'createPortals':
      return canCreatePortals(role)
    case 'deleteProperties':
      return canDeleteProperties(role)
    case 'manageOrganization':
      return canManageOrganization(role)
    case 'viewAllProperties':
      return canViewAllProperties(role)
    case 'inviteMembers':
      return canInviteMembers(role)
    case 'approveReplies':
      return canApproveReplies(role)
    case 'useAI':
      return canUseAI(role)
    case 'manageGamification':
      return canManageGamification(role)
    case 'manageIntegrations':
      return canManageIntegrations(role)
  }
}
