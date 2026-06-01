import { describe, it, expect } from 'vitest'
import { getInboxFolderCounts } from './get-folder-counts'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import { createMockLogger } from '#/shared/testing/mock-logger'
import {
  organizationId,
  inboxItemId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'
import { isInboxError } from '../../domain/errors'
import type { Role } from '#/shared/domain/roles'

// ── Test data factory (typed, no `any`) ─────────────────────────────
const ORG_ID = organizationId('org-1')
const USER_ID = userId('user-1')

const makeItem = ({
  id,
  ...overrides
}: Partial<Omit<InboxItem, 'id'>> & { id: string }): InboxItem =>
  ({
    id: inboxItemId(id),
    organizationId: ORG_ID,
    propertyId: propertyId('prop-1'),
    sourceType: 'review',
    sourceId: reviewId(`source-${id}`),
    status: 'new',
    rating: 4,
    sourceDate: new Date('2025-01-01'),
    platform: null,
    snippet: null,
    assignedTo: null,
    reviewerName: null,
    propertyName: null,
    readAt: null,
    escalatedAt: null,
    addressedAt: null,
    archivedAt: null,
    firstReplySubmittedAt: null,
    firstReplyPublishedAt: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  }) satisfies InboxItem

const setup = () => {
  const repo = createInMemoryInboxRepo()
  const deps = { repo, logger: createMockLogger() }
  const useCase = getInboxFolderCounts(deps)

  return { useCase, repo }
}

describe('getInboxFolderCounts', () => {
  it('returns counts per status with inbox = sum of all and unaddressed = new + read', async () => {
    const { useCase, repo } = setup()

    repo.items.push(
      makeItem({ id: 'ii-1', status: 'new' }),
      makeItem({ id: 'ii-2', status: 'new' }),
      makeItem({ id: 'ii-3', status: 'new' }),
      makeItem({ id: 'ii-4', status: 'read' }),
      makeItem({ id: 'ii-5', status: 'read' }),
      makeItem({ id: 'ii-6', status: 'escalated' }),
      makeItem({ id: 'ii-7', status: 'addressed' }),
      makeItem({ id: 'ii-8', status: 'addressed' }),
      makeItem({ id: 'ii-9', status: 'archived' }),
    )

    const counts = await useCase({
      organizationId: ORG_ID,
      userId: USER_ID,
      role: 'AccountAdmin',
    })

    expect(counts).toEqual({
      inbox: 9,
      unaddressed: 5, // 3 new + 2 read
      escalated: 1,
      addressed: 2,
      archived: 1,
    })
  })

  it('returns all zeros when organization has no items', async () => {
    const { useCase } = setup()

    const counts = await useCase({
      organizationId: ORG_ID,
      userId: USER_ID,
      role: 'AccountAdmin',
    })

    expect(counts).toEqual({
      inbox: 0,
      unaddressed: 0,
      escalated: 0,
      addressed: 0,
      archived: 0,
    })
  })

  it('throws forbidden when role lacks inbox.read permission', async () => {
    const { useCase } = setup()

    // All current domain roles have inbox.read, so we cast a fictional role
    // to verify the permission gate is active and would block an unauthorized role.
    await expect(
      useCase({
        organizationId: ORG_ID,
        userId: USER_ID,
        role: 'Guest' as unknown as Role,
      }),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'forbidden')
  })
})
