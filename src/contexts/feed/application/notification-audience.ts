import {
  inboxItemId,
  portalId,
  userId as brandUserId,
  type InboxItemId,
  type OrganizationId,
  type PropertyId,
  type UserId,
} from '#/shared/domain/ids'
import type { PortalPublicApi } from '#/contexts/portal/application/public-api'
import type { UserLookupPort } from './ports/notification-user-lookup.port'
import type { ResponsibleManagerLookupPort } from './ports/responsible-manager-lookup.port'
import type { InboxItemLookupPort } from './ports/notification-inbox-item-lookup.port'
import type { EscalationResolutionLookupPort } from './ports/escalation-resolution-lookup.port'
import {
  inboxNotificationAudience,
  resolveResponsibleRecipients,
  type ResponsibleScope,
} from './responsible-recipients'
import { resolveEscalationResolutionRecipients } from './escalation-resolution-recipients'
import { resolveResponseTargetReminderRecipients } from './response-target-reminder-recipients'
import type {
  GoalSubject,
  MonthlyResultNotificationFactsLookup,
} from '#/contexts/reporting/application/public-api'
import {
  ORGANIZATION_ACCOUNT_NOTIFICATION_EVENT_TYPES,
  type OrganizationAccountNotificationAuthorityPort,
  type OrganizationAccountNotificationEventType,
} from './ports/organization-account-notification-authority.port'
import {
  isActionablePortalHealthReason,
  type ActionablePortalHealthReason,
  type ActionablePortalHealthStatus,
} from './portal-health-notification'

/** One exact Handling Cycle, as the Inbox head showed it when the notice was queued. */
export type HandlingCycleRef = Readonly<{
  inboxItemId: InboxItemId
  sourceType: 'review' | 'feedback'
  sourceId: string
  cycleNumber: number
  sourceRevision: number
  stateRevision: number
}>

/**
 * Durable description of why a recipient may receive a notification.
 * Identifiers only: no review, guest, staff, or provider content enters the queue.
 */
export type NotificationAudience =
  | Readonly<{
      kind: 'affected_organization_user'
      eventId: string
      eventType: OrganizationAccountNotificationEventType
    }>
  | Readonly<{ kind: 'responsible_scope'; scope: ResponsibleScope }>
  | Readonly<{ kind: 'account_admin' }>
  | Readonly<{
      kind: 'responsibility_gap'
      scope: Exclude<ResponsibleScope, Readonly<{ kind: 'portal_group' }>>
    }>
  | Readonly<{ kind: 'inbox_assignee'; inboxItemId: InboxItemId }>
  | Readonly<{
      kind: 'bulk_inbox_assignee'
      inboxItemIds: ReadonlyArray<InboxItemId>
    }>
  | Readonly<{
      kind: 'escalation_resolution'
      inboxItemId: InboxItemId
      resolvedAt: string
      resolvedBy: UserId | null
    }>
  | Readonly<{
      kind: 'handling_cycle'
      inboxItemId: InboxItemId
      sourceType: 'review' | 'feedback'
      sourceId: string
      cycleNumber: number
      sourceRevision: number
      stateRevision: number
      actorUserId: UserId | null
    }>
  | Readonly<{
      kind: 'bulk_handling_cycle'
      cycles: ReadonlyArray<HandlingCycleRef>
      actorUserId: UserId | null
    }>
  | Readonly<{
      kind: 'response_target_reminder'
      inboxItemId: InboxItemId
      sourceType: 'review' | 'feedback'
      sourceId: string
      cycleNumber: number
      sourceRevision: number
      stateRevision: number
      targetKind: 'google_review_response' | 'private_feedback_handling'
      reminderKind: 'halfway' | 'target_passed'
      scheduledFor: string
    }>
  | Readonly<{
      kind: 'portal_health'
      portalId: string
      status: ActionablePortalHealthStatus
      reason: ActionablePortalHealthReason
      /** When the Health interval this notice announces opened (ISO). */
      effectiveFrom: string
    }>
  | Readonly<{
      kind: 'goal_completion'
      programId: string
      assignmentId: string
      monthlyResultId: string
    }>
  | Readonly<{
      kind: 'goal_result_revision'
      programId: string
      programVersionId: string
      assignmentId: string
      monthlyResultId: string
      revisionId: string
      revision: number
      evaluationState: 'eligible' | 'insufficient_data' | 'unavailable' | 'quarantined'
      achieved: boolean | null
    }>
  | Readonly<{ kind: 'property_operator' }>

