// Portal command store — shared guards for the command modules.
// Split out of portal-command-store.ts (round 4 F3).

import { portalError } from '../domain/errors'

export const sameInstant = (left: Date, right: Date): boolean =>
  left.getTime() === right.getTime()

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
