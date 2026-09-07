// WP3.3-B moved the AI reservation ledger from SECURITY DEFINER procedures into
// this module. The arithmetic below is what a monthly cap, an idempotent
// settlement and the stale-reservation reaper actually promise; only a real
// database can prove the row-level locking and the check constraints agree.

import { randomUUID } from 'node:crypto'
import type { Job } from 'bullmq'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { aiOperations, aiOrganizationCostWindows } from '#/shared/db/schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { AI_OPERATION_PROFILES } from '#/shared/ai-operation-profiles'
import { maximumCostMicros } from '#/shared/ai-openai-provider-profile'
import { createAiBudgetReservationReaperHandler } from '#/shared/jobs/ai-budget-reservation-reaper.job'
import {
  AI_REPLY_OPERATION_PROFILE,
  installAiOperationFixture,
  type AiOperationFixture,
} from '#/shared/db/testing/ai-operation-fixture'
import {
  createAiBudgetControl,
  reapStaleAiReservations,
  type AiBudgetAdmissionInput,
} from './ai-budget'

// Behind the database clock: the reaper stamps rows with clock_timestamp().
const NOW = new Date(Date.now() - 60_000)
const ORGANIZATION_ID = organizationId('ai-budget-test-org')
const PROPERTY_ID = propertyId('75000000-0000-4000-8000-000000000001')
const ROUTE_KEY = AI_REPLY_OPERATION_PROFILE.routeKey
const PAYLOAD_BYTES = 512

const profile = AI_OPERATION_PROFILES.find(
  (candidate) => candidate.sourceRoute === ROUTE_KEY,
)
if (!profile) throw new Error('reply-suggestion profile is not registered')
const RESERVED = maximumCostMicros(profile, PAYLOAD_BYTES)

