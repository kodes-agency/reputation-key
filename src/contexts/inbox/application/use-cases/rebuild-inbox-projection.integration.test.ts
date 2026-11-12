// rebuildInboxProjection against PostgreSQL.
//
// Rebuild derives review-sourced inbox state from canonical data and
// reconciles missing items and reply milestone metadata without inferring a
// Handling Cycle outcome from expiry, source absence, or historical publish
// state. The one outcome it records is for an item it creates: closed, when
// Review's exact-current permit shows a reply on Google answering the review.
// It never touches inbox-owned fields, never deletes, and dryRun writes
// nothing while reporting the same counts.

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { rebuildInboxProjection } from './rebuild-inbox-projection'
import { getEnv } from '#/shared/config/env'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  createInboxDatabaseStores,
  dropInboxOrganization,
  fixtureUuid,
  readOutboxFacts,
  seedInboxScope,
  seedReviewSource,
} from '../../infrastructure/inbox-database-fixtures'
import type {
  ReviewSourceLookupPort,
  ReviewSourceMeta,
} from '../ports/review-source-lookup.port'
import type {
  GoogleReplyHead,
  ReplyLookupPort,
  ReplyMilestones,
} from '../ports/reply-lookup.port'
import type {
  CurrentReplyObservationPermit,
  ReplyObservationAuthorityPort,
} from '../ports/reply-observation-authority.port'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'

const NOW = new Date('2026-06-15T12:00:00Z')
const SCOPE = 'rebuild-inbox-projection'
const ORG = organizationId('org-rebuild-inbox-projection-test')
const PROP = propertyId(fixtureUuid(SCOPE, 'prop-1'))
const PROP_2 = propertyId(fixtureUuid(SCOPE, 'prop-2'))
const USER = userId('user-1')

let seq = 0
function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  seq += 1
  return {
    id: inboxItemId(fixtureUuid(SCOPE, `item-${seq}`)),
    organizationId: ORG,
    propertyId: PROP,
    sourceType: 'review',
    sourceId: reviewId(fixtureUuid(SCOPE, `rev-${seq}`)),
    status: 'open',
    rating: null,
    sourceDate: new Date('2026-06-01'),
    platform: 'google',
    snippet: null,
    assignedTo: null,
    reviewerName: null,
    propertyName: null,
    isEscalated: false,
    escalatedAt: null,
    escalatedBy: null,
    escalationResolvedAt: null,
    escalationResolvedBy: null,
    closedAt: null,
    firstReplySubmittedAt: null,
    firstReplyPublishedAt: null,
    commandRevision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeSource(overrides: Partial<ReviewSourceMeta> = {}): ReviewSourceMeta {
  seq += 1
  return {
    id: reviewId(fixtureUuid(SCOPE, `rev-${seq}`)),
    propertyId: PROP,
    platform: 'google',
    sourceEpoch: 1,
    sourceDate: new Date('2026-06-01'),
    contentExpiresAt: new Date('2027-01-01'),
    materialReviewRevision: 1,
    ...overrides,
  }
}

const READ_FROM_GOOGLE = new Date('2026-06-10T08:00:00Z')

/** Google shows a reply written there, answering revision 1 of `src`. */
function googleReply(
  src: ReviewSourceMeta,
  overrides: Partial<GoogleReplyHead> = {},
): GoogleReplyHead {
  return {
    reviewId: src.id,
    propertyId: src.propertyId,
    observationRevision: 3,
    sourceEpoch: src.sourceEpoch,
    materialReviewRevision: 1,
    state: 'live',
    change: 'added',
    resolution: 'external_current_live',
    provenance: 'external_or_unknown',
    matchedReplyId: null,
    matchedPublicationCycle: null,
    observedAt: READ_FROM_GOOGLE,
    ...overrides,
  }
}

/** Review's authority: issues the permit asked for, or reports it obsolete. */
function fakeAuthority(answer: 'current' | 'obsolete') {
  const authority: ReplyObservationAuthorityPort = {
    withExactCurrent: vi.fn(async (expectation, apply) => {
      if (answer === 'obsolete') return { status: 'obsolete' as const }
      const permit: CurrentReplyObservationPermit = {
        ...expectation,
        authority: 'review.current-google-reply-observation.v1',
        sourceEpochCarryFromMaterialReviewRevision: null,
        state: 'live',
        observedAt: expectation.occurredAt,
        providerReplyUpdatedAt: null,
        reviewSourceContentState: 'active',
        responseTargetEligibility: 'legacy_unknown',
        responseTargetStartAt: null,
        rating: 5,
      }
      return { status: 'current' as const, value: await apply(permit) }
    }),
  }
  return authority
}

const pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })

