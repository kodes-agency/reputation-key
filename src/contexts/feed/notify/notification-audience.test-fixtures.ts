// Shared doubles and builders for the notification audience authorization
// suites. Defaults match what the assertions rely on: nobody is eligible,
// replies may be approved, and every lookup answers "nothing found".

import { vi } from 'vitest'
import type { HeldTransaction } from '#/shared/db/testing/held-transaction'
import {
  inboxItemId,
  organizationId,
  portalId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import {
  createNotificationAudienceAuthorizer,
  type NotificationAudienceAuthorizationInput,
} from './notification-audience.server'

export const ORG = organizationId('org-1')
export const PROPERTY = propertyId('11111111-1111-4111-8111-111111111111')
export const PORTAL = portalId('22222222-2222-4222-8222-222222222222')
export const HEALTH_SINCE = '2026-08-27T08:00:00.000Z'
export const RECIPIENT = userId('manager-1')
export const RESPONSIBLE_MANAGER = userId('responsible-manager-1')
export const REPLACEMENT_ASSIGNEE = userId('replacement-assignee-1')
export const INBOX_ITEM = inboxItemId('33333333-3333-4333-8333-333333333333')
export const SECOND_INBOX_ITEM = inboxItemId('44444444-4444-4444-8444-444444444444')
export const RESOLVED_AT = '2026-08-27T08:00:00.000Z'
export const TARGET_SCHEDULED_FOR = '2026-08-28T08:00:00.000Z'

export const buildAudienceDeps = (db: HeldTransaction['db']) => ({
  userLookup: {
    findByRole: vi.fn().mockResolvedValue([]),
  },
  responsibleManagers: {
    findForProperty: vi.fn().mockResolvedValue([]),
    findForPortal: vi.fn().mockResolvedValue([]),
    findForPortalGroup: vi.fn().mockResolvedValue([]),
    isEligibleForProperty: vi.fn().mockResolvedValue(false),
  },
  inboxItemLookup: {
    findInboxItemFacts: vi.fn().mockResolvedValue(null),
    findNoteAuthors: vi.fn().mockResolvedValue([]),
    findHandlingCycleNotificationFacts: vi.fn().mockResolvedValue(null),
    findResponseTargetReminderNotificationFacts: vi.fn().mockResolvedValue(null),
  },
  escalationResolutions: {
    findEscalationResolutionFacts: vi.fn().mockResolvedValue(null),
  },
  replyApproval: {
    canApproveReplies: vi.fn().mockResolvedValue(true),
  },
  db,
  portalHealthLookup: {
    findPortalHealthNotificationFacts: vi.fn().mockResolvedValue(null),
  },
  monthlyResultFacts: {
    findMonthlyResultNotificationFacts: vi.fn().mockResolvedValue(null),
    findMonthlyResultRevisionNotificationFacts: vi.fn().mockResolvedValue(null),
  },
  organizationAccountAuthority: {
    isAffectedRecipient: vi.fn().mockResolvedValue(false),
  },
})

export type AudienceDeps = ReturnType<typeof buildAudienceDeps>

export const authorize = (
  overrides: Partial<NotificationAudienceAuthorizationInput> = {},
) => ({
  userId: RECIPIENT,
  organizationId: ORG,
  propertyId: PROPERTY,
  audience: { kind: 'account_admin' as const },
  ...overrides,
})

export const decide = (
  deps: AudienceDeps,
  overrides: Partial<NotificationAudienceAuthorizationInput> = {},
) => createNotificationAudienceAuthorizer(deps)(authorize(overrides))

export const inboxItemFacts = (overrides: Record<string, unknown> = {}) => ({
  propertyId: PROPERTY,
  portalId: null,
  assignedTo: null,
  propertyName: null,
  guestRating: null,
  sourceType: 'review',
  createdAt: new Date('2026-08-25T10:00:00Z'),
  ...overrides,
})

export const escalationFacts = (overrides: Record<string, unknown> = {}) => ({
  propertyId: PROPERTY,
  assignedTo: RECIPIENT,
  propertyName: null,
  isEscalated: false,
  escalatedAt: null,
  resolvedAt: new Date(RESOLVED_AT),
  resolvedBy: userId('resolver-1'),
  ...overrides,
})

export const escalationAudience = () => ({
  kind: 'escalation_resolution' as const,
  inboxItemId: INBOX_ITEM,
  resolvedAt: RESOLVED_AT,
  resolvedBy: userId('resolver-1'),
})

export const cycleFacts = (overrides: Record<string, unknown> = {}) => ({
  propertyId: PROPERTY,
  portalId: PORTAL,
  assignedTo: null,
  propertyName: 'Riverside Hotel',
  guestRating: 2,
  sourceType: 'feedback',
  sourceId: 'feedback-source-1',
  createdAt: new Date('2026-08-27T08:00:00.000Z'),
  currentCycleNumber: 2,
  currentSourceRevision: 4,
  stateRevision: 7,
  status: 'open',
  ...overrides,
})

export const cycleAudience = (
  overrides: Record<string, unknown> = {},
): NotificationAudienceAuthorizationInput['audience'] =>
  ({
    kind: 'handling_cycle',
    inboxItemId: INBOX_ITEM,
    sourceType: 'feedback',
    sourceId: 'feedback-source-1',
    cycleNumber: 2,
    sourceRevision: 4,
    stateRevision: 7,
    actorUserId: userId('another-manager'),
    ...overrides,
  }) as NotificationAudienceAuthorizationInput['audience']

export const reminderFacts = (overrides: Record<string, unknown> = {}) =>
  cycleFacts({
    targetKind: 'private_feedback_handling',
    reminderKind: 'halfway',
    scheduledFor: new Date(TARGET_SCHEDULED_FOR),
    ...overrides,
  })

export const reminderAudience = (
  overrides: Record<string, unknown> = {},
): NotificationAudienceAuthorizationInput['audience'] =>
  ({
    kind: 'response_target_reminder',
    inboxItemId: INBOX_ITEM,
    sourceType: 'feedback',
    sourceId: 'feedback-source-1',
    cycleNumber: 2,
    sourceRevision: 4,
    stateRevision: 7,
    targetKind: 'private_feedback_handling',
    reminderKind: 'halfway',
    scheduledFor: TARGET_SCHEDULED_FOR,
    ...overrides,
  }) as NotificationAudienceAuthorizationInput['audience']

const goalRevisionBase = {
  programId: 'program-1',
  programVersionId: 'program-version-2',
  assignmentId: 'assignment-1',
  monthlyResultId: 'monthly-result-1',
  revisionId: 'revision-2',
  revision: 2,
  evaluationState: 'eligible' as const,
  achieved: false,
}

export const goalRevisionAudience = (overrides: Record<string, unknown> = {}) => ({
  kind: 'goal_result_revision' as const,
  ...goalRevisionBase,
  ...overrides,
})

export const goalRevisionFacts = (overrides: Record<string, unknown> = {}) => ({
  ...goalRevisionBase,
  programName: 'Guest rating average',
  subject: { kind: 'property' as const, propertyId: PROPERTY },
  ...overrides,
})

export const goalCompletionAudience = () => ({
  kind: 'goal_completion' as const,
  programId: 'program-1',
  assignmentId: 'assignment-1',
  monthlyResultId: 'monthly-result-1',
})

export const goalCompletionFacts = (overrides: Record<string, unknown> = {}) => ({
  programId: 'program-1',
  assignmentId: 'assignment-1',
  monthlyResultId: 'monthly-result-1',
  programName: 'Guest rating average',
  subject: { kind: 'property', propertyId: PROPERTY },
  ...overrides,
})
