import { describe, it, expect } from 'vitest'
import { createInboxItem as createInboxItemUseCase } from './create-inbox-item'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { isInboxError } from '../../domain/errors'
import { inboxItemId, organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import type { SourceType } from '../../domain/types'

const FIXED_ID = inboxItemId('ii-1')
const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const ORG_ID = organizationId('org-1')
const PROP_ID = propertyId('prop-1')

const setup = () => {
  const repo = createInMemoryInboxRepo()
  const events = createCapturingEventBus()
  const increments = { count: 0, keys: [] as string[] }
  const newCounter = {
    getCount: async () => 0,
    setCount: async () => {},
    increment: async (orgId: string) => {
      increments.count++
      increments.keys.push(orgId)
    },
    decrement: async () => {},
    decrementBy: async () => {},
    invalidate: async () => {},
  }
  const deps = {
    repo,
    events,
    newCounter,
    idGen: () => FIXED_ID,
    clock: () => FIXED_TIME,
    logger: createMockLogger(),
  }
  const useCase = createInboxItemUseCase(deps)
  return { useCase, repo, events, increments }
}

describe('createInboxItem', () => {
  it('creates an inbox item and persists it', async () => {
    const { useCase, repo } = setup()

    const item = await useCase({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      sourceType: 'review' as SourceType,
      sourceId: reviewId('rev-1'),
      rating: 4,
      sourceDate: new Date('2026-04-10'),
      platform: 'google',
      snippet: 'Great stay!',
      reviewerName: null,
    })

    expect(item.id).toBe(FIXED_ID)
    expect(item.status).toBe('new')
    expect(item.rating).toBe(4)
    expect(item.platform).toBe('google')
    expect(item.snippet).toBe('Great stay!')
    expect(repo.items).toHaveLength(1)
  })

  it('emits inbox.item.created event', async () => {
    const { useCase, events } = setup()

    await useCase({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      sourceType: 'review' as SourceType,
      sourceId: reviewId('rev-1'),
      rating: 5,
      sourceDate: new Date('2026-04-10'),
      platform: null,
      snippet: null,
      reviewerName: null,
    })

    const emitted = events.capturedEvents
    expect(emitted).toHaveLength(1)
    expect(emitted[0]._tag).toBe('inbox.inbox_item.created')
  })

  it('throws already_exists for duplicate source', async () => {
    const { useCase } = setup()

    const input = {
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      sourceType: 'review' as SourceType,
      sourceId: reviewId('rev-1'),
      rating: 3,
      sourceDate: new Date('2026-04-10'),
      platform: 'google',
      snippet: 'OK',
      reviewerName: null,
    }

    await useCase(input)

    await expect(useCase(input)).rejects.toSatisfy(
      (e: unknown) => isInboxError(e) && e.code === 'already_exists',
    )
  })

  it('increments new counter on creation', async () => {
    const { useCase, increments } = setup()

    await useCase({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      sourceType: 'review' as SourceType,
      sourceId: reviewId('rev-1'),
      rating: 4,
      sourceDate: new Date('2026-04-10'),
      platform: 'google',
      snippet: 'test',
      reviewerName: null,
    })

    expect(increments.count).toBe(1)
  })
})
