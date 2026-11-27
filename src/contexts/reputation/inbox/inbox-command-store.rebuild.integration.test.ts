import { reviewOpeningAnchor } from './review-opening-anchor.test-fixtures'
import { emptyLookupPorts } from '#/contexts/reputation/inbox/inbox-test-doubles.test-fixtures'
import { seedReply } from '../replies/reply-seed.test-fixtures'
import { getDb } from '#/shared/db'
import { describe, it, expect } from 'vitest'
import { inboxItemId, reviewId } from '#/shared/domain/ids'
import type {} from '#/contexts/reputation/domain/review-types'
import { inboxItemAssigned } from '#/contexts/reputation/domain/inbox-events'
import { reviewCreated } from '#/contexts/reputation/domain/review-events'
import { createInboxRepository } from './inbox-repository.server'
import { createReviewHandlingCycleStore } from '#/contexts/reputation/inbox/review-handling-cycle-store.server'
import { createReplyRepository } from '#/contexts/reputation/replies/reply-repository.server'
import { createReviewSourceLookupAdapter } from '#/contexts/reputation/inbox/review-source-lookup.adapter.server'
import { createReplyLookupAdapter } from '#/contexts/reputation/inbox/reply-lookup.adapter.server'
import { createReviewReplyObservationAuthority } from '#/contexts/reputation/reviews/reply-observation-authority.server'
import { rebuildInboxProjection } from '#/contexts/reputation/inbox/rebuild-inbox-projection.server'
import { testReviewRepository } from '#/contexts/reputation/reviews/review-stores.test-fixtures'
import {
  ORG_A,
  PROP_A,
  USER_A,
  REVIEW_A,
  NOW,
  CONSUMER,
  createAtomicInboxCommandStore,
  db,
  noopLogger,
  makeItem,
  makeReview,
  makeReply,
  insertSourceEvent,
  seedReviewRevisionOne,
  createdFact,
  pool,
  useInboxCommandStoreDb,
} from './inbox-command-store.test-fixtures'

useInboxCommandStoreDb()