export type NotificationAudienceAuthorizationInput = Readonly<{
  userId: UserId
  organizationId: OrganizationId
  propertyId: PropertyId | null
  audience: NotificationAudience
}>

/**
 * Whether the recipient may still receive the notice. A grouped notice
 * answers with how many of its items still stand for the recipient, so its
 * count is restated at delivery; `false` suppresses any notice.
 */
export type NotificationAudienceDecision = boolean | Readonly<{ itemCount: number }>

export type NotificationAudienceAuthorizer = (
  input: NotificationAudienceAuthorizationInput,
) => Promise<NotificationAudienceDecision>

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0
const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  !Number.isNaN(new Date(value).getTime()) &&
  new Date(value).toISOString() === value
const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const isClosedGoalEvaluationState = (
  value: unknown,
): value is 'eligible' | 'insufficient_data' | 'unavailable' | 'quarantined' =>
  value === 'eligible' ||
  value === 'insufficient_data' ||
  value === 'unavailable' ||
  value === 'quarantined'

const parseClosedGoalEvaluation = (
  state: unknown,
  achieved: unknown,
): Readonly<{
  evaluationState: 'eligible' | 'insufficient_data' | 'unavailable' | 'quarantined'
  achieved: boolean | null
}> | null => {
  if (!isClosedGoalEvaluationState(state)) return null
  if (state === 'eligible') {
    return typeof achieved === 'boolean' ? { evaluationState: state, achieved } : null
  }
  return achieved === null ? { evaluationState: state, achieved: null } : null
}

type AudienceRecord = Readonly<Record<string, unknown>>
/** Parses one `kind` of the queued-audience union; `null` rejects the payload. */
type AudienceKindParser = (value: AudienceRecord) => NotificationAudience | null

const parseAffectedOrganizationUser: AudienceKindParser = (value) => {
  if (
    !isIdentifier(value.eventId) ||
    typeof value.eventType !== 'string' ||
    !ORGANIZATION_ACCOUNT_NOTIFICATION_EVENT_TYPES.some(
      (eventType) => eventType === value.eventType,
    )
  ) {
    return null
  }
  return {
    kind: 'affected_organization_user',
    eventId: value.eventId,
    eventType: value.eventType as OrganizationAccountNotificationEventType,
  }
}

const parseInboxAssignee: AudienceKindParser = (value) =>
  isIdentifier(value.inboxItemId)
    ? { kind: 'inbox_assignee', inboxItemId: value.inboxItemId as InboxItemId }
    : null

const parseBulkInboxAssignee: AudienceKindParser = (value) => {
  if (
    !Array.isArray(value.inboxItemIds) ||
    value.inboxItemIds.length === 0 ||
    value.inboxItemIds.length > 100 ||
    !value.inboxItemIds.every(isIdentifier) ||
    new Set(value.inboxItemIds).size !== value.inboxItemIds.length
  ) {
    return null
  }
  return {
    kind: 'bulk_inbox_assignee',
    inboxItemIds: value.inboxItemIds.map(inboxItemId),
  }
}

const parseEscalationResolution: AudienceKindParser = (value) => {
  if (
    !isIdentifier(value.inboxItemId) ||
    !isIsoDate(value.resolvedAt) ||
    !(value.resolvedBy === null || isIdentifier(value.resolvedBy))
  ) {
    return null
  }
  return {
    kind: 'escalation_resolution',
    inboxItemId: inboxItemId(value.inboxItemId),
    resolvedAt: value.resolvedAt,
    resolvedBy: value.resolvedBy === null ? null : brandUserId(value.resolvedBy),
  }
}

