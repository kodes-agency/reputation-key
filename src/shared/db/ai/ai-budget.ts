import { replyDynamicDeveloperBytes } from '#/shared/reply-drafting-v2-request'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  aiExecutionControlHeads,
  aiOperations,
  aiOrganizationCostWindows,
} from '#/shared/db/schema'
import { AI_OPERATION_PROFILES } from '#/shared/ai-operation-profiles'
import { operationProviderPairing } from '#/shared/ai-operation-provider-pairings'
import { AI_PROVIDER_IDS, type AiProviderId } from '#/shared/ai-provider-ids'
import { maximumCostMicrosWith } from '#/shared/ai-provider-pricing'
import { priceCatalogueOfProvider } from '#/shared/ai-provider-pricing-registry'

export type AiBudgetTx = Parameters<Parameters<Database['transaction']>[0]>[0]

export type AiBudgetAdmissionInput = Readonly<{
  organizationId: string
  propertyId: string
  operationKey: string
  routeKey: string
  /**
   * The operation profile the operation runs under. Absent means the first profile
   * of the route, which is the only one a route has until review-analysis v3 is
   * activated.
   */
  operationProfileVersion?: string
  providerPayloadBytes: number
}>

export type AiBudgetAdmissionResult =
  | Readonly<{ ok: true; operationId: string; reservedMicros: number }>
  | Readonly<{
      ok: false
      code: 'kill_switch' | 'budget_exhausted' | 'capability_unavailable'
    }>

export type AiBudgetControl = Readonly<{
  admitAiOperation(
    tx: AiBudgetTx,
    input: AiBudgetAdmissionInput,
  ): Promise<AiBudgetAdmissionResult>
  settleAiOperation(
    tx: AiBudgetTx,
    operationId: string,
    actualMicros: number,
  ): Promise<void>
  reapStaleReservations(tx: AiBudgetTx): Promise<number>
}>

/**
 * Budget control no longer rate-limits. Per-minute and in-flight capacity is
 * admitted once, atomically and per lane, by the AI context before an
 * operation's execution attempt is claimed (ADR 0058); by the time a request
 * reaches this gateway it has already been admitted. What remains here is the
 * provider kill switch and the organization's monthly cost reservation.
 */
type AiBudgetDependencies = Readonly<{
  idGen: () => string
  now: () => Date
}>

export const ORGANIZATION_MONTHLY_CAP_MICROS = 50_000_000
const RESERVATION_TTL_INTERVAL = '15 minutes'

function profileForRoute(routeKey: string, operationProfileVersion?: string) {
  return AI_OPERATION_PROFILES.find(
    (profile) =>
      profile.sourceRoute === routeKey &&
      profile.capability !== null &&
      (operationProfileVersion === undefined ||
        profile.profileVersion === operationProfileVersion),
  )
}

/**
 * What an operation may cost, priced by the provider it was claimed under and from
 * that provider's own static token figure. An operation that records no provider is
 * a v2 operation: OpenAI's price list and its profile's own figure, as before. A
 * provider with no price list or no pairing for the profile cannot be reserved.
 */
function reservationFor(
  profile: NonNullable<ReturnType<typeof profileForRoute>>,
  providerId: string | null,
  providerPayloadBytes: number,
): number | null {
  const pricing = priceCatalogueOfProvider(providerId)
  if (pricing === null) return null
  if (providerId === null) {
    return maximumCostMicrosWith(
      pricing,
      {
        ...profile,
        staticTokenBearingBytes:
          profile.staticTokenBearingBytes +
          replyDynamicDeveloperBytes(profile.profileVersion),
      },
      providerPayloadBytes,
    )
  }
  if (!(AI_PROVIDER_IDS as readonly string[]).includes(providerId)) return null
  const pairing = operationProviderPairing(
    profile.profileVersion,
    providerId as AiProviderId,
  )
  if (pairing === null) return null
  return maximumCostMicrosWith(
    pricing,
    {
      staticTokenBearingBytes:
        pairing.staticTokenBearing.bytes +
        replyDynamicDeveloperBytes(profile.profileVersion),
      maxOutputTokens: profile.maxOutputTokens,
    },
    providerPayloadBytes,
  )
}

