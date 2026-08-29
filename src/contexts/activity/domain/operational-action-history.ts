import { err, ok, type Result } from '#/shared/domain'
import type { Brand } from '#/shared/domain/brand'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import { activityError, type ActivityError } from './errors'

export type OperationalActionHistoryRecordId = Brand<
  string,
  'OperationalActionHistoryRecordId'
>

export const operationalActionHistoryRecordId = (
  value: string,
): OperationalActionHistoryRecordId => value as OperationalActionHistoryRecordId

export const OPERATIONAL_ACTION_KINDS = Object.freeze([
  { action: 'authentication.decision', resourceType: 'account' },
  { action: 'authorization.decision', resourceType: 'policy' },
  { action: 'member.role_changed', resourceType: 'member' },
  { action: 'property_access.changed', resourceType: 'property_grant' },
  { action: 'sensitive_data.accessed', resourceType: 'data_export' },
  { action: 'sensitive_data.exported', resourceType: 'data_export' },
  { action: 'capability.changed', resourceType: 'capability' },
  { action: 'policy.changed', resourceType: 'policy' },
  { action: 'google_connection.connected', resourceType: 'google_connection' },
  { action: 'google_connection.disconnected', resourceType: 'google_connection' },
  { action: 'google_reply.published', resourceType: 'reply' },
  { action: 'guest_feedback.moderated', resourceType: 'feedback' },
  { action: 'portal_upload.validated', resourceType: 'upload' },
  { action: 'privacy_request.received', resourceType: 'privacy_request' },
  { action: 'privacy_request.fulfilled', resourceType: 'privacy_request' },
  { action: 'property.archived', resourceType: 'property' },
  { action: 'property.restored', resourceType: 'property' },
  { action: 'property.deleted', resourceType: 'property' },
  { action: 'portal.archived', resourceType: 'portal' },
  { action: 'portal.published', resourceType: 'portal' },
  { action: 'operator.command_executed', resourceType: 'operator_command' },
  { action: 'operational_history.accessed', resourceType: 'operational_history' },
  { action: 'operational_history.exported', resourceType: 'operational_history' },
  {
    action: 'operational_history.legal_hold_placed',
    resourceType: 'operational_history',
  },
  {
    action: 'operational_history.legal_hold_released',
    resourceType: 'operational_history',
  },
  {
    action: 'operational_history.redaction_applied',
    resourceType: 'operational_history',
  },
  {
    action: 'operational_history.retention_assessed',
    resourceType: 'operational_history',
  },
] as const)

export type OperationalAction = (typeof OPERATIONAL_ACTION_KINDS)[number]['action']
export type OperationalActionResourceType =
  (typeof OPERATIONAL_ACTION_KINDS)[number]['resourceType']
export type OperationalActionOutcome = 'succeeded' | 'denied' | 'failed'
export type OperationalActionActorType =
  'user' | 'system' | 'operator' | 'service' | 'public'
export type OperationalActionProvenanceKind =
  | 'domain_fact'
  | 'policy_decision'
  | 'interactive_command'
  | 'worker_command'
  | 'operator_command'
  | 'history_access'
  | 'history_lifecycle'

export type OperationalActionProvenance = Readonly<{
  kind: OperationalActionProvenanceKind
  id: string
  eventType: string | null
  eventVersion: number | null
  sourceContext: string | null
  sourceAggregateId: string | null
}>

export type OperationalActionRecord = Readonly<{
  id: OperationalActionHistoryRecordId
  organizationId: OrganizationId
  propertyId: PropertyId | null
  actorType: OperationalActionActorType
  actorId: string | null
  action: OperationalAction
  outcome: OperationalActionOutcome
  resourceType: OperationalActionResourceType
  resourceId: string | null
  reasonCode: string | null
  provenance: OperationalActionProvenance
  occurredAt: Date
  recordedAt: Date
}>

export type CreateOperationalActionRecordInput = OperationalActionRecord

const KIND_KEYS: ReadonlySet<string> = new Set(
  OPERATIONAL_ACTION_KINDS.map(
    ({ action, resourceType }) => `${action}\u0000${resourceType}`,
  ),
)
const ACTIONS: ReadonlySet<string> = new Set(
  OPERATIONAL_ACTION_KINDS.map(({ action }) => action),
)
const RESOURCE_TYPES: ReadonlySet<string> = new Set(
  OPERATIONAL_ACTION_KINDS.map(({ resourceType }) => resourceType),
)
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$/u
const CODE = /^[a-z][a-z0-9_.:-]{0,127}$/u
const ATTRIBUTABLE_ACTORS: ReadonlySet<OperationalActionActorType> = new Set([
  'user',
  'operator',
  'service',
])

