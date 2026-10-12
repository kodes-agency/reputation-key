// What choosing a role in the Change role dialog means, in words: whether it can
// be confirmed and the consequence the person should read first. Pure.

import type { BetaInteractiveRole } from '#/shared/domain/beta-interactive-role'
import type { Role } from '#/shared/domain/roles'

export type RoleChange = Readonly<{
  canConfirm: boolean
  note: string
}>

export function describeRoleChange(
  current: Role | null,
  next: BetaInteractiveRole | null,
  memberName: string,
): RoleChange {
  if (next === null) {
    return { canConfirm: false, note: `Choose a role for ${memberName}.` }
  }
  if (next === current) {
    return { canConfirm: false, note: `${memberName} already has this role.` }
  }
  if (next === 'AccountAdmin') {
    return {
      canConfirm: true,
      note: `${memberName} will see every property and manage members, the Google connection, AI consent and organization settings.`,
    }
  }
  if (current === 'AccountAdmin') {
    return {
      canConfirm: true,
      note: `${memberName} will see only the properties you grant them, which can be none until you choose some. If they are the last Account Admin, the change is refused.`,
    }
  }
  return {
    canConfirm: true,
    note: `${memberName} will see only the properties you grant them.`,
  }
}
