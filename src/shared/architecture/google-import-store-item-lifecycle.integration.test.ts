import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { googleImportItems, googleImports } from '#/shared/db/schema/google-import.schema'
import { idempotencyReceipts, outboxEvents } from '#/shared/db/schema/outbox.schema'
import { createGoogleImportLifecycle } from '#/contexts/integration/imports/google-import-lifecycle.server'
import {
  useImportStoreItemsSuite,
  NOW,
  DAY_MS,
  ORG_ID,
  USER_ID,
  REQUEST_ID,
  ITEM_ID,
  CONNECTION_ID,
  PROPERTY_ID,
  RETRY_REQUEST_ID,
  RETRY_OUTBOX_ID,
  OTHER_PROPERTY_ID,
  matchesDigest,
  intent,
} from '#/contexts/integration/imports/google-import-store-items.test-fixtures'

describe('Google import item behaviour on the import store (real PostgreSQL)', () => {
  const suite = useImportStoreItemsSuite()
  const {
    resetIntent,
    readItem,
    reapAt,
    recordReceipt,
    claim,
    lifecycleTerminal,
    claimAs,
    release,
    scrub,
  } = suite

  describe('the item lifecycle', () => {
    it('fences scoped parents and scrubs cancelled item lifecycle authority', async () => {
      await resetIntent()
      const connectionScope = {
        kind: 'connection' as const,
        organizationId: ORG_ID,
        connectionId: CONNECTION_ID,
      }

      await expect(
        suite.store.listLifecycleScopeParents(connectionScope, 100),
      ).resolves.toEqual([{ organizationId: ORG_ID, importJobId: REQUEST_ID }])
      await expect(
        suite.store.fenceLifecycleParent({
          organizationId: ORG_ID,
          importJobId: REQUEST_ID,
          now: NOW,
        }),
      ).resolves.toBe('fenced')
      await expect(
        suite.store.listLifecycleScopeParents(connectionScope, 100),
      ).resolves.toEqual([])
      await expect(
        suite.store.listLifecycleScopeItems(connectionScope, 100),
      ).resolves.toEqual([
        {
          organizationId: ORG_ID,
          importJobId: REQUEST_ID,
          itemId: ITEM_ID,
          retryRevision: 0,
          active: true,
        },
      ])

      await expect(lifecycleTerminal('authorization_changed')).resolves.toBe('completed')
      await expect(scrub()).resolves.toBe(1)

      const [parent] = await suite.db
        .select()
        .from(googleImports)
        .where(eq(googleImports.id, REQUEST_ID))
      expect(parent).toMatchObject({ deletionFence: 1 })
      await expect(readItem()).resolves.toMatchObject({
        status: 'cancelled',
        outcomeCode: 'authorization_changed',
        connectionId: null,
        existingPropertyId: null,
        destinationPropertyId: null,
        providerAccountSuffix: null,
        providerLocationSuffix: null,
        expectedConnectionLifecycleVersion: null,
        expectedConnectionAccessVersion: null,
        expectedCredentialGeneration: null,
        expectedSourceEpoch: null,
        expectedProfileVersion: null,
      })
    })

    it('keeps the produced Property on an imported item until its own deletion sweep', async () => {
      await resetIntent()
      await recordReceipt()

      await expect(
        suite.store.reconcileFromReceipt({
          organizationId: ORG_ID,
          itemId: ITEM_ID,
          now: NOW,
        }),
      ).resolves.toBe('completed')

      // Provider identifiers and fences are gone; the Property reference stays
      // and the progress read hands it to the merchant.
      await expect(readItem()).resolves.toMatchObject({
        status: 'imported',
        destinationPropertyId: PROPERTY_ID,
        connectionId: null,
        providerAccountSuffix: null,
        providerLocationSuffix: null,
        expectedCredentialGeneration: null,
      })
      const progress = await suite.store.getProgress(ORG_ID, USER_ID, REQUEST_ID)
      expect(progress?.items[0]).toMatchObject({
        status: 'imported',
        propertyId: PROPERTY_ID,
      })

      // A connection or user sweep holds no authority over a plain reference.
      for (const scope of [
        {
          kind: 'connection' as const,
          organizationId: ORG_ID,
          connectionId: CONNECTION_ID,
        },
        { kind: 'user' as const, organizationId: ORG_ID, userId: USER_ID },
      ]) {
        await expect(suite.store.listLifecycleScopeItems(scope, 100)).resolves.toEqual([])
        await expect(suite.store.countLifecycleScopeItems(scope, 100)).resolves.toBe(0)
      }

      // Deleting the Property must still find and clear the reference.
      const propertyScope = {
        kind: 'property' as const,
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
      }
      await expect(
        suite.store.listLifecycleScopeItems(propertyScope, 100),
      ).resolves.toEqual([
        {
          organizationId: ORG_ID,
          importJobId: REQUEST_ID,
          itemId: ITEM_ID,
          retryRevision: 0,
          active: false,
        },
      ])
      await expect(scrub()).resolves.toBe(1)
      await expect(
        suite.store.listLifecycleScopeItems(propertyScope, 100),
      ).resolves.toEqual([])
      const afterSweep = await suite.store.getProgress(ORG_ID, USER_ID, REQUEST_ID)
      expect(afterSweep?.items[0]).toMatchObject({ status: 'imported', propertyId: null })
    })

    it('sweeps expired items and atomically releases retention before parent cascade', async () => {
      await resetIntent()
      const effectDeadline = intent().items[0]!.effectDeadlineAt

      await expect(
        suite.store.listExpiredItems(new Date(effectDeadline.getTime() - 1), 100),
      ).resolves.toEqual([])
      await expect(suite.store.listExpiredItems(effectDeadline, 100)).resolves.toEqual([
        { organizationId: ORG_ID, itemId: ITEM_ID, retryRevision: 0 },
      ])

      await expect(
        suite.store.terminalizeItem({
          authority: { kind: 'lifecycle' },
          organizationId: ORG_ID,
          itemId: ITEM_ID,
          retryRevision: 0,
          outcomeCode: 'internal_error',
          retainRetryState: false,
          now: effectDeadline,
        }),
      ).resolves.toBe('completed')

      const purgeAt = new Date(effectDeadline.getTime() + 30 * DAY_MS)
      await expect(
        suite.store.listPurgeCandidates(new Date(purgeAt.getTime() - 1), 100),
      ).resolves.toEqual([])
      await expect(suite.store.listPurgeCandidates(purgeAt, 100)).resolves.toEqual([
        { organizationId: ORG_ID, importJobId: REQUEST_ID, deletionFence: 0 },
      ])

      await suite.db.insert(idempotencyReceipts).values({
        scope: 'gbp_import_item_retry',
        key: JSON.stringify([ORG_ID, USER_ID, ITEM_ID, RETRY_REQUEST_ID]),
        payload: {
          organizationId: ORG_ID,
          initiatingUserId: USER_ID,
          itemId: ITEM_ID,
          retryRequestId: RETRY_REQUEST_ID,
          requestDigestKeyVersion: 'v1',
          requestDigest: 'C'.repeat(43),
          acceptedRetryRevision: 1,
        },
        recordedAt: effectDeadline,
      })
      const releaseEventId = '20000000-0000-4000-8000-000000000014'
      await expect(
        suite.store.purgeParent({
          organizationId: ORG_ID,
          importJobId: REQUEST_ID,
          expectedDeletionFence: 0,
          now: purgeAt,
          outboxEventId: releaseEventId,
        }),
      ).resolves.toBe('purged')

      await expect(
        suite.db.select().from(googleImports).where(eq(googleImports.id, REQUEST_ID)),
      ).resolves.toEqual([])
      await expect(
        suite.db
          .select()
          .from(googleImportItems)
          .where(eq(googleImportItems.id, ITEM_ID)),
      ).resolves.toEqual([])
      await expect(
        suite.db
          .select()
          .from(idempotencyReceipts)
          .where(
            and(
              eq(idempotencyReceipts.scope, 'gbp_import_item_retry'),
              sql`${idempotencyReceipts.payload}->>'itemId' = ${ITEM_ID}`,
            ),
          ),
      ).resolves.toEqual([])
      const [releaseEvent] = await suite.db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.id, releaseEventId))
      expect(releaseEvent).toMatchObject({
        eventType: 'integration.property_import.retention_released',
        eventVersion: 1,
        organizationId: ORG_ID,
        payload: {
          organizationId: ORG_ID,
          importJobId: REQUEST_ID,
          idempotencyKeys: [ITEM_ID],
        },
      })
    })
  })

  // Retryable outcomes retain their state to satisfy the real table CHECK.
  // Expired work can only resume through fresh discovery and confirmation.
  describe('an item the import cannot finish', () => {
    const deadline = () => intent().items[0]!.effectDeadlineAt
    const claimLastAttempt = async (at: Date) => {
      for (let attemptOrdinal = 1; attemptOrdinal <= 5; attemptOrdinal++) {
        const claimFence = `20000000-0000-4000-8000-0000000001${attemptOrdinal}0`
        await claimAs({
          dispatchEpoch: attemptOrdinal - 1,
          attemptOrdinal,
          claimFence,
          now: at,
          leaseExpiresAt: new Date(at.getTime() + 60_000),
        })
        if (attemptOrdinal < 5) {
          await release({
            dispatchEpoch: attemptOrdinal - 1,
            claimFence,
            now: at,
          })
        }
      }
      return new Date(at.getTime() + 60_000)
    }
    const retry = (now: Date) =>
      suite.store.retryItem({
        organizationId: ORG_ID,
        initiatingUserId: USER_ID,
        itemId: ITEM_ID,
        retryRequestId: RETRY_REQUEST_ID,
        expectedRetryRevision: 0,
        requestDigest: { keyVersion: 'v1', digest: 'C'.repeat(43) },
        now,
        outboxEventId: RETRY_OUTBOX_ID,
        matchesRequestDigest: matchesDigest({ keyVersion: 'v1', digest: 'C'.repeat(43) }),
        authorize: async () => 'authorized' as const,
      })

    it('offers fresh confirmation for an item that outlived its deadline', async () => {
      await resetIntent()
      const lifecycle = createGoogleImportLifecycle({
        store: suite.store,
        propertyBindingApi: {
          sweepReleasedExpired: async () => 0,
          countUnreleasedExpired: async () => 0,
          cleanupOrganization: async () => 0,
        },
        clock: deadline,
        newEventId: () => randomUUID(),
      })

      await expect(lifecycle.sweep()).resolves.toMatchObject({
        expiredItemsVisited: 1,
        itemsTerminalized: 1,
      })

      await expect(readItem()).resolves.toMatchObject({
        status: 'failed',
        outcomeCode: 'temporarily_unavailable',
        connectionId: CONNECTION_ID,
        providerAccountSuffix: 'account-1',
        providerLocationSuffix: 'location-1',
      })
      await expect(
        suite.store.getProgress(ORG_ID, USER_ID, REQUEST_ID),
      ).resolves.toMatchObject({
        canRetry: true,
        items: [expect.objectContaining({ retryable: true, userAction: 'retry' })],
      })
      await expect(
        suite.store.listRetryCandidates(ORG_ID, USER_ID, REQUEST_ID, deadline()),
      ).resolves.toMatchObject([{ itemId: ITEM_ID }])
      await expect(
        suite.store.listRetryCandidates(ORG_ID, 'another-user', REQUEST_ID, deadline()),
      ).resolves.toEqual([])
      await expect(retry(deadline())).resolves.toEqual({
        kind: 'rejected',
        reason: 'effect_expired',
      })
      await expect(readItem()).resolves.toMatchObject({
        retryRevision: 0,
        effectDeadlineAt: deadline(),
      })
      await expect(
        suite.db.select().from(outboxEvents).where(eq(outboxEvents.id, RETRY_OUTBOX_ID)),
      ).resolves.toEqual([])
    })

    it('keeps an item whose attempts ran out before its deadline retryable', async () => {
      await resetIntent()
      const leaseExpiresAt = await claimLastAttempt(NOW)

      await expect(reapAt(leaseExpiresAt)).resolves.toMatchObject({
        completionChecks: 1,
        claimsLost: 0,
      })
      await expect(readItem()).resolves.toMatchObject({
        status: 'failed',
        outcomeCode: 'temporarily_unavailable',
        connectionId: CONNECTION_ID,
        providerAccountSuffix: 'account-1',
        providerLocationSuffix: 'location-1',
      })
      await expect(retry(leaseExpiresAt)).resolves.toEqual({
        kind: 'accepted',
        importJobId: REQUEST_ID,
        retryRevision: 1,
      })
    })

    it('keeps an item whose attempts ran out past its deadline available for fresh confirmation', async () => {
      await resetIntent()
      const claimedAt = new Date(deadline().getTime() - 30_000)
      const leaseExpiresAt = await claimLastAttempt(claimedAt)

      await expect(reapAt(leaseExpiresAt)).resolves.toMatchObject({
        completionChecks: 1,
        claimsLost: 0,
      })
      await expect(readItem()).resolves.toMatchObject({
        status: 'failed',
        outcomeCode: 'temporarily_unavailable',
        connectionId: CONNECTION_ID,
        providerAccountSuffix: 'account-1',
      })
      await expect(retry(leaseExpiresAt)).resolves.toEqual({
        kind: 'rejected',
        reason: 'effect_expired',
      })
    })

    // A cancel that lands while the effect is in flight scrubs the item's
    // destination before the effect's receipt is read back. The receipt is the
    // proof the Property exists, so it must win over the cancel.
    it('adopts the receipt of an effect that committed after a cancel scrubbed the item', async () => {
      await resetIntent()
      await expect(lifecycleTerminal('user_cancelled')).resolves.toBe('completed')
      await expect(readItem()).resolves.toMatchObject({
        status: 'cancelled',
        destinationPropertyId: null,
      })

      await recordReceipt()
      await expect(
        suite.store.reconcileFromReceipt({
          organizationId: ORG_ID,
          itemId: ITEM_ID,
          now: NOW,
        }),
      ).resolves.toBe('completed')

      await expect(readItem()).resolves.toMatchObject({
        status: 'imported',
        outcomeCode: 'imported',
        destinationPropertyId: PROPERTY_ID,
      })
    })

    // The same row shape reached another way: its Property was deleted and the
    // deletion sweep cleared the reference. That item is not a cancelled one.
    it('does not give a deleted Property back to an imported item whose reference was cleared', async () => {
      await resetIntent()
      await recordReceipt()
      await suite.store.reconcileFromReceipt({
        organizationId: ORG_ID,
        itemId: ITEM_ID,
        now: NOW,
      })
      await scrub()

      await expect(
        suite.store.reconcileFromReceipt({
          organizationId: ORG_ID,
          itemId: ITEM_ID,
          now: NOW,
        }),
      ).resolves.toBe('lost')

      await expect(readItem()).resolves.toMatchObject({
        status: 'imported',
        destinationPropertyId: null,
      })
    })

    it('still refuses a receipt that names a different Property than the item holds', async () => {
      await resetIntent()
      await recordReceipt(OTHER_PROPERTY_ID)

      await expect(
        suite.store.reconcileFromReceipt({
          organizationId: ORG_ID,
          itemId: ITEM_ID,
          now: NOW,
        }),
      ).resolves.toBe('lost')

      await expect(readItem()).resolves.toMatchObject({
        status: 'pending',
        destinationPropertyId: PROPERTY_ID,
      })
    })

    // A caller that asks for a scrubbed `temporarily_unavailable` is told so
    // before the transaction, not by a CHECK violation that aborts a whole sweep
    // or reaper pass.
    it('refuses to scrub a retryable failure or to keep the state of a final one', async () => {
      await resetIntent()
      const claimFence = '20000000-0000-4000-8000-0000000001a0'
      await claim(claimFence)
      const settle = {
        organizationId: ORG_ID,
        itemId: ITEM_ID,
        retryRevision: 0,
        now: NOW,
      }

      await expect(
        suite.store.terminalizeItem({
          authority: { kind: 'lifecycle' },
          ...settle,
          outcomeCode: 'temporarily_unavailable',
          retainRetryState: false,
        }),
      ).rejects.toThrow('protected google import state must survive retryable failure')
      await expect(
        suite.store.completeClaim({
          dispatchEpoch: 0,
          ...settle,
          claimFence,
          outcomeCode: 'temporarily_unavailable',
          retainRetryState: false,
        }),
      ).rejects.toThrow('protected google import state must survive retryable failure')
      await expect(
        suite.store.completeClaim({
          dispatchEpoch: 0,
          ...settle,
          claimFence,
          outcomeCode: 'internal_error',
          retainRetryState: true,
        }),
      ).rejects.toThrow(
        'protected google import state may only survive retryable failure',
      )
      await expect(readItem()).resolves.toMatchObject({
        status: 'processing',
        connectionId: CONNECTION_ID,
      })
    })
  })
})
