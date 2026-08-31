import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { organizationId } from '#/shared/domain/ids'
import { createRecentActivityVocabularyReconciliationStore } from './recent-activity-vocabulary-reconciliation.store'

const db = getDb()
const ORG_A = organizationId('org-vocabulary-store-a')
const ORG_B = organizationId('org-vocabulary-store-b')
const ACTOR = 'operator-act-01'
const EVIDENCE = 'support:ACT-01:vocabulary-decision-1'
const IDS = [
  'f4000000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000002',
  'f4000000-0000-4000-8000-000000000003',
  'f4000000-0000-4000-8000-000000000004',
] as const

const cleanup = async (): Promise<void> => {
  await db.execute(sql`
    DELETE FROM recent_activity_vocabulary_reconciliations
    WHERE organization_id IN (${ORG_A as string}, ${ORG_B as string})
  `)
  await db.execute(sql`
    DELETE FROM recent_activity_entries
    WHERE organization_id IN (${ORG_A as string}, ${ORG_B as string})
  `)
}

const seed = async (
  id: string,
  organization: typeof ORG_A,
  action: string,
  resourceType: string,
): Promise<void> => {
  await db.execute(sql`
    INSERT INTO recent_activity_entries (
      id, actor_id, actor_name, actor_role, action, resource_type,
      resource_id, organization_id, payload, event_id, source, created_at
    ) VALUES (
      ${id}::uuid, 'actor-act-01', 'Actor', 'AccountAdmin', ${action},
      ${resourceType}, ${`resource-${id}`}, ${organization as string},
      '{}'::jsonb, ${`event-${id}`}, 'web', '2026-08-28T12:00:00Z'::timestamptz
    )
  `)
}

beforeAll(cleanup)
beforeEach(async () => {
  await cleanup()
  await seed(IDS[0], ORG_A, 'approved', 'property')
  await seed(IDS[1], ORG_A, 'approved', 'property')
  await seed(IDS[2], ORG_B, 'approved', 'property')
})
afterAll(cleanup)

describe('Recent Activity vocabulary reconciliation store (real PostgreSQL)', () => {
  it('reports only grouped tenant-local codes, counts, and exact fingerprints', async () => {
    const store = createRecentActivityVocabularyReconciliationStore(db)

    const report = await store.report(ORG_A)

    expect(report).toEqual([
      {
        action: 'approved',
        resourceType: 'property',
        count: 2,
        targetFingerprintSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
    ])
    expect(JSON.stringify(report)).not.toContain(IDS[0])
    expect(JSON.stringify(report)).not.toContain(ORG_B)
  })

  it('atomically applies an exact target and replays concurrent identical commands', async () => {
    const firstStore = createRecentActivityVocabularyReconciliationStore(db)
    const secondStore = createRecentActivityVocabularyReconciliationStore(db)
    const [target] = await firstStore.report(ORG_A)
    const command = {
      operationId: 'f5000000-0000-4000-8000-000000000001',
      organizationId: ORG_A,
      source: { action: 'approved', resourceType: 'property' },
      target: { action: 'created', resourceType: 'property' },
      expectedTargetCount: target!.count,
      expectedTargetFingerprintSha256: target!.targetFingerprintSha256,
      authorizedBy: ACTOR,
      authorizationEvidenceRef: EVIDENCE,
      appliedAt: new Date('2026-08-28T12:05:00.000Z'),
    } as const

    const outcomes = await Promise.all([
      firstStore.apply(command),
      secondStore.apply(command),
    ])

    expect(outcomes).toContainEqual({ status: 'applied', updatedCount: 2 })
    expect(outcomes).toContainEqual({ status: 'replayed', updatedCount: 2 })
    const rows = await db.execute(sql`
      SELECT organization_id, action, resource_type
      FROM recent_activity_entries
      WHERE id IN (${IDS[0]}::uuid, ${IDS[1]}::uuid, ${IDS[2]}::uuid)
      ORDER BY id
    `)
    expect(rows.rows).toEqual([
      { organization_id: ORG_A, action: 'created', resource_type: 'property' },
      { organization_id: ORG_A, action: 'created', resource_type: 'property' },
      { organization_id: ORG_B, action: 'approved', resource_type: 'property' },
    ])
  })

  it('refuses a stale fingerprint without writing rows or a receipt', async () => {
    const store = createRecentActivityVocabularyReconciliationStore(db)
    const [target] = await store.report(ORG_A)
    await seed(IDS[3], ORG_A, 'approved', 'property')

    await expect(
      store.apply({
        operationId: 'f5000000-0000-4000-8000-000000000002',
        organizationId: ORG_A,
        source: { action: 'approved', resourceType: 'property' },
        target: { action: 'created', resourceType: 'property' },
        expectedTargetCount: target!.count,
        expectedTargetFingerprintSha256: target!.targetFingerprintSha256,
        authorizedBy: ACTOR,
        authorizationEvidenceRef: EVIDENCE,
        appliedAt: new Date('2026-08-28T12:05:00.000Z'),
      }),
    ).resolves.toMatchObject({ status: 'stale_target', currentCount: 3 })
    const evidence = await db.execute(sql`
      SELECT
        (SELECT count(*)::integer FROM recent_activity_entries
         WHERE organization_id = ${ORG_A as string} AND action = 'approved') AS source_count,
        (SELECT count(*)::integer FROM recent_activity_vocabulary_reconciliations
         WHERE operation_id = 'f5000000-0000-4000-8000-000000000002'::uuid) AS receipt_count
    `)
    expect(evidence.rows[0]).toEqual({ source_count: 3, receipt_count: 0 })
  })

  it('rolls back an interruption between update and receipt, then recovers on retry', async () => {
    const stable = createRecentActivityVocabularyReconciliationStore(db)
    const [target] = await stable.report(ORG_A)
    const command = {
      operationId: 'f5000000-0000-4000-8000-000000000003',
      organizationId: ORG_A,
      source: { action: 'approved', resourceType: 'property' },
      target: { action: 'created', resourceType: 'property' },
      expectedTargetCount: target!.count,
      expectedTargetFingerprintSha256: target!.targetFingerprintSha256,
      authorizedBy: ACTOR,
      authorizationEvidenceRef: EVIDENCE,
      appliedAt: new Date('2026-08-28T12:05:00.000Z'),
    } as const
    const interrupted = createRecentActivityVocabularyReconciliationStore(db, {
      afterUpdateBeforeReceipt: async () => {
        throw new Error('simulated_interruption')
      },
    })

    await expect(interrupted.apply(command)).rejects.toThrow('simulated_interruption')
    const afterFailure = await stable.report(ORG_A)
    expect(afterFailure).toEqual([target])

    await expect(stable.apply(command)).resolves.toEqual({
      status: 'applied',
      updatedCount: 2,
    })
  })
})