function setup(opts: {
  items?: InboxItem[]
  sources?: ReviewSourceMeta[]
  milestones?: ReadonlyMap<string, ReplyMilestones>
  onGoogle?: ReadonlyArray<GoogleReplyHead>
  permit?: 'current' | 'obsolete'
}) {
  const { repo, commandStore } = createInboxDatabaseStores(() => NOW, createMockLogger())
  const reviewSourceLookup: ReviewSourceLookupPort = {
    getReviewSourceMetaById: vi.fn(async () => null),
    getReviewSourceMetaByIds: vi.fn(async () => []),
    listReviewSources: vi.fn(async () => opts.sources ?? []),
  }
  const replyLookup: ReplyLookupPort = {
    getEffectiveReplyByReviewId: vi.fn(async () => null),
    getReplyMilestonesByReviewIds: vi.fn(async () => opts.milestones ?? new Map()),
    getGoogleReplyHeadsByReviewIds: vi.fn(
      async () => new Map((opts.onGoogle ?? []).map((head) => [head.reviewId, head])),
    ),
    getReplyStatesByReviewIds: vi.fn(async () => new Map()),
    findReviewIdsByReplyStage: vi.fn(async () => ({ awaiting: [], waiting: [] })),
  }
  const deps = {
    repo,
    commandStore,
    reviewSourceLookup,
    replyLookup,
    replyObservationAuthority: fakeAuthority(opts.permit ?? 'current'),
    idGen: () => inboxItemId(crypto.randomUUID()),
    clock: () => NOW,
    logger: createMockLogger(),
  }
  const seed = async () => {
    await seedInboxScope(pool, ORG, [PROP, PROP_2], opts.items ?? [], NOW)
    for (const source of opts.sources ?? []) {
      await seedReviewSource(pool, {
        id: source.id,
        organizationId: ORG,
        propertyId: source.propertyId,
        sourceDate: source.sourceDate,
      })
    }
  }
  const items = async () =>
    (await repo.findFilteredPaginated({}, ORG, undefined, 100)).items
  const events = {
    status: () => readOutboxFacts(pool, ORG, 'inbox.inbox_item.status_changed'),
    created: () => readOutboxFacts(pool, ORG, 'inbox.inbox_item.created'),
    all: async () =>
      (await pool.query('SELECT id FROM outbox_events WHERE organization_id = $1', [ORG]))
        .rows,
  }
  return { useCase: rebuildInboxProjection(deps), seed, items, events, deps }
}

