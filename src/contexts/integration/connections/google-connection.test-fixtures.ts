// Real PostgreSQL stand-ins for the Google connection and outbox helpers that
// tests used to get from in-memory fakes. The repository is the production one;
// `seed` and `all` are test-only conveniences on top of it.

import { asc, eq, inArray } from 'drizzle-orm'
import type { Clock } from '#/shared/domain/clock'
import type { GoogleConnectionRepository } from '#/contexts/integration/application/ports/google-connection.repository'
import { googleConnectionFromRow } from '#/contexts/integration/infrastructure/mappers/google-connection.mapper'
import { createGoogleConnectionRepository } from '#/contexts/integration/infrastructure/repositories/google-connection.repository'
import type { GoogleConnection } from '#/contexts/integration/domain/types'
import type { Database } from '#/shared/db'
import { googleConnections, outboxEvents } from '#/shared/db/schema'

export type GoogleConnectionTestStore = GoogleConnectionRepository &
  Readonly<{
    seed: (connections: ReadonlyArray<GoogleConnection>) => Promise<void>
    /** Stands in for a commit another replica makes while a use case is in flight. */
    replace: (connection: GoogleConnection) => Promise<void>
    all: () => Promise<ReadonlyArray<GoogleConnection>>
  }>

export const createGoogleConnectionTestStore = (
  db: Database,
  clock: Clock,
  organizationIds: ReadonlyArray<string>,
): GoogleConnectionTestStore => {
  const repository = createGoogleConnectionRepository(db, clock)
  return {
    ...repository,
    seed: async (connections) => {
      for (const connection of connections) await repository.insert(connection)
    },
    replace: async (connection) => {
      await db.delete(googleConnections).where(eq(googleConnections.id, connection.id))
      await repository.insert(connection)
    },
    all: async () =>
      (
        await db
          .select()
          .from(googleConnections)
          .where(inArray(googleConnections.organizationId, [...organizationIds]))
          .orderBy(asc(googleConnections.createdAt), asc(googleConnections.id))
      ).map(googleConnectionFromRow),
  }
}

export type OutboxFact = Readonly<{ _tag: string } & Record<string, unknown>>

export type OutboxReader = Readonly<{
  facts: () => Promise<ReadonlyArray<OutboxFact>>
  byTag: (tag: string) => Promise<ReadonlyArray<OutboxFact>>
}>

// Reads the facts the commit transactions wrote, in commit order. A fact
// exists exactly when its outbox row does.
export const createOutboxReader = (
  db: Database,
  organizationIds: ReadonlyArray<string>,
): OutboxReader => {
  const facts = async () =>
    (
      await db
        .select({ eventType: outboxEvents.eventType, payload: outboxEvents.payload })
        .from(outboxEvents)
        .where(inArray(outboxEvents.organizationId, [...organizationIds]))
        .orderBy(asc(outboxEvents.createdAt), asc(outboxEvents.id))
    ).map(({ eventType, payload }) => ({
      ...(payload as Record<string, unknown>),
      _tag: eventType,
    }))
  return {
    facts,
    byTag: async (tag) => (await facts()).filter((fact) => fact._tag === tag),
  }
}
