// WP3.3-B moved the AI reservation ledger from SECURITY DEFINER procedures into
// this module. The arithmetic below is what a monthly cap, an idempotent
// settlement and the stale-reservation reaper actually promise; only a real
// database can prove the row-level locking and the check constraints agree.

import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import {
  aiExecutionControlHeads,
  aiExecutionControlTransitions,
  aiOperations,
  aiOrganizationCostWindows,
  properties,
} from '#/shared/db/schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { AI_OPERATION_PROFILES } from '#/shared/ai-operation-profiles'
import { maximumCostMicros } from '#/shared/ai-openai-provider-profile'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  createAiBudgetControl,
  reapStaleAiReservations,
  type AiBudgetAdmissionInput,
} from './ai-budget'

// Behind the database clock: the reaper stamps rows with clock_timestamp().
const NOW = new Date(Date.now() - 60_000)
const ORGANIZATION_ID = organizationId('ai-budget-test-org')
const PROPERTY_ID = propertyId('75000000-0000-4000-8000-000000000001')
const ROUTE_KEY = 'reply-suggestion'
const PAYLOAD_BYTES = 512

const profile = AI_OPERATION_PROFILES.find(
  (candidate) => candidate.sourceRoute === ROUTE_KEY,
)
if (!profile?.capability) throw new Error('reply-suggestion profile is not registered')
const CAPABILITY = profile.capability
const RESERVED = maximumCostMicros(profile, PAYLOAD_BYTES)

