/**
 * Unified role label helper — single source of truth for role display text.
 * Supports 'short' style (for badges, inline) and 'full' style (for forms, selects).
 */

import type { Role } from '#/shared/domain/roles'

export function roleLabel(role: Role, style: 'short' | 'full' = 'short'): string {
  if (style === 'full') {
    switch (role) {
      case 'AccountAdmin':
        return 'Account Admin'
      case 'PropertyManager':
        return 'Property Manager'
      case 'Staff':
        return 'Staff'
    }
  }

  switch (role) {
    case 'AccountAdmin':
      return 'Admin'
    case 'PropertyManager':
      return 'Manager'
    case 'Staff':
      return 'Staff'
  }
}
