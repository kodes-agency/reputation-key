// Real PostgreSQL wiring for Inbox use-case tests: the production repository
// and atomic command store over a seeded organization, plus a reader for the
// outbox facts a command committed.

import { Pool } from 'pg'
import { getDb, type Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { InboxRepository } from '../application/ports/inbox.repository'
import type { InboxCommandStore } from '../application/ports/inbox-command-store.port'
import { createInboxRepository } from './repositories/inbox.repository'
import {
  createAtomicInboxCommandStore,
  type InboxCommandAuthority,
} from './inbox-command-store'

const allowAllCommandAuthority: InboxCommandAuthority = async () => ({ allowed: true })

const silentLogger: LoggerPort = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => silentLogger,
}

export const openFixturePool = (): Pool =>
  new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })

export const createUseCaseInboxRepository = (
  db: Database,
  clock: () => Date,
): InboxRepository =>
  createInboxRepository(
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
    },
    { clock, logger: silentLogger },
  )

export const createUseCaseCommandStore = (
  db: Database,
  clock: () => Date,
): InboxCommandStore => createAtomicInboxCommandStore(db, allowAllCommandAuthority, clock)

export const createUseCaseDatabase = (): Database => getDb()

export type CommittedFact = Readonly<{
  eventType: string
  payload: Record<string, unknown>
}>

export async function readCommittedFacts(
  pool: Pool,
  organizationId: string,
): Promise<ReadonlyArray<CommittedFact>> {
  const result = await pool.query<{
    event_type: string
    payload: Record<string, unknown>
  }>(
    `SELECT event_type, payload FROM outbox_events
     WHERE organization_id = $1 ORDER BY created_at, id`,
    [organizationId],
  )
  return result.rows.map((row) => ({ eventType: row.event_type, payload: row.payload }))
}

export async function clearInboxUseCaseRows(
  pool: Pool,
  organizationId: string,
): Promise<void> {
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [organizationId])
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [
    organizationId,
  ])
}

export async function dropInboxUseCaseOrganization(
  pool: Pool,
  organizationId: string,
): Promise<void> {
  await clearInboxUseCaseRows(pool, organizationId)
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [organizationId])
}
