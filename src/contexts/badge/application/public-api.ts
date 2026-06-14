// Badge context — public API surface for cross-context consumers.

export type { BadgeDefinition, BadgeAwardWithTarget } from '../domain/types'
export type { EvaluateBadgeForTargetInput } from './use-cases/evaluate-badge-for-target'
export type {
  ReconcileBadgeDefinitionsInput,
  ReconcileBadgeDefinitionsResult,
} from './use-cases/reconcile-badge-definitions'

export type {
  GetStaffVisibleBadgesInput,
  GetVisibleTargetBadgesInput,
  SetOrganizationBadgeEnablementInput,
} from './dto/badge.dto'

export type { BadgeEvent, BadgeAwarded } from '../domain/events'
export { badgeAwarded } from '../domain/events'