describe.sequential('AI budget ledger (real PostgreSQL)', () => {
  const db = getDb()
  let fixture: AiOperationFixture
  let limiterAllows = true
  const budget = createAiBudgetControl({
    rateLimiter: { check: async () => ({ allowed: limiterAllows }) },
    idGen: randomUUID,
    now: () => NOW,
  })

  const admission = (operationKey: string): AiBudgetAdmissionInput => ({
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    operationKey,
    routeKey: ROUTE_KEY,
    providerPayloadBytes: PAYLOAD_BYTES,
  })

  const window = async () => {
    const [row] = await db
      .select({
        reservedMicros: aiOrganizationCostWindows.reservedMicros,
        settledMicros: aiOrganizationCostWindows.settledMicros,
        capMicros: aiOrganizationCostWindows.capMicros,
      })
      .from(aiOrganizationCostWindows)
      .where(eq(aiOrganizationCostWindows.organizationId, ORGANIZATION_ID))
    if (!row) throw new Error('cost window missing')
    return row
  }

  const operation = async (id: string) => {
    const [row] = await db
      .select({
        reservedMicros: aiOperations.reservedMicros,
        actualMicros: aiOperations.actualMicros,
        budgetSettledAt: aiOperations.budgetSettledAt,
      })
      .from(aiOperations)
      .where(eq(aiOperations.id, id))
    if (!row) throw new Error('operation missing')
    return row
  }

  beforeAll(async () => {
    fixture = await installAiOperationFixture({
      db,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      actorUserId: 'ai-budget-test-user',
      now: NOW,
    })
    // Room for one reservation, not two: settlement must free headroom.
    await db.insert(aiOrganizationCostWindows).values({
      id: randomUUID(),
      organizationId: ORGANIZATION_ID,
      windowStart: sql`date_trunc('month', ${NOW}::timestamptz)`,
      reservedMicros: 0,
      settledMicros: 0,
      capMicros: 2 * RESERVED - 1,
      updatedAt: NOW,
    })
  })

  afterAll(async () => {
    await fixture.remove()
  })

  it('reserves the profile maximum once, denies past the cap, and frees headroom on settlement', async () => {
    const first = await fixture.seedOperation()
    const second = await fixture.seedOperation()

    await expect(
      db.transaction((tx) => budget.admitAiOperation(tx, admission(first))),
    ).resolves.toEqual({ ok: true, operationId: first, reservedMicros: RESERVED })
    // A replayed admission returns the live reservation instead of reserving twice.
    await expect(
      db.transaction((tx) => budget.admitAiOperation(tx, admission(first))),
    ).resolves.toEqual({ ok: true, operationId: first, reservedMicros: RESERVED })
    await expect(window()).resolves.toMatchObject({
      reservedMicros: RESERVED,
      settledMicros: 0,
    })

    await expect(
      db.transaction((tx) => budget.admitAiOperation(tx, admission(second))),
    ).resolves.toEqual({ ok: false, code: 'budget_exhausted' })
    await expect(operation(second)).resolves.toMatchObject({ reservedMicros: 0 })

    await db.transaction((tx) => budget.settleAiOperation(tx, first, 7))
    await expect(window()).resolves.toMatchObject({ reservedMicros: 0, settledMicros: 7 })
    await expect(operation(first)).resolves.toMatchObject({ actualMicros: 7 })

    // Settling again at the same cost is a no-op; a different cost is a conflict.
    await db.transaction((tx) => budget.settleAiOperation(tx, first, 7))
    await expect(window()).resolves.toMatchObject({ settledMicros: 7 })
    await expect(
      db.transaction((tx) => budget.settleAiOperation(tx, first, 8)),
    ).rejects.toThrow(/different cost/)

    await expect(
      db.transaction((tx) => budget.admitAiOperation(tx, admission(second))),
    ).resolves.toEqual({ ok: true, operationId: second, reservedMicros: RESERVED })
    await expect(window()).resolves.toMatchObject({
      reservedMicros: RESERVED,
      settledMicros: 7,
    })
    await db.transaction((tx) => budget.settleAiOperation(tx, second, 0))
  })

  it('refuses a throttled admission before touching the window', async () => {
    const id = await fixture.seedOperation()
    limiterAllows = false
    try {
      await expect(
        db.transaction((tx) => budget.admitAiOperation(tx, admission(id))),
      ).resolves.toEqual({ ok: false, code: 'rate_limited' })
    } finally {
      limiterAllows = true
    }
    await expect(operation(id)).resolves.toMatchObject({ reservedMicros: 0 })
  })

  it('reaps only reservations older than the TTL and gives their micros back to the window', async () => {
    const stale = await fixture.seedOperation()
    await expect(
      db.transaction((tx) => budget.admitAiOperation(tx, admission(stale))),
    ).resolves.toMatchObject({ ok: true })
    const before = await window()
    await db
      .update(aiOperations)
      .set({ budgetReservedAt: sql`clock_timestamp() - interval '16 minutes'` })
      .where(eq(aiOperations.id, stale))
    const fresh = await fixture.seedOperation()
    // The window has room for exactly one live reservation; the job frees it.
    const reaperJob = createAiBudgetReservationReaperHandler(db)
    await expect(reaperJob({} as Job)).resolves.toBe(1)
    await expect(
      db.transaction((tx) => budget.admitAiOperation(tx, admission(fresh))),
    ).resolves.toMatchObject({ ok: true })

    await expect(db.transaction((tx) => reapStaleAiReservations(tx))).resolves.toBe(0)
    await expect(operation(stale)).resolves.toMatchObject({ actualMicros: 0 })
    await expect(
      operation(stale).then((row) => row.budgetSettledAt),
    ).resolves.not.toBeNull()
    await expect(operation(fresh)).resolves.toMatchObject({
      reservedMicros: RESERVED,
      budgetSettledAt: null,
    })
    await expect(window()).resolves.toMatchObject({
      reservedMicros: before.reservedMicros,
      settledMicros: before.settledMicros,
    })
  })
})
