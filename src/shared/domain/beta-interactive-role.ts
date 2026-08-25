import type { Role } from './roles'

export type BetaInteractiveRole = Extract<Role, 'AccountAdmin' | 'PropertyManager'>

/** Only manager logins are active during the closed beta. */
export function isBetaInteractiveRole(role: Role): role is BetaInteractiveRole {
  return role === 'AccountAdmin' || role === 'PropertyManager'
}

/** Better Auth tokens that map to the two active beta manager roles. */
export function isBetaInteractiveMemberRoleToken(role: string): boolean {
  const normalized = role.trim().toLowerCase()
  return normalized === 'owner' || normalized === 'admin'
}
