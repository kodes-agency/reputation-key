// Inbox context — inbox repository integration tests
// Per architecture: integration tests against real Postgres.
// Tenant isolation test is NON-NEGOTIABLE.

import { describe, it, expect } from 'vitest'
import { inboxItemId, reviewId, feedbackId } from '#/shared/domain/ids'
import { createAtomicInboxCommandStore } from '#/contexts/reputation/inbox/command-store.server'
import { queueToFilters } from '#/contexts/reputation/inbox/inbox-queues.contracts'
import {
  ORG_A,
  ORG_B,
  PROP_A,
  PROP_A_2,
  PROP_B,
  USER_A,
  TEST_NOW,
  db,
  allowAllCommandAuthority,
  stubPorts,
  createInboxRepository,
  makeInboxItem,
  useInboxRepositoryDb,
} from './inbox-repository.test-fixtures'

useInboxRepositoryDb()

describe('inbox repository — CRUD', () => {
  const repo = createInboxRepository(db, stubPorts)

  it('creates and finds an inbox item by id', async () => {
    const item = makeInboxItem()
    await repo.seedItem(item)

    const found = await repo.findById(item.id, ORG_A)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(item.id)
    expect(found!.status).toBe('open')
    // Denormalized content columns are never written nor read back —
    // rating/snippet/reviewerName resolve live via the review lookup.
    expect(found!.rating).toBeNull()
    expect(found!.snippet).toBeNull()
    expect(found!.reviewerName).toBeNull()
  })

  it('findById returns null for non-existent id', async () => {
    const found = await repo.findById(inboxItemId(crypto.randomUUID()), ORG_A)
    expect(found).toBeNull()
  })

  it('findByIds returns multiple items', async () => {
    const item1 = makeInboxItem({ sourceId: reviewId(crypto.randomUUID()) })
    const item2 = makeInboxItem({ sourceId: reviewId(crypto.randomUUID()) })
    await repo.seedItem(item1)
    await repo.seedItem(item2)

    const found = await repo.findByIds([item1.id, item2.id], ORG_A)
    expect(found).toHaveLength(2)
  })

  it('findBySource finds item by source type + source id', async () => {
    const srcId = feedbackId(crypto.randomUUID())
    const item = makeInboxItem({ sourceType: 'feedback', sourceId: srcId })
    await repo.seedItem(item)

    const found = await repo.findBySource('feedback', srcId as string, ORG_A)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(item.id)
  })

  it('findBySource returns null for wrong source type', async () => {
    const item = makeInboxItem({
      sourceType: 'review',
      sourceId: reviewId(crypto.randomUUID()),
    })
    await repo.seedItem(item)
    const found = await repo.findBySource('feedback', item.sourceId as string, ORG_A)
    expect(found).toBeNull()
  })
})

