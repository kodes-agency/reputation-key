// Settlement through the admission adapter: an admitted operation is priced
// from usage once, unknown usage is charged at the reservation, and a later
// attempt is admitted only after a release without dispatch.

import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { getPool } from '#/shared/db/pool'
import { aiOperations } from '#/shared/db/schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { settledCostMicros } from '#/shared/ai-provider-profile/ai-openai-provider-profile'
import type { AiSettlementRequestV1 } from '#/shared/ai-gateway/ai-internal-transport-contract'
import { AI_REPLY_OPERATION_PROFILE } from '#/shared/db/testing/ai-operation-fixture'
import { createAiBudgetControl, reapStaleAiReservations } from '#/shared/db/ai/ai-budget'
import { createAiExecutionAdmissionAdapter } from './ai-execution-admission.adapter.server'
import {
  PAYLOAD_BYTES,
  RESERVED,
  buildAdmissionDescriptor,
  createAdmissionDbHelpers,
  noDispatch,
  seedExecutingOperation,
  settlement,
  useAiOperationFixture,
  type AdmissionScope as Scope,
} from './ai-admission.test-fixtures'

const NOW = new Date(Date.now() - 60_000)
const ORGANIZATION_ID = organizationId('ai-admission-test-org')
const PROPERTY_ID = propertyId('76000000-0000-4000-8000-000000000001')
const SCOPE: Scope = { organizationId: ORGANIZATION_ID, propertyId: PROPERTY_ID }

const descriptor = (
  input: { operationId: string; permitId: string; attemptNumber?: number },
  scope: Scope = SCOPE,
) =>
  buildAdmissionDescriptor(
    { now: NOW, idPrefix: '76', actorId: 'ai-admission-test-user' },
    input,
    scope,
  )

const db = getDb()
const authority = createAiExecutionAdmissionAdapter({
  pool: getPool(),
  now: () => NOW,
})
const { costWindow, operationRow } = createAdmissionDbHelpers(db, ORGANIZATION_ID)

/** The settlement, with its receipt's fields beside the status. */
async function settle(request: AiSettlementRequestV1) {
  const { operationId, permitId, attemptNumber, ...outcome } = request
  const result = await authority.settle({ operationId, permitId, attemptNumber }, outcome)
  return result.status === 'settled'
    ? { status: result.status, ...result.receipt }
    : result
}

