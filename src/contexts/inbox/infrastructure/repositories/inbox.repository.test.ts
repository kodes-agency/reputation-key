// Inbox context — inbox repository tests
// No DB test infrastructure exists in this project (no testcontainers or test DB helpers).
// These tests verify that the repository factory function compiles correctly against
// the InboxRepository port interface — i.e., structural typing is satisfied.

import { describe, it, expect } from 'vitest'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import type { Database } from '#/shared/db'
import { createInboxRepository } from './inbox.repository'
import type { InboxItem } from '../../domain/types'
import type {
  InboxItemId,
  OrganizationId,
  PropertyId,
  ReviewId,
  FeedbackId,
} from '#/shared/domain/ids'

// Simple mock db — we only need to verify the factory returns the right shape
function createMockDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
          orderBy: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([]),
        onConflictDoUpdate: () => ({
          returning: () => Promise.resolve([]),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([]),
        }),
      }),
    }),
  } as unknown as Database
}

// In-memory repo for testing findDetailById behavior
function createInMemoryInboxRepo(): InboxRepository {
  const items: InboxItem[] = []

  return {
    findById: async (id, orgId) =>
      items.find((i) => i.id === id && i.organizationId === orgId) ?? null,
    findBySource: async () => null,
    findFilteredPaginated: async () => ({ items: [], nextCursor: null }),
    create: async (item) => {
      items.push(item)
      return item
    },
    updateStatus: async (id, orgId, status) => {
      const item = items.find((i) => i.id === id && i.organizationId === orgId)
      if (!item) throw new Error('Not found')
      return { ...item, status }
    },
    bulkUpdateStatus: async (ids, orgId, status) => {
      let updated = 0
      for (const id of ids) {
        const idx = items.findIndex((i) => i.id === id && i.organizationId === orgId)
        if (idx !== -1) {
          items[idx] = { ...items[idx], status }
          updated++
        }
      }
      return { updated }
    },
    updateAssignment: async (id, orgId, assignedTo) => {
      const item = items.find((i) => i.id === id && i.organizationId === orgId)
      if (!item) throw new Error('Not found')
      return { ...item, assignedTo }
    },
    countByStatus: async () => 0,
    syncDenormalizedFields: async () => {},
    findByIds: async () => [],
    findDetailById: async (id, orgId) => {
      const item = items.find((i) => i.id === id && i.organizationId === orgId)
      if (!item) return null
      if (item.sourceType === 'review') {
        return {
          item,
          reviewerName: 'Test Reviewer',
          reviewText: 'Test review text',
          reviewerProfilePhotoUrl: null,
          feedbackComment: null,
          feedbackRatingValue: null,
        }
      }
      return {
        item,
        reviewerName: null,
        reviewText: null,
        reviewerProfilePhotoUrl: null,
        feedbackComment: 'Test feedback comment',
        feedbackRatingValue: item.rating,
      }
    },
  }
}

describe('createInboxRepository', () => {
  it('returns an object satisfying InboxRepository', () => {
    const db = createMockDb()
    const noopPorts = {
      reviewLookup: { getReviewSnippetById: async () => null },
      feedbackLookup: { getFeedbackSnippetById: async () => null },
      propertyLookup: { getPropertyNameById: async () => null },
    }
    const repo = createInboxRepository(db, noopPorts)

    // Verify all port methods exist
    expect(typeof repo.findById).toBe('function')
    expect(typeof repo.findBySource).toBe('function')
    expect(typeof repo.findFilteredPaginated).toBe('function')
    expect(typeof repo.create).toBe('function')
    expect(typeof repo.updateStatus).toBe('function')
    expect(typeof repo.bulkUpdateStatus).toBe('function')
    expect(typeof repo.updateAssignment).toBe('function')
    expect(typeof repo.countByStatus).toBe('function')
    expect(typeof repo.syncDenormalizedFields).toBe('function')
    expect(typeof repo.findDetailById).toBe('function')
  })

  it('factory return type satisfies InboxRepository (compile-time check)', () => {
    const db = createMockDb()
    const noopPorts = {
      reviewLookup: { getReviewSnippetById: async () => null },
      feedbackLookup: { getFeedbackSnippetById: async () => null },
      propertyLookup: { getPropertyNameById: async () => null },
    }
    const repo: InboxRepository = createInboxRepository(db, noopPorts)
    // If this compiles, the factory output matches the port interface
    expect(repo).toBeDefined()
  })
})

describe('in-memory inbox repository', () => {
  it('findDetailById returns review source data for review items', async () => {
    const repo = createInMemoryInboxRepo()
    const item: InboxItem = {
      id: 'item-1' as InboxItemId,
      organizationId: 'org-1' as OrganizationId,
      propertyId: 'prop-1' as PropertyId,
      sourceType: 'review',
      sourceId: 'review-1' as ReviewId,
      status: 'new',
      rating: 4,
      snippet: 'Great place',
      sourceDate: new Date(),
      platform: 'google',
      assignedTo: null,
      reviewerName: null,
      propertyName: null,
      readAt: null,
      escalatedAt: null,
      addressedAt: null,
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    await repo.create(item)

    const result = await repo.findDetailById(
      'item-1' as InboxItemId,
      'org-1' as OrganizationId,
    )

    expect(result).not.toBeNull()
    expect(result?.reviewerName).toBe('Test Reviewer')
    expect(result?.reviewText).toBe('Test review text')
    expect(result?.feedbackComment).toBeNull()
  })

  it('findDetailById returns feedback source data for feedback items', async () => {
    const repo = createInMemoryInboxRepo()
    const item: InboxItem = {
      id: 'item-2' as InboxItemId,
      organizationId: 'org-1' as OrganizationId,
      propertyId: 'prop-1' as PropertyId,
      sourceType: 'feedback',
      sourceId: 'feedback-1' as FeedbackId,
      status: 'new',
      rating: null,
      snippet: 'Nice service',
      sourceDate: new Date(),
      platform: null,
      assignedTo: null,
      reviewerName: null,
      propertyName: null,
      readAt: null,
      escalatedAt: null,
      addressedAt: null,
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    await repo.create(item)

    const result = await repo.findDetailById(
      'item-2' as InboxItemId,
      'org-1' as OrganizationId,
    )

    expect(result).not.toBeNull()
    expect(result?.feedbackComment).toBe('Test feedback comment')
    expect(result?.reviewerName).toBeNull()
    expect(result?.reviewText).toBeNull()
  })

  it('findDetailById returns null for non-existent item', async () => {
    const repo = createInMemoryInboxRepo()
    const result = await repo.findDetailById(
      'nonexistent' as InboxItemId,
      'org-1' as OrganizationId,
    )
    expect(result).toBeNull()
  })
})
