import type { AuthContext } from '#/shared/domain/auth-context'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import {
  buildGoogleImportedProperty,
  type PropertyGoogleBindingPublicApi,
} from '#/contexts/property/application/public-api'
import { jobRetryDelayUpperBoundMs } from '#/shared/jobs/job-policy'
import type { GoogleImportCommandAuthorizer } from './google-import-discovery'
import {
  GOOGLE_PROPERTY_IMPORT_ITEM_JOB,
  type ImportOutcomeCode,
} from './google-import-v2-contract'
import {
  GOOGLE_IMPORT_ITEM_CLAIM_LEASE_MS,
  GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS,
  type GoogleImportV2ClaimedItem,
  type GoogleImportV2Store,
} from './ports/google-import-v2-store.port'

export type ProcessGoogleImportV2Item = Readonly<{
  organizationId: string
  itemId: string
  retryRevision: number
  attemptOrdinal: number
}>

export type GoogleImportV2Processor = Readonly<{
  process(input: ProcessGoogleImportV2Item): Promise<void>
}>

type PropertyReceipt = NonNullable<
  Awaited<ReturnType<PropertyGoogleBindingPublicApi['readReceipt']>>
>
type CodedError = Readonly<{ code: string }>

function errorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as CodedError).code)
    : null
}

function propertyOutcome(error: unknown): ImportOutcomeCode | null {
  switch (errorCode(error)) {
    case 'location_already_bound':
      return 'already_exists'
    case 'active_binding_conflict':
      return 'active_binding_conflict'
    case 'stale_binding':
    case 'stale_profile':
      return 'stale_binding'
    case 'property_deleted':
    case 'property_not_found':
      return 'property_deleted'
    case 'invalid_binding':
    case 'invalid_transition':
    case 'invalid_name':
    case 'invalid_slug':
    case 'invalid_timezone':
    case 'invalid_country':
    case 'idempotency_conflict':
      return 'internal_error'
    default:
      return null
  }
}

function authorizationOutcome(
  code:
    | 'authorization_denied'
    | 'authorization_changed'
    | 'connection_unavailable'
    | 'runtime_unavailable',
): ImportOutcomeCode | null {
  switch (code) {
    case 'connection_unavailable':
      return 'reconnect_required'
    case 'authorization_denied':
    case 'authorization_changed':
      return 'authorization_changed'
    case 'runtime_unavailable':
      return null
  }
}

