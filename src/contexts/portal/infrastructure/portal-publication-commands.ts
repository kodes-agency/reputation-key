// Portal command store — the publication writes: the rows of a snapshot and its
// activation, the check that a snapshot says what the committed working copy
// says, and "publish changes while live" (republish). Split out of
// portal-command-store.ts (round 4 F9), which keeps publish, rollback and
// deactivate inside `updatePortal` because those are Portal state changes.
//
// Republish is not one: the Portal stays Published, so it has its own command
// instead of a mutation kind on `updatePortal`. It takes the same locks in the
// same order as publishing (ADR 0060: the Property publication fence first,
// then the Portal row, then the working-copy tables).

import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portals,
  portalPublicationActivations,
  portalPublicationSnapshots,
} from '#/shared/db/schema'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import { unbrand } from '#/shared/domain/ids'
import type {
  PortalCommandStore,
  RepublishPortalCommand,
} from '../application/ports/portal-command-store.port'
import type {
  PortalPublicationActivation,
  PortalPublicationSnapshot,
} from '../domain/portal-publication-snapshot'
import { portalError } from '../domain/errors'
import { workingCopyMatchesSnapshot } from '../application/portal-working-copy-match'
import { verifyPortalPublicationSnapshot } from '../application/portal-publication-snapshot'
import { snapshotMirrorColumns } from './mappers/portal-publication-snapshot.mapper'
import { assertCommittedRevision, sameInstant } from './portal-command-guards'
import { lockPortalPublicationProperty } from './portal-publication-serialization'
import { resolvePortalPendingContentChanges } from './portal-pending-content-changes'
import {
  lockPortalWorkingCopyTables,
  readPortalWorkingCopy,
} from './portal-working-copy.reader'

export type PortalPublicationCommandStore = Pick<PortalCommandStore, 'republishPortal'>

/** The Portal a publication write is about. Every command that publishes carries it. */
type PublicationScope = Pick<
  RepublishPortalCommand,
  'organizationId' | 'propertyId' | 'portalId'
>

export function snapshotToRow(snapshot: PortalPublicationSnapshot) {
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    propertyId: snapshot.propertyId,
    portalId: snapshot.portalId,
    version: snapshot.version,
    configurationDigest: snapshot.configurationDigest,
    configuration: snapshot.configuration,
    guestLocale: snapshot.configuration.guestLocale,
    languagePackVersion: snapshot.configuration.languagePackVersion,
    ...snapshotMirrorColumns(snapshot.configuration),
    privateFeedbackThreshold:
      snapshot.configuration.reviewGateway.privateFeedbackThreshold,
    destinationUri: snapshot.destinationUri,
    destinationRetrievedAt: snapshot.destinationRetrievedAt,
    destinationSourceEpoch: snapshot.destinationSourceEpoch,
    destinationProfileVersion: snapshot.destinationProfileVersion,
    createdBy: snapshot.createdBy,
    createdAt: snapshot.createdAt,
  } satisfies typeof portalPublicationSnapshots.$inferInsert
}

export function activationToRow(activation: PortalPublicationActivation) {
  return {
    id: activation.id,
    organizationId: activation.organizationId,
    propertyId: activation.propertyId,
    portalId: activation.portalId,
    snapshotId: activation.snapshotId,
    activationSequence: activation.activationSequence,
    kind: activation.kind,
    activatedBy: activation.activatedBy,
    activatedAt: activation.activatedAt,
    deactivatedAt: activation.deactivatedAt,
    deactivationReason: activation.deactivationReason,
  } satisfies typeof portalPublicationActivations.$inferInsert
}

/** Closes the Portal's live activation, if it has one, and says how many it closed. */
export async function closeActivePublication(
  tx: Tx,
  command: PublicationScope & Readonly<{ occurredAt: Date }>,
  reason: 'disabled' | 'archived' | 'replaced',
): Promise<number> {
  const closed = await tx
    .update(portalPublicationActivations)
    .set({
      deactivatedAt: command.occurredAt,
      deactivationReason: reason,
    })
    .where(
      and(
        eq(portalPublicationActivations.organizationId, unbrand(command.organizationId)),
        eq(portalPublicationActivations.propertyId, unbrand(command.propertyId)),
        eq(portalPublicationActivations.portalId, unbrand(command.portalId)),
        isNull(portalPublicationActivations.deactivatedAt),
      ),
    )
    .returning({ id: portalPublicationActivations.id })
  return closed.length
}

/**
 * The snapshot about to be inserted must say exactly what the committed working
 * rows say. The rows are read by the same reader that built the snapshot, so a
 * difference means content moved between the read and this commit.
 */
export async function assertSnapshotMatchesCommittedWorkingCopy(
  tx: Tx,
  scope: PublicationScope,
  snapshot: PortalPublicationSnapshot,
): Promise<void> {
  const committed = await readPortalWorkingCopy(tx, {
    organizationId: unbrand(scope.organizationId),
    propertyId: unbrand(scope.propertyId),
    portalId: unbrand(scope.portalId),
  })
  if (!committed) {
    throw portalError(
      'publication_snapshot_unavailable',
      'Portal working copy disappeared while its publication snapshot was being committed',
    )
  }
  if (!workingCopyMatchesSnapshot(committed, snapshot)) {
    throw portalError(
      'revision_conflict',
      'Portal content changed while the publication snapshot was being committed',
    )
  }
}

