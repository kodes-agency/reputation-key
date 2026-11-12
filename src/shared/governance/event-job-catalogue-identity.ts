// EventJobCatalogue — Identity event families.
//
// Split out of ./event-job-catalogue.ts, which spreads these rows into
// EVENT_FAMILY_ROWS, so that module stays under its file-length ratchet. The row
// shapes and factories live in ./event-job-catalogue-rows.ts: this module must
// not import the catalogue back.

import { durable, ev, type EventFamilyRow } from './event-job-catalogue-rows'

const ACTIVITY_OUTBOX = 'src/contexts/feed/infrastructure/activity-outbox-consumers.ts'
const AI_OUTBOX = 'src/contexts/ai/infrastructure/outbox-consumers.ts'
const NOTIFICATION_IDENTITY_ACCOUNT_OUTBOX =
  'src/contexts/feed/infrastructure/identity-account-outbox-consumers.ts'
const IDENTITY_MEMBER_ROLE_OUTBOX =
  'src/contexts/identity/infrastructure/member-role-outbox-consumers.ts'
const INBOX_MEMBER_OFFBOARDING_OUTBOX =
  'src/contexts/inbox/infrastructure/member-offboarding-outbox-consumers.ts'
const INTEGRATION_MEMBER_DEPARTURE_OUTBOX =
  'src/contexts/integration/infrastructure/member-departure-outbox-consumers.ts'
const PORTAL_MEMBER_OFFBOARDING_OUTBOX =
  'src/contexts/portal/infrastructure/member-offboarding-outbox-consumers.ts'
const PROPERTY_MEMBER_OFFBOARDING_OUTBOX =
  'src/contexts/property/infrastructure/member-offboarding-outbox-consumers.ts'

export const IDENTITY_ROWS: ReadonlyArray<EventFamilyRow> = [
  ev('identity.organization.created', []),
  ev('identity.member.invited', []),
  ev('identity.invitation.accepted', [
    durable(
      'notification.on-identity-invitation-accepted',
      NOTIFICATION_IDENTITY_ACCOUNT_OUTBOX,
    ),
    // The inviter hears it too, in a consumer and a receipt of its own.
    durable(
      'notification.on-identity-invitation-accepted-inviter',
      NOTIFICATION_IDENTITY_ACCOUNT_OUTBOX,
    ),
  ]),
  ev('identity.invitation.canceled', []),
  // ADR 0059: tells the reporter their own beta report reached an outcome.
  ev('identity.beta_feedback.outcome_reached', [
    durable(
      'notification.on-identity-beta-feedback-outcome',
      NOTIFICATION_IDENTITY_ACCOUNT_OUTBOX,
    ),
  ]),
  // The fact commits with the membership delete, sessions and grants: each
  // owner releases from it what the member may no longer hold.
  ev('identity.member.removed', [
    durable(
      'notification.on-identity-member-removed',
      NOTIFICATION_IDENTITY_ACCOUNT_OUTBOX,
    ),
    durable('property.on-member-removed', PROPERTY_MEMBER_OFFBOARDING_OUTBOX),
    durable('portal.on-member-removed', PORTAL_MEMBER_OFFBOARDING_OUTBOX),
    durable('inbox.on-member-removed', INBOX_MEMBER_OFFBOARDING_OUTBOX),
    durable('integration.on-member-removed', INTEGRATION_MEMBER_DEPARTURE_OUTBOX),
  ]),
  ev('identity.member.role_changed', [
    durable('identity.on-member-role-changed', IDENTITY_MEMBER_ROLE_OUTBOX),
    durable('integration.on-member-role-changed', INTEGRATION_MEMBER_DEPARTURE_OUTBOX),
    durable('activity.operational-action-history', ACTIVITY_OUTBOX),
    durable(
      'notification.on-identity-member-role-changed',
      NOTIFICATION_IDENTITY_ACCOUNT_OUTBOX,
    ),
  ]),
  // An AccountAdmin changed a PropertyManager's Properties. The member is told
  // (mandatory, Organization-scoped); the fact itself stays the audit trail.
  ev('identity.member.property_access_changed', [
    durable(
      'notification.on-identity-member-property-access-changed',
      NOTIFICATION_IDENTITY_ACCOUNT_OUTBOX,
    ),
  ]),
  ev('identity.merchant_ai.changed', [
    durable('ai.enroll-review-analysis', AI_OUTBOX),
    durable('activity.operational-action-history', ACTIVITY_OUTBOX),
  ]),
]