describe('inbox repository — active Handling Cycle authority', () => {
  const repo = createInboxRepository(db, stubPorts)

  it.each([
    ['Review', 'review', reviewId(crypto.randomUUID())],
    ['feedback', 'feedback', feedbackId(crypto.randomUUID())],
  ] as const)(
    'hides an orphan %s projection from every active read and count',
    async (_label, sourceType, sourceId) => {
      const orphan = makeInboxItem({
        sourceType,
        sourceId,
        rating: null,
        snippet: null,
        reviewerName: null,
      })
      await createAtomicInboxCommandStore(
        db,
        allowAllCommandAuthority,
        () => TEST_NOW,
      ).createItem(orphan, null)

      await expect(repo.findById(orphan.id, ORG_A)).resolves.toBeNull()
      await expect(repo.findByIds([orphan.id], ORG_A)).resolves.toEqual([])
      await expect(repo.findDetailById(orphan.id, ORG_A)).resolves.toBeNull()
      await expect(repo.countFiltered({ status: 'open' }, ORG_A)).resolves.toBe(0)
      await expect(repo.findFilteredPaginated({}, ORG_A)).resolves.toMatchObject({
        items: [],
        totalCount: 0,
      })

      // Integration/repair consumers retain a raw source-anchor lookup so a
      // legacy row can still be scrubbed or converged instead of becoming
      // unreachable merely because it is not actionable.
      await expect(
        repo.findBySource(sourceType, orphan.sourceId as string, ORG_A),
      ).resolves.toMatchObject({ id: orphan.id })
    },
  )

  it.each([
    ['Review', 'review', reviewId(crypto.randomUUID())],
    ['feedback', 'feedback', feedbackId(crypto.randomUUID())],
  ] as const)(
    'serves the %s item from its own status',
    async (_label, sourceType, sourceId) => {
      const item = makeInboxItem({ sourceType, sourceId, status: 'open' })
      await repo.seedItem(item)

      await expect(repo.findById(item.id, ORG_A)).resolves.toMatchObject({
        id: item.id,
        status: 'open',
      })
      await expect(repo.findDetailById(item.id, ORG_A)).resolves.toMatchObject({
        item: expect.objectContaining({ status: 'open' }),
      })
      await expect(repo.countFiltered({ status: 'open' }, ORG_A)).resolves.toBe(1)
      await expect(repo.countFiltered({ status: 'closed' }, ORG_A)).resolves.toBe(0)
      await expect(
        repo.findFilteredPaginated({ status: 'open' }, ORG_A),
      ).resolves.toMatchObject({
        items: [expect.objectContaining({ id: item.id, status: 'open' })],
        totalCount: 1,
      })
      await expect(
        repo.findFilteredPaginated({ status: 'closed' }, ORG_A),
      ).resolves.toMatchObject({ items: [], totalCount: 0 })
    },
  )
})

describe('inbox repository — active Review item ids', () => {
  const repo = createInboxRepository(db, stubPorts)

  it('maps each requested Review at the Property to its active item', async () => {
    const first = makeInboxItem({ sourceId: reviewId(crypto.randomUUID()) })
    const second = makeInboxItem({ sourceId: reviewId(crypto.randomUUID()) })
    await repo.seedItem(first)
    await repo.seedItem(second)
    const withoutItem = reviewId(crypto.randomUUID())

    const itemIds = await repo.findActiveReviewItemIds(ORG_A, PROP_A, [
      reviewId(first.sourceId),
      reviewId(second.sourceId),
      withoutItem,
    ])

    expect(itemIds).toEqual(
      new Map([
        [first.sourceId, first.id],
        [second.sourceId, second.id],
      ]),
    )
  })

  it('leaves out another Property, private feedback, and an orphan projection', async () => {
    const elsewhere = makeInboxItem({
      propertyId: PROP_A_2,
      sourceId: reviewId(crypto.randomUUID()),
    })
    const feedback = makeInboxItem({
      sourceType: 'feedback',
      sourceId: feedbackId(crypto.randomUUID()),
    })
    const orphan = makeInboxItem({
      sourceId: reviewId(crypto.randomUUID()),
      rating: null,
      snippet: null,
      reviewerName: null,
    })
    await repo.seedItem(elsewhere)
    await repo.seedItem(feedback)
    await createAtomicInboxCommandStore(
      db,
      allowAllCommandAuthority,
      () => TEST_NOW,
    ).createItem(orphan, null)

    const itemIds = await repo.findActiveReviewItemIds(ORG_A, PROP_A, [
      reviewId(elsewhere.sourceId),
      reviewId(feedback.sourceId),
      reviewId(orphan.sourceId),
    ])

    // The orphan is exactly what `findById` hides, so a link to it could not open.
    expect(itemIds.size).toBe(0)
    await expect(repo.findById(orphan.id, ORG_A)).resolves.toBeNull()
  })

  it('answers an empty lookup without a Review', async () => {
    await expect(repo.findActiveReviewItemIds(ORG_A, PROP_A, [])).resolves.toEqual(
      new Map(),
    )
  })
})

