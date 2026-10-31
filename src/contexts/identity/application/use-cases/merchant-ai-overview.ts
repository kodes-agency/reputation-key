import type { MerchantAiNoticeUpdate } from '#/shared/merchant-ai-notice-announcements'
// Organization AI overview — every manageable Property's Merchant AI standing.
//
// Read-only. It lists, for each Property the actor may manage AI for, the
// authorization state and capabilities, the notice the state was granted
// under, whether that notice is no longer in force, any standing
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
  pauseReason?: string | null
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
  pauseReason?: (
    record: MerchantAiOverviewRecord,
    organizationId: string,
    propertyId: string,
  ) => string | null
  readLatestUpdate?: (
    input: MerchantAiOverviewInput,
  ) => Promise<MerchantAiNoticeUpdate | null>
  clock: () => Date
  /**
   * Whether consent recorded under a notice is in force: the served notice, or
   * an earlier one it keeps in force (`isMerchantAiNoticeInForce`).
   */
  isNoticeInForce(
    notice: Readonly<{ noticeVersion: string; noticeDigest: string }>,
  ): boolean
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
  /** An enabled authorization recorded under a notice no longer in force. */
  reconsentRequired: boolean
  pauseReason?: string | null
  /** ISO-8601 instant of a standing "not now" decision, or null. */
  decisionDeferredAt: string | null
  googleBindingActive: boolean
}>

export type MerchantAiOverview = Readonly<{
  properties: readonly MerchantAiOverviewEntry[]
  latestUpdate?: MerchantAiNoticeUpdate | null
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
  isNoticeInForce: MerchantAiOverviewDeps['isNoticeInForce'],
): MerchantAiOverviewEntry {
  const authorization = record.authorization
  const consented = authorization !== null && authorization.state === 'enabled'
  return Object.freeze({
    propertyId: record.propertyId,
    propertyName: record.propertyName,
    state: authorization?.state ?? 'disabled',
    capabilities: authorization?.capabilities ?? Object.freeze([]),
    noticeVersion: authorization?.noticeVersion ?? null,
    reconsentRequired: consented && !isNoticeInForce(authorization),
    ...(consented && !isNoticeInForce(authorization)
      ? {
          pauseReason:
            record.pauseReason ??
            (record.googleBindingActive ? 'update_pending' : 'google_unbound'),
        }
      : {}),
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

    const latestUpdate = deps.readLatestUpdate
      ? { latestUpdate: await deps.readLatestUpdate(input) }
      : {}
    const records = await deps.reader.listOverview({
      organizationId: input.organizationId,
      propertyIds: scope.kind === 'organization' ? null : scope.propertyIds,
    })
    return Object.freeze({
      ...latestUpdate,
      properties: Object.freeze(
        records.map((record) =>
          toEntry(
            {
              ...record,
              pauseReason:
                deps.pauseReason?.(record, input.organizationId, record.propertyId) ??
                record.pauseReason,
            },
            deps.isNoticeInForce,
          ),
        ),
      ),
    })
  }

export type ListMerchantAiOverview = ReturnType<typeof listMerchantAiOverview>
