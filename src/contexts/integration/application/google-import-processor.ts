import type { AuthContext } from '#/shared/domain/auth-context'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import {
  buildGoogleImportedProperty,
  type PropertyGoogleBindingPublicApi,
} from '#/contexts/property/application/public-api'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { jobRetryDelayUpperBoundMs } from '#/shared/jobs/job-policy'
import type { GoogleImportCommandAuthorizer } from './google-import-discovery'
import {
  GOOGLE_PROPERTY_IMPORT_ITEM_JOB,
  terminalWriteFor,
  type ImportOutcomeCode,
  type ImportProfileField,
} from './google-import-contract'
import {
  GOOGLE_IMPORT_ITEM_CLAIM_LEASE_MS,
  GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS,
  type GoogleImportClaimedItem,
  type GoogleImportOutcomeDetail,
  type GoogleImportStore,
  type GoogleImportTerminalAuthority,
} from './ports/google-import-store.port'
import {
  googleImportErrorCode,
  isTransientGoogleImportInfrastructureError,
} from './google-import-error-taxonomy'

export type ProcessGoogleImportItem = Readonly<{
  organizationId: string
  itemId: string
  retryRevision: number
  dispatchEpoch: number
  attemptOrdinal: number
}>

export type GoogleImportProcessor = Readonly<{
  process(input: ProcessGoogleImportItem): Promise<void>
}>

type PropertyReceipt = NonNullable<
  Awaited<ReturnType<PropertyGoogleBindingPublicApi['readReceipt']>>
>

type TerminalOutcome = Readonly<{
  outcomeCode: ImportOutcomeCode
  detail?: GoogleImportOutcomeDetail
}>

const profileRejected = (field: ImportProfileField): TerminalOutcome => ({
  outcomeCode: 'tenant_profile_invalid',
  detail: { kind: 'invalid_profile_field', field },
})

function propertyOutcome(error: unknown): TerminalOutcome | null {
  // Explicit BEFORE the domain switch: pool exhaustion and lock/session
  // timeouts share no code space with Property's domain errors, so leaving
  // them on the `default` fallthrough made their transient handling
  // accidental. Naming them keeps a future default-case change from turning a
  // saturated pool into a permanent tenant-visible failure.
  if (isTransientGoogleImportInfrastructureError(error)) return null
  switch (googleImportErrorCode(error)) {
    case 'location_already_bound':
      return { outcomeCode: 'already_exists' }
    case 'active_binding_conflict':
      return { outcomeCode: 'active_binding_conflict' }
    case 'connection_unavailable':
      return { outcomeCode: 'reconnect_required' }
    case 'stale_binding':
    case 'stale_profile':
      return { outcomeCode: 'stale_binding' }
    case 'property_deleted':
    case 'property_not_found':
      return { outcomeCode: 'property_deleted' }
    // The confirmed profile broke a Property rule. Retrying the same profile
    // cannot succeed; the manager has to correct the field and import again.
    case 'invalid_name':
      return profileRejected('name')
    case 'invalid_timezone':
      return profileRejected('timezone')
    case 'invalid_country':
      return profileRejected('country')
    // The slug is generated from the import item id, not confirmed by the
    // manager, so a rejected slug is RepKey's defect rather than a profile fix.
    case 'invalid_slug':
    case 'invalid_binding':
    case 'invalid_transition':
    case 'idempotency_conflict':
      return { outcomeCode: 'internal_error' }
    default:
      return null
  }
}

/**
 * The two authorization denials are DIFFERENT tenant-visible facts and get
 * different outcome codes.
 *
 * `authorization_denied` is the capability gate itself saying no — the org or
 * property is not allowlisted for `property.import_gbp_v2`/`property.connect_gbp`,
 * is suspended, or the capability is killed. Nothing the tenant captured has
 * moved; the feature is simply not available to them. `policy_disabled`
 * ("Import stopped because this feature is unavailable.") is that fact, and
 * was until now an outcome code with no producer at all.
 *
 * `authorization_changed` is the narrow claim it names: the connection
 * generations, destination source/profile generations, or authorization vector
 * frozen when the item was enqueued no longer matches.
 *
 * Collapsing them cost real debugging time: a cancelled item reported
 * `authorization_changed` whether the gate had denied it or its expectations
 * had drifted, so the persisted `outcome_code` could not narrow which of the
 * authorizer's eleven deny sites fired. Both codes still present as
 * `cancelled`/`cancellation`, so parent and progress totals are unchanged.
 */
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
      return 'policy_disabled'
    case 'authorization_changed':
      return 'authorization_changed'
    case 'runtime_unavailable':
      return null
  }
}

