// Shared test fixtures for the notification job handlers (digest + urgent-email).
// Both jobs build the same mocked repository/lookup/sender/logger fakes inside
// their createFakeDeps(); extracting them removes the cross-file duplication.
// Mirrors the shared `buildTestX(overrides)` convention.

import { vi } from 'vitest'
import type { Mock } from 'vitest'
import type { LoggerPort } from '#/shared/domain/logger.port'

export type FakeEmailRepo = {
  insert: Mock
  findById: Mock
  findPendingByOrg: Mock
  markSent: Mock
  markFailed: Mock
  markSkipped: Mock
}

export function createFakeEmailRepo(): FakeEmailRepo {
  return {
    insert: vi.fn(),
    findById: vi.fn(),
    findPendingByOrg: vi.fn(),
    markSent: vi.fn(),
    markFailed: vi.fn(),
    markSkipped: vi.fn(),
  }
}

// Includes `findByIds` (used by the digest job); the urgent job never calls it,
// but sharing the same shape removes the duplication entirely.
export type FakeNotifRepo = {
  insert: Mock
  findById: Mock
  findByIds: Mock
  findUnreadByUser: Mock
  countUnreadByUser: Mock
  findByUser: Mock
  markRead: Mock
  markAllRead: Mock
}

export function createFakeNotifRepo(): FakeNotifRepo {
  return {
    insert: vi.fn(),
    findById: vi.fn(),
    findByIds: vi.fn(),
    findUnreadByUser: vi.fn(),
    countUnreadByUser: vi.fn(),
    findByUser: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
  }
}

export type FakeUserLookup = {
  findByRole: Mock
  findAssignedManagers: Mock
  getEmail: Mock
  getName: Mock
}

export function createFakeUserLookup(): FakeUserLookup {
  return {
    findByRole: vi.fn(),
    findAssignedManagers: vi.fn(),
    getEmail: vi.fn(),
    getName: vi.fn(),
  }
}

export type FakeEmailSender = {
  send: Mock
}

export function createFakeEmailSender(): FakeEmailSender {
  return { send: vi.fn() }
}

export type FakeJobLogger = LoggerPort

export function createFakeJobLogger(): FakeJobLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as LoggerPort
}