describe('inbox repository — queue predicates', () => {
  const repo = createInboxRepository(db, stubPorts)

  it('uses one predicate path for list totals and standalone counts', async () => {
    const included = makeInboxItem({ assignedTo: USER_A })
    const excluded = makeInboxItem()
    await repo.seedItem(included)
    await repo.seedItem(excluded)

    const filters = {
      status: 'open' as const,
      sourceType: 'review' as const,
      assignedTo: USER_A,
      replyStage: {
        match: 'include' as const,
        reviewIds: [reviewId(included.sourceId)],
      },
    }

    const [page, count] = await Promise.all([
      repo.findFilteredPaginated(filters, ORG_A),
      repo.countFiltered(filters, ORG_A),
    ])

    expect(page.items.map((item) => item.id)).toEqual([included.id])
    expect(page.totalCount).toBe(1)
    expect(count).toBe(page.totalCount)
    await expect(
      repo.countFiltered(
        {
          status: 'open',
          sourceType: 'review',
          replyStage: {
            match: 'exclude',
            reviewIds: [reviewId(included.sourceId)],
          },
        },
        ORG_A,
      ),
    ).resolves.toBe(1)
  })
})

describe('inbox repository — closed folders by kind', () => {
  const repo = createInboxRepository(db, stubPorts)
  const context = {
    viewerId: USER_A,
    canManageReplies: true,
    replyStages: { awaiting: [], waiting: [] },
  } as const

  it('lists Replied and Handled apart, and counts each exactly as its list totals it', async () => {
    const closedReview = makeInboxItem({ status: 'closed' })
    const closedFeedback = makeInboxItem({
      sourceType: 'feedback',
      sourceId: feedbackId(crypto.randomUUID()),
      status: 'closed',
    })
    const openReview = makeInboxItem()
    const openFeedback = makeInboxItem({
      sourceType: 'feedback',
      sourceId: feedbackId(crypto.randomUUID()),
    })
    for (const item of [closedReview, closedFeedback, openReview, openFeedback]) {
      await repo.seedItem(item)
    }

    const folders = [
      ['replied', closedReview],
      ['handled', closedFeedback],
    ] as const
    for (const [queue, expected] of folders) {
      const filters = queueToFilters(queue, context)
      const [page, count] = await Promise.all([
        repo.findFilteredPaginated(filters, ORG_A),
        repo.countFiltered(filters, ORG_A),
      ])

      expect(page.items.map((item) => item.id)).toEqual([expected.id])
      expect(count).toBe(page.totalCount)
      expect(count).toBe(1)
    }
  })

  it('reads the reply queue without stages as every open Review, and counts it as the list does', async () => {
    const needsReply = makeInboxItem()
    const awaiting = makeInboxItem()
    const closed = makeInboxItem({ status: 'closed' })
    const feedback = makeInboxItem({
      sourceType: 'feedback',
      sourceId: feedbackId(crypto.randomUUID()),
    })
    for (const item of [needsReply, awaiting, closed, feedback]) {
      await repo.seedItem(item)
    }

    const filters = queueToFilters('reply', { ...context, canManageReplies: false })
    const [page, count] = await Promise.all([
      repo.findFilteredPaginated(filters, ORG_A),
      repo.countFiltered(filters, ORG_A),
    ])

    expect(page.items.map((item) => item.id).sort()).toEqual(
      [needsReply.id, awaiting.id].sort(),
    )
    expect(count).toBe(page.totalCount)
  })
})