/** Identity shared by the two inbox-cycle audiences. */
const parseHandlingCycleCore = (value: AudienceRecord) => {
  if (
    !isIdentifier(value.inboxItemId) ||
    !(value.sourceType === 'review' || value.sourceType === 'feedback') ||
    !isIdentifier(value.sourceId) ||
    !isPositiveSafeInteger(value.cycleNumber) ||
    !isPositiveSafeInteger(value.sourceRevision) ||
    !isPositiveSafeInteger(value.stateRevision)
  ) {
    return null
  }
  return {
    inboxItemId: inboxItemId(value.inboxItemId),
    sourceType: value.sourceType,
    sourceId: value.sourceId,
    cycleNumber: value.cycleNumber,
    sourceRevision: value.sourceRevision,
    stateRevision: value.stateRevision,
  } as const
}

const parseHandlingCycle: AudienceKindParser = (value) => {
  const core = parseHandlingCycleCore(value)
  if (!core) return null
  if (!(value.actorUserId === null || isIdentifier(value.actorUserId))) return null
  return {
    kind: 'handling_cycle',
    ...core,
    actorUserId: value.actorUserId === null ? null : brandUserId(value.actorUserId),
  }
}

/** One bulk command reopens at most 100 items, each at most once. */
const parseBulkHandlingCycle: AudienceKindParser = (value) => {
  if (
    !Array.isArray(value.cycles) ||
    value.cycles.length === 0 ||
    value.cycles.length > 100 ||
    !(value.actorUserId === null || isIdentifier(value.actorUserId))
  ) {
    return null
  }
  const cycles = value.cycles.map((cycle: unknown) =>
    isRecord(cycle) ? parseHandlingCycleCore(cycle) : null,
  )
  const parsed = cycles.filter((cycle): cycle is HandlingCycleRef => cycle !== null)
  if (
    parsed.length !== cycles.length ||
    new Set(parsed.map((cycle) => cycle.inboxItemId)).size !== parsed.length
  ) {
    return null
  }
  return {
    kind: 'bulk_handling_cycle',
    cycles: parsed,
    actorUserId: value.actorUserId === null ? null : brandUserId(value.actorUserId),
  }
}

const parseResponseTargetReminder: AudienceKindParser = (value) => {
  const core = parseHandlingCycleCore(value)
  if (!core) return null
  if (
    !(
      value.targetKind === 'google_review_response' ||
      value.targetKind === 'private_feedback_handling'
    ) ||
    !(value.reminderKind === 'halfway' || value.reminderKind === 'target_passed') ||
    !isIsoDate(value.scheduledFor)
  ) {
    return null
  }
  return {
    kind: 'response_target_reminder',
    ...core,
    targetKind: value.targetKind,
    reminderKind: value.reminderKind,
    scheduledFor: value.scheduledFor,
  }
}

const parsePortalHealth: AudienceKindParser = (value) => {
  if (
    !isIdentifier(value.portalId) ||
    !(value.status === 'degraded' || value.status === 'unavailable') ||
    !isActionablePortalHealthReason(value.reason) ||
    !isIsoDate(value.effectiveFrom)
  ) {
    return null
  }
  return {
    kind: 'portal_health',
    portalId: value.portalId,
    status: value.status,
    reason: value.reason,
    effectiveFrom: value.effectiveFrom,
  }
}

const parseGoalCompletion: AudienceKindParser = (value) => {
  if (
    !isIdentifier(value.programId) ||
    !isIdentifier(value.assignmentId) ||
    !isIdentifier(value.monthlyResultId)
  ) {
    return null
  }
  return {
    kind: 'goal_completion',
    programId: value.programId,
    assignmentId: value.assignmentId,
    monthlyResultId: value.monthlyResultId,
  }
}

const parseGoalResultRevision: AudienceKindParser = (value) => {
  const evaluation = parseClosedGoalEvaluation(value.evaluationState, value.achieved)
  if (
    !isIdentifier(value.programId) ||
    !isIdentifier(value.programVersionId) ||
    !isIdentifier(value.assignmentId) ||
    !isIdentifier(value.monthlyResultId) ||
    !isIdentifier(value.revisionId) ||
    !isPositiveSafeInteger(value.revision) ||
    !evaluation
  ) {
    return null
  }
  return {
    kind: 'goal_result_revision',
    programId: value.programId,
    programVersionId: value.programVersionId,
    assignmentId: value.assignmentId,
    monthlyResultId: value.monthlyResultId,
    revisionId: value.revisionId,
    revision: value.revision,
    ...evaluation,
  }
}

