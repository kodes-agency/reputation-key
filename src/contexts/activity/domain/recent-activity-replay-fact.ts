import type {
  RecentActivityEntryId,
  OrganizationId,
  PropertyId,
  UserId,
} from '#/shared/domain/ids'
import type {
  ActivityAction,
  ActivityPayload,
  ActivitySource,
  ResourceType,
} from './types'

export const RECENT_ACTIVITY_REPLAY_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000
export const RECENT_ACTIVITY_VISIBILITY_TARGET_MS = 5 * 60 * 1_000
export const RECENT_ACTIVITY_REBUILD_BATCH_MAX = 100

export const RECENT_ACTIVITY_REPLAY_SOURCE_KINDS = [
  'durable_fact',
  'legacy_projection_snapshot',
] as const

export type RecentActivityReplaySourceKind =
  (typeof RECENT_ACTIVITY_REPLAY_SOURCE_KINDS)[number]

export type RecentActivityReplaySourceEvent = Readonly<{
  eventId: string
  eventType: string
  eventVersion: number
  organizationId: string
  propertyId: string | null
  sourceContext: string
  sourceAggregateId: string
  occurredAt?: string
  recordedAt?: string
}>

export type RecentActivityProjectionInput = Readonly<{
  action: ActivityAction
  resourceType: ResourceType
  resourceId: string
  propertyId: PropertyId | null
  organizationId: OrganizationId
  userId: UserId | null
  source: ActivitySource
  occurredAt?: Date | string
  payload: ActivityPayload
}>

type ReplaySource = Readonly<{
  replayKey: string
  sourceKind: RecentActivityReplaySourceKind
  sourceEventId: string | null
  sourceEventType: string | null
  sourceEventVersion: number | null
  sourceContext: string | null
  sourceAggregateId: string | null
  organizationId: OrganizationId
  propertyId: PropertyId | null
  sourceOccurredAt: Date
}>

export type ProjectableRecentActivityReplayFact = ReplaySource &
  Readonly<{
    disposition: 'projectable'
    projectionId: RecentActivityEntryId
    actorSubjectId: UserId | null
    /** Durable privacy marker preventing recovery/redelivery from restoring a label. */
    actorLabelRedactedAt: Date | null
    action: ActivityAction
    resourceType: ResourceType
    resourceId: string
    payload: ActivityPayload
    source: ActivitySource
  }>

export type ObsoleteRecentActivityReplayFact = ReplaySource &
  Readonly<{
    disposition: 'obsolete'
    projectionId: null
    actorSubjectId: null
    actorLabelRedactedAt: null
    action: null
    resourceType: null
    resourceId: null
    payload: null
    source: null
  }>

export type RecentActivityReplayFact =
  ProjectableRecentActivityReplayFact | ObsoleteRecentActivityReplayFact

const SAFE_REPLAY_VALUE = /^[A-Za-z0-9_.:-]{1,255}$/u
const SAFE_SUBJECTS = new Set([
  'escalation',
  'goal_result',
  'inbox_item',
  'integration',
  'member',
  'note',
  'organization',
  'portal',
  'portal_health',
  'portal_publication',
  'property',
  'reply',
  'status',
])

const sourceTime = (value: Date | string | undefined): Date => {
  const parsed = value instanceof Date ? value : new Date(value ?? Number.NaN)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Recent Activity replay fact has no valid source time')
  }
  return parsed
}

const assertContentFreeRecentActivityInput = (
  input: RecentActivityProjectionInput,
): void => {
  if (!SAFE_SUBJECTS.has(input.payload.subject)) {
    throw new Error('Recent Activity replay subject is not allowlisted')
  }
  for (const value of [
    input.payload.from,
    input.payload.to,
    input.payload.detail,
    input.payload.bulkId ?? null,
  ]) {
    if (value !== null && !SAFE_REPLAY_VALUE.test(value)) {
      throw new Error('Recent Activity replay transition value is not content-free')
    }
  }
  if (!SAFE_REPLAY_VALUE.test(input.resourceId)) {
    throw new Error('Recent Activity replay resource identifier is invalid')
  }
}

const durableSource = (event: RecentActivityReplaySourceEvent) => ({
  replayKey: `event:${event.organizationId}:${event.eventId}`,
  sourceKind: 'durable_fact' as const,
  sourceEventId: event.eventId,
  sourceEventType: event.eventType,
  sourceEventVersion: event.eventVersion,
  sourceContext: event.sourceContext,
  sourceAggregateId: event.sourceAggregateId,
  organizationId: event.organizationId as OrganizationId,
  propertyId: (event.propertyId as PropertyId | null) ?? null,
})

export const createProjectableRecentActivityReplayFact = (
  event: RecentActivityReplaySourceEvent,
  input: RecentActivityProjectionInput,
  projectionId: RecentActivityEntryId,
): ProjectableRecentActivityReplayFact => {
  assertContentFreeRecentActivityInput(input)
  if (
    input.organizationId !== event.organizationId ||
    input.propertyId !== event.propertyId
  ) {
    throw new Error('Recent Activity replay scope does not match its source event')
  }
  return {
    ...durableSource(event),
    sourceOccurredAt: sourceTime(
      input.occurredAt ?? event.occurredAt ?? event.recordedAt,
    ),
    disposition: 'projectable',
    projectionId,
    actorSubjectId: input.userId,
    actorLabelRedactedAt: null,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    payload: input.payload,
    source: input.source,
  }
}

export const createObsoleteRecentActivityReplayFact = (
  event: RecentActivityReplaySourceEvent,
): ObsoleteRecentActivityReplayFact => ({
  ...durableSource(event),
  sourceOccurredAt: sourceTime(event.occurredAt ?? event.recordedAt),
  disposition: 'obsolete',
  projectionId: null,
  actorSubjectId: null,
  actorLabelRedactedAt: null,
  action: null,
  resourceType: null,
  resourceId: null,
  payload: null,
  source: null,
})
