import type { AuthContext } from '#/shared/domain/auth-context'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  type GoogleConnectionId,
} from '#/shared/domain/ids'
import {
  buildGoogleImportedProperty,
  type PropertyGoogleBindingPublicApi,
} from '#/contexts/property/application/public-api'
import type { ReviewQueuePort } from '#/contexts/review/application/public-api'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { jobRetryDelayUpperBoundMs } from '#/shared/jobs/job-policy'
import type { GoogleImportCommandAuthorizer } from './google-import-discovery'
import {
  GOOGLE_PROPERTY_IMPORT_ITEM_JOB,
  reconciledOutcomeCode,
  type ImportOutcomeCode,
} from './google-import-v2-contract'
import type { ManageNotificationsApi } from './use-cases/manage-notifications'
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

/**
 * The binding facts post-import follow-up needs, with the provider
 * identifiers already proven non-null. Follow-up cannot address Google
 * without all three, so resolving them is a single yes/no question rather
 * than three checks spread across the call site.
 */
type ImportFollowUpTarget = Readonly<{
  connectionId: GoogleConnectionId
  accountId: string
  locationId: string
}>
type CodedError = Readonly<{ code: string }>

function errorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as CodedError).code)
    : null
}

/**
 * Infrastructure saturation, not a domain outcome. `propertyOutcome` returns
 * null for these so the caller releases the claim and retries the attempt —
 * they must NEVER be reported to the tenant as `internal_error`.
 *
 * pg-pool's acquisition timeout carries no `code` at all, so it is only
 * recognizable by message; the SQLSTATEs cover a saturated server, a
 * `lock_timeout` expiry and a session killed by
 * `idle_in_transaction_session_timeout` (see #/shared/db/pool).
 */
const TRANSIENT_INFRASTRUCTURE_CODES: Readonly<Record<string, true>> = {
  '08000': true, // connection_exception
  '08003': true, // connection_does_not_exist
  '08006': true, // connection_failure
  '25P03': true, // idle_in_transaction_session_timeout
  '40001': true, // serialization_failure
  '40P01': true, // deadlock_detected
  '53300': true, // too_many_connections
  '53400': true, // configuration_limit_exceeded
  '55P03': true, // lock_not_available (lock_timeout)
  '57014': true, // query_canceled (statement_timeout)
  '57P01': true, // admin_shutdown
}

const TRANSIENT_INFRASTRUCTURE_MESSAGE_RE =
  /timeout exceeded when trying to connect|connection terminated|too many clients|connection is closed/i

function isTransientInfrastructureError(error: unknown): boolean {
  const code = errorCode(error)
  if (code !== null && TRANSIENT_INFRASTRUCTURE_CODES[code] === true) return true
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? (error as Readonly<{ message: unknown }>).message
      : null
  return typeof message === 'string' && TRANSIENT_INFRASTRUCTURE_MESSAGE_RE.test(message)
}

