// Inbox context — inbox repository tests
// No DB test infrastructure exists in this project (no testcontainers or test DB helpers).
// These tests verify that the repository factory function compiles correctly against
// the InboxRepository port interface — i.e., structural typing is satisfied.

import { describe, it, expect } from 'vitest'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import type { Database } from '#/shared/db'
import { createInboxRepository } from './inbox.repository'

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

describe('createInboxRepository', () => {
  it('returns an object satisfying InboxRepository', () => {
    const db = createMockDb()
    const repo = createInboxRepository(db)

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
    const repo: InboxRepository = createInboxRepository(db)
    // If this compiles, the factory output matches the port interface
    expect(repo).toBeDefined()
  })
})