describe('inbox repository — per-property counts', () => {
  const repo = createInboxRepository(db, stubPorts)

  it('groups the standalone count by property, with the same predicates', async () => {
    await repo.seedItem(makeInboxItem({ propertyId: PROP_A }))
    await repo.seedItem(makeInboxItem({ propertyId: PROP_A }))
    await repo.seedItem(makeInboxItem({ propertyId: PROP_A_2 }))
    await repo.seedItem(makeInboxItem({ propertyId: PROP_A_2, status: 'closed' }))
    await repo.seedItem(makeInboxItem({ organizationId: ORG_B, propertyId: PROP_B }))

    const filters = { status: 'open' as const, sourceType: 'review' as const }
    const [byProperty, total] = await Promise.all([
      repo.countFilteredByProperty(filters, ORG_A),
      repo.countFiltered(filters, ORG_A),
    ])

    expect(
      [...byProperty].sort(
        (a, b) => b.count - a.count || a.propertyId.localeCompare(b.propertyId),
      ),
    ).toEqual([
      { propertyId: PROP_A, count: 2 },
      { propertyId: PROP_A_2, count: 1 },
    ])
    expect(byProperty.reduce((sum, row) => sum + row.count, 0)).toBe(total)
  })

  it('reads nothing outside the property scope it is given', async () => {
    await repo.seedItem(makeInboxItem({ propertyId: PROP_A }))
    await repo.seedItem(makeInboxItem({ propertyId: PROP_A_2 }))

    await expect(
      repo.countFilteredByProperty({ status: 'open', propertyIds: [PROP_A_2] }, ORG_A),
    ).resolves.toEqual([{ propertyId: PROP_A_2, count: 1 }])
    await expect(
      repo.countFilteredByProperty({ status: 'open', propertyIds: [] }, ORG_A),
    ).resolves.toEqual([])
  })
})

describe('inbox repository — count by status', () => {
  const repo = createInboxRepository(db, stubPorts)

  it('counts items by status', async () => {
    await repo.seedItem(
      makeInboxItem({ sourceId: reviewId(crypto.randomUUID()), status: 'open' }),
    )
    await repo.seedItem(
      makeInboxItem({ sourceId: reviewId(crypto.randomUUID()), status: 'open' }),
    )
    await repo.seedItem(
      makeInboxItem({ sourceId: reviewId(crypto.randomUUID()), status: 'closed' }),
    )

    const newCount = await repo.countFiltered({ status: 'open' }, ORG_A)
    expect(newCount).toBe(2)

    const addressedCount = await repo.countFiltered({ status: 'closed' }, ORG_A)
    expect(addressedCount).toBe(1)
  })

  it('narrows status, escalation, and last-visit counts by source family', async () => {
    await repo.seedItem(
      makeInboxItem({
        sourceType: 'review',
        sourceId: reviewId(crypto.randomUUID()),
        status: 'open',
      }),
    )
    await repo.seedItem(
      makeInboxItem({
        sourceType: 'feedback',
        sourceId: feedbackId(crypto.randomUUID()),
        status: 'open',
        isEscalated: true,
        escalatedAt: new Date(),
      }),
    )

    await expect(
      Promise.all([
        repo.countFiltered(
          { status: 'open', sourceScopes: [{ sourceType: 'review' }] },
          ORG_A,
        ),
        repo.countFiltered(
          { isEscalated: true, sourceScopes: [{ sourceType: 'review' }] },
          ORG_A,
        ),
        repo.countOpenSince(ORG_A, null, undefined, [{ sourceType: 'review' }]),
        repo.countFiltered(
          { status: 'open', sourceScopes: [{ sourceType: 'feedback' }] },
          ORG_A,
        ),
        repo.countFiltered(
          { isEscalated: true, sourceScopes: [{ sourceType: 'feedback' }] },
          ORG_A,
        ),
        repo.countOpenSince(ORG_A, null, undefined, [{ sourceType: 'feedback' }]),
        repo.countFiltered({ status: 'open', sourceScopes: [] }, ORG_A),
      ]),
    ).resolves.toEqual([1, 0, 1, 1, 1, 1, 0])
  })

  it('applies a different property envelope to each source family', async () => {
    await repo.seedItem(
      makeInboxItem({
        propertyId: PROP_A_2,
        sourceType: 'review',
        sourceId: reviewId(crypto.randomUUID()),
      }),
    )
    await repo.seedItem(
      makeInboxItem({
        propertyId: PROP_A,
        sourceType: 'feedback',
        sourceId: feedbackId(crypto.randomUUID()),
      }),
    )
    await repo.seedItem(
      makeInboxItem({
        propertyId: PROP_A_2,
        sourceType: 'feedback',
        sourceId: feedbackId(crypto.randomUUID()),
      }),
    )
    const sourceScopes = [
      { sourceType: 'review' as const },
      { sourceType: 'feedback' as const, propertyIds: [PROP_A] },
    ]

    const [count, page] = await Promise.all([
      repo.countFiltered({ status: 'open', sourceScopes }, ORG_A),
      repo.findFilteredPaginated({ sourceScopes }, ORG_A, undefined, 50),
    ])

    expect(count).toBe(2)
    expect(page.totalCount).toBe(2)
    expect(page.items.map((item) => [item.sourceType, item.propertyId])).toEqual(
      expect.arrayContaining([
        ['review', PROP_A_2],
        ['feedback', PROP_A],
      ]),
    )
  })
})