export function createGoogleImportProcessor(
  deps: Readonly<{
    store: GoogleImportStore
    propertyBindingApi: PropertyGoogleBindingPublicApi
    authorizeGoogleImportCommand: GoogleImportCommandAuthorizer
    resolveActor: (organizationId: string, userId: string) => Promise<AuthContext | null>
    clock: () => Date
    newClaimFence: () => string
    /**
     * Terminal item outcomes are deliberately content-free and the terminal write
     * scrubs every attributable column, so an `internal_error` row keeps no trace of
     * what produced it. This is the only place the originating error is observable.
     */
    logger: LoggerPort
  }>,
): GoogleImportProcessor {
  const reconcileKnownReceipt = async (
    organizationIdValue: string,
    itemId: string,
    _receipt: PropertyReceipt,
    now: Date,
  ): Promise<void> => {
    await deps.store.reconcileFromReceipt({
      organizationId: organizationIdValue,
      itemId,
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
    item: GoogleImportClaimedItem,
    outcomeCode: ImportOutcomeCode,
    detail?: GoogleImportOutcomeDetail,
  ): Promise<void> => {
    const now = deps.clock()
    if (await reconcileReceipt(item.organizationId, item.itemId, now)) return
    await deps.store.completeClaim({
      organizationId: item.organizationId,
      itemId: item.itemId,
      retryRevision: item.retryRevision,
      dispatchEpoch: item.dispatchEpoch,
      claimFence: item.claimFence,
      ...terminalWriteFor(outcomeCode),
      now,
      ...(detail ? { detail } : {}),
    })
  }

  /**
   * The Property that already holds an `already_exists` item's location, so the
   * progress view can link to it. The lookup is scoped to the item's own
   * Organization (location bindings are unique per Organization), and a holder
   * from anywhere else is ignored, so another tenant's Property id is never
   * recorded. A failed lookup loses only the link, never the outcome.
   */
  const existingPropertyDetail = async (
    item: GoogleImportClaimedItem,
  ): Promise<GoogleImportOutcomeDetail | undefined> => {
    try {
      const [holder] = await deps.propertyBindingApi.readByLocationIds(
        organizationId(item.organizationId),
        [item.providerLocationSuffix],
      )
      return holder && holder.organizationId === item.organizationId
        ? { kind: 'existing_property', propertyId: holder.propertyId }
        : undefined
    } catch (error) {
      deps.logger.warn(
        {
          itemId: item.itemId,
          errorName: error instanceof Error ? error.name : 'unknown',
          errorCode: googleImportErrorCode(error),
        },
        'Google import could not resolve the Property that already holds the location',
      )
      return undefined
    }
  }

  const transientFailure = async (
    item: GoogleImportClaimedItem,
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
        dispatchEpoch: item.dispatchEpoch,
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
    await complete(item, 'temporarily_unavailable')
  }

  const terminalizeUnclaimed = async (
    input: ProcessGoogleImportItem,
    authority: GoogleImportTerminalAuthority,
  ): Promise<void> => {
    const now = deps.clock()
    if (await reconcileReceipt(input.organizationId, input.itemId, now)) return
    await deps.store.terminalizeItem({
      organizationId: input.organizationId,
      itemId: input.itemId,
      retryRevision: input.retryRevision,
      authority,
      ...terminalWriteFor('temporarily_unavailable'),
      now,
    })
  }

  const processClaim = async (item: GoogleImportClaimedItem): Promise<void> => {
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
          dispatchEpoch: item.dispatchEpoch,
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
                googleReviewUri: item.googleReviewUri,
                googlePrimaryCategory: item.googlePrimaryCategory,
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
                googleReviewUri: item.googleReviewUri,
                googlePrimaryCategory: item.googlePrimaryCategory,
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
      if (
        execution.kind === 'effect_expired' ||
        execution.value.kind === 'effect_expired'
      ) {
        return terminalizeUnclaimed(
          {
            organizationId: item.organizationId,
            itemId: item.itemId,
            retryRevision: item.retryRevision,
            dispatchEpoch: item.dispatchEpoch,
            attemptOrdinal: item.attemptOrdinal,
          },
          {
            kind: 'claim',
            dispatchEpoch: item.dispatchEpoch,
            claimFence: item.claimFence,
          },
        )
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
      // Codes plus the item's own key only: no tenant identifier (BANNED_LOG_KEYS),
      // no provider resource name, no display string, no Property profile field.
      // `itemId` alone locates the row — it is the table's primary key.
      deps.logger.warn(
        {
          itemId: item.itemId,
          action: item.action,
          attemptOrdinal: item.attemptOrdinal,
          retryRevision: item.retryRevision,
          errorName: error instanceof Error ? error.name : 'unknown',
          errorCode: googleImportErrorCode(error),
          outcome: outcome?.outcomeCode ?? 'transient',
        },
        'Google import item effect failed',
      )
      if (!outcome) return transientFailure(item, error)
      const detail =
        outcome.outcomeCode === 'already_exists'
          ? await existingPropertyDetail(item)
          : outcome.detail
      return complete(item, outcome.outcomeCode, detail)
    }
  }

  return Object.freeze({
    process: async (input) => {
      if (
        !Number.isSafeInteger(input.dispatchEpoch) ||
        input.dispatchEpoch < 0 ||
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
        dispatchEpoch: input.dispatchEpoch,
        attemptOrdinal: input.attemptOrdinal,
        claimFence: deps.newClaimFence(),
        now,
        leaseExpiresAt: new Date(now.getTime() + GOOGLE_IMPORT_ITEM_CLAIM_LEASE_MS),
      })
      if (claim.kind !== 'claimed') {
        if (claim.reason === 'effect_expired' || claim.reason === 'attempts_exhausted') {
          await terminalizeUnclaimed(input, claim.authority)
          return
        }
        // Keep this delivery retryable while a live owner holds the row.
        // The durable appointment also recovers a lost or exhausted queue job.
        if (claim.reason === 'claim_active') {
          throw new Error('Google import item claim lease is still active')
        }
        return
      }
      await processClaim(claim.item)
    },
  })
}