describe.sequential('rebuildInboxProjection (integration)', () => {
  function makeRebuild() {
    const reviewRepo = testReviewRepository(db)
    const replyRepo = createReplyRepository(db, () => new Date())
    const repo = createInboxRepository(db, emptyLookupPorts)
    const commandStore = createAtomicInboxCommandStore(db)
    const useCase = rebuildInboxProjection({
      repo,
      commandStore,
      reviewSourceLookup: createReviewSourceLookupAdapter({
        findById: (id, orgId) => reviewRepo.findById(id, orgId),
        findByIds: (ids, orgId) => reviewRepo.findByIds(ids, orgId),
        findByOrganizationId: (orgId) => reviewRepo.findByOrganizationId(orgId),
        findByPropertyId: (pid, orgId) => reviewRepo.findByPropertyId(pid, orgId),
      }),
      replyLookup: createReplyLookupAdapter({
        findByReviewId: (id, orgId) => replyRepo.findByReviewId(id, orgId),
        getCurrentGoogleReplyByReviewId: async () => null,
        findMilestonesByReviewIds: (ids, orgId) =>
          replyRepo.findMilestonesByReviewIds(ids, orgId),
        findCurrentGoogleReplyHeadsByReviewIds: (ids, orgId) =>
          replyRepo.findCurrentGoogleReplyHeadsByReviewIds(ids, orgId),
        findStatesByReviewIds: (ids, orgId) =>
          replyRepo.findStatesByReviewIds(ids, orgId),
        findReviewIdsByReplyStage: (orgId, propertyIds) =>
          replyRepo.findReviewIdsByReplyStage(orgId, propertyIds),
      }),
      replyObservationAuthority: createReviewReplyObservationAuthority(db),
      idGen: () => inboxItemId(crypto.randomUUID()),
      clock: () => NOW,
      logger: noopLogger,
    })
    return { useCase, repo, reviewRepo, replyRepo, commandStore }
  }

  async function seedCanonicalState() {
    const { reviewRepo, commandStore } = makeRebuild()
    // LIVE-PUBLISHED: historical publish metadata is stamped, but rebuild is
    // not exact-current Reply authority and therefore cannot close the cycle.
    const livePublished = makeReview({
      id: reviewId('4d000000-0000-0000-0000-000000000011'),
    })
    const storedLivePublished = await reviewRepo.upsert(livePublished)
    await seedReply(getDb(), makeReply({ reviewId: livePublished.id }))
    await commandStore.createItem(
      makeItem({
        id: inboxItemId('4d000000-0000-0000-0000-000000000021'),
        sourceId: livePublished.id,
      }),
      reviewOpeningAnchor(
        makeItem({
          id: inboxItemId('4d000000-0000-0000-0000-000000000021'),
          sourceId: livePublished.id,
        }),
        storedLivePublished.sourceRevision,
      ),
    )
    // MISSING: review live, no item — heal = create (no created fact).
    const missing = makeReview({ id: reviewId('4d000000-0000-0000-0000-000000000012') })
    await reviewRepo.upsert(missing)
    // EXPIRED: content clock alone is not Handling Cycle close authority.
    const expired = makeReview({
      id: reviewId('4d000000-0000-0000-0000-000000000013'),
      contentExpiresAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    const storedExpired = await reviewRepo.upsert(expired)
    await commandStore.createItem(
      makeItem({
        id: inboxItemId('4d000000-0000-0000-0000-000000000022'),
        sourceId: expired.id,
      }),
      reviewOpeningAnchor(
        makeItem({
          id: inboxItemId('4d000000-0000-0000-0000-000000000022'),
          sourceId: expired.id,
        }),
        storedExpired.sourceRevision,
      ),
    )
    // PURGED/ORPHAN: deliberately raw repair fixture. It remains hidden from
    // active reads and rebuild must not guess a status transition.
    await commandStore.createItem(
      makeItem({
        id: inboxItemId('4d000000-0000-0000-0000-000000000023'),
        sourceId: reviewId('4d000000-0000-0000-0000-000000000099'),
      }),
    )
    // HEALTHY: live review, item closed with milestones — no change.
    const healthy = makeReview({ id: reviewId('4d000000-0000-0000-0000-000000000014') })
    const storedHealthy = await reviewRepo.upsert(healthy)
    await commandStore.createItem(
      makeItem({
        id: inboxItemId('4d000000-0000-0000-0000-000000000024'),
        sourceId: healthy.id,
        status: 'closed',
        closedAt: NOW,
        firstReplyPublishedAt: NOW,
        assignedTo: USER_A,
        isEscalated: true,
        escalatedAt: NOW,
        escalatedBy: USER_A,
      }),
      reviewOpeningAnchor(
        makeItem({
          id: inboxItemId('4d000000-0000-0000-0000-000000000024'),
          sourceId: healthy.id,
          status: 'closed',
          closedAt: NOW,
          firstReplyPublishedAt: NOW,
          assignedTo: USER_A,
          isEscalated: true,
          escalatedAt: NOW,
          escalatedBy: USER_A,
        }),
        storedHealthy.sourceRevision,
      ),
    )
  }

  it('heals a corrupted projection from canonical data and reports it', async () => {
    const { useCase, repo } = makeRebuild()
    await seedCanonicalState()

    const report = await useCase({ organizationId: ORG_A, dryRun: false })

    expect(report.dryRun).toBe(false)
    expect(report.created).toBe(1)
    expect(report.closed).toBe(0)
    expect(report.milestones).toBe(1)
    expect(report.scanned).toBe(8) // 4 items + 4 canonical reviews

    // Historical milestones are repaired, while the canonical head stays open.
    const healed = await repo.findById(
      inboxItemId('4d000000-0000-0000-0000-000000000021'),
      ORG_A,
    )
    expect(healed?.status).toBe('open')
    expect(healed?.firstReplySubmittedAt).toEqual(new Date('2026-05-28T10:00:00.000Z'))
    expect(healed?.firstReplyPublishedAt).toEqual(new Date('2026-05-29T10:00:00.000Z'))

    // created for the missing review (source metadata from canonical data)
    const created = await repo.findBySource(
      'review',
      '4d000000-0000-0000-0000-000000000012',
      ORG_A,
    )
    expect(created).not.toBeNull()
    expect(created?.status).toBe('open')
    expect(created?.sourceDate).toEqual(NOW)

    // Expiry does not close the exact current cycle.
    expect(
      (await repo.findById(inboxItemId('4d000000-0000-0000-0000-000000000022'), ORG_A))
        ?.status,
    ).toBe('open')
    // The orphan remains non-actionable and its raw compatibility status is
    // unchanged rather than being promoted to a guessed close.
    await expect(
      repo.findById(inboxItemId('4d000000-0000-0000-0000-000000000023'), ORG_A),
    ).resolves.toBeNull()
    const orphan = await pool.query(
      'SELECT status FROM inbox_items WHERE id = $1 AND organization_id = $2',
      ['4d000000-0000-0000-0000-000000000023', ORG_A],
    )
    expect(orphan.rows).toEqual([{ status: 'open' }])

    // healthy item untouched — inbox-owned fields preserved
    const healthy = await repo.findById(
      inboxItemId('4d000000-0000-0000-0000-000000000024'),
      ORG_A,
    )
    expect(healthy?.assignedTo).toBe(USER_A)
    expect(healthy?.isEscalated).toBe(true)

    // Repair records no inferred status facts and no synthetic created fact.
    const facts = await pool.query(
      `SELECT event_type, COUNT(*)::int AS n FROM outbox_events
       WHERE organization_id = $1 GROUP BY event_type ORDER BY event_type`,
      [ORG_A],
    )
    expect(facts.rows).toEqual([])

    // idempotent: a second run reconciles nothing
    const second = await useCase({ organizationId: ORG_A, dryRun: false })
    expect(second).toMatchObject({ created: 0, closed: 0, milestones: 0 })
  })

  it('dryRun reports the same counts but writes nothing', async () => {
    const { useCase, repo } = makeRebuild()
    await seedCanonicalState()

    const report = await useCase({ organizationId: ORG_A, dryRun: true })

    expect(report).toMatchObject({ created: 1, closed: 0, milestones: 1, dryRun: true })
    const items = await pool.query(
      `SELECT COUNT(*)::int AS n FROM inbox_items WHERE organization_id = $1`,
      [ORG_A],
    )
    expect(items.rows[0].n).toBe(4) // nothing created
    expect(
      (await repo.findById(inboxItemId('4d000000-0000-0000-0000-000000000021'), ORG_A))
        ?.status,
    ).toBe('open') // nothing closed
    const facts = await pool.query(
      'SELECT id FROM outbox_events WHERE organization_id = $1',
      [ORG_A],
    )
    expect(facts.rows).toHaveLength(0)
  })
})

describe.sequential('inboxCommandStore lent transaction (integration)', () => {
  class OuterRollback extends Error {}

  const sourceEvent = () =>
    reviewCreated({
      reviewId: REVIEW_A,
      propertyId: PROP_A,
      organizationId: ORG_A,
      platform: 'google',
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 1,
      occurredAt: NOW,
    })

  it('rolls the item, its fact and the receipt back with the outer transaction', async () => {
    await seedReviewRevisionOne()
    const store = createAtomicInboxCommandStore(db)
    const source = sourceEvent()
    await insertSourceEvent(source)
    const item = makeItem()
    const fact = createdFact(item)

    await expect(
      db.transaction(async (tx) => {
        const outcome = await store.applySourceCreatedOnce(
          {
            eventId: source.eventId,
            consumerName: CONSUMER,
            item,
            fact,
            cycleAnchor: { ...reviewOpeningAnchor(item), triggerEventId: source.eventId },
          },
          tx,
        )
        expect(outcome).toBe('applied')
        throw new OuterRollback()
      }),
    ).rejects.toBeInstanceOf(OuterRollback)

    const items = await pool.query(
      'SELECT 1 FROM inbox_items WHERE organization_id = $1',
      [ORG_A],
    )
    const facts = await pool.query(
      `SELECT 1 FROM outbox_events WHERE id = $1 AND event_type = 'inbox.inbox_item.created'`,
      [fact.eventId],
    )
    const receipts = await pool.query(
      'SELECT 1 FROM event_consumer_receipts WHERE event_id = $1 AND consumer_name = $2',
      [source.eventId, CONSUMER],
    )
    expect([items.rowCount, facts.rowCount, receipts.rowCount]).toEqual([0, 0, 0])
  })

  it('commits the item, fact and receipt when the outer transaction commits', async () => {
    await seedReviewRevisionOne()
    const store = createAtomicInboxCommandStore(db)
    const source = sourceEvent()
    await insertSourceEvent(source)
    const item = makeItem()
    const fact = createdFact(item)

    await db.transaction(async (tx) => {
      await store.applySourceCreatedOnce(
        {
          eventId: source.eventId,
          consumerName: CONSUMER,
          item,
          fact,
          cycleAnchor: { ...reviewOpeningAnchor(item), triggerEventId: source.eventId },
        },
        tx,
      )
    })

    const items = await pool.query(
      'SELECT 1 FROM inbox_items WHERE organization_id = $1',
      [ORG_A],
    )
    const receipts = await pool.query(
      'SELECT status FROM event_consumer_receipts WHERE event_id = $1',
      [source.eventId],
    )
    expect(items.rowCount).toBe(1)
    expect(receipts.rows).toEqual([{ status: 'applied' }])
  })

  it('reads through the lent transaction see the outer writes that other connections do not', async () => {
    await seedReviewRevisionOne()
    const store = createAtomicInboxCommandStore(db)
    const repo = createInboxRepository(db, emptyLookupPorts)
    const cycles = createReviewHandlingCycleStore(db)
    const item = makeItem()

    await expect(
      db.transaction(async (tx) => {
        await store.createItem(item, reviewOpeningAnchor(item), tx)

        expect((await repo.findBySource('review', item.sourceId, ORG_A, tx))?.id).toBe(
          item.id,
        )
        expect((await cycles.findHead(item.id, ORG_A, tx))?.currentCycleNumber).toBe(1)
        expect(await repo.findBySource('review', item.sourceId, ORG_A)).toBeNull()
        expect(await cycles.findHead(item.id, ORG_A)).toBeNull()
        throw new OuterRollback()
      }),
    ).rejects.toBeInstanceOf(OuterRollback)

    expect(await repo.findBySource('review', item.sourceId, ORG_A)).toBeNull()
  })

  it('lets a later command see an earlier one in the same lent transaction', async () => {
    await seedReviewRevisionOne()
    const store = createAtomicInboxCommandStore(db)
    const item = makeItem()

    const assigned = await db.transaction(async (tx) => {
      await store.createItem(item, reviewOpeningAnchor(item), tx)
      return store.assign(
        item,
        { assignedTo: USER_A },
        inboxItemAssigned({
          inboxItemId: item.id,
          organizationId: ORG_A,
          propertyId: PROP_A,
          userId: USER_A,
          assignedTo: USER_A,
          source: 'web',
          occurredAt: NOW,
        }),
        tx,
      )
    })

    expect(assigned.assignedTo).toBe(USER_A)
  })
})