export function createAiBudgetControl(
  dependencies: AiBudgetDependencies,
): AiBudgetControl {
  return Object.freeze({
    async admitAiOperation(tx, input) {
      const profile = profileForRoute(input.routeKey, input.operationProfileVersion)
      if (!profile || !profile.capability)
        return { ok: false, code: 'capability_unavailable' }
      if (
        !Number.isSafeInteger(input.providerPayloadBytes) ||
        input.providerPayloadBytes < 0 ||
        input.providerPayloadBytes > profile.providerPayloadByteLimit
      ) {
        return { ok: false, code: 'capability_unavailable' }
      }

      const [operation] = await tx
        .select({
          id: aiOperations.id,
          command: aiOperations.command,
          capability: aiOperations.capability,
          providerId: aiOperations.providerId,
          reservedMicros: aiOperations.reservedMicros,
          costWindowId: aiOperations.costWindowId,
        })
        .from(aiOperations)
        .where(
          and(
            eq(aiOperations.id, input.operationKey),
            eq(aiOperations.organizationId, input.organizationId),
            eq(aiOperations.propertyId, input.propertyId),
          ),
        )
        .limit(1)
        .for('update')
      if (
        !operation ||
        operation.command !== profile.command ||
        operation.capability !== profile.capability
      ) {
        return { ok: false, code: 'capability_unavailable' }
      }
      if (operation.costWindowId !== null && operation.reservedMicros > 0) {
        return {
          ok: true,
          operationId: operation.id,
          reservedMicros: operation.reservedMicros,
        }
      }

      const controlKeys = [
        'global',
        `provider:${profile.providerDeploymentProfileVersion}`,
        `capability:${profile.capability}`,
      ]
      const controls = await tx
        .select({
          scopeKey: aiExecutionControlHeads.scopeKey,
          executionState: aiExecutionControlHeads.executionState,
          admissionState: aiExecutionControlHeads.admissionState,
        })
        .from(aiExecutionControlHeads)
        .where(inArray(aiExecutionControlHeads.scopeKey, controlKeys))
      if (
        controls.length !== controlKeys.length ||
        controls.some(
          (control) =>
            control.executionState !== 'enabled' ||
            control.admissionState !== 'accepting',
        )
      ) {
        return { ok: false, code: 'kill_switch' }
      }

      const reservedMicros = reservationFor(
        profile,
        operation.providerId,
        input.providerPayloadBytes,
      )
      if (reservedMicros === null) return { ok: false, code: 'capability_unavailable' }
      const now = dependencies.now()
      const startsAt = sql<Date>`date_trunc('month', ${now}::timestamptz)`
      const windowId = dependencies.idGen()
      await tx
        .insert(aiOrganizationCostWindows)
        .values({
          id: windowId,
          organizationId: input.organizationId,
          windowStart: startsAt,
          capMicros: ORGANIZATION_MONTHLY_CAP_MICROS,
          updatedAt: now,
        })
        .onConflictDoNothing({
          target: [
            aiOrganizationCostWindows.organizationId,
            aiOrganizationCostWindows.windowStart,
          ],
        })

      const [window] = await tx
        .update(aiOrganizationCostWindows)
        .set({
          reservedMicros: sql`${aiOrganizationCostWindows.reservedMicros} + ${reservedMicros}`,
          updatedAt: now,
        })
        .where(
          and(
            eq(aiOrganizationCostWindows.organizationId, input.organizationId),
            eq(aiOrganizationCostWindows.windowStart, startsAt),
            sql`${aiOrganizationCostWindows.reservedMicros} + ${aiOrganizationCostWindows.settledMicros} + ${reservedMicros} <= ${aiOrganizationCostWindows.capMicros}`,
          ),
        )
        .returning({ id: aiOrganizationCostWindows.id })
      if (!window) return { ok: false, code: 'budget_exhausted' }

      await tx
        .update(aiOperations)
        .set({
          routeKey: input.routeKey,
          costWindowId: window.id,
          reservedMicros,
          budgetReservedAt: now,
          updatedAt: now,
        })
        .where(eq(aiOperations.id, operation.id))
      return { ok: true, operationId: operation.id, reservedMicros }
    },

    async settleAiOperation(tx, operationId, actualMicros) {
      if (!Number.isSafeInteger(actualMicros) || actualMicros < 0) {
        throw new RangeError('AI actual cost must be a nonnegative safe integer')
      }
      const [operation] = await tx
        .select({
          costWindowId: aiOperations.costWindowId,
          reservedMicros: aiOperations.reservedMicros,
          actualMicros: aiOperations.actualMicros,
          budgetSettledAt: aiOperations.budgetSettledAt,
        })
        .from(aiOperations)
        .where(eq(aiOperations.id, operationId))
        .limit(1)
        .for('update')
      if (!operation?.costWindowId || operation.reservedMicros <= 0) {
        throw new Error('AI operation has no active budget reservation')
      }
      if (operation.budgetSettledAt !== null) {
        if (operation.actualMicros !== actualMicros) {
          throw new Error('AI operation was settled with a different cost')
        }
        return
      }
      if (actualMicros > operation.reservedMicros) {
        throw new Error('AI actual cost exceeds the reserved maximum')
      }
      const now = dependencies.now()
      const [window] = await tx
        .update(aiOrganizationCostWindows)
        .set({
          reservedMicros: sql`${aiOrganizationCostWindows.reservedMicros} - ${operation.reservedMicros}`,
          settledMicros: sql`${aiOrganizationCostWindows.settledMicros} + ${actualMicros}`,
          updatedAt: now,
        })
        .where(
          and(
            eq(aiOrganizationCostWindows.id, operation.costWindowId),
            sql`${aiOrganizationCostWindows.reservedMicros} >= ${operation.reservedMicros}`,
            sql`${aiOrganizationCostWindows.settledMicros} + ${actualMicros} <= ${aiOrganizationCostWindows.capMicros}`,
          ),
        )
        .returning({ id: aiOrganizationCostWindows.id })
      if (!window) throw new Error('AI budget window could not settle reservation')
      await tx
        .update(aiOperations)
        .set({ actualMicros, budgetSettledAt: now, updatedAt: now })
        .where(
          and(eq(aiOperations.id, operationId), isNull(aiOperations.budgetSettledAt)),
        )
    },

    reapStaleReservations: reapStaleAiReservations,
  })
}