describe.sequential('AI execution admission settlement (real PostgreSQL)', () => {
  const ORGANIZATION = organizationId('ai-admission-settlement-test-org')
  const PROPERTY = propertyId('76000000-0000-4000-8000-000000000021')
  const scope: Scope = { organizationId: ORGANIZATION, propertyId: PROPERTY }
  const window = () => costWindow(ORGANIZATION)
  const fixture = useAiOperationFixture(db, NOW, {
    organizationId: ORGANIZATION,
    propertyId: PROPERTY,
    actorUserId: 'ai-admission-settlement-test-user',
  })
  const executingOperation = () => seedExecutingOperation(fixture())
  const admit = async (subject: { operationId: string; permitId: string }) => {
    const granted = await authority.authorize(descriptor(subject, scope))
    if (granted.status !== 'admitted') throw new Error(`not admitted: ${granted.code}`)
    return granted
  }
  const claimNextAttempt = async (operationId: string, attemptNumber: number) => {
    const permitId = randomUUID()
    await db
      .update(aiOperations)
      .set({
        state: 'executing',
        executionAttempt: attemptNumber,
        executionPermitId: permitId,
      })
      .where(eq(aiOperations.id, operationId))
    return { operationId, permitId, attemptNumber }
  }
  const authorizeAttempt = async (operationId: string, attemptNumber: number) =>
    authority.authorize(
      descriptor(await claimNextAttempt(operationId, attemptNumber), scope),
    )

  it('settles an admitted operation from usage once and refuses any later settlement', async () => {
    const subject = await executingOperation()
    await admit(subject)
    const usage = { inputTokens: 1_000, cachedInputTokens: 200, outputTokens: 300 }
    const cost = Number(settledCostMicros(usage))

    await expect(settle(settlement(subject, usage))).resolves.toMatchObject({
      status: 'settled',
      costMicros: cost,
      settlementState: 'settled',
    })
    const settled = await window()
    await expect(operationRow(subject.operationId)).resolves.toMatchObject({
      actualMicros: cost,
    })
    // The reservation is closed: neither the same nor another cost settles again.
    await expect(settle(settlement(subject, usage))).resolves.toEqual({
      status: 'denied',
      code: 'settlement_conflict',
    })
    await expect(
      settle(settlement(subject, { ...usage, outputTokens: 301 })),
    ).resolves.toEqual({ status: 'denied', code: 'settlement_conflict' })
    await expect(
      settle(settlement({ ...subject, permitId: randomUUID() }, usage)),
    ).resolves.toEqual({ status: 'denied', code: 'permit_mismatch' })
    await expect(window()).resolves.toEqual(settled)
  })

  it('refuses to settle an executing attempt that was never admitted', async () => {
    const subject = await executingOperation()
    const before = await window()
    await expect(
      settle(
        settlement(subject, { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 }),
      ),
    ).resolves.toEqual({ status: 'denied', code: 'permit_not_consumed' })
    await expect(window()).resolves.toEqual(before)
  })

  it('refuses a malformed operation ID without changing the budget', async () => {
    const subject = await executingOperation()
    await admit(subject)
    const before = await window()
    await expect(
      settle(
        settlement(
          { ...subject, operationId: 'not-a-uuid' },
          { inputTokens: 1_000, cachedInputTokens: 200, outputTokens: 300 },
        ),
      ),
    ).resolves.toEqual({ status: 'denied', code: 'settlement_conflict' })
    await expect(window()).resolves.toEqual(before)
  })

  it.each([
    ['another permit', { permitId: '76000000-0000-4000-8000-0000000000ff' }],
    ['another attempt', { attemptNumber: 2 }],
  ] as const)(
    'refuses %s before and after settlement without changing the budget',
    async (_name, mismatch) => {
      const subject = await executingOperation()
      await admit(subject)
      const usage = { inputTokens: 1_000, cachedInputTokens: 200, outputTokens: 300 }
      const mismatched = settlement({ ...subject, ...mismatch }, usage)

      const reserved = await window()
      await expect(settle(mismatched)).resolves.toEqual({
        status: 'denied',
        code: 'permit_mismatch',
      })
      await expect(window()).resolves.toEqual(reserved)

      await expect(settle(settlement(subject, usage))).resolves.toMatchObject({
        status: 'settled',
        costMicros: Number(settledCostMicros(usage)),
      })
      const settled = await window()
      await expect(settle(mismatched)).resolves.toEqual({
        status: 'denied',
        code: 'permit_mismatch',
      })
      await expect(window()).resolves.toEqual(settled)
    },
  )

  it.each([
    { inputTokens: -1, cachedInputTokens: 0, outputTokens: 1 },
    { inputTokens: 1, cachedInputTokens: 2, outputTokens: 1 },
    { inputTokens: 1.5, cachedInputTokens: 0, outputTokens: 1 },
  ])('refuses invalid usage without settling the budget: %j', async (usage) => {
    const subject = await executingOperation()
    await admit(subject)
    const before = await window()
    await expect(settle(settlement(subject, usage))).resolves.toEqual({
      status: 'denied',
      code: 'settlement_conflict',
    })
    await expect(window()).resolves.toEqual(before)
    await expect(operationRow(subject.operationId)).resolves.toMatchObject({
      budgetSettledAt: null,
      actualMicros: null,
    })
  })

  // A timeout, a lost connection, a 400 or a 401, an unreadable answer: the call may
  // have been billed in full and nothing says how much.
  it.each([
    ['transport_ambiguous', 'transport_ambiguous', 'ambiguous'],
    ['deadline_exceeded', 'deadline_exceeded', 'settled'],
    ['provider_refused', 'provider_refused', 'settled'],
    ['provider_unavailable', 'provider_unavailable', 'settled'],
    ['output_invalid', 'success', 'settled'],
  ] as const)(
    'charges unknown usage (%s) at the reservation and rejects any later settlement',
    async (disposition, reportedDisposition, settlementState) => {
      const subject = await executingOperation()
      await admit(subject)
      const { reservedMicros } = await operationRow(subject.operationId)
      expect(reservedMicros).toBeGreaterThan(0)
      const unknown = {
        ...noDispatch(subject),
        disposition,
        reportedDisposition,
      }

      await expect(settle(unknown)).resolves.toMatchObject({
        status: 'settled',
        usageKnown: false,
        costMicros: reservedMicros,
        settlementState,
      })
      await expect(settle(unknown)).resolves.toEqual({
        status: 'denied',
        code: 'settlement_conflict',
      })
      await expect(
        settle(
          settlement(subject, { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 }),
        ),
      ).resolves.toEqual({ status: 'denied', code: 'settlement_conflict' })
      await expect(authorizeAttempt(subject.operationId, 2)).resolves.toEqual({
        status: 'denied',
        code: 'already_consumed',
      })
    },
  )

  it('lets only one competing settlement change the monthly counter', async () => {
    const subject = await executingOperation()
    await admit(subject)
    const { reservedMicros } = await operationRow(subject.operationId)
    const before = await window()
    const results = await Promise.all(
      [100, 300].map((outputTokens) =>
        settle(
          settlement(subject, { inputTokens: 1_000, cachedInputTokens: 0, outputTokens }),
        ),
      ),
    )
    const winners = results.filter((result) => result.status === 'settled')
    expect(winners).toHaveLength(1)
    expect(results.filter((result) => result.status === 'denied')).toEqual([
      { status: 'denied', code: 'settlement_conflict' },
    ])
    const winner = winners[0]
    if (!winner || winner.status !== 'settled') throw new Error('settlement missing')
    await expect(window()).resolves.toEqual({
      reservedMicros: before.reservedMicros - reservedMicros,
      settledMicros: before.settledMicros + winner.costMicros,
    })
  })

  // Reproduced on the closed beta (2026-09-29): during an import burst, database
  // waits left three analyses less grant time than the provider call needs, so
  // the gateway withheld dispatch and released the grant. Every later attempt
  // was then refused as `already_consumed`, the caller read that as an
  // ambiguous provider outcome, and after four attempts the reviews were
  // settled without an analysis. Nothing had been spent.
  it('admits the next attempt once the previous admission was released without dispatch', async () => {
    const first = await executingOperation()
    const granted = await admit(first)
    await expect(settle(noDispatch(first))).resolves.toMatchObject({
      status: 'settled',
      costMicros: 0,
      settlementState: 'released',
    })

    const second = await claimNextAttempt(first.operationId, 2)
    const regranted = await authority.authorize(descriptor(second, scope))

    expect(regranted).toMatchObject({ status: 'admitted' })
    if (regranted.status !== 'admitted') throw new Error('unreachable')
    expect(regranted.admission).not.toBe(granted.admission)
    expect(regranted.admission.attemptNumber).toBe(2)
    await expect(operationRow(first.operationId)).resolves.toMatchObject({
      reservedMicros: RESERVED,
      budgetSettledAt: null,
      actualMicros: null,
    })

    // The fresh admission is settled from its own usage, once.
    const usage = { inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 100 }
    await expect(settle(settlement(second, usage))).resolves.toMatchObject({
      status: 'settled',
      costMicros: Number(settledCostMicros(usage)),
      settlementState: 'settled',
    })
    // The released first attempt can no longer settle against the operation.
    await expect(settle(noDispatch(first))).resolves.toEqual({
      status: 'denied',
      code: 'permit_mismatch',
    })
  })

  // Closed beta, 2026-10-24: OpenAI answered 429 to every call. The connector
  // reports a refusal by status as known usage of nothing, so the gateway's
  // expected cost is the zero this authority charges, and the retry the
  // analysis schedules is admitted afresh.
  it.each([
    ['rate_limited', true, 20],
    ['quota_exhausted', false, null],
    ['provider_unavailable', true, null],
  ] as const)(
    'charges a %s refusal nothing and admits the next attempt',
    async (disposition, providerRetryable, retryAfterSeconds) => {
      const first = await executingOperation()
      await admit(first)
      await expect(
        settle({
          ...settlement(first, { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }),
          disposition,
          reportedDisposition: disposition,
          providerRetryable,
          retryAfterSeconds,
        }),
      ).resolves.toMatchObject({
        status: 'settled',
        disposition,
        usageKnown: true,
        costMicros: 0,
        settlementState: 'settled',
      })

      await expect(authorizeAttempt(first.operationId, 2)).resolves.toMatchObject({
        status: 'admitted',
      })
    },
  )

  it('still refuses a later attempt once a charged attempt consumed the admission', async () => {
    const first = await executingOperation()
    await admit(first)
    const usage = { inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 100 }
    await settle(settlement(first, usage))

    await expect(authorizeAttempt(first.operationId, 2)).resolves.toEqual({
      status: 'denied',
      code: 'already_consumed',
    })
  })

  it('still refuses a later attempt while the previous admission is unsettled', async () => {
    const first = await executingOperation()
    await admit(first)

    await expect(authorizeAttempt(first.operationId, 2)).resolves.toEqual({
      status: 'denied',
      code: 'already_consumed',
    })
  })

  it('charges an expired admission once and refuses a late settlement with a different cost', async () => {
    const subject = await executingOperation()
    await admit(subject)
    const { reservedMicros } = await operationRow(subject.operationId)
    await db
      .update(aiOperations)
      .set({ budgetReservedAt: sql`clock_timestamp() - interval '16 minutes'` })
      .where(eq(aiOperations.id, subject.operationId))
    await db.transaction(reapStaleAiReservations)

    await expect(operationRow(subject.operationId)).resolves.toMatchObject({
      actualMicros: reservedMicros,
    })
    await expect(settle(noDispatch(subject))).resolves.toEqual({
      status: 'denied',
      code: 'settlement_conflict',
    })
  })

  // While the previous release still runs beside this one, it admits rows with
  // a reservation in the budget ledger. Such a row behaves by it alone.
  describe('a row admitted by the previous release', () => {
    const budget = createAiBudgetControl({ idGen: randomUUID, now: () => NOW })
    const admittedByPreviousRelease = async () => {
      const subject = await executingOperation()
      await db.transaction(async (tx) => {
        const reserved = await budget.admitAiOperation(tx, {
          organizationId: ORGANIZATION,
          propertyId: PROPERTY,
          operationKey: subject.operationId,
          routeKey: AI_REPLY_OPERATION_PROFILE.routeKey,
          operationProfileVersion: AI_REPLY_OPERATION_PROFILE.profileVersion,
          providerPayloadBytes: PAYLOAD_BYTES,
        })
        if (!reserved.ok) throw new Error(`not reserved: ${reserved.code}`)
      })
      return subject
    }

    it('is refused while open, even for the binding that admitted it', async () => {
      const subject = await admittedByPreviousRelease()
      await expect(authority.authorize(descriptor(subject, scope))).resolves.toEqual({
        status: 'denied',
        code: 'already_consumed',
      })
    })

    it('admits the next attempt once released, and refuses it once charged', async () => {
      const released = await admittedByPreviousRelease()
      await expect(settle(noDispatch(released))).resolves.toMatchObject({
        status: 'settled',
        settlementState: 'released',
      })
      await expect(authorizeAttempt(released.operationId, 2)).resolves.toMatchObject({
        status: 'admitted',
      })
      await expect(operationRow(released.operationId)).resolves.toMatchObject({
        reservedMicros: RESERVED,
        budgetSettledAt: null,
      })

      const charged = await admittedByPreviousRelease()
      await settle(
        settlement(charged, { inputTokens: 10, cachedInputTokens: 0, outputTokens: 10 }),
      )
      await expect(authorizeAttempt(charged.operationId, 2)).resolves.toEqual({
        status: 'denied',
        code: 'already_consumed',
      })
    })

    it('settles from usage while open, then refuses a second settlement', async () => {
      const open = await admittedByPreviousRelease()
      const usage = { inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 100 }
      await expect(settle(settlement(open, usage))).resolves.toMatchObject({
        status: 'settled',
        costMicros: Number(settledCostMicros(usage)),
        settlementState: 'settled',
      })
      await expect(settle(settlement(open, usage))).resolves.toEqual({
        status: 'denied',
        code: 'settlement_conflict',
      })
    })

    it('is charged in full by the reaper when left open, and admits nothing after', async () => {
      const stale = await admittedByPreviousRelease()
      const { reservedMicros } = await operationRow(stale.operationId)
      await db
        .update(aiOperations)
        .set({ budgetReservedAt: sql`clock_timestamp() - interval '16 minutes'` })
        .where(eq(aiOperations.id, stale.operationId))
      await db.transaction(reapStaleAiReservations)

      await expect(operationRow(stale.operationId)).resolves.toMatchObject({
        actualMicros: reservedMicros,
      })
      await expect(settle(noDispatch(stale))).resolves.toEqual({
        status: 'denied',
        code: 'settlement_conflict',
      })
      await expect(authorizeAttempt(stale.operationId, 2)).resolves.toEqual({
        status: 'denied',
        code: 'already_consumed',
      })
    })
  })
})
