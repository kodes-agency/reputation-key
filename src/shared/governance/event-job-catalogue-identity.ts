// EventJobCatalogue — Identity event families.
//
// Split out of ./event-job-catalogue.ts, which spreads these rows into
// EVENT_FAMILY_ROWS, so that module stays under its file-length ratchet. The row
// shapes and factories live in ./event-job-catalogue-rows.ts: this module must
// not import the catalogue back.

import {
  durable,
  ev,
  type EventConsumerRef,
  type EventFamilyRow,
} from './event-job-catalogue-rows'

const ACTIVITY_OUTBOX = 'src/contexts/feed/infrastructure/activity-outbox-consumers.ts'
const AI_OUTBOX = 'src/contexts/ai/infrastructure/outbox-consumers.ts'
const NOTIFICATION_IDENTITY_ACCOUNT_OUTBOX =
  'src/contexts/feed/infrastructure/identity-account-outbox-consumers.ts'
const NOTIFICATION_SETTLEMENT_OUTBOX =
  'src/contexts/feed/infrastructure/notification-settlement-outbox-consumers.ts'

/** A Feed route that retires notices rather than raising them (ADR 0046). */
const settles = (name: string): EventConsumerRef =>
  durable(name, NOTIFICATION_SETTLEMENT_OUTBOX)

export const IDENTITY_ROWS: ReadonlyArray<EventFamilyRow> = [
  ev('identity.organization.created', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
  ]),
  ev('identity.member.invited', [durable('activity.recent-activity', ACTIVITY_OUTBOX)]),
  ev('identity.invitation.accepted', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
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
  ev('identity.invitation.canceled', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
  ]),
  // ADR 0059: tells the reporter their own beta report reached an outcome.
  ev('identity.beta_feedback.outcome_reached', [
    durable(
      'notification.on-identity-beta-feedback-outcome',
      NOTIFICATION_IDENTITY_ACCOUNT_OUTBOX,
    ),
  ]),
  ev('identity.member.removed', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable(
      'notification.on-identity-member-removed',
      NOTIFICATION_IDENTITY_ACCOUNT_OUTBOX,
    ),
  ]),
  ev('identity.member.role_changed', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
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
  ev('identity.organization_lifecycle.changed', [
    durable(
      'notification.on-identity-organization-purge-pending',
      NOTIFICATION_IDENTITY_ACCOUNT_OUTBOX,
    ),
    settles('notification.settle-on-organization-purge-cancelled'),
  ]),
]