const parseResponsibleScope: AudienceKindParser = (value) => {
  if (!isRecord(value.scope)) return null
  const scope = value.scope
  if (scope.kind === 'property' && isIdentifier(scope.propertyId)) {
    return {
      kind: 'responsible_scope',
      scope: { kind: 'property', propertyId: scope.propertyId },
    }
  }
  if (scope.kind === 'portal' && isIdentifier(scope.portalId)) {
    return {
      kind: 'responsible_scope',
      scope: { kind: 'portal', portalId: scope.portalId },
    }
  }
  if (scope.kind === 'portal_group' && isIdentifier(scope.portalGroupId)) {
    return {
      kind: 'responsible_scope',
      scope: { kind: 'portal_group', portalGroupId: scope.portalGroupId },
    }
  }
  return null
}

/** Only a Property or a Portal carries a responsible-manager gap. */
const parseResponsibilityGap: AudienceKindParser = (value) => {
  const parsed = parseResponsibleScope(value)
  if (parsed?.kind !== 'responsible_scope' || parsed.scope.kind === 'portal_group') {
    return null
  }
  return { kind: 'responsibility_gap', scope: parsed.scope }
}

/**
 * A `Map` — not an object literal — so an attacker-supplied `kind` such as
 * `"constructor"` cannot reach `Object.prototype` and resolve to a callable.
 */
const AUDIENCE_KIND_PARSERS: ReadonlyMap<string, AudienceKindParser> = new Map<
  string,
  AudienceKindParser
>([
  ['affected_organization_user', parseAffectedOrganizationUser],
  ['account_admin', () => ({ kind: 'account_admin' })],
  ['responsibility_gap', parseResponsibilityGap],
  ['property_operator', () => ({ kind: 'property_operator' })],
  ['inbox_assignee', parseInboxAssignee],
  ['bulk_inbox_assignee', parseBulkInboxAssignee],
  ['escalation_resolution', parseEscalationResolution],
  ['handling_cycle', parseHandlingCycle],
  ['bulk_handling_cycle', parseBulkHandlingCycle],
  ['response_target_reminder', parseResponseTargetReminder],
  ['portal_health', parsePortalHealth],
  ['goal_completion', parseGoalCompletion],
  ['goal_result_revision', parseGoalResultRevision],
  ['responsible_scope', parseResponsibleScope],
])

/** Parse the queue trust boundary without accepting a partial scope. */
export function parseNotificationAudience(value: unknown): NotificationAudience | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null
  const parseKind = AUDIENCE_KIND_PARSERS.get(value.kind)
  return parseKind ? parseKind(value) : null
}

type Deps = Readonly<{
  userLookup: Pick<UserLookupPort, 'findByRole'>
  responsibleManagers: ResponsibleManagerLookupPort
  inboxItemLookup: Pick<
    InboxItemLookupPort,
    | 'findInboxItemFacts'
    | 'findHandlingCycleNotificationFacts'
    | 'findResponseTargetReminderNotificationFacts'
  >
  escalationResolutions: EscalationResolutionLookupPort
  portalHealthLookup: Pick<PortalPublicApi, 'findPortalHealthNotificationFacts'>
  monthlyResultFacts: MonthlyResultNotificationFactsLookup
  organizationAccountAuthority: OrganizationAccountNotificationAuthorityPort
}>

const includesRecipient = (recipients: readonly UserId[], recipient: UserId) =>
  recipients.includes(recipient)

/**
 * The Property-scoped half of an authorization request: every audience kind
 * except `affected_organization_user` requires a non-null Property.
 */
type PropertyScopedRequest = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  userId: UserId
}>

type AudienceOfKind<Kind extends NotificationAudience['kind']> = Extract<
  NotificationAudience,
  { kind: Kind }
>

const isResponsibleScopeRecipient = async (
  deps: Deps,
  { organizationId, userId }: PropertyScopedRequest,
  scope: ResponsibleScope,
) =>
  includesRecipient(
    await resolveResponsibleRecipients(deps, organizationId, scope),
    userId,
  )