export const isOperationalAction = (value: string): value is OperationalAction =>
  ACTIONS.has(value)

export const isOperationalActionResourceType = (
  value: string,
): value is OperationalActionResourceType => RESOURCE_TYPES.has(value)

const validIdentifier = (value: string | null): boolean =>
  value === null || IDENTIFIER.test(value)

const invalidProvenance = (message: string): ActivityError =>
  activityError('invalid_operational_action_provenance', message)

/**
 * Each rule reports the first violation it owns, or null when the record
 * satisfies it. `createOperationalActionRecord` runs them in a fixed order, so
 * the reported failure is the same one the inline guard sequence reported.
 */
type OperationalActionRule = (
  input: CreateOperationalActionRecordInput,
) => ActivityError | null

const identifierRule: OperationalActionRule = (input) =>
  validIdentifier(input.resourceId) &&
  validIdentifier(input.actorId) &&
  validIdentifier(input.provenance.id) &&
  (input.reasonCode === null || CODE.test(input.reasonCode))
    ? null
    : activityError(
        'invalid_operational_action_identifier',
        'Operational Action History accepts identifiers and reason codes only',
      )

const resourceAttributionRule: OperationalActionRule = (input) =>
  input.resourceId === null &&
  input.action !== 'authentication.decision' &&
  input.action !== 'authorization.decision'
    ? activityError(
        'invalid_operational_action_identifier',
        'Operational Action History resource attribution is required',
      )
    : null

const actorAttributionRule: OperationalActionRule = (input) =>
  ATTRIBUTABLE_ACTORS.has(input.actorType) === (input.actorId !== null)
    ? null
    : activityError(
        'invalid_operational_action_actor',
        'Operational Action History actor attribution does not match actor type',
      )

const hasCompleteEventIdentity = (provenance: OperationalActionProvenance): boolean =>
  provenance.eventType !== null &&
  CODE.test(provenance.eventType) &&
  provenance.eventVersion !== null &&
  Number.isInteger(provenance.eventVersion) &&
  provenance.eventVersion >= 1 &&
  provenance.sourceContext !== null &&
  CODE.test(provenance.sourceContext) &&
  provenance.sourceAggregateId !== null &&
  validIdentifier(provenance.sourceAggregateId)

const hasNoEventIdentity = (provenance: OperationalActionProvenance): boolean =>
  provenance.eventType === null &&
  provenance.eventVersion === null &&
  provenance.sourceContext === null &&
  provenance.sourceAggregateId === null

const provenanceRule: OperationalActionRule = ({ provenance }) => {
  if (provenance.kind === 'domain_fact') {
    return hasCompleteEventIdentity(provenance)
      ? null
      : invalidProvenance(
          'Durable source-event identity and version are required without inference',
        )
  }
  return hasNoEventIdentity(provenance)
    ? null
    : invalidProvenance(
        'Non-event Operational Action History provenance cannot invent event fields',
      )
}

const timeRule: OperationalActionRule = (input) =>
  Number.isNaN(input.occurredAt.getTime()) ||
  Number.isNaN(input.recordedAt.getTime()) ||
  input.recordedAt.getTime() < input.occurredAt.getTime()
    ? activityError(
        'invalid_operational_action_time',
        'Operational Action History times are invalid',
      )
    : null

const kindRule: OperationalActionRule = (input) =>
  KIND_KEYS.has(`${input.action}\u0000${input.resourceType}`)
    ? null
    : activityError(
        'invalid_operational_action_kind',
        `Unsupported Operational Action History kind: ${input.action}/${input.resourceType}`,
      )

const OPERATIONAL_ACTION_RULES: readonly OperationalActionRule[] = [
  kindRule,
  identifierRule,
  resourceAttributionRule,
  actorAttributionRule,
  provenanceRule,
  timeRule,
]

export const createOperationalActionRecord = (
  input: CreateOperationalActionRecordInput,
): Result<OperationalActionRecord, ActivityError> => {
  for (const rule of OPERATIONAL_ACTION_RULES) {
    const violation = rule(input)
    if (violation) return err(violation)
  }
  return ok(input)
}
