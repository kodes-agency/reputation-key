import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { properties } from '#/shared/db/schema/property.schema'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import { propertyError } from '../domain/errors'
import { assertValidTransition } from '../domain/property-lifecycle'
import type {
  PropertyLifecycleCommandStore,
  PropertyLifecycleTransitionCommand,
} from '../application/ports/property-lifecycle-command-store.port'
import { propertyFromRow } from './mappers/property.mapper'

const assertCommandIntegrity = (command: PropertyLifecycleTransitionCommand): void => {
  assertValidTransition(command.from, command.to)
  if (
    command.nextSourceEpoch !== command.expectedSourceEpoch + 1 ||
    command.event.organizationId !== command.organizationId ||
    command.event.propertyId !== command.propertyId ||
    command.event.sourceEpoch !== command.nextSourceEpoch ||
    command.event.userId !== command.initiatedBy ||
    command.event.occurredAt.getTime() !== command.occurredAt.getTime() ||
    (command.to === 'archived' &&
      (command.event._tag !== 'property.archived' ||
        command.recoveryDeadline === null ||
        command.event.recoveryDeadline.getTime() !==
          command.recoveryDeadline.getTime())) ||
    (command.to === 'active' && command.event._tag !== 'property.restored') ||
    command.event.previousState !== command.from
  ) {
    throw propertyError('stale_property', 'Property lifecycle command is inconsistent')
  }
  if (
    (command.to === 'archived' &&
      (command.reason === null ||
        command.recoveryDeadline === null ||
        command.recoveryDeadline.getTime() <= command.occurredAt.getTime())) ||
    (command.to === 'active' &&
      (command.reason !== null || command.recoveryDeadline !== null))
  ) {
    throw propertyError('invalid_transition', 'Property lifecycle metadata is invalid')
  }
}

/**
 * Property lifecycle mutation authority. The stable Property row is updated
 * in place; no dependent row or provider identity is erased here.
 */
export const createPropertyLifecycleCommandStore = (
  db: Database,
): PropertyLifecycleCommandStore => ({
  transitionLifecycle: (command) =>
    trace('property.lifecycle.transition', async () => {
      assertCommandIntegrity(command)
      const updated = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(properties)
          .where(
            and(
              eq(properties.organizationId, command.organizationId),
              eq(properties.id, command.propertyId),
              isNull(properties.deletedAt),
            ),
          )
          .for('update')
          .limit(1)
        if (!current) throw propertyError('property_not_found', 'property not found')
        if (
          current.lifecycleState !== command.from ||
          current.sourceEpoch !== command.expectedSourceEpoch ||
          current.profileVersion !== command.expectedProfileVersion
        ) {
          throw propertyError(
            'stale_property',
            'Property changed while its lifecycle transition was being committed',
          )
        }

        const nextDestinationState =
          current.googleReviewDestinationState === 'verified' ||
          current.googleReviewDestinationState === 'awaiting_refresh'
            ? 'awaiting_refresh'
            : 'unavailable'
        const [row] = await tx
          .update(properties)
          .set({
            lifecycleState: command.to,
            lifecycleReason: command.reason,
            lifecycleStateChangedAt: command.occurredAt,
            purgeScheduledFor: command.recoveryDeadline,
            lifecycleInitiatedBy: command.initiatedBy,
            sourceEpoch: command.nextSourceEpoch,
            googleReviewDestinationState: nextDestinationState,
            updatedAt: command.occurredAt,
          })
          .where(
            and(
              eq(properties.organizationId, command.organizationId),
              eq(properties.id, command.propertyId),
              isNull(properties.deletedAt),
              eq(properties.lifecycleState, command.from),
              eq(properties.sourceEpoch, command.expectedSourceEpoch),
              eq(properties.profileVersion, command.expectedProfileVersion),
            ),
          )
          .returning()
        if (!row) {
          throw propertyError(
            'stale_property',
            'Property changed while its lifecycle transition was being committed',
          )
        }
        await insertOutboxRow(tx, command.event)
        return row
      })
      return propertyFromRow(updated)
    }),
})
