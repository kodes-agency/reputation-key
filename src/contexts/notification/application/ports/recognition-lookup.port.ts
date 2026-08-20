// Notification context — port for the display names behind recognition
// notifications (goal.completed, badge.awarded).
//
// `goal.completed` and `badge.awarded` carry ids only, and a notification that
// says "Goal completed" without saying WHICH goal is not actionable. These
// lookups resolve the registered, non-sensitive display names that ADR 0046 r.8
// allows in copy: the tenant-authored goal name, the badge's catalogue name,
// and the portal / portal-group name that received the award. No person's name
// is ever resolved here.
import type {
  BadgeId,
  GoalId,
  OrganizationId,
  PortalId,
  PortalGroupId,
} from '#/shared/domain/ids'

export type GoalFacts = Readonly<{
  /** Tenant-authored goal name. */
  goalName: string
  /** Property the goal belongs to, for the property-name clause. */
  propertyName: string | null
}>

export type BadgeFacts = Readonly<{
  /** Badge catalogue display name. */
  badgeName: string
  /** Portal / portal-group display name, or null when the target is gone. */
  recipientName: string | null
}>

export type RecognitionLookupPort = Readonly<{
  /** Display facts for a completed goal. Null when the goal row is gone. */
  findGoalFacts(goalId: GoalId, orgId: OrganizationId): Promise<GoalFacts | null>

  /** Display facts for an award. Null when the badge definition is gone. */
  findBadgeFacts(
    input: Readonly<{
      badgeDefinitionId: BadgeId
      target:
        | Readonly<{ kind: 'portal'; id: PortalId }>
        | Readonly<{ kind: 'portal_group'; id: PortalGroupId }>
      orgId: OrganizationId
    }>,
  ): Promise<BadgeFacts | null>
}>
