/**
 * Unified role label helper — single source of truth for role display text.
 * Supports 'short' style (for badges, inline) and 'full' style (for forms, selects).
 */

import type { Role } from '#/shared/domain/roles'
import type { BetaInteractiveRole } from '#/shared/domain/beta-interactive-role'

export function roleLabel(role: Role, style: 'short' | 'full' = 'short'): string {
  if (style === 'full') {
    switch (role) {
      case 'AccountAdmin':
        return 'Account Admin'
      case 'PropertyManager':
        return 'Property Manager'
      case 'Member':
        return 'Member'
      default: {
        const _exhaustive: never = role
        return String(_exhaustive)
      }
    }
  }

  switch (role) {
    case 'AccountAdmin':
      return 'Admin'
    case 'PropertyManager':
      return 'Manager'
    case 'Member':
      return 'Member'
    default: {
      const _exhaustive: never = role
      return String(_exhaustive)
    }
  }
}

/** One line on what a role can do, shown wherever a person picks or reviews a role. */
export function roleDescription(role: BetaInteractiveRole): string {
  switch (role) {
    case 'AccountAdmin':
      return 'Sees every property. Manages members, the Google connection, AI consent and organization settings.'
    case 'PropertyManager':
      return "Works on the properties you choose: inbox, replies, portals and goals. Can't invite people or change organization settings."
    default: {
      const _exhaustive: never = role
      return String(_exhaustive)
    }
  }
}
