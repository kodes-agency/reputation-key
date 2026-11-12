// Shared setup for the Inbox use-case tests that run on real PostgreSQL: the
// production repository and atomic command store over stubbed cross-context
// lookups, plus the outbox read and cleanup those tests need.

import type { Pool } from 'pg'
import { getDb } from '#/shared/db'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { AiReviewInsightsPort } from '../application/ports/ai-review-insights.port'
import type { InboxCommandStore } from '../application/ports/inbox-command-store.port'
import type { InboxRepository } from '../application/ports/inbox.repository'
import type { InboxNoteRepository } from '../application/ports/inbox-note.repository'
import type { InboxItem } from '../domain/types'
import { createAtomicInboxCommandStore } from './inbox-command-store'
import { createInboxRepository } from './repositories/inbox.repository'
import { createInboxNoteRepository } from './repositories/inbox-note.repository'
import { seedInboxItem } from './inbox-database-fixtures'

const silentLogger: LoggerPort = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => silentLogger,
}

export type InboxUseCaseDatabase = Readonly<{
  repo: InboxRepository
  commandStore: InboxCommandStore
  noteRepo: InboxNoteRepository
  seed: (...items: InboxItem[]) => Promise<void>
}>

export function createInboxUseCaseDatabase(
  pool: Pool,
  now: () => Date,
  aiInsights?: AiReviewInsightsPort,
): InboxUseCaseDatabase {
  const db = getDb()
  const repo = createInboxRepository(
    db,
    {
      reviewLookup: {
        getReviewSnippetById: async () => ({ status: 'not_found' }),
        getReviewSnippetsByIds: async () => new Map(),
        findEligibleReviewIds: async () => [],
      },
      feedbackLookup: {
        getFeedbackSnippetById: async () => null,
        getFeedbackSnippetsByIds: async () => new Map(),
        findEligibleFeedbackIds: async () => [],
      },
      propertyLookup: {
        getPropertyNameById: async () => null,
        getPropertyNamesByIds: async () => new Map(),
      },
      ...(aiInsights ? { aiInsights } : {}),
    },
    { clock: now, logger: silentLogger },
  )
  return {
    repo,
    commandStore: createAtomicInboxCommandStore(db, async () => ({ allowed: true }), now),
    noteRepo: createInboxNoteRepository(db),
    seed: async (...items) => {
      for (const item of items) await seedInboxItem(pool, db, item, now)
    },
  }
}

/** The level a manager set, written as the command store writes it. */
export async function setStoredManagerPriority(
  pool: Pool,
  id: InboxItem['id'],
  level: 'urgent' | 'high' | 'medium' | 'low',
  setBy: string,
  setAt: Date,
): Promise<void> {
  await pool.query(
    `UPDATE inbox_items
        SET manager_priority = $2, manager_priority_set_by = $3,
            manager_priority_set_at = $4
      WHERE id = $1`,
    [id, level, setBy, setAt],
  )
}

export type StoredOutboxFact = Readonly<{
  eventType: string
  payload: Record<string, unknown>
}>

export async function readOutboxFacts(
  pool: Pool,
  organizationId: string,
): Promise<ReadonlyArray<StoredOutboxFact>> {
  const { rows } = await pool.query<{
    event_type: string
    payload: Record<string, unknown>
  }>(
    `SELECT event_type, payload FROM outbox_events
      WHERE organization_id = $1 ORDER BY created_at, id`,
    [organizationId],
  )
  return rows.map((row) => ({ eventType: row.event_type, payload: row.payload }))
}

export async function clearInboxOrganization(
  pool: Pool,
  organizationId: string,
): Promise<void> {
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [
    organizationId,
  ])
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [organizationId])
}

export async function dropInboxOrganization(
  pool: Pool,
  organizationId: string,
): Promise<void> {
  await clearInboxOrganization(pool, organizationId)
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [organizationId])
}