/**
 * Release reservations whose operation never settled within the TTL. Reads the
 * database clock so the recovery fence, which ages rows with `clock_timestamp()`
 * before calling this, and the reaper job agree on what "stale" means.
 */
export async function reapStaleAiReservations(tx: AiBudgetTx): Promise<number> {
  const operations = await tx
    .select({
      id: aiOperations.id,
      costWindowId: aiOperations.costWindowId,
      reservedMicros: aiOperations.reservedMicros,
    })
    .from(aiOperations)
    .where(
      and(
        isNull(aiOperations.budgetSettledAt),
        sql`${aiOperations.budgetReservedAt} <= clock_timestamp() - ${RESERVATION_TTL_INTERVAL}::interval`,
        sql`${aiOperations.reservedMicros} > 0`,
      ),
    )
    .for('update', { skipLocked: true })

  for (const operation of operations) {
    if (!operation.costWindowId) continue
    const [released] = await tx
      .update(aiOrganizationCostWindows)
      .set({
        reservedMicros: sql`${aiOrganizationCostWindows.reservedMicros} - ${operation.reservedMicros}`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(aiOrganizationCostWindows.id, operation.costWindowId),
          sql`${aiOrganizationCostWindows.reservedMicros} >= ${operation.reservedMicros}`,
        ),
      )
      .returning({ id: aiOrganizationCostWindows.id })
    if (!released) throw new Error('AI stale reservation window is inconsistent')
    await tx
      .update(aiOperations)
      .set({
        actualMicros: 0,
        budgetSettledAt: sql`clock_timestamp()`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(and(eq(aiOperations.id, operation.id), isNull(aiOperations.budgetSettledAt)))
  }
  return operations.length
}
