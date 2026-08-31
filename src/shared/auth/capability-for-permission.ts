// Permission → capability mapping (BQR-4.1; moved from authorization-policy
// in BQC-2.6 when the ExecutionPolicy superseded the old seam).
//
// Maps role permissions to the capability that must be enabled for the action
// (ADR 0032/0033/0049). Portal management, guest response/contact, and media
// are separate promotable controls; all remain off by default.

import type { Permission } from '#/shared/domain/permissions'
import type { Capability } from './beta-capabilities'

const PERMISSION_CAPABILITY: Readonly<Record<Permission, Capability>> = {
  'property.create': 'property.create',
  'property.update': 'property.create',
  // LIF-01: destructive deletion is not ordinary Property management.
  // This capability stays blocked until support-mediated erasure exists.
  'property.delete': 'property.erase',
  // Recoverable lifecycle commands are ordinary Property management and do
  // not acquire the permanently blocked erasure capability.
  'property.archive': 'property.create',
  'property.restore': 'property.create',
  'property.disconnect': 'property.create',
  'property.read': 'property.create',
  'property.admin': 'property.create',
  'property.import_gbp_v2': 'property.import_gbp_v2',
  'property.read_gbp_performance': 'property.read_gbp_performance',
  'reply.manage': 'property.publish_reply',
  'review.read': 'review.use',
  'inbox.read': 'inbox.use',
  'inbox.write': 'inbox.use',
  'inbox.manage': 'inbox.use',
  'dashboard.read': 'dashboard.use',
  'dashboard.fleet_read': 'dashboard.use',
  'staff.read': 'staff.use',
  'staff.manage': 'staff.use',
  'integration.manage': 'integration.use',
  'policy.admin': 'identity.invite',
  'ai.reply.generate': 'ai.generate_reply',
  'ai.trends.read': 'ai.detect_trends',
  'ai.manage': 'property.create',
  'notification.read': 'notification.in_app',
  'notification.update': 'notification.in_app',
  'invitation.create': 'identity.invite',
  'invitation.list': 'identity.invite',
  'invitation.cancel': 'identity.invite',
  'invitation.resend': 'identity.invite',
  // BQC-0.2 / STD-P0-01: mutations and media are independent of portal.read.
  // portal.write remains promotable. portal.upload is temporarily blocked at
  // capability policy level until its issuance-bound SEC-01 remediation lands.
  'portal.create': 'portal.write',
  'portal.admin': 'portal.write',
  'portal.update': 'portal.write',
  'portal.delete': 'portal.write',
  'portal.read': 'portal.read',
  'team.create': 'team.use',
  'team.update': 'team.use',
  'team.delete': 'team.use',
  'team.read': 'team.use',
  'team.membership.manage': 'team.use',
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
  'feedback.read': 'portal.guest_response',
  // Handling is an Inbox workflow over already-submitted feedback. It must
  // remain available when new Guest Response collection is paused.
  'feedback.handle': 'inbox.use',
  'feedback.respond': 'portal.guest_response',
  'feedback.contact_read': 'portal.guest_contact',
}

export function capabilityForPermission(permission: Permission): Capability {
  return PERMISSION_CAPABILITY[permission]
}

/** True when the action is a known Permission (the map is exhaustive). */
export function hasPermissionCapability(action: string): action is Permission {
  return Object.hasOwn(PERMISSION_CAPABILITY, action)
}
