import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  aiExecutionControlHeads,
  aiOperations,
  aiOrganizationCostWindows,
} from '#/shared/db/schema'
import { AI_OPERATION_PROFILES, AI_PROVIDER_DEPLOYMENT_PROFILE } from '#/shared/ai-operation-profiles'
import { maximumCostMicros } from '#/shared/ai-openai-provider-profile'
import { getRedis } from '#/shared/cache/redis'
import { createRateLimiter, type RateLimiter } from '#/shared/rate-limit/middleware'

export type AiBudgetTx = Parameters<Parameters<Database['transaction']>[0]>[0]

export type AiBudgetAdmissionInput = Readonly<{
  organizationId: string
  propertyId: string
  operationKey: string
  routeKey: string
  providerPayloadBytes: number
}>

export type AiBudgetAdmissionResult =
  | Readonly<{ ok: true; operationId: string; reservedMicros: number }>
  | Readonly<{
      ok: false
      code: 'kill_switch' | 'rate_limited' | 'budget_exhausted' | 'capability_unavailable'
    }>

export type AiBudgetControl = Readonly<{
  admitAiOperation(
    tx: AiBudgetTx,
    input: AiBudgetAdmissionInput,
  ): Promise<AiBudgetAdmissionResult>
  settleAiOperation(tx: AiBudgetTx, operationId: string, actualMicros: number): Promise<void>
  reapStaleReservations(tx: AiBudgetTx): Promise<number>
}>

type AiBudgetDependencies = Readonly<{
  rateLimiter: RateLimiter
  idGen: () => string
  now: () => Date
}>

const ORGANIZATION_MONTHLY_CAP_MICROS = 50_000_000
const RESERVATION_TTL_MILLIS = 15 * 60 * 1_000

function profileForRoute(routeKey: string) {
  return AI_OPERATION_PROFILES.find(
    (profile) => profile.sourceRoute === routeKey && profile.capability !== null,
  )
}


async function withinRateLimits(
  limiter: RateLimiter,
  input: AiBudgetAdmissionInput,
): Promise<boolean> {
  for (const [key, maxRequests] of [
    ['global', 16],
    ['provider', 16],
    [`org:${input.organizationId}`, 8],
    [`property:${input.propertyId}`, 4],
  ] as const) {
    const result = await limiter.check(key, { maxRequests, windowSeconds: 60 })
    if (!result.allowed) return false
  }
  return true
}

export function createAiBudgetControl(dependencies: AiBudgetDependencies): AiBudgetControl {
  return Object.freeze({
    async admitAiOperation(tx, input) {
      const profile = profileForRoute(input.routeKey)
      if (!profile || !profile.capability) return { ok: false, code: 'capability_unavailable' }
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
        `provider:${AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion}`,
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
            control.executionState !== 'enabled' || control.admissionState !== 'accepting',
        )
      ) {
        return { ok: false, code: 'kill_switch' }
      }
      if (!(await withinRateLimits(dependencies.rateLimiter, input))) {
        return { ok: false, code: 'rate_limited' }
      }

      const reservedMicros = maximumCostMicros(profile, input.providerPayloadBytes)
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
        .where(and(eq(aiOperations.id, operationId), isNull(aiOperations.budgetSettledAt)))
    },

    async reapStaleReservations(tx) {
      const now = dependencies.now()
      const staleBefore = new Date(now.getTime() - RESERVATION_TTL_MILLIS)
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
            lte(aiOperations.budgetReservedAt, staleBefore),
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
            updatedAt: now,
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
          .set({ actualMicros: 0, budgetSettledAt: now, updatedAt: now })
          .where(and(eq(aiOperations.id, operation.id), isNull(aiOperations.budgetSettledAt)))
      }
      return operations.length
    },
  })
}

let defaultControl: AiBudgetControl | undefined

function getDefaultControl(): AiBudgetControl {
  defaultControl ??= createAiBudgetControl({
    rateLimiter: createRateLimiter(getRedis(), {
      keyPrefix: 'ai',
      maxRequests: 16,
      windowSeconds: 60,
      failClosed: true,
    }),
    idGen: randomUUID,
    now: () => new Date(),
  })
  return defaultControl
}

export function admitAiOperation(
  tx: AiBudgetTx,
  input: AiBudgetAdmissionInput,
): Promise<AiBudgetAdmissionResult> {
  return getDefaultControl().admitAiOperation(tx, input)
}

export function settleAiOperation(
  tx: AiBudgetTx,
  operationId: string,
  actualMicros: number,
): Promise<void> {
  return getDefaultControl().settleAiOperation(tx, operationId, actualMicros)
}

export function reapStaleReservations(tx: AiBudgetTx): Promise<number> {
  return getDefaultControl().reapStaleReservations(tx)
}
