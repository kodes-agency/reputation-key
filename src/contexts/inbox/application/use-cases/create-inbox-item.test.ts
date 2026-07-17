import { describe, it, expect } from 'vitest'
import { createInboxItem as createInboxItemUseCase } from './create-inbox-item'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
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
  const deps = {
    repo,
    events,
    idGen: () => FIXED_ID,
    clock: () => FIXED_TIME,
  }
  const useCase = createInboxItemUseCase(deps)
  return { useCase, repo, events }
}

describe('createInboxItem', () => {
  it('creates an inbox item and persists it', async () => {
    const { useCase, repo } = setup()

    const item = await useCase({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      sourceType: 'review' as SourceType,
      sourceId: reviewId('rev-1'),
      sourceDate: new Date('2026-04-10'),
      platform: 'google',
    })

    expect(item.id).toBe(FIXED_ID)
    expect(item.status).toBe('open')
    // BQC-1.2: raw source content is never stored — always null.
    expect(item.rating).toBeNull()
    expect(item.platform).toBe('google')
    expect(item.snippet).toBeNull()
    expect(item.reviewerName).toBeNull()
    expect(repo.items).toHaveLength(1)
  })

  it('emits inbox.item.created event', async () => {
    const { useCase, events } = setup()

    await useCase({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      sourceType: 'review' as SourceType,
      sourceId: reviewId('rev-1'),
      sourceDate: new Date('2026-04-10'),
      platform: null,
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
      sourceDate: new Date('2026-04-10'),
      platform: 'google',
    }

    await useCase(input)

    await expect(useCase(input)).rejects.toSatisfy(
      (e: unknown) => isInboxError(e) && e.code === 'already_exists',
    )
  })
})