const isAccountAdminRecipient = async (
  deps: Deps,
  { organizationId, userId }: PropertyScopedRequest,
) =>
  includesRecipient(
    await deps.userLookup.findByRole(organizationId, 'AccountAdmin'),
    userId,
  )

/**
 * "Choose a responsible manager" stands only while no eligible manager holds
 * the scope; once someone is chosen, a queued request is stale. Recipients
 * are current AccountAdmins, the people who can choose one.
 */
const isResponsibilityGapRecipient = async (
  deps: Deps,
  { organizationId, propertyId, userId }: PropertyScopedRequest,
  scope: AudienceOfKind<'responsibility_gap'>['scope'],
) => {
  if (scope.kind === 'property' && scope.propertyId !== propertyId) return false
  const [admins, managers] = await Promise.all([
    deps.userLookup.findByRole(organizationId, 'AccountAdmin'),
    scope.kind === 'property'
      ? deps.responsibleManagers.findForProperty(organizationId, propertyId)
      : deps.responsibleManagers.findForPortal(organizationId, portalId(scope.portalId)),
  ])
  return managers.length === 0 && includesRecipient(admins, userId)
}

const isStillInboxAssignee = async (
  deps: Deps,
  { organizationId, propertyId, userId }: PropertyScopedRequest,
  itemId: InboxItemId,
) => {
  const facts = await deps.inboxItemLookup.findInboxItemFacts(itemId, organizationId)
  return Boolean(facts && facts.propertyId === propertyId && facts.assignedTo === userId)
}

const isStillAssigneeOfEvery = async (
  deps: Deps,
  { organizationId, propertyId, userId }: PropertyScopedRequest,
  itemIds: ReadonlyArray<InboxItemId>,
) => {
  const facts = await Promise.all(
    itemIds.map((itemId) =>
      deps.inboxItemLookup.findInboxItemFacts(itemId, organizationId),
    ),
  )
  return !facts.some(
    (item) => !item || item.propertyId !== propertyId || item.assignedTo !== userId,
  )
}

const isEscalationResolutionRecipient = async (
  deps: Deps,
  { organizationId, propertyId, userId }: PropertyScopedRequest,
  audience: AudienceOfKind<'escalation_resolution'>,
) => {
  const facts = await deps.escalationResolutions.findEscalationResolutionFacts(
    audience.inboxItemId,
    organizationId,
  )
  if (
    !facts ||
    facts.propertyId !== propertyId ||
    facts.isEscalated ||
    facts.resolvedAt?.toISOString() !== audience.resolvedAt ||
    facts.resolvedBy !== audience.resolvedBy ||
    userId === audience.resolvedBy
  ) {
    return false
  }
  const recipients = await resolveEscalationResolutionRecipients(deps, {
    organizationId,
    propertyId,
    assignedTo: facts.assignedTo,
    resolvedBy: facts.resolvedBy,
  })
  return recipients.includes(userId)
}

/** The cycle is still the exact open head, and the user is responsible for it now. */
const isCurrentCycleRecipient = async (
  deps: Deps,
  { organizationId, propertyId, userId }: PropertyScopedRequest,
  cycle: HandlingCycleRef,
) => {
  const facts = await deps.inboxItemLookup.findHandlingCycleNotificationFacts(
    cycle.inboxItemId,
    organizationId,
  )
  if (
    !facts ||
    facts.propertyId !== propertyId ||
    facts.sourceType !== cycle.sourceType ||
    facts.sourceId !== cycle.sourceId ||
    facts.currentCycleNumber !== cycle.cycleNumber ||
    facts.currentSourceRevision !== cycle.sourceRevision ||
    facts.stateRevision !== cycle.stateRevision ||
    facts.status !== 'open'
  ) {
    return false
  }
  const currentAudience = inboxNotificationAudience(facts)
  const recipients =
    currentAudience.kind === 'responsible_scope'
      ? await resolveResponsibleRecipients(deps, organizationId, currentAudience.scope)
      : await deps.userLookup.findByRole(organizationId, 'AccountAdmin')
  return recipients.includes(userId)
}

const isHandlingCycleRecipient = async (
  deps: Deps,
  request: PropertyScopedRequest,
  audience: AudienceOfKind<'handling_cycle'>,
) => {
  if (request.userId === audience.actorUserId) return false
  return isCurrentCycleRecipient(deps, request, audience)
}

