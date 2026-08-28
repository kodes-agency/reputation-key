import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import { activityError } from '../../domain/errors'
import {
  createOperationalActionRecord,
  type CreateOperationalActionRecordInput,
  type OperationalActionHistoryRecordId,
  type OperationalActionRecord,
} from '../../domain/operational-action-history'
import type { OperationalActionHistoryStore } from '../../ports/operational-action-history-store.port'

const DAY_MS = 24 * 60 * 60 * 1_000
export const OPERATIONAL_ACTION_HISTORY_RETENTION_MS = 365 * DAY_MS
export const OPERATIONAL_ACTION_HISTORY_RETENTION_MODE =
  'report_only_pending_counsel' as const
export const OPERATIONAL_ACTION_HISTORY_BATCH_MAX = 100

export type OperationalActionHistoryLifecycleDeps = Readonly<{
  store: OperationalActionHistoryStore
  clock: () => Date
  idGen: () => OperationalActionHistoryRecordId
  holdIdGen: () => string
}>

export type AppendOperationalActionDeps = Pick<
  OperationalActionHistoryLifecycleDeps,
  'store' | 'clock' | 'idGen'
>

export type AppendOperationalActionInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId | null
}> &
  Omit<
    CreateOperationalActionRecordInput,
    'id' | 'recordedAt' | 'organizationId' | 'propertyId'
  >

const validDate = (value: Date): boolean => !Number.isNaN(value.getTime())

const create = (input: CreateOperationalActionRecordInput): OperationalActionRecord => {
  const result = createOperationalActionRecord(input)
  if (result.isErr()) throw result.error
  return result.value
}

export const appendOperationalAction =
  (deps: AppendOperationalActionDeps) => async (input: AppendOperationalActionInput) =>
    deps.store.append(
      create({
        ...input,
        id: deps.idGen(),
        recordedAt: deps.clock(),
      }),
    )

export type AppendOperationalAction = ReturnType<typeof appendOperationalAction>

const lifecycleAction = (
  deps: OperationalActionHistoryLifecycleDeps,
  input: Readonly<{
    organizationId: OrganizationId
    operatorId: string
    correlationId: string
    action:
      | 'operational_history.legal_hold_placed'
      | 'operational_history.legal_hold_released'
      | 'operational_history.redaction_applied'
      | 'operational_history.retention_assessed'
    outcome?: OperationalActionRecord['outcome']
    resourceId: string
    reasonCode: string
  }>,
): OperationalActionRecord => {
  const at = deps.clock()
  return create({
    id: deps.idGen(),
    organizationId: input.organizationId,
    propertyId: null,
    actorType: 'operator',
    actorId: input.operatorId,
    action: input.action,
    outcome: input.outcome ?? 'succeeded',
    resourceType: 'operational_history',
    resourceId: input.resourceId,
    reasonCode: input.reasonCode,
    provenance: {
      kind: 'history_lifecycle',
      id: input.correlationId,
      eventType: null,
      eventVersion: null,
      sourceContext: null,
      sourceAggregateId: null,
    },
    occurredAt: at,
    recordedAt: at,
  })
}

export type OperationalActionHistoryReadiness = Readonly<{
  state: 'ready' | 'unavailable'
  reason: 'sequence_current' | 'unaccounted_sequence_gap' | 'authority_store_unavailable'
  observedAt: Date
  retentionMode: typeof OPERATIONAL_ACTION_HISTORY_RETENTION_MODE
  lastSequence: number | null
  coveredSequenceCount: number | null
  duplicateSequenceCount: number | null
  minimumSequence: number | null
  maximumSequence: number | null
  oldestRecordAt: Date | null
  newestRecordAt: Date | null
  activeLegalHoldCount: number | null
}>

export type GetOperationalActionHistoryReadinessInput = Readonly<{
  organizationId: OrganizationId
  observedAt: Date
}>

export type GetOperationalActionHistoryReadinessDeps = Readonly<{
  store: OperationalActionHistoryStore
}>

export const getOperationalActionHistoryReadiness =
  (deps: GetOperationalActionHistoryReadinessDeps) =>
  async (input: GetOperationalActionHistoryReadinessInput) => {
    if (!validDate(input.observedAt)) {
      throw activityError(
        'invalid_operational_history_observation_time',
        'Operational Action History observation time is invalid',
      )
    }
    try {
      const snapshot = await deps.store.readReadiness(input.organizationId)
      const current =
        snapshot.coveredSequenceCount === snapshot.lastSequence &&
        snapshot.duplicateSequenceCount === 0 &&
        (snapshot.lastSequence === 0
          ? snapshot.minimumSequence === null && snapshot.maximumSequence === null
          : snapshot.minimumSequence === 1 &&
            snapshot.maximumSequence === snapshot.lastSequence)
      return {
        state: current ? ('ready' as const) : ('unavailable' as const),
        reason: current
          ? ('sequence_current' as const)
          : ('unaccounted_sequence_gap' as const),
        observedAt: input.observedAt,
        retentionMode: OPERATIONAL_ACTION_HISTORY_RETENTION_MODE,
        ...snapshot,
      }
    } catch {
      return {
        state: 'unavailable' as const,
        reason: 'authority_store_unavailable' as const,
        observedAt: input.observedAt,
        retentionMode: OPERATIONAL_ACTION_HISTORY_RETENTION_MODE,
        lastSequence: null,
        coveredSequenceCount: null,
        duplicateSequenceCount: null,
        minimumSequence: null,
        maximumSequence: null,
        oldestRecordAt: null,
        newestRecordAt: null,
        activeLegalHoldCount: null,
      }
    }
  }