describe.sequential('rebuildInboxProjection', () => {
  registerAllEventSchemas()

  beforeEach(async () => {
    seq = 0
    await dropInboxOrganization(pool, ORG)
  })

  afterAll(async () => {
    await dropInboxOrganization(pool, ORG)
    await pool.end()
  })

  it('creates missing items for canonical reviews without recording created facts', async () => {
    const src = makeSource()
    const { useCase, seed, items, events } = setup({ sources: [src] })

    await seed()
    const report = await useCase({ organizationId: ORG, dryRun: false })

    expect(report.created).toBe(1)
    expect(await items()).toHaveLength(1)
    expect((await items())[0]!.sourceId).toBe(src.id)
    expect((await items())[0]!.status).toBe('open')
    expect((await items())[0]!.sourceDate).toEqual(src.sourceDate)
    // Rebuild is repair, not new information: no created fact.
    expect(await events.created()).toHaveLength(0)
  })

  it('creates a missing expired review open without inferring a handling outcome', async () => {
    const src = makeSource({ contentExpiresAt: new Date('2026-01-01') })
    const { useCase, seed, items, events } = setup({ sources: [src] })

    await seed()
    const report = await useCase({ organizationId: ORG, dryRun: false })

    expect(report).toMatchObject({ created: 1, closed: 0 })
    expect((await items())[0]).toMatchObject({
      sourceId: src.id,
      status: 'open',
      closedAt: null,
    })
    expect(await events.status()).toHaveLength(0)
  })

  it('creates a missing review open while preserving reply milestones', async () => {
    const src = makeSource()
    const publishedAt = new Date('2026-06-06T12:00:00Z')
    const milestones: ReadonlyMap<string, ReplyMilestones> = new Map([
      [
        src.id as string,
        {
          firstSubmittedAt: new Date('2026-06-05T12:00:00Z'),
          firstPublishedAt: publishedAt,
        },
      ],
    ])
    const { useCase, seed, items } = setup({ sources: [src], milestones })

    await seed()
    const report = await useCase({ organizationId: ORG, dryRun: false })

    expect(report).toMatchObject({ created: 1, closed: 0, milestones: 1 })
    expect((await items())[0]).toMatchObject({
      status: 'open',
      closedAt: null,
      firstReplySubmittedAt: new Date('2026-06-05T12:00:00Z'),
      firstReplyPublishedAt: publishedAt,
    })
  })

  it('creates a missing item closed when Google shows a reply answering it', async () => {
    const src = makeSource()
    const writtenOnGoogle = new Date('2026-06-09T18:00:00Z')
    const milestones: ReadonlyMap<string, ReplyMilestones> = new Map([
      [src.id as string, { firstSubmittedAt: null, firstPublishedAt: writtenOnGoogle }],
    ])
    const { useCase, seed, items, events, deps } = setup({
      sources: [src],
      milestones,
      onGoogle: [googleReply(src)],
    })

    await seed()
    const report = await useCase({ organizationId: ORG, dryRun: false })

    expect(report).toMatchObject({ created: 1, closed: 1, milestones: 1 })
    expect((await items())[0]).toMatchObject({
      sourceId: src.id,
      status: 'closed',
      closedAt: READ_FROM_GOOGLE,
      firstReplyPublishedAt: writtenOnGoogle,
    })
    expect(deps.replyObservationAuthority.withExactCurrent).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewId: src.id,
        observationRevision: 3,
        materialReviewRevision: 1,
        resolution: 'external_current_live',
        occurredAt: READ_FROM_GOOGLE,
      }),
      expect.any(Function),
    )
    expect(await events.all()).toHaveLength(0)
  })

  it('creates the item open when the Google reply moved after it was read', async () => {
    const src = makeSource()
    const { useCase, seed, items } = setup({
      sources: [src],
      onGoogle: [googleReply(src)],
      permit: 'obsolete',
    })

    await seed()
    const report = await useCase({ organizationId: ORG, dryRun: false })

    expect(report).toMatchObject({ created: 1, closed: 0 })
    expect((await items())[0]).toMatchObject({ status: 'open', closedAt: null })
  })

  it.each([
    ['answers an earlier revision', { materialReviewRevision: 0 }],
    ['was read in an earlier source epoch', { sourceEpoch: 0 }],
    ['differs from the reply RepKey sent', { resolution: 'diverged' as const }],
    ['was carried over a guest edit', { resolution: 'unchanged' as const }],
    [
      'was deleted',
      {
        state: 'absent' as const,
        change: 'deleted' as const,
        resolution: 'absent' as const,
      },
    ],
  ])('creates a missing item open when the Google reply %s', async (_case, head) => {
    const src = makeSource()
    const { useCase, seed, items, deps } = setup({
      sources: [src],
      onGoogle: [googleReply(src, head)],
    })

    await seed()
    const report = await useCase({ organizationId: ORG, dryRun: false })

    expect(report).toMatchObject({ created: 1, closed: 0 })
    expect((await items())[0]!.status).toBe('open')
    expect(deps.replyObservationAuthority.withExactCurrent).not.toHaveBeenCalled()
  })

  it('never closes an existing open item, even when Google answers its review', async () => {
    const src = makeSource()
    const item = makeItem({ sourceId: src.id, status: 'open' })
    const { useCase, seed, items, deps } = setup({
      items: [item],
      sources: [src],
      onGoogle: [googleReply(src)],
    })

    await seed()
    const report = await useCase({ organizationId: ORG, dryRun: false })

    expect(report.closed).toBe(0)
    expect((await items())[0]!.status).toBe('open')
    expect(deps.replyObservationAuthority.withExactCurrent).not.toHaveBeenCalled()
  })

  it('dryRun counts an item it would create closed without asking for a permit', async () => {
    const src = makeSource()
    const { useCase, seed, items, deps } = setup({
      sources: [src],
      onGoogle: [googleReply(src)],
    })

    await seed()
    const report = await useCase({ organizationId: ORG, dryRun: true })

    expect(report).toMatchObject({ created: 1, closed: 1, dryRun: true })
    expect(await items()).toHaveLength(0)
    expect(deps.replyObservationAuthority.withExactCurrent).not.toHaveBeenCalled()
  })

  it('does not close an open item whose review row is gone', async () => {
    const item = makeItem({ status: 'open' })
    const { useCase, seed, items, events } = setup({ items: [item], sources: [] })

    await seed()
    const report = await useCase({ organizationId: ORG, dryRun: false })

    expect(report.closed).toBe(0)
    expect((await items())[0]!.status).toBe('open')
    expect(await events.status()).toHaveLength(0)
  })

  it('does not close an open item whose review content is expired', async () => {
    const src = makeSource({ contentExpiresAt: new Date('2026-01-01') })
    const item = makeItem({ sourceId: src.id, status: 'open' })
    const { useCase, seed, items } = setup({ items: [item], sources: [src] })

    await seed()
    const report = await useCase({ organizationId: ORG, dryRun: false })

    expect(report.closed).toBe(0)
    expect((await items())[0]!.status).toBe('open')
  })

  it('leaves an open item alone when its review is live and no reply exists', async () => {
    const src = makeSource()
    const item = makeItem({ sourceId: src.id, status: 'open' })
    const { useCase, seed, items } = setup({ items: [item], sources: [src] })

    await seed()
    const report = await useCase({ organizationId: ORG, dryRun: false })

    expect(report.closed).toBe(0)
    expect(report.created).toBe(0)
    expect(report.milestones).toBe(0)
    expect((await items())[0]!.status).toBe('open')
  })

  it('stamps missing reply milestones without a status fact', async () => {
    const src = makeSource()
    const item = makeItem({ sourceId: src.id, status: 'open' })
    const milestones: ReadonlyMap<string, ReplyMilestones> = new Map([
      [
        src.id as string,
        { firstSubmittedAt: new Date('2026-06-05'), firstPublishedAt: null },
      ],
    ])
    const { useCase, seed, items, events } = setup({
      items: [item],
      sources: [src],
      milestones,
    })

    await seed()
    const report = await useCase({ organizationId: ORG, dryRun: false })

    expect(report.milestones).toBe(1)
    expect(report.closed).toBe(0)
    expect((await items())[0]!.firstReplySubmittedAt).toEqual(new Date('2026-06-05'))
    expect((await items())[0]!.status).toBe('open')
    expect(await events.status()).toHaveLength(0)
  })

  it('stamps a published milestone without inferring a close', async () => {
    const src = makeSource()
    const item = makeItem({ sourceId: src.id, status: 'open' })
    const milestones: ReadonlyMap<string, ReplyMilestones> = new Map([
      [
        src.id as string,
        {
          firstSubmittedAt: new Date('2026-06-05'),
          firstPublishedAt: new Date('2026-06-06'),
        },
      ],
    ])
    const { useCase, seed, items, events } = setup({
      items: [item],
      sources: [src],
      milestones,
    })

    await seed()
    const report = await useCase({ organizationId: ORG, dryRun: false })

    expect(report.closed).toBe(0)
    expect((await items())[0]!.status).toBe('open')
    expect((await items())[0]!.firstReplyPublishedAt).toEqual(new Date('2026-06-06'))
    expect(await events.status()).toHaveLength(0)
  })

  it('stamps the published milestone on an already-closed item without a fact', async () => {
    const src = makeSource()
    const item = makeItem({
      sourceId: src.id,
      status: 'closed',
      closedAt: new Date('2026-06-07'),
    })
    const milestones: ReadonlyMap<string, ReplyMilestones> = new Map([
      [
        src.id as string,
        { firstSubmittedAt: null, firstPublishedAt: new Date('2026-06-06') },
      ],
    ])
    const { useCase, seed, items, events } = setup({
      items: [item],
      sources: [src],
      milestones,
    })

    await seed()
    const report = await useCase({ organizationId: ORG, dryRun: false })

    expect(report.milestones).toBe(1)
    expect(report.closed).toBe(0)
    expect((await items())[0]!.firstReplyPublishedAt).toEqual(new Date('2026-06-06'))
    expect(await events.status()).toHaveLength(0)
  })

  it('never touches inbox-owned fields (assignment, escalation)', async () => {
    const src = makeSource()
    const item = makeItem({
      sourceId: src.id,
      status: 'open',
      assignedTo: USER,
      isEscalated: true,
      escalatedAt: NOW,
      escalatedBy: USER,
    })
    const { useCase, seed, items } = setup({ items: [item], sources: [src] })

    await seed()
    await useCase({ organizationId: ORG, dryRun: false })

    expect((await items())[0]!.assignedTo).toBe(USER)
    expect((await items())[0]!.isEscalated).toBe(true)
  })

  it('dryRun reports the same counts but writes nothing', async () => {
    const srcLive = makeSource()
    const missing = makeSource()
    const item = makeItem({ sourceId: srcLive.id, status: 'open' })
    const orphan = makeItem({ status: 'open' })
    const { useCase, seed, items, events } = setup({
      items: [item, orphan],
      sources: [srcLive, missing],
    })

    await seed()
    const report = await useCase({ organizationId: ORG, dryRun: true })

    expect(report.created).toBe(1)
    expect(report.closed).toBe(0)
    expect(report.dryRun).toBe(true)
    expect(await items()).toHaveLength(2)
    expect((await items())[0]!.status).toBe('open')
    expect((await items())[1]!.status).toBe('open')
    expect(await events.all()).toHaveLength(0)
  })

  it('is idempotent: a second run reconciles nothing', async () => {
    const src = makeSource()
    const orphan = makeItem({ status: 'open' })
    const { useCase, seed } = setup({ items: [orphan], sources: [src] })

    await seed()
    await useCase({ organizationId: ORG, dryRun: false })
    const second = await useCase({ organizationId: ORG, dryRun: false })

    expect(second.created).toBe(0)
    expect(second.closed).toBe(0)
    expect(second.milestones).toBe(0)
  })

  it('scopes to one property when propertyId is given', async () => {
    const otherProp = PROP_2
    const src = makeSource({ propertyId: otherProp })
    const { useCase, seed, items } = setup({ sources: [src] })

    await seed()
    const report = await useCase({
      organizationId: ORG,
      propertyId: otherProp,
      dryRun: false,
    })

    expect(report.created).toBe(1)
    expect((await items())[0]!.propertyId).toBe(otherProp)
  })
})