/**
 * A grouped notice stands while any of its cycles is still the open head and
 * the recipient still responsible for it, and counts only those. Per-item
 * reopen facts notify nobody, so one changed item must not silence the rest.
 */
const isBulkHandlingCycleRecipient = async (
  deps: Deps,
  request: PropertyScopedRequest,
  audience: AudienceOfKind<'bulk_handling_cycle'>,
): Promise<NotificationAudienceDecision> => {
  if (request.userId === audience.actorUserId) return false
  const current = await Promise.all(
    audience.cycles.map((cycle) => isCurrentCycleRecipient(deps, request, cycle)),
  )
  const itemCount = current.filter(Boolean).length
  return itemCount === 0 ? false : { itemCount }
}

const isResponseTargetReminderRecipient = async (
  deps: Deps,
  { organizationId, propertyId, userId }: PropertyScopedRequest,
  audience: AudienceOfKind<'response_target_reminder'>,
) => {
  const facts = await deps.inboxItemLookup.findResponseTargetReminderNotificationFacts({
    inboxItemId: audience.inboxItemId,
    organizationId,
    cycleNumber: audience.cycleNumber,
    targetKind: audience.targetKind,
    reminderKind: audience.reminderKind,
    scheduledFor: new Date(audience.scheduledFor),
  })
  if (
    !facts ||
    facts.propertyId !== propertyId ||
    facts.sourceType !== audience.sourceType ||
    facts.sourceId !== audience.sourceId ||
    facts.currentCycleNumber !== audience.cycleNumber ||
    facts.currentSourceRevision !== audience.sourceRevision ||
    facts.stateRevision !== audience.stateRevision ||
    facts.status !== 'open' ||
    facts.targetKind !== audience.targetKind ||
    facts.reminderKind !== audience.reminderKind ||
    facts.scheduledFor.toISOString() !== audience.scheduledFor
  ) {
    return false
  }
  const recipients = await resolveResponseTargetReminderRecipients(
    deps,
    organizationId,
    facts,
  )
  return recipients.includes(userId)
}

/**
 * The notice stands while the Health interval it announced is still open. The
 * interval's source version is no fence: every same-status reconcile re-stamps
 * it, although nothing about the Portal's Health changed.
 */
const isPortalHealthRecipient = async (
  deps: Deps,
  { organizationId, propertyId, userId }: PropertyScopedRequest,
  audience: AudienceOfKind<'portal_health'>,
) => {
  const portal = portalId(audience.portalId)
  const facts = await deps.portalHealthLookup.findPortalHealthNotificationFacts(
    organizationId,
    portal,
  )
  if (
    !facts ||
    facts.propertyId !== propertyId ||
    facts.status !== audience.status ||
    facts.reason !== audience.reason ||
    facts.effectiveFrom.toISOString() !== audience.effectiveFrom
  ) {
    return false
  }
  const recipients = await resolveResponsibleRecipients(deps, organizationId, {
    kind: 'portal',
    portalId: audience.portalId,
  })
  return recipients.includes(userId)
}

const goalSubjectScope = (subject: GoalSubject): ResponsibleScope =>
  subject.kind === 'property'
    ? { kind: 'property', propertyId: subject.propertyId }
    : subject.kind === 'portal_group'
      ? { kind: 'portal_group', portalGroupId: subject.portalGroupId }
      : { kind: 'portal', portalId: subject.portalId }

/**
 * "Goal completed" is checked against the result as it stands at delivery: a
 * correction that un-achieved the month since the close was handled makes the
 * lookup answer null, and the notice is dropped.
 */
const isGoalCompletionRecipient = async (
  deps: Deps,
  { organizationId, propertyId, userId }: PropertyScopedRequest,
  audience: AudienceOfKind<'goal_completion'>,
) => {
  const facts = await deps.monthlyResultFacts.findMonthlyResultNotificationFacts({
    organizationId,
    propertyId,
    assignmentId: audience.assignmentId,
    monthlyResultId: audience.monthlyResultId,
  })
  if (
    !facts ||
    facts.programId !== audience.programId ||
    facts.assignmentId !== audience.assignmentId ||
    facts.monthlyResultId !== audience.monthlyResultId ||
    (facts.subject.kind === 'property' && facts.subject.propertyId !== propertyId)
  ) {
    return false
  }
  return includesRecipient(
    await resolveResponsibleRecipients(
      deps,
      organizationId,
      goalSubjectScope(facts.subject),
    ),
    userId,
  )
}

