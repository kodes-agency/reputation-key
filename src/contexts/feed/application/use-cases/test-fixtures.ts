// Shared test fixtures for the insert-notification use case: the use case's
// deps over a real database, with doubles only for the edges Feed does not own.

import { randomUUID } from 'node:crypto'
import { vi } from 'vitest'
import type { InsertNotificationDeps } from './insert-notification'
import { notificationId, notificationEmailId } from '#/shared/domain/ids'

const FIXED_DATE = new Date('2026-06-10T10:00:00Z')

/**
 * {@link InsertNotificationDeps} writing to `db`. Ids are fresh UUIDs, the
 * clock is fixed, and the rating lookup, immediate-email enqueue and logger
 * are doubles.
 */
export function buildInsertNotificationDeps(
  db: InsertNotificationDeps['db'],
): InsertNotificationDeps {
  return {
    db,
    clock: () => FIXED_DATE,
    idGen: () => notificationId(randomUUID()),
    emailIdGen: () => notificationEmailId(randomUUID()),
    enqueueImmediateEmail: vi.fn(async () => {}),
    ratingForRouting: vi.fn(async () => null),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
  }
}
