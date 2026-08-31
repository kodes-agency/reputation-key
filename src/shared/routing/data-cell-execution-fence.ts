// Data Cell execution fence — one local-process admission decision.
//
// The ProcessingRouter answers a location-independent question: where SHOULD
// a subject execute? This module answers the separate runtime question: may
// THIS process touch that subject? Keeping the two interfaces distinct makes
// operator diagnostics honest while giving HTTP/server/repository/queue/
// outbox/provider/storage/operator boundaries one fail-closed comparison.
//
// Only content-free routing facts enter or leave this module. Property ids are
// used solely for the injected lookup and are deliberately absent from errors.

import {
  dataCellById,
  resolvePersistedDataCellId,
  type DataCellId,
} from '#/shared/domain/data-cell-catalogue'

export type DataCellExecutionBoundary =
  | 'http'
  | 'server_function'
  | 'repository'
  | 'queue'
  | 'outbox'
  | 'provider'
  | 'credential_broker'
  | 'object_storage'
  | 'backup'
  | 'operator_command'

export type DataCellExecutionDenyReason =
  | 'property_missing'
  | 'cell_unresolved'
  | 'cell_denied'
  | 'wrong_cell'
  | 'routing_unavailable'

export type PropertyDataCellFacts = Readonly<{
  dataCellId?: string | null
  processingRegion: string | null
  routingPolicyVersion: number
}>

export type DataCellExecutionDecision =
  | Readonly<{
      kind: 'allow'
      cell: DataCellId
      routingPolicyVersion: number
    }>
  | Readonly<{
      kind: 'deny'
      reason: DataCellExecutionDenyReason
      localCell: DataCellId
      targetCell: DataCellId | null
    }>

export class DataCellExecutionDeniedError extends Error {
  readonly name = 'DataCellExecutionDeniedError'

  constructor(
    readonly boundary: DataCellExecutionBoundary,
    readonly reason: DataCellExecutionDenyReason,
    readonly localCell: DataCellId,
    readonly targetCell: DataCellId | null,
  ) {
    // Content-free by construction: no Property/Organization/user id.
    super(
      `data_cell_execution_denied:${boundary}:${reason}:local=${localCell}:target=${targetCell ?? 'none'}`,
    )
  }
}

export type DataCellExecutionFence = Readonly<{
  localCell: DataCellId
  decideFacts: (facts: PropertyDataCellFacts | null) => DataCellExecutionDecision
  decideProperty: (propertyId: string) => Promise<DataCellExecutionDecision>
  assertFacts: (
    facts: PropertyDataCellFacts | null,
    boundary: DataCellExecutionBoundary,
  ) => DataCellId
  assertProperty: (
    propertyId: string,
    boundary: DataCellExecutionBoundary,
  ) => Promise<DataCellId>
}>

export function createDataCellExecutionFence(
  deps: Readonly<{
    localCell: string
    loadPropertyRouting: (propertyId: string) => Promise<PropertyDataCellFacts | null>
  }>,
): DataCellExecutionFence {
  const localDefinition = dataCellById(deps.localCell)
  if (!localDefinition) {
    throw new Error(`Unknown PROCESSING_CELL '${deps.localCell}'`)
  }
  const localCell = localDefinition.id

  const decideFacts = (
    facts: PropertyDataCellFacts | null,
  ): DataCellExecutionDecision => {
    if (!facts) {
      return { kind: 'deny', reason: 'property_missing', localCell, targetCell: null }
    }

    const resolved = resolvePersistedDataCellId(facts.dataCellId, facts.processingRegion)
    if (!resolved) {
      const unresolved =
        facts.dataCellId == null &&
        (facts.processingRegion == null || facts.processingRegion === 'unresolved')
      return {
        kind: 'deny',
        reason: unresolved ? 'cell_unresolved' : 'cell_denied',
        localCell,
        targetCell: null,
      }
    }

    const target = dataCellById(resolved)
    if (
      !target ||
      target.state !== 'accepting' ||
      !Number.isSafeInteger(facts.routingPolicyVersion) ||
      facts.routingPolicyVersion < 1 ||
      facts.routingPolicyVersion > target.policyVersion
    ) {
      return {
        kind: 'deny',
        reason: 'cell_denied',
        localCell,
        targetCell: target?.id ?? null,
      }
    }

    if (target.id !== localCell) {
      return {
        kind: 'deny',
        reason: 'wrong_cell',
        localCell,
        targetCell: target.id,
      }
    }

    return {
      kind: 'allow',
      cell: target.id,
      routingPolicyVersion: facts.routingPolicyVersion,
    }
  }

  const decideProperty = async (
    propertyId: string,
  ): Promise<DataCellExecutionDecision> => {
    try {
      return decideFacts(await deps.loadPropertyRouting(propertyId))
    } catch {
      return {
        kind: 'deny',
        reason: 'routing_unavailable',
        localCell,
        targetCell: null,
      }
    }
  }

  const assertDecision = (
    decision: DataCellExecutionDecision,
    boundary: DataCellExecutionBoundary,
  ): DataCellId => {
    if (decision.kind === 'allow') return decision.cell
    throw new DataCellExecutionDeniedError(
      boundary,
      decision.reason,
      decision.localCell,
      decision.targetCell,
    )
  }

  return Object.freeze({
    localCell,
    decideFacts,
    decideProperty,
    assertFacts: (facts, boundary) => assertDecision(decideFacts(facts), boundary),
    assertProperty: async (propertyId, boundary) =>
      assertDecision(await decideProperty(propertyId), boundary),
  })
}
