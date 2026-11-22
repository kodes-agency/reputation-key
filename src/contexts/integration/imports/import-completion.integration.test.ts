import { RETENTION_RULES } from '#/shared/jobs/retention-sweep.job'
import { executeRetentionRule } from '#/shared/db/retention/execute-retention-rule'
import { durableConsumersFor } from '#/shared/governance/event-job-catalogue'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { createOutboxRelay } from '#/shared/outbox/relay'
import { googleImports } from '#/shared/db/schema/google-import.schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { sql, eq } from 'drizzle-orm'
import { completeImportsForRestore } from './import-completion.server'
import { useImportStoreFixtures } from './import-store.test-fixtures'

const minuteAfter = (at: Date) => new Date(at.getTime() + 60_000)

describe('Google import completion and follow-up crash recovery (real PostgreSQL)', () => {
  const fx = useImportStoreFixtures({ orgPrefix: 'google-import-completion' })
  const { NOW, ORG_A, USER_ID, commit, readItem, createProperty } = fx
  const { committedProperty, markPublished, restoreDeps, lifecycle, snapshots } = fx

  it('waits behind the item effect, then adopts the Property commit after the worker dies', async () => {
    const work = await commit()
    const item = work.items[0]!
    const fence = randomUUID()
    await expect(
      fx.store.claimItem({
        organizationId: ORG_A,
        itemId: item.id,
        retryRevision: 0,
        dispatchEpoch: 0,
        attemptOrdinal: 1,
        claimFence: fence,
        now: NOW,
        leaseExpiresAt: minuteAfter(NOW),
      }),
    ).resolves.toMatchObject({ kind: 'claimed' })
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const death = new Error('worker died after Property commit')
    const effect = fx.store.runClaimedEffect(
      {
        organizationId: ORG_A,
        itemId: item.id,
        retryRevision: 0,
        dispatchEpoch: 0,
        attemptOrdinal: 1,
        claimFence: fence,
        now: NOW,
      },
      async () => {
        entered.resolve()
        await release.promise
        await createProperty(work)
        throw death
      },
    )
    const observedDeath = expect(effect).rejects.toBe(death)
    await entered.promise
    const sweep = lifecycle(new Date(item.effectDeadlineAt.getTime() + 1)).sweep()
    try {
      // A database-observed barrier, rather than a timing guess: lifecycle is
      // blocked behind the worker before the Property transaction is committed.
      await vi.waitFor(async () => {
        const blocked = await fx.lease.pool.query(
          "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND (query LIKE '%google_import_items%' OR query LIKE '%google_imports%')",
        )
        expect(blocked.rows[0].count).toBeGreaterThan(0)
      })
    } finally {
      release.resolve()
    }
    await observedDeath
    await sweep
    await expect(readItem(item.id)).resolves.toMatchObject({
      status: 'imported',
      outcomeCode: 'imported',
      destinationPropertyId: item.destinationPropertyId,
      nextDispatchAt: null,
    })
    await expect(fx.store.getProgress(ORG_A, USER_ID, work.id)).resolves.toMatchObject({
      status: 'completed',
      processedCount: 1,
      counts: { imported: 1, failed: 0, processing: 0 },
    })
    expect(
      await snapshots().readHistoryCutoff({
        organizationId: organizationId(ORG_A),
        propertyId: propertyId(item.destinationPropertyId),
        sourceEpoch: 0,
      }),
    ).not.toBeNull()
  })

  it('keeps binding obligations recoverable after the ordinary redelivery budget', async () => {
    const { event } = await committedProperty()
    await markPublished(event.eventId, { consumerRedeliveryAttempts: 3 })
    const repo = createOutboxRepository(fx.db)
    const due = await createOutboxRelay(repo, undefined).sweep()
    const delivery = due.find((row) => row.subjectId === event.eventId)
    expect(delivery).toBeDefined()
    expect(await repo.delivery.workItems.inspect(ORG_A, delivery!.id)).toMatchObject({
      state: 'pending',
      attempts: 0,
    })
  })

  it('uses receipt authority and the historical cutoff during isolated restore completion', async () => {
    const work = await commit()
    await createProperty(work)
    await fx.db.transaction((tx) => completeImportsForRestore(tx, restoreDeps(), NOW))
    await expect(readItem(work.items[0]!.id)).resolves.toMatchObject({
      status: 'imported',
      destinationPropertyId: work.items[0]!.destinationPropertyId,
      connectionId: null,
      existingPropertyId: null,
      providerAccountSuffix: null,
      providerLocationSuffix: null,
      googleReviewUri: null,
      googlePrimaryCategory: null,
      expectedConnectionLifecycleVersion: null,
      expectedConnectionAccessVersion: null,
      expectedCredentialGeneration: null,
      expectedExecutionPolicyVersion: null,
      expectedActorRole: null,
      expectedPermissionDigest: null,
      expectedPrincipalKind: null,
      expectedPermissionVersion: null,
      expectedSourceEpoch: null,
      expectedProfileVersion: null,
      claimFence: null,
      claimLeaseExpiresAt: null,
      nextDispatchAt: null,
    })
    expect(
      await snapshots().readHistoryCutoff({
        organizationId: organizationId(ORG_A),
        propertyId: propertyId(work.items[0]!.destinationPropertyId),
        sourceEpoch: 0,
      }),
    ).not.toBeNull()
  })
  it('retains an overdue binding fact until every durable consumer acknowledges it', async () => {
    const { event } = await committedProperty()
    await markPublished(event.eventId)
    const original = RETENTION_RULES.find(
      (rule) => rule.subject === 'outbox_events.published',
    )!
    const rule = {
      ...original,
      extraWhere: `(${original.extraWhere}) AND organization_id = '${ORG_A}'`,
    }
    const cutoff = new Date(NOW.getTime() + 31 * 86_400_000)
    await expect(executeRetentionRule(fx.db, rule, { cutoff })).resolves.toMatchObject({
      rowsDeleted: 0,
    })
    const receipts = createOutboxRepository(fx.db)
    for (const { name } of durableConsumersFor(event.eventType))
      await receipts.insertReceipt(event.eventId, name, 'applied')
    await expect(executeRetentionRule(fx.db, rule, { cutoff })).resolves.toMatchObject({
      rowsDeleted: 1,
    })
  })
  it('starts the retention clock of a restored import whose items are all terminal', async () => {
    const work = await commit()
    await createProperty(work)
    await fx.store.reconcileFromReceipt({
      organizationId: ORG_A,
      itemId: work.items[0]!.id,
      now: NOW,
    })
    await fx.db
      .update(googleImports)
      .set({ firstTerminalAt: null, purgeAt: null })
      .where(eq(googleImports.id, work.id))
    await fx.db.transaction((tx) => completeImportsForRestore(tx, restoreDeps(), NOW))
    await expect(fx.store.getProgress(ORG_A, USER_ID, work.id)).resolves.toMatchObject({
      status: 'completed',
      processedCount: 1,
      counts: { pending: 0, imported: 1 },
    })
    const [parent] = await fx.db
      .select({
        purgeAt: googleImports.purgeAt,
        expectedPurgeAt:
          sql<Date | null>`${googleImports.firstTerminalAt} + interval '30 days'`.mapWith(
            googleImports.purgeAt,
          ),
      })
      .from(googleImports)
      .where(eq(googleImports.id, work.id))
    expect(parent?.purgeAt).toEqual(parent?.expectedPurgeAt)
  })
})