function propertyOutcome(error: unknown): ImportOutcomeCode | null {
  // Explicit BEFORE the domain switch: pool exhaustion and lock/session
  // timeouts share no code space with Property's domain errors, so leaving
  // them on the `default` fallthrough made their transient handling
  // accidental. Naming them keeps a future default-case change from turning a
  // saturated pool into a permanent tenant-visible failure.
  if (isTransientInfrastructureError(error)) return null
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
    enqueueReviewSync?: ReviewQueuePort['addSyncJob']
    /**
     * Tells Google to START publishing GBP notifications for this connection's
     * account to our Pub/Sub topic — the counterpart of the unsubscribe the
     * disconnect use case already performs. Called on the SAME receipt branch
     * as `enqueueReviewSync`, because that branch is the definition of "this
     * property is now live".
     *
     * Idempotent by construction: it resolves to a PATCH of the account's
     * single `notificationSetting` resource, so re-importing, relinking, or
     * re-running the ops backfill just re-asserts the same topic. Optional and
     * best-effort — push is an optimization over the discovery sweep, never a
     * correctness gate, so a failure is logged and the import proceeds.
     */
    subscribeToNotifications?: ManageNotificationsApi['subscribe']
    /**
     * BQC-2.7: grants a property the capability allowlist of its organization
     * (identity-owned, idempotent). A created property starts with an EMPTY
     * property_capability set, and an empty set denies every non-core
     * capability — provisioning is what makes an imported property usable.
     * Optional and best-effort: a failure is logged and repairable with
     * ops:property-capabilities, never a reason to fail the import effect.
     */
    provisionPropertyCapabilities?: (
      input: Readonly<{
        organizationId: string
        propertyId: string
        createdBy: string
      }>,
    ) => Promise<void>
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
): GoogleImportV2Processor {
  /**
   * Resolve the binding that post-import follow-up (review backfill + GBP
   * push subscribe) should target, or null when there is nothing to follow up
   * on: no follow-up dependency is wired, the receipt is not a live import,
   * or the binding is not an active one matching the receipt's source epoch.
   *
   * The epoch match is what makes follow-up safe to run at all — a binding
   * that moved on since the receipt was written belongs to a later operation.
   */
  const readFollowUpTarget = async (
    organizationIdValue: string,
    receipt: PropertyReceipt,
  ): Promise<ImportFollowUpTarget | null> => {
    if (!deps.enqueueReviewSync && !deps.subscribeToNotifications) return null
    if (receipt.tombstone || receipt.destinationPropertyId === null) return null
    if (receipt.outcome !== 'imported' && receipt.outcome !== 'relinked') return null

    const binding = await deps.propertyBindingApi.readInternal(
      organizationId(organizationIdValue),
      receipt.destinationPropertyId,
    )
    if (
      binding?.state !== 'active' ||
      binding.connectionId === null ||
      binding.accountId === null ||
      binding.locationId === null ||
      binding.sourceEpoch !== receipt.destinationSourceEpoch
    ) {
      return null
    }
    return {
      connectionId: binding.connectionId,
      accountId: binding.accountId,
      locationId: binding.locationId,
    }
  }

  /**
   * Ask Google to push future reviews for this account. Swallows its own
   * failure: the discovery sweep still finds new reviews, and
   * `ops:gbp-subscribe` repairs the subscription out of band.
   */
  const subscribeToNotificationsBestEffort = async (
    organizationIdValue: string,
    itemId: string,
    connectionId: GoogleConnectionId,
  ): Promise<void> => {
    if (!deps.subscribeToNotifications) return
    try {
      await deps.subscribeToNotifications(
        organizationId(organizationIdValue),
        connectionId,
      )
    } catch (error) {
      // Content-free, matching the capability-provisioning warn below.
      deps.logger.warn(
        {
          itemId,
          errorName: error instanceof Error ? error.name : 'unknown',
          errorCode: errorCode(error),
        },
        'GBP notification subscribe failed after import — push stays dark for this account until ops:gbp-subscribe runs; discovery sweep unaffected',
      )
    }
  }

  const reconcileKnownReceipt = async (
    organizationIdValue: string,
    itemId: string,
    receipt: PropertyReceipt,
    now: Date,
  ): Promise<void> => {
    const target = await readFollowUpTarget(organizationIdValue, receipt)
    if (target && receipt.destinationPropertyId !== null) {
      if (deps.enqueueReviewSync) {
        await deps.enqueueReviewSync(
          {
            organizationId: organizationIdValue,
            propertyId: receipt.destinationPropertyId,
            connectionId: target.connectionId,
            locationName: `accounts/${target.accountId}/locations/${target.locationId}`,
            initiator: {
              kind: 'system',
              id: 'google-property-import',
            },
            correlationId: `google-import:${itemId}`,
          },
          {
            jobId: `review-sync-${receipt.destinationPropertyId}-source-epoch-${receipt.destinationSourceEpoch}`,
          },
        )
      }
      // Runs AFTER the sync enqueue so a subscribe outage cannot delay the
      // backfill that makes the property usable.
      await subscribeToNotificationsBestEffort(
        organizationIdValue,
        itemId,
        target.connectionId,
      )
    }
    await deps.store.reconcileFromReceipt({
      organizationId: organizationIdValue,
      itemId,
      destinationPropertyId: receipt.destinationPropertyId,
      outcomeCode: reconciledOutcomeCode(receipt),
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
            if (deps.provisionPropertyCapabilities) {
              try {
                await deps.provisionPropertyCapabilities({
                  organizationId: item.organizationId,
                  propertyId: item.destinationPropertyId,
                  createdBy: item.initiatedBy,
                })
              } catch (error) {
                // Same content-free posture as the effect's own failure log:
                // codes plus the item key, no tenant identifier.
                deps.logger.warn(
                  {
                    itemId: item.itemId,
                    errorName: error instanceof Error ? error.name : 'unknown',
                    errorCode: errorCode(error),
                  },
                  'Google import property capability provisioning failed',
                )
              }
            }
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
          errorCode: errorCode(error),
          outcome: outcome ?? 'transient',
        },
        'Google import item effect failed',
      )
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
        if (claim.reason === 'effect_expired') {
          await terminalizeExpired(input)
          return
        }
        // A live claim lease means another attempt owns this item right now —
        // or owned it inside a worker that was killed mid-effect. Returning
        // normally would mark THIS BullMQ attempt completed, and if the
        // arrival was BullMQ's single permitted stalled recovery
        // (maxStalledCount 1) nothing would ever re-dispatch the item: the
        // row would stay 'processing' until its effect deadline hours later.
        // Throwing keeps the attempt budget alive, so the job retries after
        // backoff; by then the 60s lease has expired (worker.ts pins
        // lockDuration/stalledInterval above it) and claimItem takes the item
        // over under a fresh fence. Re-claiming is safe: the claim path is
        // idempotent and every effect is fenced by claimFence, so the loser
        // of the race commits nothing.
        if (claim.reason === 'claim_active') {
          throw new Error('Google import item claim lease is still active')
        }
        return
      }
      await processClaim(claim.item)
    },
  })
}
