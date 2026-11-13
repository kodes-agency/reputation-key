import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { aiOperations } from '#/shared/db/schema'
import { organizationId } from '#/shared/domain/ids'
import {
  installAiAnalysisFixture,
  type AiAnalysisFixture,
} from '#/shared/db/testing/ai-review-analysis-v3-fixture'
import type { AiOperationId } from '../../domain/types'
import { createAiOperationStoreAdapter } from './ai-operation-store.adapter'

const ORGANIZATION = organizationId('ai-operation-recovery-test')
const PROPERTY = '7a600000-0000-4000-8000-000000000001'
const START = Date.parse('2026-11-02T02:00:00.000Z')
const DEADLINE = Date.parse('2026-11-02T02:15:00.000Z')

describe.sequential('AI recovery selection and fences (real PostgreSQL)', () => {
  const db = getDb()
  const operations = createAiOperationStoreAdapter(db, randomUUID)
  let fixture: AiAnalysisFixture
  let operationId: AiOperationId

  const scan = async (nowEpochMillis = DEADLINE) => {
    const result = await operations.listExpiredExecutions({
      nowEpochMillis,
      executionHorizonMillis: 15 * 60_000,
      limit: 100,
    })
    expect(
      result.unreadable.filter((row) => row.organizationId === ORGANIZATION),
    ).toEqual([])
    return result.candidates.filter((row) => row.organizationId === ORGANIZATION)
  }
  const stored = async () => {
    const [row] = await db
      .select({
        state: aiOperations.state,
        executionAttempt: aiOperations.executionAttempt,
        failureCode: aiOperations.failureCode,
        deliveredAt: aiOperations.deliveredAt,
      })
      .from(aiOperations)
      .where(eq(aiOperations.id, operationId))
    return row
  }

  beforeAll(async () => {
    fixture = await installAiAnalysisFixture({
      db,
      organizationId: ORGANIZATION,
      propertyId: PROPERTY,
      now: new Date(START),
    })
  })
  beforeEach(async () => {
    await fixture.reset()
    const key = await fixture.seedAnalysis({
      profile: 'review-analysis-v3',
      analysisSequence: 1,
      expiresAt: new Date(START + 86_400_000),
    })
    const [row] = await db
      .select({ id: aiOperations.id })
      .from(aiOperations)
      .where(
        and(
          eq(aiOperations.organizationId, ORGANIZATION),
          eq(aiOperations.reviewId, key.reviewId),
        ),
      )
    if (!row) throw new Error('fixture operation missing')
    operationId = row.id as AiOperationId
    await db
      .update(aiOperations)
      .set({ capabilityRuntimeProfileVersion: 'review-analysis-runtime-v2' })
      .where(eq(aiOperations.id, operationId))
  })
  afterAll(async () => {
    await fixture?.remove()
  })

  it.each(['pending', 'succeeded_pending_delivery'] as const)(
    'selects %s at 02:15:00, never at 02:14:59',
    async (state) => {
      await db
        .update(aiOperations)
        .set({ state, expiresAt: new Date(DEADLINE) })
        .where(eq(aiOperations.id, operationId))

      await expect(scan(DEADLINE - 1_000)).resolves.toEqual([])
      await expect(scan()).resolves.toMatchObject([{ operationId, state, attempt: 1 }])
    },
  )

  it('does not overwrite an owner that claimed a new attempt after the recovery scan', async () => {
    await db
      .update(aiOperations)
      .set({ state: 'pending', failureCode: 'provider_rate_limited' })
      .where(eq(aiOperations.id, operationId))
    // The pending operation expires later; an expired scan can still race with
    // an owner whose clock was just inside that window.
    const [candidate] = await scan(START + 86_400_000)
    if (!candidate) throw new Error('recovery candidate missing')
    const claimed = await operations.claimExecution({
      operationId,
      organizationId: ORGANIZATION,
      expectedAttempt: 2,
      nowEpochMillis: DEADLINE - 1_000,
    })
    expect(claimed).toMatchObject({ state: 'executing', executionAttempt: 2 })

    await expect(
      operations.recordFailure({
        operationId,
        organizationId: ORGANIZATION,
        expectedAttempt: candidate.attempt,
        expectedState: 'pending',
        expectedFailureCode: candidate.failureCode,
        failureCode: 'operation_abandoned',
        retryAtEpochMillis: null,
        failedAtEpochMillis: START + 86_400_000,
      }),
    ).resolves.toBe(false)
    await expect(stored()).resolves.toMatchObject({
      state: 'executing',
      executionAttempt: 2,
      failureCode: null,
    })
  })

  it.each(['state', 'attempt', 'failure code'] as const)(
    'rejects a recovery write when only the scanned %s changed',
    async (field) => {
      await db
        .update(aiOperations)
        .set({ state: 'pending', failureCode: 'provider_rate_limited' })
        .where(eq(aiOperations.id, operationId))
      const [candidate] = await scan(START + 86_400_000)
      if (!candidate) throw new Error('recovery candidate missing')
      const changes =
        field === 'state'
          ? { state: 'failed' as const }
          : field === 'attempt'
            ? { executionAttempt: 2 }
            : { failureCode: 'provider_unavailable' }
      await db.update(aiOperations).set(changes).where(eq(aiOperations.id, operationId))
      const winner = await stored()

      await expect(
        operations.recordFailure({
          operationId,
          organizationId: ORGANIZATION,
          expectedAttempt: candidate.attempt,
          expectedState: 'pending',
          expectedFailureCode: candidate.failureCode,
          failureCode: 'operation_abandoned',
          retryAtEpochMillis: null,
          failedAtEpochMillis: START + 86_400_000,
        }),
      ).resolves.toBe(false)
      await expect(stored()).resolves.toEqual(winner)
    },
  )

  it('delivers once and rejects a stale delivery attempt', async () => {
    await db
      .update(aiOperations)
      .set({ state: 'succeeded_pending_delivery' })
      .where(eq(aiOperations.id, operationId))
    const [candidate] = await scan()
    if (!candidate) throw new Error('delivery candidate missing')
    const delivery = {
      operationId,
      organizationId: ORGANIZATION,
      expectedAttempt: candidate.attempt,
      deliveredAtEpochMillis: DEADLINE,
    }

    await expect(
      operations.markDelivered({ ...delivery, expectedAttempt: candidate.attempt + 1 }),
    ).resolves.toBe(false)
    await expect(stored()).resolves.toMatchObject({ state: 'succeeded_pending_delivery' })
    await expect(operations.markDelivered(delivery)).resolves.toBe(true)
    await expect(operations.markDelivered(delivery)).resolves.toBe(false)
    await expect(stored()).resolves.toMatchObject({
      state: 'succeeded',
      executionAttempt: 1,
      deliveredAt: new Date(DEADLINE),
    })
    await expect(scan()).resolves.toEqual([])
  })
})