describe('inbox repository — pagination', () => {
  const repo = createInboxRepository(db, stubPorts)

  it('returns paginated results with cursor', async () => {
    // Create 5 items with different source dates
    for (let i = 0; i < 5; i++) {
      const date = new Date(2026, 0, i + 1) // Jan 1-5, 2026
      await repo.seedItem(
        makeInboxItem({
          sourceId: reviewId(crypto.randomUUID()),
          sourceDate: date,
        }),
      )
    }

    // Request first 3
    const result = await repo.findFilteredPaginated({}, ORG_A, undefined, 3)
    expect(result.items).toHaveLength(3)
    expect(result.totalCount).toBe(5)
    expect(result.nextCursor).not.toBeNull()

    // Request next page
    const page2 = await repo.findFilteredPaginated({}, ORG_A, result.nextCursor!, 3)
    expect(page2.items).toHaveLength(2)
    expect(page2.totalCount).toBeNull()
    expect(page2.nextCursor).toBeNull()
  })

  it('supports oldest-first keyset pagination', async () => {
    for (let i = 0; i < 3; i++) {
      await repo.seedItem(
        makeInboxItem({
          sourceId: reviewId(crypto.randomUUID()),
          sourceDate: new Date(Date.UTC(2026, 0, i + 1)),
        }),
      )
    }

    const page1 = await repo.findFilteredPaginated(
      { sort: 'oldest' },
      ORG_A,
      undefined,
      2,
    )
    const page2 = await repo.findFilteredPaginated(
      { sort: 'oldest' },
      ORG_A,
      page1.nextCursor!,
      2,
    )

    expect(page1.items.map((item) => item.sourceDate.toISOString())).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
    ])
    expect(page2.items[0]!.sourceDate.toISOString()).toBe('2026-01-03T00:00:00.000Z')
    expect(page1.totalCount).toBe(3)
    expect(page2.totalCount).toBeNull()
  })

  it.each([
    [
      'newest' as const,
      [
        '00000000-0000-4000-8000-000000000003',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000001',
      ],
    ],
    [
      'oldest' as const,
      [
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000003',
      ],
    ],
  ])('uses id as the %s tie-breaker across pages', async (sort, expectedIds) => {
    const sharedDate = new Date('2026-01-15T10:00:00.000Z')
    for (const id of expectedIds) {
      await repo.seedItem(
        makeInboxItem({
          id: inboxItemId(id),
          sourceId: reviewId(crypto.randomUUID()),
          sourceDate: sharedDate,
        }),
      )
    }

    const page1 = await repo.findFilteredPaginated({ sort }, ORG_A, undefined, 2)
    const page2 = await repo.findFilteredPaginated({ sort }, ORG_A, page1.nextCursor!, 2)

    expect([...page1.items, ...page2.items].map((item) => item.id)).toEqual(
      expectedIds.map(inboxItemId),
    )
    expect(page1.totalCount).toBe(3)
    expect(page2.totalCount).toBeNull()
  })

  it('filters by property', async () => {
    await repo.seedItem(makeInboxItem({ sourceId: reviewId(crypto.randomUUID()) }))
    await repo.seedItem(
      makeInboxItem({
        sourceId: reviewId(crypto.randomUUID()),
        propertyId: PROP_A_2,
      }),
    )

    const result = await repo.findFilteredPaginated(
      { propertyId: PROP_A },
      ORG_A,
      undefined,
      50,
    )
    expect(result.items).toHaveLength(1)
  })

  it('filters by status', async () => {
    await repo.seedItem(
      makeInboxItem({ sourceId: reviewId(crypto.randomUUID()), status: 'open' }),
    )
    await repo.seedItem(
      makeInboxItem({ sourceId: reviewId(crypto.randomUUID()), status: 'closed' }),
    )

    const result = await repo.findFilteredPaginated(
      { status: 'open' },
      ORG_A,
      undefined,
      50,
    )
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.status).toBe('open')
  })
})

