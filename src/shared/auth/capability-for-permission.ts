// Permission → capability mapping (BQR-4.1; moved from authorization-policy
// in BQC-2.6 when the ExecutionPolicy superseded the old seam).
//
// Maps a role permission to the beta surface capability that must be enabled
// for the action (ADR 0032/0033). Dark-context permissions map to dark
// capabilities (fail closed unless allowlisted); portal mutations map to
// portal.write and media to portal.upload — both hard-blocked for beta
// (BQC-0.2 / STD-P0-01).

import type { Permission } from '#/shared/domain/permissions'
import type { Capability } from './beta-capabilities'

const PERMISSION_CAPABILITY: Readonly<Record<Permission, Capability>> = {
  'property.create': 'property.create',
  'property.update': 'property.create',
  'property.delete': 'property.create',
  'property.read': 'property.create',
  'property.admin': 'property.create',
  'reply.manage': 'property.publish_reply',
  'review.read': 'review.use',
  'inbox.read': 'inbox.use',
  'inbox.write': 'inbox.use',
  'inbox.manage': 'inbox.use',
  'dashboard.read': 'dashboard.use',
  'dashboard.fleet_read': 'dashboard.use',
  'staff_assignment.create': 'staff.use',
  'staff_assignment.delete': 'staff.use',
  'staff_assignment.read': 'staff.use',
  'integration.manage': 'integration.use',
  'notification.read': 'notification.in_app',
  'notification.update': 'notification.in_app',
  'invitation.create': 'identity.invite',
  'invitation.list': 'identity.invite',
  'invitation.cancel': 'identity.invite',
  'invitation.resend': 'identity.invite',
  // BQC-0.2 / STD-P0-01: mutations and media are independent of portal.read.
  // portal.write and portal.upload remain hard-blocked for beta (ADR 0032).
  'portal.create': 'portal.write',
  'portal.update': 'portal.write',
  'portal.delete': 'portal.write',
  'portal.read': 'portal.read',
  'team.create': 'team.use',
  'team.update': 'team.use',
  'team.delete': 'team.use',
  'team.read': 'team.use',
  'goal.read': 'goal.use',
  'goal.create': 'goal.use',
  'goal.update': 'goal.use',
  'goal.cancel': 'goal.use',
  'badge.read': 'badge.use',
  'badge.manage': 'badge.use',
  'leaderboard.read': 'leaderboard.use',
  'organization.update': 'identity.invite',
  'organization.delete': 'identity.invite',
  'member.create': 'identity.invite',
  'member.update': 'identity.invite',
  'member.delete': 'identity.invite',
  'member.list': 'identity.invite',
  'identity.avatar_upload': 'identity.invite',
  'identity.logo_upload': 'identity.invite',
  'identity.password.change': 'identity.invite',
  'identity.profile.update': 'identity.invite',
  'identity.avatar.set': 'identity.invite',
  'identity.leave_org': 'identity.invite',
  'ac.create': 'identity.invite',
  'ac.read': 'identity.invite',
  'ac.update': 'identity.invite',
  'ac.delete': 'identity.invite',
  'feedback.read': 'identity.invite',
  'feedback.respond': 'identity.invite',
}

export function capabilityForPermission(permission: Permission): Capability {
  return PERMISSION_CAPABILITY[permission]
}
