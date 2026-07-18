// BQC-3.4 — rebuildInboxProjection unit tests.
//
// Rebuild derives review-sourced inbox state from canonical data and
// reconciles: missing items created (idempotent, NO created fact — rebuild
// is repair, not new information), expired-but-open items closed (with
// fact), missing reply milestones stamped. It never touches inbox-owned
// fields (assignment, escalation, notes), never deletes, and dryRun writes
// nothing while reporting the same counts.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { rebuildInboxProjection } from './rebuild-inbox-projection'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { createSequentialInboxCommandStore } from '#/shared/testing/sequential-inbox-command-store'
import type {
  ReviewSourceLookupPort,
  ReviewSourceMeta,
} from '../ports/review-source-lookup.port'
import type { ReplyLookupPort, ReplyMilestones } from '../ports/reply-lookup.port'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'

const NOW = new Date('2026-06-15T12:00:00Z')
const ORG = organizationId('org-1')
const PROP = propertyId('prop-1')
const USER = userId('user-1')

let seq = 0
function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  seq += 1
  return {
    id: inboxItemId(`ii-${String(seq).padStart(4, '0')}`),
    organizationId: ORG,
    propertyId: PROP,
    sourceType: 'review',
    sourceId: reviewId(`rev-${seq}`),
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
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeSource(overrides: Partial<ReviewSourceMeta> = {}): ReviewSourceMeta {
  seq += 1
  return {
    id: reviewId(`rev-${seq}`),
    propertyId: PROP,
    platform: 'google',
    sourceDate: new Date('2026-06-01'),
    contentExpiresAt: new Date('2027-01-01'),
    ...overrides,
  }
}

function setup(opts: {
  items?: InboxItem[]
  sources?: ReviewSourceMeta[]
  milestones?: ReadonlyMap<string, ReplyMilestones>
}) {
  const repo = createInMemoryInboxRepo()
  for (const item of opts.items ?? []) repo.items.push(item)
  const events = createCapturingEventBus()
  const commandStore = createSequentialInboxCommandStore({ repo, events })
  const reviewSourceLookup: ReviewSourceLookupPort = {
    getReviewSourceMetaById: vi.fn(async () => null),
    listReviewSources: vi.fn(async () => opts.sources ?? []),
  }
  const replyLookup: ReplyLookupPort = {
    getReplyByReviewId: vi.fn(async () => null),
    getReplyMilestonesByReviewIds: vi.fn(async () => opts.milestones ?? new Map()),
  }
  const deps = {
    repo,
    commandStore,
    reviewSourceLookup,
    replyLookup,
    idGen: () => inboxItemId(`ii-new-${crypto.randomUUID()}`),
    clock: () => NOW,
    logger: createMockLogger(),
  }
  return { useCase: rebuildInboxProjection(deps), repo, events }
}

describe('rebuildInboxProjection', () => {
  beforeEach(() => {
    seq = 0
  })

  it('creates missing items for canonical reviews — without re-emitting created facts', async () => {
    const src = makeSource()
    const { useCase, repo, events } = setup({ sources: [src] })

    const report = await useCase({ organizationId: ORG, dryRun: false })

    expect(report.created).toBe(1)
    expect(repo.items).toHaveLength(1)
    expect(repo.items[0]!.sourceId).toBe(src.id)
    expect(repo.items[0]!.status).toBe('open')
    expect(repo.items[0]!.sourceDate).toEqual(src.sourceDate)
    // Rebuild is repair, not new information: no created fact.
    expect(events.capturedByTag('inbox.inbox_item.created')).toHaveLength(0)
  })

  it('closes an open item whose review row is gone (purged)', async () => {
    const item = makeItem({ status: 'open' })
    const { useCase, repo, events } = setup({ items: [item], sources: [] })

    const report = await useCase({ organizationId: ORG, dryRun: false })

    expect(report.closed).toBe(1)
    expect(repo.items[0]!.status).toBe('closed')
    expect(events.capturedByTag('inbox.inbox_item.status_changed')).toHaveLength(1)
  })

  it('closes an open item whose review is content-expired', async () => {
    const src = makeSource({ contentExpiresAt: new Date('2026-01-01') })
    const item = makeItem({ sourceId: src.id, status: 'open' })
    const { useCase, repo } = setup({ items: [item], sources: [src] })

    const report = await useCase({ organizationId: ORG, dryRun: false })

    expect(report.closed).toBe(1)
    expect(repo.items[0]!.status).toBe('closed')
  })

  it('leaves an open item alone when its review is live and no reply exists', async () => {
    const src = makeSource()
    const item = makeItem({ sourceId: src.id, status: 'open' })
    const { useCase, repo } = setup({ items: [item], sources: [src] })

    const report = await useCase({ organizationId: ORG, dryRun: false })

    expect(report.closed).toBe(0)
    expect(report.created).toBe(0)
    expect(report.milestones).toBe(0)
    expect(repo.items[0]!.status).toBe('open')
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
    const { useCase, repo, events } = setup({
      items: [item],
      sources: [src],
      milestones,
    })

    const report = await useCase({ organizationId: ORG, dryRun: false })

    expect(report.milestones).toBe(1)
    expect(report.closed).toBe(0)
    expect(repo.items[0]!.firstReplySubmittedAt).toEqual(new Date('2026-06-05'))
    expect(repo.items[0]!.status).toBe('open')
    expect(events.capturedByTag('inbox.inbox_item.status_changed')).toHaveLength(0)
  })

  it('auto-closes an open item with a published reply (with status_changed fact)', async () => {
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
    const { useCase, repo, events } = setup({
      items: [item],
      sources: [src],
      milestones,
    })

    const report = await useCase({ organizationId: ORG, dryRun: false })

    expect(report.closed).toBe(1)
    expect(repo.items[0]!.status).toBe('closed')
    expect(repo.items[0]!.firstReplyPublishedAt).toEqual(new Date('2026-06-06'))
    expect(events.capturedByTag('inbox.inbox_item.status_changed')).toHaveLength(1)
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
    const { useCase, repo, events } = setup({
      items: [item],
      sources: [src],
      milestones,
    })

    const report = await useCase({ organizationId: ORG, dryRun: false })

    expect(report.milestones).toBe(1)
    expect(report.closed).toBe(0)
    expect(repo.items[0]!.firstReplyPublishedAt).toEqual(new Date('2026-06-06'))
    expect(events.capturedByTag('inbox.inbox_item.status_changed')).toHaveLength(0)
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
    const { useCase, repo } = setup({ items: [item], sources: [src] })

    await useCase({ organizationId: ORG, dryRun: false })

    expect(repo.items[0]!.assignedTo).toBe(USER)
    expect(repo.items[0]!.isEscalated).toBe(true)
  })

  it('dryRun reports the same counts but writes nothing', async () => {
    const srcLive = makeSource()
    const missing = makeSource()
    const item = makeItem({ sourceId: srcLive.id, status: 'open' })
    const orphan = makeItem({ status: 'open' })
    const { useCase, repo, events } = setup({
      items: [item, orphan],
      sources: [srcLive, missing],
    })

    const report = await useCase({ organizationId: ORG, dryRun: true })

    expect(report.created).toBe(1)
    expect(report.closed).toBe(1) // orphan — its review is gone
    expect(report.dryRun).toBe(true)
    expect(repo.items).toHaveLength(2)
    expect(repo.items[0]!.status).toBe('open')
    expect(repo.items[1]!.status).toBe('open')
    expect(events.capturedEvents).toHaveLength(0)
  })

  it('is idempotent: a second run reconciles nothing', async () => {
    const src = makeSource()
    const orphan = makeItem({ status: 'open' })
    const { useCase } = setup({ items: [orphan], sources: [src] })

    await useCase({ organizationId: ORG, dryRun: false })
    const second = await useCase({ organizationId: ORG, dryRun: false })

    expect(second.created).toBe(0)
    expect(second.closed).toBe(0)
    expect(second.milestones).toBe(0)
  })

  it('scopes to one property when propertyId is given', async () => {
    const otherProp = propertyId('prop-2')
    const src = makeSource({ propertyId: otherProp })
    const { useCase, repo } = setup({ sources: [src] })

    const report = await useCase({
      organizationId: ORG,
      propertyId: otherProp,
      dryRun: false,
    })

    expect(report.created).toBe(1)
    expect(repo.items[0]!.propertyId).toBe(otherProp)
  })
})