describe.sequential('AI budget ledger (real PostgreSQL)', () => {
  const db = getDb()
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

  const seedOperation = async (): Promise<string> => {
    const heads = await db
      .select({
        scopeKey: aiExecutionControlHeads.scopeKey,
        controlId: aiExecutionControlHeads.controlId,
        generation: aiExecutionControlHeads.generation,
      })
      .from(aiExecutionControlHeads)
    const head = (scopeKey: string) => {
      const found = heads.find((candidate) => candidate.scopeKey === scopeKey)
      if (!found) throw new Error(`AI execution control ${scopeKey} is not seeded`)
      return found
    }
    const global = head('global')
    const provider = head(`provider:${profile.providerDeploymentProfileVersion}`)
    const capability = head(`capability:${CAPABILITY}`)
    const id = randomUUID()
    await db.insert(aiOperations).values({
      id,
      idempotencyScope: `reply:${id}`,
      idempotencyKey: id,
      requestFingerprint: 'f'.repeat(64),
      sourceDigest: 'e'.repeat(64),
      sourceByteCount: 20,
      command: profile.command,
      capability: CAPABILITY,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      actorUserId: 'ai-budget-test-user',
      systemPrincipal: null,
      reviewId: '75000000-0000-4000-8000-000000000002',
      sourceEpoch: 1,
      sourceRevision: 1,
      reviewedAtEpochMillis: NOW.getTime(),
      tone: 'professional',
      baseReplyStateRevision: 0,
      propertyProfileVersion: 1,
      providerDeploymentProfileVersion: profile.providerDeploymentProfileVersion,
      operationProfileVersion: profile.profileVersion,
      capabilityRuntimeProfileVersion: profile.capabilityRuntimeProfileVersion,
      globalControlId: global.controlId,
      globalControlGeneration: global.generation,
      providerControlId: provider.controlId,
      providerControlGeneration: provider.generation,
      capabilityControlId: capability.controlId,
      capabilityControlGeneration: capability.generation,
      capabilityFences: {},
      state: 'pending',
      executionAttempt: 0,
      createdAt: NOW,
      updatedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60 * 60_000),
    })
    return id
  }

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

  // The seed leaves every capability killed and draining (fail closed). The
  // ledger reads the heads inside the admission transaction, so open this one
  // for the run and put it back afterwards.
  type ControlPosture = Readonly<{
    executionState: 'enabled' | 'killed'
    admissionState: 'accepting' | 'draining'
  }>
  let initialPosture: ControlPosture | undefined
  const capabilityScopeKey = `capability:${CAPABILITY}`
  const transitionCapabilityControl = async (posture: ControlPosture) => {
    const [head] = await db
      .select()
      .from(aiExecutionControlHeads)
      .where(eq(aiExecutionControlHeads.scopeKey, capabilityScopeKey))
      .limit(1)
    if (!head) throw new Error(`AI execution control ${capabilityScopeKey} is not seeded`)
    if (
      head.executionState === posture.executionState &&
      head.admissionState === posture.admissionState
    ) {
      return
    }
    const generation = head.generation + 1
    // The head guard refuses an update stamped before the previous one; use the
    // wall clock here so consecutive runs (and other suites) stay monotonic.
    const occurredAt = new Date()
    await db.transaction(async (tx) => {
      await tx.insert(aiExecutionControlTransitions).values({
        controlId: head.controlId,
        generation,
        predecessorGeneration: head.generation,
        scopeKey: head.scopeKey,
        scopeKind: head.scopeKind,
        scopeValue: head.scopeValue,
        executionState: posture.executionState,
        admissionState: posture.admissionState,
        reasonCode: 'integration_test_transition',
        actorUserId: 'ai-budget-test-user',
        ticketReference: `ai-budget-${generation}`,
        candidateReleaseSha: null,
        occurredAt,
      })
      await tx
        .update(aiExecutionControlHeads)
        .set({
          generation,
          executionState: posture.executionState,
          admissionState: posture.admissionState,
          updatedAt: occurredAt,
        })
        .where(
          sql`${aiExecutionControlHeads.scopeKey} = ${capabilityScopeKey}
            AND ${aiExecutionControlHeads.generation} = ${head.generation}`,
        )
    })
  }

  const clear = async () => {
    await db.delete(aiOperations).where(eq(aiOperations.organizationId, ORGANIZATION_ID))
    await db
      .delete(aiOrganizationCostWindows)
      .where(eq(aiOrganizationCostWindows.organizationId, ORGANIZATION_ID))
    await db.delete(properties).where(eq(properties.id, PROPERTY_ID))
    await deleteTestOrganizations(db, [ORGANIZATION_ID])
  }

  beforeAll(async () => {
    await clear()
    const [head] = await db
      .select({
        executionState: aiExecutionControlHeads.executionState,
        admissionState: aiExecutionControlHeads.admissionState,
      })
      .from(aiExecutionControlHeads)
      .where(eq(aiExecutionControlHeads.scopeKey, capabilityScopeKey))
      .limit(1)
    if (
      !head ||
      (head.executionState !== 'enabled' && head.executionState !== 'killed') ||
      (head.admissionState !== 'accepting' && head.admissionState !== 'draining')
    ) {
      throw new Error(`AI execution control ${capabilityScopeKey} has an invalid state`)
    }
    initialPosture = {
      executionState: head.executionState,
      admissionState: head.admissionState,
    }
    await transitionCapabilityControl({
      executionState: 'enabled',
      admissionState: 'accepting',
    })
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${ORGANIZATION_ID}, 'AI budget test', ${ORGANIZATION_ID}, ${NOW})
    `)
    await db.insert(properties).values({
      id: PROPERTY_ID,
      organizationId: ORGANIZATION_ID,
      name: 'AI budget property',
      slug: 'ai-budget-property',
      timezone: 'America/New_York',
      countryCode: 'US',
      profileVersion: 1,
      sourceEpoch: 1,
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
    await clear()
    if (initialPosture) await transitionCapabilityControl(initialPosture)
  })

  it('reserves the profile maximum once, denies past the cap, and frees headroom on settlement', async () => {
    const first = await seedOperation()
    const second = await seedOperation()

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
    const id = await seedOperation()
    limiterAllows = false
    try {
      await expect(
        db.transaction((tx) => budget.admitAiOperation(tx, admission(id))),
      ).resolves.toEqual({
        ok: false,
        code: 'rate_limited',
      })
    } finally {
      limiterAllows = true
    }
    await expect(operation(id)).resolves.toMatchObject({ reservedMicros: 0 })
  })

  it('reaps only reservations older than the TTL and gives their micros back to the window', async () => {
    const stale = await seedOperation()
    await expect(
      db.transaction((tx) => budget.admitAiOperation(tx, admission(stale))),
    ).resolves.toMatchObject({ ok: true })
    const before = await window()
    await db
      .update(aiOperations)
      .set({ budgetReservedAt: sql`clock_timestamp() - interval '16 minutes'` })
      .where(eq(aiOperations.id, stale))
    const fresh = await seedOperation()
    // The window has room for exactly one live reservation; the reap frees it.
    await expect(db.transaction((tx) => reapStaleAiReservations(tx))).resolves.toBe(1)
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
