import { describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { googleImports } from '#/shared/db/schema/google-import.schema'
import { idempotencyReceipts, outboxEvents } from '#/shared/db/schema/outbox.schema'
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
    claim,
    lifecycleTerminal,
    claimAs,
    release,
    expectStaleEffectLost,
  } = suite

  describe('claim fences', () => {
    it('rejects duplicate claims and never invokes a stale fenced effect', async () => {
      await resetIntent()
      const firstFence = '20000000-0000-4000-8000-000000000006'
      const competingFence = '20000000-0000-4000-8000-000000000007'

      await expect(claim(firstFence)).resolves.toMatchObject({
        kind: 'claimed',
        item: { authorization: intent().items[0]!.authorization },
      })
      await expect(claim(competingFence)).resolves.toEqual({
        kind: 'ignored',
        reason: 'claim_active',
      })

      await expectStaleEffectLost(competingFence, NOW)
    })

    it('permits same-ordinal takeover only after lease expiry', async () => {
      await resetIntent()
      const staleFence = '20000000-0000-4000-8000-000000000008'
      const freshFence = '20000000-0000-4000-8000-000000000009'
      const expiredAt = new Date(NOW.getTime() + 1_000)

      await claimAs({
        dispatchEpoch: 0,
        attemptOrdinal: 1,
        claimFence: staleFence,
        now: NOW,
        leaseExpiresAt: expiredAt,
      })
      await expect(
        claimAs({
          dispatchEpoch: 0,
          attemptOrdinal: 1,
          claimFence: freshFence,
          now: new Date(expiredAt.getTime() + 1),
          leaseExpiresAt: new Date(expiredAt.getTime() + 30_000),
        }),
      ).resolves.toMatchObject({
        kind: 'claimed',
        item: { claimFence: freshFence, attemptOrdinal: 2, dispatchEpoch: 1 },
      })
    })

    it('reserves pending work and only processing claims whose lease has elapsed', async () => {
      await resetIntent()
      const claimFence = '20000000-0000-4000-8000-00000000000a'
      const leaseExpiresAt = new Date(NOW.getTime() + 60_000)
      await expect(suite.store.reserveDueItems(NOW, 100)).resolves.toMatchObject([
        { itemId: ITEM_ID, status: 'pending', claimFence: null, dispatchEpoch: 0 },
      ])
      await expect(suite.store.reserveDueItems(NOW, 100)).resolves.toEqual([])
      await expect(
        claimAs({
          dispatchEpoch: 0,
          attemptOrdinal: 1,
          claimFence,
          now: NOW,
          leaseExpiresAt,
        }),
      ).resolves.toMatchObject({ kind: 'claimed' })
      await expect(
        suite.store.reserveDueItems(new Date(leaseExpiresAt.getTime() - 1), 100),
      ).resolves.toEqual([])
      await expect(
        suite.store.reserveDueItems(leaseExpiresAt, 100),
      ).resolves.toMatchObject([
        {
          organizationId: ORG_ID,
          itemId: ITEM_ID,
          retryRevision: 0,
          dispatchEpoch: 0,
          status: 'processing',
          claimFence,
          attemptOrdinal: 1,
          effectDeadlineAt: intent().items[0]!.effectDeadlineAt,
        },
      ])
      await expect(
        release({
          dispatchEpoch: 0,
          claimFence,
          now: leaseExpiresAt,
        }),
      ).resolves.toBe('released')
      await expect(suite.store.reserveDueItems(leaseExpiresAt, 100)).resolves.toEqual([])
    })

    // Queue delivery ordinals can repeat after a death; durable acquisition
    // still spends the next attempt and rejects the previous claim fence.
    it('lets the stalled attempt take the item back after the reaper released its claim', async () => {
      await resetIntent()
      const deadFence = '20000000-0000-4000-8000-00000000000b'
      const recoveredFence = '20000000-0000-4000-8000-00000000000c'
      const leaseExpiresAt = new Date(NOW.getTime() + 60_000)
      await claimAs({
        dispatchEpoch: 0,
        attemptOrdinal: 1,
        claimFence: deadFence,
        now: NOW,
        leaseExpiresAt,
      })

      await expect(reapAt(leaseExpiresAt)).resolves.toMatchObject({
        claimsReleased: 1,
        completionChecks: 0,
        itemsDispatched: 1,
      })

      const recoveredAt = new Date(leaseExpiresAt.getTime() + 30_000)
      await expect(
        claimAs({
          dispatchEpoch: 1,
          attemptOrdinal: 1,
          claimFence: recoveredFence,
          now: recoveredAt,
          leaseExpiresAt: new Date(recoveredAt.getTime() + 60_000),
        }),
      ).resolves.toMatchObject({
        kind: 'claimed',
        item: { claimFence: recoveredFence, attemptOrdinal: 2, dispatchEpoch: 1 },
      })
      // The dead attempt's fence owns nothing any more.
      await expectStaleEffectLost(deadFence, recoveredAt)
    })

    it('refuses a delivery generation older than the claim that was released', async () => {
      await resetIntent()
      const firstFence = '20000000-0000-4000-8000-00000000000d'
      const secondFence = '20000000-0000-4000-8000-00000000000e'
      const lease = (from: Date) => new Date(from.getTime() + 60_000)
      await claimAs({
        dispatchEpoch: 0,
        attemptOrdinal: 1,
        claimFence: firstFence,
        now: NOW,
        leaseExpiresAt: lease(NOW),
      })
      await release({
        dispatchEpoch: 0,
        claimFence: firstFence,
        now: NOW,
      })
      await claimAs({
        dispatchEpoch: 1,
        attemptOrdinal: 2,
        claimFence: secondFence,
        now: NOW,
        leaseExpiresAt: lease(NOW),
      })
      await release({
        dispatchEpoch: 1,
        claimFence: secondFence,
        now: NOW,
      })

      await expect(
        claimAs({
          dispatchEpoch: 0,
          attemptOrdinal: 1,
          claimFence: '20000000-0000-4000-8000-00000000000f',
          now: NOW,
          leaseExpiresAt: lease(NOW),
        }),
      ).resolves.toEqual({ kind: 'ignored', reason: 'stale_dispatch' })
    })
  })

  describe('manual retry', () => {
    it('atomically accepts and exactly replays one authorized manual retry', async () => {
      await resetIntent()
      await expect(
        lifecycleTerminal('temporarily_unavailable', new Date(NOW.getTime() + 60_000)),
      ).resolves.toBe('completed')
      const digest = { keyVersion: 'v1', digest: 'C'.repeat(43) }
      const authorize = vi.fn(async () => 'authorized' as const)
      const retryAt = new Date(NOW.getTime() + 120_000)
      const retryInput = {
        organizationId: ORG_ID,
        initiatingUserId: USER_ID,
        itemId: ITEM_ID,
        retryRequestId: RETRY_REQUEST_ID,
        expectedRetryRevision: 0,
        requestDigest: digest,
        matchesRequestDigest: matchesDigest(digest),
        now: retryAt,
        authorize,
      }

      await expect(
        suite.store.retryItem({ ...retryInput, outboxEventId: RETRY_OUTBOX_ID }),
      ).resolves.toEqual({ kind: 'accepted', importJobId: REQUEST_ID, retryRevision: 1 })
      expect(authorize).toHaveBeenCalledWith(
        expect.objectContaining({
          importJobId: REQUEST_ID,
          itemId: ITEM_ID,
          connectionId: CONNECTION_ID,
          authorization: expect.objectContaining({
            organizationId: ORG_ID,
            userId: USER_ID,
            connectionId: CONNECTION_ID,
          }),
        }),
      )

      await expect(readItem()).resolves.toMatchObject({
        status: 'pending',
        outcomeCode: null,
        retryRevision: 1,
        highestAttemptForRevision: 0,
        providerAccountSuffix: 'account-1',
        providerLocationSuffix: 'location-1',
        firstTerminalAt: new Date(NOW.getTime() + 60_000),
      })
      const [parent] = await suite.db
        .select()
        .from(googleImports)
        .where(eq(googleImports.id, REQUEST_ID))
      expect(parent).toMatchObject({
        firstTerminalAt: new Date(NOW.getTime() + 60_000),
        purgeAt: new Date(NOW.getTime() + 30 * DAY_MS + 60_000),
      })
      await expect(
        suite.db
          .select()
          .from(idempotencyReceipts)
          .where(
            and(
              eq(idempotencyReceipts.scope, 'gbp_import_item_retry'),
              eq(
                idempotencyReceipts.key,
                JSON.stringify([ORG_ID, USER_ID, ITEM_ID, RETRY_REQUEST_ID]),
              ),
            ),
          ),
      ).resolves.toHaveLength(1)
      await expect(
        suite.db.select().from(outboxEvents).where(eq(outboxEvents.id, RETRY_OUTBOX_ID)),
      ).resolves.toHaveLength(1)

      authorize.mockClear()
      await expect(
        suite.store.retryItem({
          ...retryInput,
          outboxEventId: '20000000-0000-4000-8000-000000000012',
        }),
      ).resolves.toEqual({ kind: 'replayed', importJobId: REQUEST_ID, retryRevision: 1 })
      expect(authorize).not.toHaveBeenCalled()
    })

    it('rejects mismatched replay hashes without mutating the accepted revision', async () => {
      await resetIntent()
      await lifecycleTerminal('temporarily_unavailable', new Date(NOW.getTime() + 60_000))
      const base = {
        organizationId: ORG_ID,
        initiatingUserId: USER_ID,
        itemId: ITEM_ID,
        retryRequestId: RETRY_REQUEST_ID,
        expectedRetryRevision: 0,
        now: new Date(NOW.getTime() + 120_000),
        outboxEventId: RETRY_OUTBOX_ID,
        authorize: vi.fn(async () => 'authorized' as const),
        matchesRequestDigest: matchesDigest({
          keyVersion: 'v1',
          digest: 'C'.repeat(43),
        }),
      }
      await suite.store.retryItem({
        ...base,
        requestDigest: { keyVersion: 'v1', digest: 'C'.repeat(43) },
      })

      await expect(
        suite.store.retryItem({
          ...base,
          matchesRequestDigest: matchesDigest({
            keyVersion: 'v1',
            digest: 'D'.repeat(43),
          }),
          requestDigest: { keyVersion: 'v1', digest: 'D'.repeat(43) },
          outboxEventId: '20000000-0000-4000-8000-000000000013',
        }),
      ).resolves.toEqual({ kind: 'rejected', reason: 'request_conflict' })
      expect(base.authorize).toHaveBeenCalledTimes(1)
      await expect(readItem()).resolves.toMatchObject({
        status: 'pending',
        retryRevision: 1,
      })
    })
  })
  describe('who asked for a Property to be imported', () => {
    it('names the initiator of the import that produced the Property', async () => {
      await resetIntent()

      await expect(
        suite.store.findPropertyImportInitiator(ORG_ID, PROPERTY_ID),
      ).resolves.toBe(USER_ID)
    })

    it('names nobody for a Property no import ever produced', async () => {
      await resetIntent()

      await expect(
        suite.store.findPropertyImportInitiator(ORG_ID, OTHER_PROPERTY_ID),
      ).resolves.toBeNull()
    })

    it('does not answer across organizations', async () => {
      await resetIntent()

      await expect(
        suite.store.findPropertyImportInitiator('another-organization', PROPERTY_ID),
      ).resolves.toBeNull()
    })

    it('names the first initiator when the Property was imported more than once', async () => {
      await resetIntent()
      const laterRequestId = '20000000-0000-4000-8000-0000000000a1'
      const laterItemId = '20000000-0000-4000-8000-0000000000a2'
      const later = intent(new Date(NOW.getTime() + 60_000))
      await expect(
        suite.store.commitImport({
          ...later,
          id: laterRequestId,
          requestId: laterRequestId,
          initiatedBy: 'a-later-colleague',
          wireReplay: { keyVersion: 'v1', digest: 'C'.repeat(43) },
          semanticReplay: { keyVersion: 'v1', digest: 'D'.repeat(43) },
          items: [{ ...later.items[0]!, id: laterItemId }],
          outboxEventId: '20000000-0000-4000-8000-0000000000a3',
        }),
      ).resolves.toBe('committed')

      await expect(
        suite.store.findPropertyImportInitiator(ORG_ID, PROPERTY_ID),
      ).resolves.toBe(USER_ID)
    })
  })
})