/** The snapshot and its activation belong to this Portal and to each other. */
function assertRepublishActivation(command: RepublishPortalCommand): void {
  const { snapshot, activation } = command
  if (
    snapshot.organizationId !== unbrand(command.organizationId) ||
    snapshot.propertyId !== unbrand(command.propertyId) ||
    snapshot.portalId !== unbrand(command.portalId) ||
    activation.organizationId !== snapshot.organizationId ||
    activation.propertyId !== snapshot.propertyId ||
    activation.portalId !== snapshot.portalId ||
    activation.snapshotId !== snapshot.id ||
    activation.kind !== 'publish' ||
    // A republish replaces an activation, so it is never the first.
    activation.activationSequence < 2 ||
    activation.deactivatedAt !== null ||
    activation.deactivationReason !== null ||
    activation.activatedBy !== snapshot.createdBy ||
    !verifyPortalPublicationSnapshot(snapshot) ||
    !sameInstant(snapshot.createdAt, command.occurredAt) ||
    !sameInstant(activation.activatedAt, command.occurredAt)
  ) {
    throw portalError(
      'publication_snapshot_unavailable',
      'Republication snapshot, activation, and Portal do not share one scope',
    )
  }
}

/** Both facts name this Portal at this revision, and the publication fact quotes this snapshot. */
function assertRepublishFacts(command: RepublishPortalCommand): void {
  const version = command.revision.toISOString()
  const { event, lifecycleEvent, snapshot } = command
  const inScope = (fact: Readonly<PublicationScope>) =>
    fact.organizationId === command.organizationId &&
    fact.propertyId === command.propertyId &&
    fact.portalId === command.portalId
  if (
    !inScope(event) ||
    event.previousPublicationState !== 'published' ||
    event.publicationState !== 'published' ||
    event.sourceAggregateVersion !== version ||
    !sameInstant(event.occurredAt, command.occurredAt) ||
    !inScope(lifecycleEvent) ||
    lifecycleEvent.sourceAggregateVersion !== version ||
    !sameInstant(lifecycleEvent.occurredAt, command.occurredAt) ||
    lifecycleEvent.userId !== command.actorUserId ||
    String(lifecycleEvent.userId) !== snapshot.createdBy ||
    lifecycleEvent.publicationSnapshotId !== snapshot.id ||
    lifecycleEvent.publicationVersion !== snapshot.version ||
    lifecycleEvent.publicationDigest !== snapshot.configurationDigest
  ) {
    throw portalError(
      'forbidden',
      'Portal publication facts do not match the republished snapshot',
    )
  }
}

function assertRepublishCommand(command: RepublishPortalCommand): void {
  assertRepublishActivation(command)
  assertRepublishFacts(command)
  if (command.revision.getTime() <= command.expectedUpdatedAt.getTime()) {
    throw portalError(
      'revision_conflict',
      'Portal command revision must advance monotonically',
    )
  }
}

export const createPortalPublicationCommands = (
  db: Database,
): PortalPublicationCommandStore => ({
  republishPortal: async (command) =>
    trace('portal.commandStore.republishPortal', async () => {
      assertRepublishCommand(command)
      await db.transaction(async (tx) => {
        await lockPortalPublicationProperty(
          tx,
          unbrand(command.organizationId),
          unbrand(command.propertyId),
        )
        // The Portal must be Published right now: this is a replacement, never
        // a way to take a Portal live.
        const [updated] = await tx
          .update(portals)
          .set({ updatedAt: command.revision })
          .where(
            and(
              eq(portals.organizationId, unbrand(command.organizationId)),
              eq(portals.propertyId, unbrand(command.propertyId)),
              eq(portals.id, unbrand(command.portalId)),
              eq(portals.publicationState, 'published'),
              eq(portals.updatedAt, command.expectedUpdatedAt),
              isNull(portals.deletedAt),
            ),
          )
          .returning({ updatedAt: portals.updatedAt })
        assertCommittedRevision(
          updated,
          command.revision,
          'Portal',
          'Portal changed while its changes were being published',
        )
        // The Portal row is locked; the working-copy tables come second, then
        // the comparison reads the rows.
        await lockPortalWorkingCopyTables(tx)
        await assertSnapshotMatchesCommittedWorkingCopy(tx, command, command.snapshot)
        const closed = await closeActivePublication(tx, command, 'replaced')
        if (closed !== 1) {
          throw portalError(
            'revision_conflict',
            'Republishing requires exactly one live Portal publication',
          )
        }
        await tx
          .insert(portalPublicationSnapshots)
          .values(snapshotToRow(command.snapshot))
        await tx
          .insert(portalPublicationActivations)
          .values(activationToRow(command.activation))
        await resolvePortalPendingContentChanges(tx, {
          organizationId: unbrand(command.organizationId),
          propertyId: unbrand(command.propertyId),
          portalId: unbrand(command.portalId),
          snapshotId: command.snapshot.id,
          resolvedAt: command.occurredAt,
        })
        await insertOutboxRow(tx, command.event, {
          recordedAt: command.event.occurredAt,
        })
        await insertOutboxRow(tx, command.lifecycleEvent, {
          recordedAt: command.lifecycleEvent.occurredAt,
        })
      })
    }),
})