export function createGoogleImportV2Processor(
  deps: Readonly<{
    store: GoogleImportV2Store
    propertyBindingApi: PropertyGoogleBindingPublicApi
    authorizeGoogleImportCommand: GoogleImportCommandAuthorizer
    resolveActor: (organizationId: string, userId: string) => Promise<AuthContext | null>
    clock: () => Date
    newClaimFence: () => string
  }>,
): GoogleImportV2Processor {
  const reconcileKnownReceipt = async (
    organizationIdValue: string,
    itemId: string,
    receipt: PropertyReceipt,
    now: Date,
  ): Promise<void> => {
    await deps.store.reconcileFromReceipt({
      organizationId: organizationIdValue,
      itemId,
      destinationPropertyId: receipt.destinationPropertyId,
      outcomeCode:
        receipt.tombstone || receipt.outcome === 'property_deleted'
          ? 'property_deleted'
          : receipt.outcome,
      now,
    })
  }

  const reconcileReceipt = async (
    organizationIdValue: string,
    itemId: string,
    now: Date,
  ): Promise<boolean> => {
    const receipt = await deps.propertyBindingApi.readReceipt(
      organizationId(organizationIdValue),
      itemId,
      now,
    )
    if (!receipt) return false
    await reconcileKnownReceipt(organizationIdValue, itemId, receipt, now)
    return true
  }

  const complete = async (
    item: GoogleImportV2ClaimedItem,
    outcomeCode: ImportOutcomeCode,
    retainProtectedRouting = false,
  ): Promise<void> => {
    const now = deps.clock()
    if (await reconcileReceipt(item.organizationId, item.itemId, now)) return
    await deps.store.completeClaim({
      organizationId: item.organizationId,
      itemId: item.itemId,
      retryRevision: item.retryRevision,
      claimFence: item.claimFence,
      outcomeCode,
      retainProtectedRouting,
      now,
    })
  }

  const transientFailure = async (
    item: GoogleImportV2ClaimedItem,
    error?: unknown,
  ): Promise<void> => {
    const now = deps.clock()
    const nextRetryAt =
      now.getTime() +
      jobRetryDelayUpperBoundMs(GOOGLE_PROPERTY_IMPORT_ITEM_JOB, item.attemptOrdinal)
    if (
      item.attemptOrdinal < GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS &&
      now < item.effectDeadlineAt &&
      nextRetryAt < item.effectDeadlineAt.getTime()
    ) {
      const released = await deps.store.releaseClaimForRetry({
        organizationId: item.organizationId,
        itemId: item.itemId,
        retryRevision: item.retryRevision,
        claimFence: item.claimFence,
        now,
      })
      if (released === 'released') {
        throw error instanceof Error
          ? error
          : new Error('Google import item is temporarily unavailable')
      }
      return
    }
    await complete(item, 'temporarily_unavailable', now < item.effectDeadlineAt)
  }

  const terminalizeExpired = async (input: ProcessGoogleImportV2Item): Promise<void> => {
    const now = deps.clock()
    if (await reconcileReceipt(input.organizationId, input.itemId, now)) return
    await deps.store.terminalizeItem({
      organizationId: input.organizationId,
      itemId: input.itemId,
      retryRevision: input.retryRevision,
      outcomeCode: 'temporarily_unavailable',
      retainProtectedRouting: false,
      now,
    })
  }

  const processClaim = async (item: GoogleImportV2ClaimedItem): Promise<void> => {
    const properties =
      item.action === 'relink' &&
      item.existingPropertyId !== null &&
      item.expectedSourceEpoch !== null &&
      item.expectedProfileVersion !== null
        ? [
            {
              propertyId: propertyId(item.existingPropertyId),
              sourceEpoch: item.expectedSourceEpoch,
              profileVersion: item.expectedProfileVersion,
              action: 'property.update' as const,
            },
          ]
        : []
    if (item.action === 'relink' && properties.length !== 1) {
      return complete(item, 'internal_error')
    }

    try {
      const now = deps.clock()
      const execution = await deps.store.runClaimedEffect(
        {
          organizationId: item.organizationId,
          itemId: item.itemId,
          retryRevision: item.retryRevision,
          attemptOrdinal: item.attemptOrdinal,
          claimFence: item.claimFence,
          now,
        },
        async () => {
          const receipt = await deps.propertyBindingApi.readReceipt(
            organizationId(item.organizationId),
            item.itemId,
            now,
          )
          if (receipt) return { kind: 'receipt' as const, receipt }

          let actor: AuthContext | null
          try {
            actor = await deps.resolveActor(item.organizationId, item.initiatedBy)
          } catch {
            return {
              kind: 'terminal' as const,
              outcomeCode: 'temporarily_unavailable' as const,
            }
          }
          if (!actor) {
            return {
              kind: 'terminal' as const,
              outcomeCode: 'authorization_changed' as const,
            }
          }
          const authorization = await deps.authorizeGoogleImportCommand({
            actor,
            connectionId: googleConnectionId(item.connectionId),
            phase: 'publish',
            expected: item.authorization,
            properties,
            requireAccessToken: false,
          })
          if (!authorization.ok) {
            const outcomeCode = authorizationOutcome(authorization.code)
            if (!outcomeCode) {
              throw new Error('Google import authorization unavailable')
            }
            return { kind: 'terminal' as const, outcomeCode }
          }
          if (deps.clock() >= item.effectDeadlineAt) {
            return { kind: 'effect_expired' as const }
          }

          if (item.action === 'create') {
            if (item.countryCode === null) {
              return {
                kind: 'terminal' as const,
                outcomeCode: 'internal_error' as const,
              }
            }
            await deps.propertyBindingApi.createBoundProperty({
              organizationId: organizationId(item.organizationId),
              idempotencyKey: item.itemId,
              property: buildGoogleImportedProperty({
                organizationId: organizationId(item.organizationId),
                propertyId: propertyId(item.destinationPropertyId),
                importItemId: item.itemId,
                connectionId: googleConnectionId(item.connectionId),
                accountId: item.providerAccountSuffix,
                locationId: item.providerLocationSuffix,
                name: item.propertyName,
                address: item.propertyAddress,
                countryCode: item.countryCode,
                timezone: item.timezone,
                confirmedBy: item.initiatedBy,
                now: deps.clock(),
              }),
              now: deps.clock(),
            })
          } else {
            await deps.propertyBindingApi.relink({
              organizationId: organizationId(item.organizationId),
              propertyId: propertyId(item.existingPropertyId!),
              idempotencyKey: item.itemId,
              connectionId: googleConnectionId(item.connectionId),
              accountId: item.providerAccountSuffix,
              locationId: item.providerLocationSuffix,
              profile: {
                name: item.propertyName,
                address: item.propertyAddress,
                timezone: item.timezone,
                confirmedBy: item.initiatedBy,
              },
              expectedSourceEpoch: item.expectedSourceEpoch!,
              expectedProfileVersion: item.expectedProfileVersion!,
              now: deps.clock(),
            })
          }
          return { kind: 'property_effect' as const }
        },
      )

      if (execution.kind === 'lost') return
      if (execution.kind === 'effect_expired') {
        return terminalizeExpired({
          organizationId: item.organizationId,
          itemId: item.itemId,
          retryRevision: item.retryRevision,
          attemptOrdinal: item.attemptOrdinal,
        })
      }
      if (execution.value.kind === 'receipt') {
        await reconcileKnownReceipt(
          item.organizationId,
          item.itemId,
          execution.value.receipt,
          now,
        )
        return
      }
      if (execution.value.kind === 'effect_expired') {
        return terminalizeExpired({
          organizationId: item.organizationId,
          itemId: item.itemId,
          retryRevision: item.retryRevision,
          attemptOrdinal: item.attemptOrdinal,
        })
      }
      if (execution.value.kind === 'terminal') {
        return complete(item, execution.value.outcomeCode)
      }
      if (await reconcileReceipt(item.organizationId, item.itemId, deps.clock())) {
        return
      }
      return transientFailure(
        item,
        new Error('Google import Property receipt is unavailable after effect'),
      )
    } catch (error) {
      const outcome = propertyOutcome(error)
      return outcome ? complete(item, outcome) : transientFailure(item, error)
    }
  }

  return Object.freeze({
    process: async (input) => {
      if (
        !Number.isSafeInteger(input.retryRevision) ||
        input.retryRevision < 0 ||
        !Number.isSafeInteger(input.attemptOrdinal) ||
        input.attemptOrdinal < 1 ||
        input.attemptOrdinal > GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS
      ) {
        return
      }
      const now = deps.clock()
      if (await reconcileReceipt(input.organizationId, input.itemId, now)) return
      const claim = await deps.store.claimItem({
        organizationId: input.organizationId,
        itemId: input.itemId,
        retryRevision: input.retryRevision,
        attemptOrdinal: input.attemptOrdinal,
        claimFence: deps.newClaimFence(),
        now,
        leaseExpiresAt: new Date(now.getTime() + GOOGLE_IMPORT_ITEM_CLAIM_LEASE_MS),
      })
      if (claim.kind !== 'claimed') {
        if (claim.reason === 'effect_expired') await terminalizeExpired(input)
        return
      }
      await processClaim(claim.item)
    },
  })
}
