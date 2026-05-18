// Inbox context — inbox note repository tests
// No DB test infrastructure exists in this project (no testcontainers or test DB helpers).
// These tests verify that the repository factory function compiles correctly against
// the InboxNoteRepository port interface — i.e., structural typing is satisfied.

import { describe, it, expect } from 'vitest'
import type { InboxNoteRepository } from '../../application/ports/inbox-note.repository'
import type { Database } from '#/shared/db'
import { createInboxNoteRepository } from './inbox-note.repository'

function createMockDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve([]),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([]),
      }),
    }),
  } as unknown as Database
}

describe('createInboxNoteRepository', () => {
  it('returns an object satisfying InboxNoteRepository', () => {
    const db = createMockDb()
    const repo = createInboxNoteRepository(db)

    expect(typeof repo.findByInboxItemId).toBe('function')
    expect(typeof repo.create).toBe('function')
  })

  it('factory return type satisfies InboxNoteRepository (compile-time check)', () => {
    const db = createMockDb()
    const repo: InboxNoteRepository = createInboxNoteRepository(db)
    // If this compiles, the factory output matches the port interface
    expect(repo).toBeDefined()
  })
})