export type GetOperationalActionHistoryReadiness = ReturnType<
  typeof getOperationalActionHistoryReadiness
>

export type AssessOperationalActionHistoryRetentionInput = Readonly<{
  organizationId: OrganizationId
  operatorId: string
  correlationId: string
}>

export const assessOperationalActionHistoryRetention =
  (deps: OperationalActionHistoryLifecycleDeps) =>
  async (input: AssessOperationalActionHistoryRetentionInput) => {
    const now = deps.clock()
    const cutoff = new Date(now.getTime() - OPERATIONAL_ACTION_HISTORY_RETENTION_MS)
    const assessment = await deps.store.assessRetention({
      organizationId: input.organizationId,
      cutoff,
      assessmentRecord: lifecycleAction(deps, {
        ...input,
        action: 'operational_history.retention_assessed',
        resourceId: input.correlationId,
        reasonCode: OPERATIONAL_ACTION_HISTORY_RETENTION_MODE,
      }),
    })
    return {
      mode: OPERATIONAL_ACTION_HISTORY_RETENTION_MODE,
      cutoff,
      ...assessment,
    }
  }

export type AssessOperationalActionHistoryRetention = ReturnType<
  typeof assessOperationalActionHistoryRetention
>

export type PlaceOperationalActionHistoryLegalHoldInput = Readonly<{
  organizationId: OrganizationId
  operatorId: string
  correlationId: string
  reasonCode: string
  protectsFrom: Date
  protectsThrough: Date | null
}>

export const placeOperationalActionHistoryLegalHold =
  (deps: OperationalActionHistoryLifecycleDeps) =>
  async (input: PlaceOperationalActionHistoryLegalHoldInput) => {
    if (
      !validDate(input.protectsFrom) ||
      (input.protectsThrough !== null &&
        (!validDate(input.protectsThrough) ||
          input.protectsThrough.getTime() < input.protectsFrom.getTime()))
    ) {
      throw activityError(
        'invalid_operational_history_legal_hold',
        'Operational Action History legal-hold interval is invalid',
      )
    }
    const holdId = deps.holdIdGen()
    const placedAt = deps.clock()
    return deps.store.placeLegalHold({
      hold: {
        id: holdId,
        organizationId: input.organizationId,
        reasonCode: input.reasonCode,
        protectsFrom: input.protectsFrom,
        protectsThrough: input.protectsThrough,
        placedAt,
        placedByActorId: input.operatorId,
      },
      actionRecord: lifecycleAction(deps, {
        ...input,
        action: 'operational_history.legal_hold_placed',
        resourceId: holdId,
      }),
    })
  }

export type PlaceOperationalActionHistoryLegalHold = ReturnType<
  typeof placeOperationalActionHistoryLegalHold
>

export type ReleaseOperationalActionHistoryLegalHoldInput = Readonly<{
  organizationId: OrganizationId
  holdId: string
  operatorId: string
  correlationId: string
  reasonCode: string
}>

export const releaseOperationalActionHistoryLegalHold =
  (deps: OperationalActionHistoryLifecycleDeps) =>
  async (input: ReleaseOperationalActionHistoryLegalHoldInput) => {
    const releasedAt = deps.clock()
    const status = await deps.store.releaseLegalHold({
      organizationId: input.organizationId,
      holdId: input.holdId,
      releasedAt,
      releasedByActorId: input.operatorId,
      reasonCode: input.reasonCode,
      actionRecord: lifecycleAction(deps, {
        ...input,
        action: 'operational_history.legal_hold_released',
        resourceId: input.holdId,
      }),
    })
    return { status, holdId: input.holdId }
  }

export type ReleaseOperationalActionHistoryLegalHold = ReturnType<
  typeof releaseOperationalActionHistoryLegalHold
>

export type RedactOperationalActionHistorySubjectInput = Readonly<{
  organizationId: OrganizationId
  operatorId: string
  correlationId: string
  subjectType: 'actor' | 'resource'
  subjectId: string
  reasonCode: string
  limit?: number
}>

export const redactOperationalActionHistorySubject =
  (deps: OperationalActionHistoryLifecycleDeps) =>
  async (input: RedactOperationalActionHistorySubjectInput) => {
    const redactedAt = deps.clock()
    return deps.store.redactSubject({
      organizationId: input.organizationId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      reasonCode: input.reasonCode,
      redactedAt,
      limit: Math.min(
        OPERATIONAL_ACTION_HISTORY_BATCH_MAX,
        Math.max(1, Math.trunc(input.limit ?? OPERATIONAL_ACTION_HISTORY_BATCH_MAX)),
      ),
      actionRecord: lifecycleAction(deps, {
        ...input,
        action: 'operational_history.redaction_applied',
        resourceId: input.correlationId,
      }),
    })
  }

export type RedactOperationalActionHistorySubject = ReturnType<
  typeof redactOperationalActionHistorySubject
>
