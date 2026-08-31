import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { BetaFeedbackTriageRepository } from './beta-feedback-triage.repository'

const NOW = new Date('2026-08-28T08:00:00.000Z')
const EXPIRES = new Date('2026-09-27T08:00:00.000Z')
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)

let lease: TestLease
let db: Database
let repository: BetaFeedbackTriageRepository
const references = new Set<string>()

function prepare(reference = randomUUID()) {
  references.add(reference)
  return {
    reference,
    organizationPseudonym: HASH_A,
    actorPseudonym: HASH_B,
    feedbackType: 'bug' as const,
    impactCode: 'workaround_available' as const,
    routeKey: 'dashboard',
    viewport: 'wide' as const,
    reporterRole: 'PropertyManager' as const,
    attachmentKind: 'masked_layout_v1' as const,
    attachmentCapturedAt: NOW,
    attachmentExpiresAt: EXPIRES,
    now: NOW,
  } as const
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL)
  db = drizzle(lease.pool) as Database
  repository = BetaFeedbackTriageRepository.create(db)
})

afterAll(async () => {
  if (references.size > 0) {
    const client = await lease.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        'ALTER TABLE beta_feedback_triage_transitions DISABLE TRIGGER beta_feedback_triage_transition_update_guard',
      )
      await client.query(
        'DELETE FROM beta_feedback_triage_transitions WHERE feedback_reference = ANY($1::uuid[])',
        [[...references]],
      )
      await client.query(
        'DELETE FROM beta_feedback_triage WHERE reference = ANY($1::uuid[])',
        [[...references]],
      )
      await client.query(
        'ALTER TABLE beta_feedback_triage_transitions ENABLE TRIGGER beta_feedback_triage_transition_update_guard',
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
  await lease.release()
})

describe('beta feedback triage repository (real PostgreSQL)', () => {
  it('prepares, delivers, classifies, and retains content-free transition evidence', async () => {
    const input = prepare()
    await repository.prepare(input)
    expect(await repository.find(input.reference)).toMatchObject({
      deliveryState: 'prepared',
      triageState: 'new',
      revision: 0,
      organizationPseudonym: HASH_A,
      actorPseudonym: HASH_B,
      attachmentExpiresAt: EXPIRES,
    })

    await repository.markDelivered({
      reference: input.reference,
      providerReference: randomUUID().replaceAll('-', ''),
      expectedRevision: 0,
      now: new Date(NOW.getTime() + 1_000),
    })
    const delivered = await repository.find(input.reference)
    expect(delivered).toMatchObject({ deliveryState: 'delivered', revision: 1 })

    const transitionId = randomUUID()
    await repository.transition({
      transitionId,
      reference: input.reference,
      operatorPseudonym: HASH_C,
      now: new Date(NOW.getTime() + 2_000),
      transition: {
        expectedRevision: 1,
        toState: 'screened',
        severity: 'P2',
        privacyClass: 'clear',
        securityClass: 'none',
        reproduction: 'pending',
        dedupeDisposition: 'pending',
        duplicateOfReference: null,
        ownerQueue: 'beta_support',
        ownerPseudonym: HASH_C,
        customerResponse: 'pending',
        engineeringIssueRef: null,
        reasonCode: 'initial_screen',
        supportEvidenceRef: 'support:feedback:screen-1',
      },
    })
    expect(await repository.find(input.reference)).toMatchObject({
      triageState: 'screened',
      severity: 'P2',
      revision: 2,
    })
    const transitions = await lease.pool.query(
      `SELECT from_state, to_state, result_revision, operator_pseudonym,
              reason_code, support_evidence_ref
       FROM beta_feedback_triage_transitions
       WHERE feedback_reference = $1`,
      [input.reference],
    )
    expect(transitions.rows).toEqual([
      expect.objectContaining({
        from_state: 'new',
        to_state: 'screened',
        result_revision: 2,
        operator_pseudonym: HASH_C,
        reason_code: 'initial_screen',
        support_evidence_ref: 'support:feedback:screen-1',
      }),
    ])
    expect(JSON.stringify(transitions.rows)).not.toContain('The layout shifted')
  })

  it('CAS-refuses stale transitions without appending history', async () => {
    const input = prepare()
    await repository.prepare(input)
    await repository.markDelivered({
      reference: input.reference,
      providerReference: randomUUID().replaceAll('-', ''),
      expectedRevision: 0,
      now: new Date(NOW.getTime() + 1_000),
    })

    await expect(
      repository.transition({
        transitionId: randomUUID(),
        reference: input.reference,
        operatorPseudonym: HASH_C,
        now: new Date(NOW.getTime() + 2_000),
        transition: {
          expectedRevision: 0,
          toState: 'screened',
          severity: 'P2',
          privacyClass: 'clear',
          securityClass: 'none',
          reproduction: 'pending',
          dedupeDisposition: 'pending',
          duplicateOfReference: null,
          ownerQueue: 'beta_support',
          ownerPseudonym: HASH_C,
          customerResponse: 'pending',
          engineeringIssueRef: null,
          reasonCode: 'initial_screen',
          supportEvidenceRef: 'support:feedback:screen-2',
        },
      }),
    ).rejects.toThrow('revision')
    const count = await lease.pool.query(
      'SELECT count(*)::int AS count FROM beta_feedback_triage_transitions WHERE feedback_reference = $1',
      [input.reference],
    )
    expect(count.rows[0]?.count).toBe(0)
  })

  it('replays the exact transition ID without a second state change or history row', async () => {
    const input = prepare()
    await repository.prepare(input)
    await repository.markDelivered({
      reference: input.reference,
      providerReference: randomUUID().replaceAll('-', ''),
      expectedRevision: 0,
      now: new Date(NOW.getTime() + 1_000),
    })
    const transitionId = randomUUID()
    const transition = {
      expectedRevision: 1,
      toState: 'screened' as const,
      severity: 'P2' as const,
      privacyClass: 'clear' as const,
      securityClass: 'none' as const,
      reproduction: 'pending' as const,
      dedupeDisposition: 'pending' as const,
      duplicateOfReference: null,
      ownerQueue: 'beta_support' as const,
      ownerPseudonym: HASH_C,
      customerResponse: 'pending' as const,
      engineeringIssueRef: null,
      reasonCode: 'initial_screen',
      supportEvidenceRef: 'support:feedback:screen-replay',
    }
    const command = {
      transitionId,
      reference: input.reference,
      operatorPseudonym: HASH_C,
      now: new Date(NOW.getTime() + 2_000),
      transition,
    }

    await expect(repository.transition(command)).resolves.toMatchObject({
      triageState: 'screened',
      revision: 2,
    })
    await expect(repository.transition(command)).resolves.toMatchObject({
      triageState: 'screened',
      revision: 2,
    })

    const count = await lease.pool.query(
      'SELECT count(*)::int AS count FROM beta_feedback_triage_transitions WHERE transition_id = $1',
      [transitionId],
    )
    expect(count.rows[0]?.count).toBe(1)
    await expect(
      repository.transition({
        ...command,
        transition: { ...transition, supportEvidenceRef: 'support:feedback:other' },
      }),
    ).rejects.toThrow('transition ID')
  })

  it('records an unavailable provider attempt without creating triage-ready work', async () => {
    const input = prepare()
    await repository.prepare(input)
    await repository.markFailed({
      reference: input.reference,
      failureCode: 'monitoring_unavailable',
      expectedRevision: 0,
      now: new Date(NOW.getTime() + 1_000),
    })

    expect(await repository.find(input.reference)).toMatchObject({
      deliveryState: 'failed',
      deliveryFailureCode: 'monitoring_unavailable',
      triageState: 'new',
      revision: 1,
    })
  })

  it('lists the oldest unresolved receipt first so newer reports cannot starve it', async () => {
    const oldest = prepare()
    const newer = {
      ...prepare(),
      now: new Date(NOW.getTime() + 60_000),
      attachmentCapturedAt: new Date(NOW.getTime() + 60_000),
      attachmentExpiresAt: new Date(EXPIRES.getTime() + 60_000),
    }
    await repository.prepare(oldest)
    await repository.prepare(newer)

    const queue = await repository.listQueue(200)
    const oldestIndex = queue.findIndex((item) => item.reference === oldest.reference)
    const newerIndex = queue.findIndex((item) => item.reference === newer.reference)
    expect(oldestIndex).toBeGreaterThanOrEqual(0)
    expect(newerIndex).toBeGreaterThan(oldestIndex)
  })
})
