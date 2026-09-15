// Organization AI overview — every manageable Property's Merchant AI standing.
//
// Read-only. It lists, for each Property the actor may manage AI for, the
// authorization state and capabilities, the notice the state was granted
// under, whether that notice is stale against the served one, any standing
// "not now" decision, and whether the Google source is bound. Analysis
// coverage and spend belong to other reads.

import type {
  MerchantAiCapability,
  MerchantAiState,
} from '../../domain/merchant-ai-authorization'
import { MerchantAiAuthorizationError } from './merchant-ai-authorization'

export type MerchantAiOverviewRecord = Readonly<{
  propertyId: string
  propertyName: string
  googleBindingActive: boolean
  /** The authorization head; null when AI was never authorized for the Property. */
  authorization: Readonly<{
    state: MerchantAiState
    capabilities: ReadonlyArray<MerchantAiCapability>
    noticeVersion: string
    noticeDigest: string
  }> | null
  decisionDeferredAt: Date | null
}>

export type MerchantAiOverviewReader = Readonly<{
  /**
   * Live Properties of the Organization, ordered by name. `null` means every
   * Property; an array is the exact Property set to read.
   */
  listOverview(
    input: Readonly<{
      organizationId: string
      propertyIds: readonly string[] | null
    }>,
  ): Promise<readonly MerchantAiOverviewRecord[]>
}>

/** The Properties an actor may manage AI for, resolved once for the whole list. */
export type MerchantAiManagementScope =
  | Readonly<{ kind: 'organization' }>
  | Readonly<{ kind: 'properties'; propertyIds: readonly string[] }>
  | Readonly<{ kind: 'denied' }>

export type MerchantAiOverviewDeps = Readonly<{
  reader: MerchantAiOverviewReader
  resolveManagementScope(
    input: Readonly<{ organizationId: string; actorUserId: string; now: Date }>,
  ): Promise<MerchantAiManagementScope>
  clock: () => Date
  /** The notice version and digest currently served to managers. */
  noticeVersion: string
  noticeDigest: string
}>

export type MerchantAiOverviewInput = Readonly<{
  organizationId: string
  actorUserId: string
}>

export type MerchantAiOverviewEntry = Readonly<{
  propertyId: string
  propertyName: string
  state: MerchantAiState
  capabilities: ReadonlyArray<MerchantAiCapability>
  /** The notice the current state was recorded under; null when never authorized. */
  noticeVersion: string | null
  /** An enabled or revoked authorization recorded under a notice other than the served one. */
  reconsentRequired: boolean
  /** ISO-8601 instant of a standing "not now" decision, or null. */
  decisionDeferredAt: string | null
  googleBindingActive: boolean
}>

export type MerchantAiOverview = Readonly<{
  properties: readonly MerchantAiOverviewEntry[]
}>

function validateInput(input: MerchantAiOverviewInput): void {
  if (input.organizationId.length === 0 || input.actorUserId.length === 0) {
    throw new MerchantAiAuthorizationError(
      'invalid_command',
      'Organization and actor are required',
    )
  }
}

function toEntry(
  record: MerchantAiOverviewRecord,
  served: Readonly<{ noticeVersion: string; noticeDigest: string }>,
): MerchantAiOverviewEntry {
  const authorization = record.authorization
  const consented =
    authorization !== null &&
    (authorization.state === 'enabled' || authorization.state === 'revoked')
  return Object.freeze({
    propertyId: record.propertyId,
    propertyName: record.propertyName,
    state: authorization?.state ?? 'disabled',
    capabilities: authorization?.capabilities ?? Object.freeze([]),
    noticeVersion: authorization?.noticeVersion ?? null,
    reconsentRequired:
      consented &&
      (authorization.noticeVersion !== served.noticeVersion ||
        authorization.noticeDigest !== served.noticeDigest),
    decisionDeferredAt: record.decisionDeferredAt?.toISOString() ?? null,
    googleBindingActive: record.googleBindingActive,
  })
}

export const listMerchantAiOverview =
  (deps: MerchantAiOverviewDeps) =>
  async (input: MerchantAiOverviewInput): Promise<MerchantAiOverview> => {
    validateInput(input)
    const scope = await deps.resolveManagementScope({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      now: deps.clock(),
    })
    if (scope.kind === 'denied') {
      throw new MerchantAiAuthorizationError(
        'capability_denied',
        'Merchant AI overview is denied',
      )
    }
    if (scope.kind === 'properties' && scope.propertyIds.length === 0) {
      return Object.freeze({ properties: Object.freeze([]) })
    }

    const records = await deps.reader.listOverview({
      organizationId: input.organizationId,
      propertyIds: scope.kind === 'organization' ? null : scope.propertyIds,
    })
    return Object.freeze({
      properties: Object.freeze(records.map((record) => toEntry(record, deps))),
    })
  }

export type ListMerchantAiOverview = ReturnType<typeof listMerchantAiOverview>
