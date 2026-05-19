import { describe, it, expect } from 'vitest'
import { getInboxItems } from './get-inbox-items'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  feedbackId,
} from '#/shared/domain/ids'
import type { InboxItem, InboxStatus, SourceType } from '../../domain/types'

const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const ORG_ID = organizationId('org-1')
const OTHER_ORG_ID = organizationId('org-2')
const PROP_ID = propertyId('prop-1')
const OTHER_PROP_ID = propertyId('prop-2')

function seedItem(overrides: Partial<InboxItem> & { id: string }): InboxItem {
  return {
    id: inboxItemId(overrides.id),
    organizationId: ORG_ID,
    propertyId: PROP_ID,
    sourceType: 'review' as SourceType,
    sourceId: reviewId(`rev-${overrides.id}`),
    status: 'new' as InboxStatus,
    rating: 4,
    sourceDate: new Date('2026-04-10'),
    platform: 'google',
    snippet: 'Great!',
    assignedTo: null,
    readAt: null,
    escalatedAt: null,
    addressedAt: null,
    archivedAt: null,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    ...overrides,
  }
}

const setup = () => {
  const repo = createInMemoryInboxRepo()
  const deps = { repo }
  const useCase = getInboxItems(deps)
  return { useCase, repo }
}

describe('getInboxItems', () => {
  it('returns paginated items for an organization', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem({ id: 'ii-1' }))
    repo.items.push(seedItem({ id: 'ii-2' }))

    const result = await useCase({
      organizationId: ORG_ID,
      filters: {},
    })

    expect(result.items).toHaveLength(2)
    expect(result.nextCursor).toBeDefined()
  })

  it('filters by status', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem({ id: 'ii-1', status: 'new' }))
    repo.items.push(seedItem({ id: 'ii-2', status: 'read' }))

    const result = await useCase({
      organizationId: ORG_ID,
      filters: { status: 'new' },
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0].status).toBe('new')
  })

  it('filters by sourceType', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem({ id: 'ii-1', sourceType: 'review' }))
    repo.items.push(
      seedItem({ id: 'ii-2', sourceType: 'feedback', sourceId: feedbackId('fb-ii-2') }),
    )

    const result = await useCase({
      organizationId: ORG_ID,
      filters: { sourceType: 'feedback' },
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0].sourceType).toBe('feedback')
  })

  it('filters by propertyId', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem({ id: 'ii-1', propertyId: PROP_ID }))
    repo.items.push(seedItem({ id: 'ii-2', propertyId: OTHER_PROP_ID }))

    const result = await useCase({
      organizationId: ORG_ID,
      filters: { propertyId: PROP_ID },
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0].propertyId).toBe(PROP_ID)
  })

  it('does not return items from other organizations', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem({ id: 'ii-1', organizationId: ORG_ID }))
    repo.items.push(seedItem({ id: 'ii-2', organizationId: OTHER_ORG_ID }))

    const result = await useCase({
      organizationId: ORG_ID,
      filters: {},
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0].id).toBe(inboxItemId('ii-1'))
  })

  it('respects limit for pagination', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedItem({ id: 'ii-1', sourceDate: new Date('2026-04-12') }))
    repo.items.push(seedItem({ id: 'ii-2', sourceDate: new Date('2026-04-11') }))
    repo.items.push(seedItem({ id: 'ii-3', sourceDate: new Date('2026-04-10') }))

    const result = await useCase({
      organizationId: ORG_ID,
      filters: {},
      limit: 2,
    })

    expect(result.items).toHaveLength(2)
    expect(result.nextCursor).toBeDefined()
  })

  it('uses cursor for pagination', async () => {
    const { useCase, repo } = setup()
    const item1 = seedItem({ id: 'ii-1', sourceDate: new Date('2026-04-12') })
    const item2 = seedItem({ id: 'ii-2', sourceDate: new Date('2026-04-11') })
    const item3 = seedItem({ id: 'ii-3', sourceDate: new Date('2026-04-10') })
    repo.items.push(item1, item2, item3)

    // First page
    const page1 = await useCase({
      organizationId: ORG_ID,
      filters: {},
      limit: 1,
    })

    expect(page1.items).toHaveLength(1)
    expect(page1.nextCursor).toBeDefined()

    // Second page using cursor
    const page2 = await useCase({
      organizationId: ORG_ID,
      filters: {},
      cursor: page1.nextCursor!,
      limit: 1,
    })

    expect(page2.items).toHaveLength(1)
    expect(page2.items[0].id).not.toBe(page1.items[0].id)
  })
})