const isGoalResultRevisionRecipient = async (
  deps: Deps,
  { organizationId, propertyId, userId }: PropertyScopedRequest,
  audience: AudienceOfKind<'goal_result_revision'>,
) => {
  const findRevision = deps.monthlyResultFacts.findMonthlyResultRevisionNotificationFacts
  if (!findRevision) return false
  const facts = await findRevision({
    organizationId,
    propertyId,
    programId: audience.programId,
    programVersionId: audience.programVersionId,
    assignmentId: audience.assignmentId,
    monthlyResultId: audience.monthlyResultId,
    revisionId: audience.revisionId,
    revision: audience.revision,
  })
  // Judged against the result's current head, as at handling time: a later
  // correction without flags must not silence this one while it still holds.
  if (
    !facts ||
    facts.programId !== audience.programId ||
    facts.programVersionId !== audience.programVersionId ||
    facts.assignmentId !== audience.assignmentId ||
    facts.monthlyResultId !== audience.monthlyResultId ||
    facts.revision < audience.revision ||
    facts.evaluationState !== audience.evaluationState ||
    facts.achieved !== audience.achieved ||
    (facts.subject.kind === 'property' && facts.subject.propertyId !== propertyId)
  ) {
    return false
  }
  return includesRecipient(
    await resolveResponsibleRecipients(
      deps,
      organizationId,
      goalSubjectScope(facts.subject),
    ),
    userId,
  )
}

/**
 * Re-check delivery authority at worker execution time. A queued recipient is
 * a candidate, never a durable permission: responsibility, membership, access,
 * or participation may have changed since the originating event was handled.
 */
export const createNotificationAudienceAuthorizer =
  (deps: Deps): NotificationAudienceAuthorizer =>
  async ({ audience, organizationId, propertyId, userId }) => {
    if (audience.kind === 'affected_organization_user') {
      if (propertyId !== null) return false
      return deps.organizationAccountAuthority.isAffectedRecipient({
        eventId: audience.eventId,
        eventType: audience.eventType,
        organizationId,
        userId,
      })
    }
    // Every other active audience kind is Property-scoped. A malformed job
    // cannot use an Organization-null scope to bypass its current authority.
    if (propertyId === null) return false
    const request: PropertyScopedRequest = { organizationId, propertyId, userId }
    switch (audience.kind) {
      case 'responsible_scope':
        return isResponsibleScopeRecipient(deps, request, audience.scope)
      case 'account_admin':
        return isAccountAdminRecipient(deps, request)
      case 'responsibility_gap':
        return isResponsibilityGapRecipient(deps, request, audience.scope)
      case 'escalation_resolution':
        return isEscalationResolutionRecipient(deps, request, audience)
      case 'handling_cycle':
        return isHandlingCycleRecipient(deps, request, audience)
      case 'bulk_handling_cycle':
        return isBulkHandlingCycleRecipient(deps, request, audience)
      case 'response_target_reminder':
        return isResponseTargetReminderRecipient(deps, request, audience)
      case 'portal_health':
        return isPortalHealthRecipient(deps, request, audience)
      case 'goal_completion':
        return isGoalCompletionRecipient(deps, request, audience)
      case 'goal_result_revision':
        return isGoalResultRevisionRecipient(deps, request, audience)
      case 'inbox_assignee':
        if (!(await isStillInboxAssignee(deps, request, audience.inboxItemId))) {
          return false
        }
        break
      case 'bulk_inbox_assignee':
        if (!(await isStillAssigneeOfEvery(deps, request, audience.inboxItemIds))) {
          return false
        }
        break
      case 'property_operator':
        break
    }
    // The assignee kinds and `property_operator` all additionally require
    // current responsibility for the Property.
    return deps.responsibleManagers.isEligibleForProperty(
      organizationId,
      propertyId,
      userId,
    )
  }