describe('inbox repository — tenant isolation', () => {
  const repo = createInboxRepository(db, stubPorts)

  it('findById returns null for different org', async () => {
    const item = makeInboxItem()
    await repo.seedItem(item)

    // ORG_B should not see ORG_A's item
    const found = await repo.findById(item.id, ORG_B)
    expect(found).toBeNull()
  })

  it('findBySource returns null for different org', async () => {
    const item = makeInboxItem({
      sourceType: 'review',
      sourceId: reviewId(crypto.randomUUID()),
    })
    await repo.seedItem(item)

    const found = await repo.findBySource('review', item.sourceId as string, ORG_B)
    expect(found).toBeNull()
  })

  it('findActiveReviewItemIds returns nothing for different org', async () => {
    const item = makeInboxItem({ sourceId: reviewId(crypto.randomUUID()) })
    await repo.seedItem(item)

    const itemIds = await repo.findActiveReviewItemIds(ORG_B, PROP_A, [
      reviewId(item.sourceId),
    ])
    expect(itemIds.size).toBe(0)
  })

  it('findFilteredPaginated returns empty for different org', async () => {
    await repo.seedItem(makeInboxItem({ sourceId: reviewId(crypto.randomUUID()) }))

    const result = await repo.findFilteredPaginated({}, ORG_B, undefined, 50)
    expect(result.items).toHaveLength(0)
    expect(result.totalCount).toBe(0)
  })

  it('countFiltered returns 0 for a status in a different org', async () => {
    await repo.seedItem(
      makeInboxItem({ sourceId: reviewId(crypto.randomUUID()), status: 'open' }),
    )

    const count = await repo.countFiltered({ status: 'open' }, ORG_B)
    expect(count).toBe(0)
  })

  it('lists and counts only the Properties in scope, and the two agree', async () => {
    await repo.seedItem(makeInboxItem({ propertyId: PROP_A, status: 'open' }))
    await repo.seedItem(makeInboxItem({ propertyId: PROP_A_2, status: 'open' }))
    await repo.seedItem(makeInboxItem({ propertyId: PROP_A, status: 'closed' }))
    const filters = { status: 'open' as const, propertyIds: [PROP_A] }

    const [count, page] = await Promise.all([
      repo.countFiltered(filters, ORG_A),
      repo.findFilteredPaginated(filters, ORG_A, undefined, 50),
    ])

    expect(count).toBe(1)
    expect(page.totalCount).toBe(1)
    expect(page.items.map((item) => item.propertyId)).toEqual([PROP_A])
    await expect(repo.countOpenSince(ORG_A, null, [PROP_A_2])).resolves.toBe(1)
  })

  it('treats an explicit empty property scope as no visible rows', async () => {
    const item = makeInboxItem({
      sourceId: reviewId(crypto.randomUUID()),
      status: 'open',
      isEscalated: true,
      escalatedAt: new Date(),
    })
    await repo.seedItem(item)

    await expect(
      Promise.all([
        repo.countFiltered({ status: 'open', propertyIds: [] }, ORG_A),
        repo.countFiltered({ isEscalated: true, propertyIds: [] }, ORG_A),
        repo.countOpenSince(ORG_A, null, []),
      ]),
    ).resolves.toEqual([0, 0, 0])
  })
})
