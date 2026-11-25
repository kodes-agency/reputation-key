// Portal command store — shared guards for the command modules.
// Split out of portal-command-store.ts (round 4 F3).

import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portals } from '#/shared/db/schema'
import { unbrand } from '#/shared/domain/ids'
import { portalError } from '../domain/errors'

export const sameInstant = (left: Date, right: Date): boolean =>
  left.getTime() === right.getTime()

/** A durable fact carries the command's revision as its aggregate version and its instant. */
export const isFactAt = (
  fact: Readonly<{ sourceAggregateVersion: string; occurredAt: Date }>,
  revision: Date,
  occurredAt: Date,
): boolean =>
  fact.sourceAggregateVersion === revision.toISOString() &&
  sameInstant(fact.occurredAt, occurredAt)

export function assertRevisionAdvances(
  revision: Date,
  expected: Date,
  aggregate: 'Portal' | 'Portal Group',
): void {
  if (revision.getTime() <= expected.getTime()) {
    throw portalError(
      'revision_conflict',
      `${aggregate} command revision must advance monotonically`,
    )
  }
}

export function assertCommittedRevision(
  persisted: Readonly<{ updatedAt: Date }> | undefined,
  expected: Date,
  aggregate: 'Portal' | 'Portal Group',
  conflictMessage: string,
): void {
  if (!persisted) {
    throw portalError('revision_conflict', conflictMessage)
  }
  if (!sameInstant(persisted.updatedAt, expected)) {
    throw portalError(
      'revision_conflict',
      `${aggregate} database revision diverged from its durable fact version`,
    )
  }
}

type PortalRowScope = Readonly<{
  organizationId: Parameters<typeof unbrand>[0]
  propertyId: Parameters<typeof unbrand>[0]
  portalId: Parameters<typeof unbrand>[0]
}>

/**
 * Move a live Portal row from the revision the command read to the command's
 * revision, optionally requiring a publication state, and refuse when another
 * writer got there first.
 */
export async function casPortalRow(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  scope: PortalRowScope,
  revision: Readonly<{ expected: Date; next: Date }>,
  change: Readonly<{
    set?: Partial<typeof portals.$inferInsert>
    state?: typeof portals.$inferSelect.publicationState
    conflictMessage: string
  }>,
) {
  const [updated] = await tx
    .update(portals)
    .set({ ...change.set, updatedAt: revision.next })
    .where(
      and(
        eq(portals.organizationId, unbrand(scope.organizationId)),
        eq(portals.propertyId, unbrand(scope.propertyId)),
        eq(portals.id, unbrand(scope.portalId)),
        change.state ? eq(portals.publicationState, change.state) : undefined,
        eq(portals.updatedAt, revision.expected),
        isNull(portals.deletedAt),
      ),
    )
    .returning({
      updatedAt: portals.updatedAt,
      publicationState: portals.publicationState,
    })
  assertCommittedRevision(updated, revision.next, 'Portal', change.conflictMessage)
  return updated
}
