import {
  aiGuestVoiceSummaryReady,
  aiReviewUrgentDetected,
} from '#/contexts/ai/domain/events'
import {
  identityBetaFeedbackOutcomeReached,
  identityInvitationAccepted,
  identityMemberPropertyAccessChanged,
  identityMemberRemoved,
  identityMemberRoleChanged,
  identityOrganizationLifecycleChanged,
} from '#/contexts/identity/domain/events'
import {
  inboxAssignmentsReleased,
  inboxBulkAssignmentCompleted,
  inboxBulkReopenCompleted,
  inboxHandlingCycleClosed,
  inboxHandlingCycleOpened,
  inboxHandlingCycleReopened,
  inboxItemAssigned,
  inboxItemCreated,
  inboxItemEscalated,
  inboxItemEscalationResolved,
  inboxNoteAdded,
  inboxResponseTargetReminderDue,
} from '#/contexts/inbox/domain/events'
import {
  integrationGoogleAccountConnected,
  integrationGoogleAccountDisconnected,
  integrationGoogleAccountReauthorizationRequired,
} from '#/contexts/integration/domain/events'
import {
  portalApprovedDestinationUpdated,
  portalHealthChanged,
  portalResponsibilityNeeded,
  portalResponsibleManagersUpdated,
} from '#/contexts/portal/domain/events'
import {
  propertyArchived,
  propertyResponsibilityNeeded,
  propertyResponsibleManagersUpdated,
} from '#/contexts/property/domain/events'
import {
  goalMonthlyResultClosed,
  goalMonthlyResultRevised,
  goalRatingGoalTransitioned,
} from '#/contexts/reporting/domain/goal-events'
import {
  reviewPropertyHistoryImportFinished,
  reviewReplyApproved,
  reviewReplyPublicationCancelled,
  reviewReplyPublished,
  reviewReplyPublishFailed,
  reviewReplyRejected,
  reviewReplySubmitted,
} from '#/contexts/review/domain/events'
import {
  googleConnectionId,
  inboxItemId,
  inboxNoteId,
  invitationId,
  notificationId,
  organizationId,
  portalApprovedDestinationId,
  portalId,
  propertyId,
  replyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { DomainEvent } from '#/shared/events/events'

export const ORG = organizationId('org-route-contract')
export const PROPERTY = propertyId('4d1f0c1e-2b7a-4c55-9a51-000000000001')
export const PORTAL = portalId('4d1f0c1e-2b7a-4c55-9a51-000000000002')
export const DESTINATION = portalApprovedDestinationId(
  '4d1f0c1e-2b7a-4c55-9a51-000000000020',
)
export const ITEM = inboxItemId('4d1f0c1e-2b7a-4c55-9a51-000000000003')
export const REVIEW = reviewId('4d1f0c1e-2b7a-4c55-9a51-000000000004')
export const REPLY = replyId('4d1f0c1e-2b7a-4c55-9a51-000000000005')
export const NOTE = inboxNoteId('4d1f0c1e-2b7a-4c55-9a51-000000000006')
export const CONNECTION = googleConnectionId('4d1f0c1e-2b7a-4c55-9a51-000000000007')
export const SNAPSHOT_RUN = '4d1f0c1e-2b7a-4c55-9a51-000000000013'
export const INVITATION = invitationId('4d1f0c1e-2b7a-4c55-9a51-000000000008')
export const REPORT_REFERENCE = '4d1f0c1e-2b7a-4c55-9a51-000000000009'
export const CLOSURE_LINEAGE = '4d1f0c1e-2b7a-4c55-9a51-00000000000a'
export const BULK = '4d1f0c1e-2b7a-4c55-9a51-00000000000b'
export const GOAL = {
  programId: '4d1f0c1e-2b7a-4c55-9a51-00000000000c',
  programVersionId: '4d1f0c1e-2b7a-4c55-9a51-00000000000d',
  assignmentId: '4d1f0c1e-2b7a-4c55-9a51-00000000000e',
  monthlyResultId: '4d1f0c1e-2b7a-4c55-9a51-00000000000f',
  periodStart: new Date('2026-08-01T00:00:00.000Z'),
  periodEnd: new Date('2026-09-01T00:00:00.000Z'),
} as const
export const ACTOR = userId('user-actor')
export const RECIPIENT = userId('user-recipient')
export const DEPARTING = userId('user-departing')
export const OCCURRED_AT = new Date('2026-09-02T09:00:00.000Z')
export const SCHEDULED_FOR = new Date('2026-09-02T08:00:00.000Z')

export const handlingCycleScope = {
  inboxItemId: ITEM,
  cycleNumber: 2,
  stateRevision: 3,
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceType: 'review',
  sourceId: REVIEW,
  sourceRevision: 2,
  triggerEventId: null,
  occurredAt: OCCURRED_AT,
} as const

export const replyFact = {
  replyId: REPLY,
  reviewId: REVIEW,
  organizationId: ORG,
  propertyId: PROPERTY,
  occurredAt: OCCURRED_AT,
} as const

/**
 * One fact per matrix row, built by its producing context's own constructor.
 * Each satisfies the row's event condition, so the route has work to do.
 */
/** A site's state changed: the first state, or the decision after it. */
export const destinationUpdated = (approvalState: 'pending' | 'approved') =>
  portalApprovedDestinationUpdated({
    approvedDestinationId: DESTINATION,
    organizationId: ORG,
    propertyId: PROPERTY,
    approvalState,
    sourceAggregateVersion: OCCURRED_AT.toISOString(),
    occurredAt: OCCURRED_AT,
  })

export const PRODUCED_FACTS: Readonly<Record<string, () => DomainEvent>> = {
  'identity.invitation.accepted': () =>
    identityInvitationAccepted({
      invitationId: INVITATION,
      organizationId: ORG,
      userId: RECIPIENT,
      propertyIds: [PROPERTY],
      inviterId: ACTOR,
      occurredAt: OCCURRED_AT,
    }),
  'identity.member.property_access_changed': () =>
    identityMemberPropertyAccessChanged({
      organizationId: ORG,
      memberUserId: RECIPIENT,
      userId: ACTOR,
      grantedPropertyIds: [PROPERTY],
      revokedPropertyIds: [],
      occurredAt: OCCURRED_AT,
    }),
  'identity.member.role_changed': () =>
    identityMemberRoleChanged({
      organizationId: ORG,
      memberUserId: RECIPIENT,
      previousRole: 'PropertyManager',
      newRole: 'AccountAdmin',
      userId: ACTOR,
      occurredAt: OCCURRED_AT,
    }),
  'identity.member.removed': () =>
    identityMemberRemoved({
      organizationId: ORG,
      userId: RECIPIENT,
      removedBy: ACTOR,
      occurredAt: OCCURRED_AT,
    }),
  'identity.beta_feedback.outcome_reached': () =>
    identityBetaFeedbackOutcomeReached({
      organizationId: ORG,
      userId: RECIPIENT,
      reference: REPORT_REFERENCE,
      outcome: 'accepted',
      occurredAt: OCCURRED_AT,
    }),
  'identity.organization_lifecycle.changed': () =>
    identityOrganizationLifecycleChanged({
      organizationId: ORG,
      closureLineageId: CLOSURE_LINEAGE,
      state: 'purge_pending',
      revision: 3,
      reactivationRequired: true,
      recoverableUntil: new Date('2026-10-02T09:00:00.000Z'),
      occurredAt: OCCURRED_AT,
    }),
  'inbox.inbox_item.created': () =>
    inboxItemCreated({
      inboxItemId: ITEM,
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceType: 'review',
      sourceId: REVIEW,
      occurredAt: OCCURRED_AT,
    }),
  'inbox.handling_cycle.opened': () =>
    inboxHandlingCycleOpened({
      ...handlingCycleScope,
      actorType: 'provider',
      userId: null,
      openReason: 'material_revision_changed',
    }),
  'inbox.handling_cycle.closed': () =>
    inboxHandlingCycleClosed({
      ...handlingCycleScope,
      actorType: 'user',
      userId: ACTOR,
      closeReason: 'confirmed_on_google',
      source: 'web',
    }),
  'inbox.handling_cycle.reopened': () =>
    inboxHandlingCycleReopened({
      ...handlingCycleScope,
      actorType: 'user',
      userId: ACTOR,
      reopenReason: 'new_information',
      source: 'web',
    }),
  'inbox.inbox_items.bulk_reopen_completed': () =>
    inboxBulkReopenCompleted({
      organizationId: ORG,
      userId: ACTOR,
      bulkId: BULK,
      reopened: [
        {
          inboxItemId: ITEM,
          propertyId: PROPERTY,
          sourceType: handlingCycleScope.sourceType,
          sourceId: REVIEW,
          cycleNumber: handlingCycleScope.cycleNumber,
          sourceRevision: handlingCycleScope.sourceRevision,
          stateRevision: handlingCycleScope.stateRevision,
        },
      ],
      occurredAt: OCCURRED_AT,
    }),
  'inbox.response_target.reminder_due': () =>
    inboxResponseTargetReminderDue({
      inboxItemId: ITEM,
      cycleNumber: 2,
      organizationId: ORG,
      propertyId: PROPERTY,
      targetKind: 'google_review_response',
      reminderKind: 'target_passed',
      scheduledFor: SCHEDULED_FOR,
      occurredAt: OCCURRED_AT,
    }),
  'inbox.inbox_item.assigned': () =>
    inboxItemAssigned({
      inboxItemId: ITEM,
      organizationId: ORG,
      propertyId: PROPERTY,
      userId: ACTOR,
      assignedTo: RECIPIENT,
      previousAssignee: DEPARTING,
      occurredAt: OCCURRED_AT,
    }),
  'inbox.inbox_items.bulk_assignment_completed': () =>
    inboxBulkAssignmentCompleted({
      organizationId: ORG,
      userId: ACTOR,
      bulkId: BULK,
      transitions: [
        {
          inboxItemId: ITEM,
          propertyId: PROPERTY,
          previousAssignee: DEPARTING,
          nextAssignee: RECIPIENT,
        },
      ],
      occurredAt: OCCURRED_AT,
    }),
  'inbox.inbox_items.assignments_released': () =>
    inboxAssignmentsReleased({
      organizationId: ORG,
      userId: ACTOR,
      releasedFrom: DEPARTING,
      releaseReason: 'member_offboarded',
      releases: [{ propertyId: PROPERTY, anchorInboxItemId: ITEM, count: 1 }],
      occurredAt: OCCURRED_AT,
    }),
  'inbox.inbox_item.escalated': () =>
    inboxItemEscalated({
      inboxItemId: ITEM,
      organizationId: ORG,
      propertyId: PROPERTY,
      userId: ACTOR,
      occurredAt: OCCURRED_AT,
    }),
  'inbox.inbox_item.escalation_resolved': () =>
    inboxItemEscalationResolved({
      inboxItemId: ITEM,
      organizationId: ORG,
      propertyId: PROPERTY,
      userId: ACTOR,
      occurredAt: OCCURRED_AT,
    }),
  'inbox.inbox_note.added': () =>
    inboxNoteAdded({
      inboxItemId: ITEM,
      organizationId: ORG,
      propertyId: PROPERTY,
      userId: ACTOR,
      noteId: NOTE,
      occurredAt: OCCURRED_AT,
    }),
  'review.reply.submitted': () => reviewReplySubmitted({ ...replyFact, userId: ACTOR }),
  'review.reply.approved': () =>
    reviewReplyApproved({ ...replyFact, userId: ACTOR, authorId: RECIPIENT }),
  'review.reply.rejected': () =>
    reviewReplyRejected({
      ...replyFact,
      userId: ACTOR,
      authorId: RECIPIENT,
      reason: null,
    }),
  'review.reply.published': () =>
    reviewReplyPublished({ ...replyFact, userId: ACTOR, authorId: RECIPIENT }),
  'review.reply.publish_failed': () =>
    reviewReplyPublishFailed({ ...replyFact, authorId: RECIPIENT, outcome: 'not_sent' }),
  'review.reply.publication_cancelled': () =>
    reviewReplyPublicationCancelled({
      ...replyFact,
      authorId: RECIPIENT,
      cause: 'disconnect',
    }),
  'portal.responsibility_became_needed': () =>
    portalResponsibilityNeeded({
      portalId: PORTAL,
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceAggregateVersion: OCCURRED_AT.toISOString(),
      occurredAt: OCCURRED_AT,
    }),
  'portal.approved_destination.updated': () => destinationUpdated('pending'),
  'portal.health.changed': () =>
    portalHealthChanged({
      portalId: PORTAL,
      organizationId: ORG,
      propertyId: PROPERTY,
      previousStatus: 'healthy',
      previousReason: 'operational',
      status: 'unavailable',
      reason: 'publication_snapshot_unavailable',
      sourceVersion: 'health-fence-1',
      occurredAt: OCCURRED_AT,
    }),
  'property.responsibility_became_needed': () =>
    propertyResponsibilityNeeded({
      organizationId: ORG,
      propertyId: PROPERTY,
      occurredAt: OCCURRED_AT,
    }),
  'property.archived': () =>
    propertyArchived({
      organizationId: ORG,
      propertyId: PROPERTY,
      userId: ACTOR,
      previousState: 'active',
      sourceEpoch: 1,
      recoveryDeadline: new Date('2026-10-24T09:00:00.000Z'),
      occurredAt: OCCURRED_AT,
    }),
  'property.responsible_managers.updated': () =>
    propertyResponsibleManagersUpdated({
      organizationId: ORG,
      propertyId: PROPERTY,
      assignmentCount: 1,
      occurredAt: OCCURRED_AT,
    }),
  'portal.responsible_managers.updated': () =>
    portalResponsibleManagersUpdated({
      portalId: PORTAL,
      organizationId: ORG,
      propertyId: PROPERTY,
      assignmentCount: 1,
      sourceAggregateVersion: OCCURRED_AT.toISOString(),
      occurredAt: OCCURRED_AT,
    }),
  'review.property_history_import.finished': () =>
    reviewPropertyHistoryImportFinished({
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceEpoch: 0,
      runId: SNAPSHOT_RUN,
      outcome: 'completed',
      reviewsObserved: 260,
      failureReason: null,
      occurredAt: OCCURRED_AT,
    }),
  'integration.google_account.reauthorization_required': () =>
    integrationGoogleAccountReauthorizationRequired({
      connectionId: CONNECTION,
      organizationId: ORG,
      cause: 'member_removed',
      occurredAt: OCCURRED_AT,
    }),
  'integration.google_account.connected': () =>
    integrationGoogleAccountConnected({
      connectionId: CONNECTION,
      organizationId: ORG,
      userId: ACTOR,
      occurredAt: OCCURRED_AT,
    }),
  'integration.google_account.disconnected': () =>
    integrationGoogleAccountDisconnected({
      connectionId: CONNECTION,
      organizationId: ORG,
      userId: ACTOR,
      occurredAt: OCCURRED_AT,
    }),
  'goal.monthly_result.closed': () =>
    goalMonthlyResultClosed({
      ...GOAL,
      organizationId: ORG,
      propertyId: PROPERTY,
      evaluationState: 'eligible',
      achieved: true,
      occurredAt: OCCURRED_AT,
    }),
  'goal.monthly_result.revised': () =>
    goalMonthlyResultRevised({
      ...GOAL,
      organizationId: ORG,
      propertyId: PROPERTY,
      evaluationState: 'eligible',
      achieved: true,
      revisionId: '4d1f0c1e-2b7a-4c55-9a51-000000000010',
      revision: 2,
      supersedesRevisionId: '4d1f0c1e-2b7a-4c55-9a51-000000000011',
      outcomeChanged: true,
      availabilityChanged: false,
      occurredAt: OCCURRED_AT,
    }),
  // A review analysis found the review Urgent: the revision the Inbox item stands at.
  'ai.review_analysis.urgent_detected': () =>
    aiReviewUrgentDetected({
      organizationId: ORG,
      propertyId: PROPERTY,
      reviewId: REVIEW,
      sourceEpoch: 0,
      sourceRevision: handlingCycleScope.sourceRevision,
      analysisSequence: 5,
      occurredAt: OCCURRED_AT,
    }),
  // The Monday email: the page's lines as governed facts, for a Property's Monday.
  'ai.guest_voice_summary.ready': () =>
    aiGuestVoiceSummaryReady({
      organizationId: ORG,
      propertyId: PROPERTY,
      summaryKind: 'weekly',
      localDate: '2026-09-07',
      window: '90d',
      startLocalDate: '2026-06-10',
      endLocalDate: '2026-09-07',
      lines: [
        {
          kind: 'fix_first',
          topic: 'facilities_equipment',
          issueId: '4d1f0c1e-2b7a-4c55-9a51-000000000030',
          reviewCount: 19,
          textReviewCount: 128,
          upTo: 0.2,
          change: null,
          polarity: null,
        },
      ],
      occurredAt: OCCURRED_AT,
    }),
  'goal.rating_goal.transitioned': () =>
    goalRatingGoalTransitioned({
      organizationId: ORG,
      propertyId: PROPERTY,
      goalId: '4d1f0c1e-2b7a-4c55-9a51-000000000014',
      mode: 'climb',
      notice: {
        transition: 'entered_below_pace',
        targetTenths: 45,
        paceTenthsPerWeek: 110,
        pacePerWeek: 11,
        recentPaceTenths: 65,
        paceWindow: 'last_4_weeks',
      },
      occurredAt: OCCURRED_AT,
    }),
}

export const MANAGER = userId('user-manager')
export const ADMIN = userId('user-admin')
export const SETTLED_NOTIFICATION = notificationId('4d1f0c1e-2b7a-4c55-9a51-000000000013')

/**
 * What each settling route's notices point at. Reply and Inbox notices are
 * filed against the Inbox item; a "choose a responsible manager" request
 * against the scope that had the gap.
 */
export const SETTLED_RESOURCE: Readonly<Record<string, string>> = {
  'property.responsible_managers.updated': PROPERTY,
  'portal.responsible_managers.updated': PORTAL,
  'portal.health.changed': PORTAL,
  'portal.approved_destination.updated': DESTINATION,
  'integration.google_account.connected': CONNECTION,
  'integration.google_account.disconnected': CONNECTION,
  'identity.organization_lifecycle.changed': ORG,
}

/**
 * A settling route whose event also announces: the produced fact above is the
 * announcing shape, so the settling shape is built here, by the same producer.
 */
export const SETTLING_FACTS: Readonly<Record<string, () => DomainEvent>> = {
  'notification.settle-on-portal-destination-decided': () =>
    destinationUpdated('approved'),
  'notification.settle-on-organization-purge-cancelled': () =>
    identityOrganizationLifecycleChanged({
      organizationId: ORG,
      closureLineageId: CLOSURE_LINEAGE,
      state: 'active',
      revision: 4,
      reactivationRequired: true,
      recoverableUntil: new Date('2026-10-02T09:00:00.000Z'),
      occurredAt: OCCURRED_AT,
    }),
  'notification.settle-on-portal-health-recovered': () =>
    portalHealthChanged({
      portalId: PORTAL,
      organizationId: ORG,
      propertyId: PROPERTY,
      previousStatus: 'unavailable',
      previousReason: 'publication_snapshot_unavailable',
      status: 'healthy',
      reason: 'operational',
      sourceVersion: 'health-fence-2',
      occurredAt: OCCURRED_AT,
    }),
}
