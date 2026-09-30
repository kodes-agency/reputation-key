// Atomic Portal command store (ARC-01).
//
// Portal state, responsibility/token side effects, and every required durable
// lifecycle fact commit together in one PostgreSQL transaction.

import { and, eq, isNull, or } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portalResponsibleManagers,
  portalHealthIntervals,
  portals,
  portalTokens,
  portalPublicationActivations,
  portalPublicationSnapshots,
} from '#/shared/db/schema'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { lockPortalPublicationProperty } from './portal-publication-serialization'
import {
  recordPortalPendingContentChange,
  resolvePortalPendingContentChanges,
} from './portal-pending-content-changes'
import { trace } from '#/shared/observability/trace'
import { unbrand } from '#/shared/domain/ids'
import type {
  CreatePortalCommand,
  DeletePortalCommand,
  PortalCommandStore,
  PortalPublicationMutation,
  PortalSemanticLifecycleEvent,
  UpdatePortalCommand,
} from '../application/ports/portal-command-store.port'
import type { Portal, PortalTheme } from '../domain/types'
import { portalError } from '../domain/errors'
import {
  lockPortalWorkingCopyTables,
  readPortalWorkingCopy,
} from './portal-working-copy.reader'
import { workingCopyMatchesSnapshot } from '../application/portal-working-copy-match'
import { snapshotMirrorColumns } from './mappers/portal-publication-snapshot.mapper'
import { portalToRow } from './mappers/portal.mapper'
import { verifyPortalPublicationSnapshot } from '../application/portal-publication-snapshot'
import { assertCommittedRevision, sameInstant } from './portal-command-guards'
import { createPortalGroupCommands } from './portal-group-commands'
import { createPortalLinkCommands } from './portal-link-commands'
import { assertLocaleSetFact, watchPrimaryLocaleChange } from './portal-locale-set'
import { createPortalTokenCommands } from './portal-token-commands'

type PortalSetValues = {
  name?: string
  slug?: string
  description?: string | null
  heroImageUrl?: string | null
  theme?: Record<string, unknown>
  privateFeedbackThreshold?: number
  publicationState?: Portal['publicationState']
  primaryGuestLocale?: Portal['primaryGuestLocale']
  additionalGuestLocales?: Portal['additionalGuestLocales']
  updatedAt?: Date
}

const PORTAL_WORKING_COPY_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'slug',
  'description',
  'heroImageUrl',
  'theme',
  'privateFeedbackThreshold',
  'primaryGuestLocale',
  'additionalGuestLocales',
])

function hasPortalWorkingCopyPatch(patch: UpdatePortalCommand['patch']): boolean {
  return Object.keys(patch).some((key) => PORTAL_WORKING_COPY_FIELDS.has(key))
}

/** The `portal.created` fact must name exactly the Portal being written. */
function matchesPortalCreationScope(command: CreatePortalCommand): boolean {
  const { portal, event } = command
  return (
    portal.organizationId === command.organizationId &&
    event.organizationId === command.organizationId &&
    event.propertyId === portal.propertyId &&
    event.portalId === portal.id &&
    event.publicationState === portal.publicationState &&
    event.sourceAggregateVersion === portal.updatedAt.toISOString() &&
    sameInstant(event.occurredAt, portal.createdAt)
  )
}

/** Initial Health may only assert the Draft posture, pinned to the creation revision. */
function matchesInitialDraftHealth(
  health: NonNullable<CreatePortalCommand['health']>,
  portal: CreatePortalCommand['portal'],
): boolean {
  return (
    health.sourceVersion === portal.updatedAt.toISOString() &&
    sameInstant(health.effectiveAt, portal.createdAt) &&
    health.value.status === 'unavailable' &&
    health.value.reason === 'publication_draft'
  )
}

/** The recovery fact must carry the same scope and revision as the Portal it covers. */
function matchesResponsibilityFactScope(
  fact: NonNullable<CreatePortalCommand['responsibilityNeededEvent']>,
  command: CreatePortalCommand,
): boolean {
  const { portal } = command
  return (
    fact.organizationId === command.organizationId &&
    fact.propertyId === portal.propertyId &&
    fact.portalId === portal.id &&
    fact.sourceAggregateVersion === portal.updatedAt.toISOString() &&
    sameInstant(fact.occurredAt, portal.createdAt)
  )
}

function assertCreateCommand(command: CreatePortalCommand): void {
  const { portal, responsibilityNeededEvent, initialResponsibleManagerId } = command
  if (!matchesPortalCreationScope(command)) {
    throw portalError('forbidden', 'Tenant or resource mismatch on Portal creation')
  }
  const needsResponsibility = initialResponsibleManagerId === null
  if (
    needsResponsibility !== Boolean(responsibilityNeededEvent) ||
    needsResponsibility !== (portal.responsibilityNeededSince !== null)
  ) {
    throw portalError(
      'revision_conflict',
      'Portal responsibility state and recovery fact must be committed together',
    )
  }
  if (command.health && !matchesInitialDraftHealth(command.health, portal)) {
    throw portalError('forbidden', 'Initial Portal Health does not match Draft state')
  }
  if (
    initialResponsibleManagerId !== null &&
    portal.createdBy !== initialResponsibleManagerId
  ) {
    throw portalError(
      'responsible_manager_ineligible',
      'initial responsible manager must be the eligible Portal creator',
    )
  }
  if (
    responsibilityNeededEvent &&
    !matchesResponsibilityFactScope(responsibilityNeededEvent, command)
  ) {
    throw portalError(
      'forbidden',
      'Tenant or resource mismatch on Portal responsibility fact',
    )
  }
}

function buildPortalSetClause(patch: Readonly<Partial<Portal>>): PortalSetValues {
  const set: PortalSetValues = {}
  if (patch.name !== undefined) set.name = patch.name
  if (patch.slug !== undefined) set.slug = patch.slug
  if (patch.description !== undefined) set.description = patch.description
  if (patch.heroImageUrl !== undefined) set.heroImageUrl = patch.heroImageUrl
  if (patch.theme !== undefined)
    set.theme = patch.theme as PortalTheme as Record<string, unknown>
  if (patch.privateFeedbackThreshold !== undefined)
    set.privateFeedbackThreshold = patch.privateFeedbackThreshold
  if (patch.publicationState !== undefined) set.publicationState = patch.publicationState
  if (patch.primaryGuestLocale !== undefined)
    set.primaryGuestLocale = patch.primaryGuestLocale
  if (patch.additionalGuestLocales !== undefined)
    set.additionalGuestLocales = patch.additionalGuestLocales
  return set
}

/** The `portal.updated` fact must name this Portal at this revision, and revisions only advance. */
function assertUpdateScopeAndRevision(command: UpdatePortalCommand): void {
  const nextPublicationState =
    command.patch.publicationState ?? command.event.previousPublicationState
  if (
    command.event.organizationId !== command.organizationId ||
    command.event.propertyId !== command.propertyId ||
    command.event.portalId !== command.portalId ||
    command.event.publicationState !== nextPublicationState ||
    command.event.sourceAggregateVersion !== command.revision.toISOString() ||
    !sameInstant(command.event.occurredAt, command.occurredAt)
  ) {
    throw portalError(
      'forbidden',
      'Tenant, resource, or version mismatch on Portal update',
    )
  }
  if (command.revision.getTime() <= command.expectedUpdatedAt.getTime()) {
    throw portalError(
      'revision_conflict',
      'Portal command revision must advance monotonically',
    )
  }
}

type PortalStateTransition = Readonly<{
  previous: Portal['publicationState']
  next: Portal['publicationState']
}>

/** A publish activation and its immutable snapshot must share the Portal's scope. */
function assertPublishActivation(
  command: UpdatePortalCommand,
  publication: Extract<PortalPublicationMutation, { kind: 'publish' }>,
  transition: PortalStateTransition,
): void {
  const { snapshot, activation } = publication
  if (
    transition.previous === 'published' ||
    transition.next !== 'published' ||
    snapshot.organizationId !== unbrand(command.organizationId) ||
    snapshot.propertyId !== unbrand(command.propertyId) ||
    snapshot.portalId !== unbrand(command.portalId) ||
    activation.organizationId !== snapshot.organizationId ||
    activation.propertyId !== snapshot.propertyId ||
    activation.portalId !== snapshot.portalId ||
    activation.snapshotId !== snapshot.id ||
    activation.deactivatedAt !== null ||
    activation.deactivationReason !== null ||
    activation.activatedBy !== snapshot.createdBy ||
    !verifyPortalPublicationSnapshot(snapshot) ||
    !sameInstant(snapshot.createdAt, command.occurredAt) ||
    !sameInstant(activation.activatedAt, command.occurredAt)
  ) {
    throw portalError(
      'publication_snapshot_unavailable',
      'Publication snapshot, activation, and Portal state do not share one scope',
    )
  }
}

/** A rollback re-activates an earlier snapshot without leaving the Published state. */
function assertRollbackActivation(
  command: UpdatePortalCommand,
  publication: Extract<PortalPublicationMutation, { kind: 'rollback' }>,
  transition: PortalStateTransition,
): void {
  const { activation } = publication
  if (
    transition.previous !== 'published' ||
    transition.next !== 'published' ||
    publication.snapshotId !== activation.snapshotId ||
    publication.snapshotVersion < 1 ||
    !/^[0-9a-f]{64}$/u.test(publication.publicationDigest) ||
    activation.organizationId !== unbrand(command.organizationId) ||
    activation.propertyId !== unbrand(command.propertyId) ||
    activation.portalId !== unbrand(command.portalId) ||
    activation.deactivatedAt !== null ||
    activation.deactivationReason !== null ||
    !sameInstant(activation.activatedAt, command.occurredAt)
  ) {
    throw portalError(
      'publication_snapshot_unavailable',
      'Rollback activation does not match the current Portal scope',
    )
  }
}

/**
 * Both directions of the publication/state coupling: a transition that needs a
 * publication mutation must carry one, and a carried mutation must match the
 * transition it accompanies.
 */
function assertPublicationTransition(command: UpdatePortalCommand): void {
  const previous = command.event.previousPublicationState
  const next = command.event.publicationState
  const transition: PortalStateTransition = { previous, next }
  const publication = command.publication
  if (
    next === 'published' &&
    previous !== 'published' &&
    publication?.kind !== 'publish'
  ) {
    throw portalError(
      'publication_snapshot_unavailable',
      'A new immutable snapshot is required before publishing',
    )
  }
  if (
    previous === 'published' &&
    (next === 'disabled' || next === 'archived') &&
    (publication?.kind !== 'deactivate' || publication.reason !== next)
  ) {
    throw portalError(
      'publication_snapshot_unavailable',
      'The active publication must close with the Portal state transition',
    )
  }
  if (publication?.kind === 'publish') {
    assertPublishActivation(command, publication, transition)
  }
  if (publication?.kind === 'rollback') {
    assertRollbackActivation(command, publication, transition)
  }
  if (
    publication?.kind === 'deactivate' &&
    (!sameInstant(publication.at, command.occurredAt) ||
      previous !== 'published' ||
      next === 'published')
  ) {
    throw portalError(
      'publication_snapshot_unavailable',
      'Publication deactivation does not match the Portal state transition',
    )
  }
}

/** A Health fact written with an update is pinned to that update's revision and time. */
function assertUpdateHealthFact(command: UpdatePortalCommand): void {
  const health = command.health
  if (!health) return
  if (
    health.sourceVersion !== command.revision.toISOString() ||
    !sameInstant(health.effectiveAt, command.occurredAt) ||
    health.observedAt < health.effectiveAt
  ) {
    throw portalError('forbidden', 'Portal Health does not match its command version')
  }
}

function assertUpdateCommand(command: UpdatePortalCommand): void {
  assertUpdateScopeAndRevision(command)
  assertLocaleSetFact(command)
  assertPublicationTransition(command)
  assertUpdateHealthFact(command)
  assertSemanticLifecycleEvent(command)
}

/**
 * The one semantic fact this transition is allowed to carry, or null when the
 * transition is not semantically notable.
 */
function expectedLifecycleTag(
  command: UpdatePortalCommand,
): PortalSemanticLifecycleEvent['_tag'] | null {
  const previous = command.event.previousPublicationState
  const next = command.event.publicationState
  const publication = command.publication
  if (publication?.kind === 'publish') return 'portal.publication.published'
  if (publication?.kind === 'rollback') return 'portal.publication.rolled_back'
  if (previous !== 'archived' && next === 'archived') return 'portal.archived'
  if (previous === 'archived' && next === 'disabled') return 'portal.restored'
  return null
}

function matchesLifecycleEventScope(
  event: PortalSemanticLifecycleEvent,
  command: UpdatePortalCommand,
): boolean {
  return (
    event.organizationId === command.organizationId &&
    event.propertyId === command.propertyId &&
    event.portalId === command.portalId &&
    event.sourceAggregateVersion === command.revision.toISOString() &&
    sameInstant(event.occurredAt, command.occurredAt) &&
    event.userId === command.actorUserId
  )
}

/** A publish/rollback fact must quote the very snapshot the same commit activates. */
function assertLifecyclePayloadMatchesPublication(
  event: PortalSemanticLifecycleEvent,
  publication: PortalPublicationMutation | undefined,
): void {
  if (
    event._tag === 'portal.publication.published' &&
    (publication?.kind !== 'publish' ||
      event.publicationSnapshotId !== publication.snapshot.id ||
      event.publicationVersion !== publication.snapshot.version ||
      event.publicationDigest !== publication.snapshot.configurationDigest ||
      String(event.userId) !== publication.snapshot.createdBy)
  ) {
    throw portalError(
      'forbidden',
      'Portal publication fact does not match its immutable snapshot',
    )
  }
  if (
    event._tag === 'portal.publication.rolled_back' &&
    (publication?.kind !== 'rollback' ||
      event.publicationSnapshotId !== publication.snapshotId ||
      event.publicationVersion !== publication.snapshotVersion ||
      event.publicationDigest !== publication.publicationDigest ||
      String(event.userId) !== publication.activation.activatedBy)
  ) {
    throw portalError(
      'forbidden',
      'Portal rollback fact does not match its target immutable snapshot',
    )
  }
}

function assertSemanticLifecycleEvent(command: UpdatePortalCommand): void {
  const expectedTag = expectedLifecycleTag(command)
  const event = command.lifecycleEvent

  if ((event?._tag ?? null) !== expectedTag) {
    throw portalError(
      'forbidden',
      expectedTag === null
        ? 'Portal update carried an unrelated semantic lifecycle fact'
        : `Portal transition requires ${expectedTag}`,
    )
  }
  if (!event) return
  if (!matchesLifecycleEventScope(event, command)) {
    throw portalError(
      'forbidden',
      'Portal semantic lifecycle fact does not match its committed transition',
    )
  }
  assertLifecyclePayloadMatchesPublication(event, command.publication)
}

async function applyPortalHealthMutation(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  command: UpdatePortalCommand &
    Readonly<{ health: NonNullable<UpdatePortalCommand['health']> }>,
): Promise<void> {
  const [current] = await tx
    .select()
    .from(portalHealthIntervals)
    .where(
      and(
        eq(portalHealthIntervals.organizationId, unbrand(command.organizationId)),
        eq(portalHealthIntervals.propertyId, unbrand(command.propertyId)),
        eq(portalHealthIntervals.portalId, unbrand(command.portalId)),
        isNull(portalHealthIntervals.effectiveTo),
      ),
    )
    .limit(1)
  if (
    current?.status === command.health.value.status &&
    current.reason === command.health.value.reason
  ) {
    await tx
      .update(portalHealthIntervals)
      .set({
        sourceVersion: command.health.sourceVersion,
        observedAt:
          command.health.observedAt < current.observedAt
            ? current.observedAt
            : command.health.observedAt,
      })
      .where(eq(portalHealthIntervals.id, current.id))
    return
  }
  const effectiveFrom =
    current && command.health.effectiveAt <= current.effectiveFrom
      ? new Date(current.effectiveFrom.getTime() + 1)
      : command.health.effectiveAt
  if (current) {
    await tx
      .update(portalHealthIntervals)
      .set({ effectiveTo: effectiveFrom })
      .where(eq(portalHealthIntervals.id, current.id))
  }
  await tx.insert(portalHealthIntervals).values({
    id: command.health.id,
    organizationId: unbrand(command.organizationId),
    propertyId: unbrand(command.propertyId),
    portalId: unbrand(command.portalId),
    status: command.health.value.status,
    reason: command.health.value.reason,
    sourceVersion: command.health.sourceVersion,
    effectiveFrom,
    effectiveTo: null,
    observedAt:
      command.health.observedAt < effectiveFrom
        ? effectiveFrom
        : command.health.observedAt,
  })
}

/**
 * The snapshot about to be inserted must say exactly what the committed working
 * rows say. The rows are read by the same reader that built the snapshot, so a
 * difference means content moved between the read and this commit.
 */
async function assertSnapshotMatchesCommittedWorkingCopy(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  command: UpdatePortalCommand &
    Readonly<{
      publication: Extract<
        NonNullable<UpdatePortalCommand['publication']>,
        Readonly<{ kind: 'publish' }>
      >
    }>,
): Promise<void> {
  const committed = await readPortalWorkingCopy(
    tx,
    {
      organizationId: unbrand(command.organizationId),
      propertyId: unbrand(command.propertyId),
      portalId: unbrand(command.portalId),
    },
    { lockOrganization: true },
  )
  if (!committed) {
    throw portalError(
      'publication_snapshot_unavailable',
      'Portal working copy disappeared while its publication snapshot was being committed',
    )
  }
  if (!workingCopyMatchesSnapshot(committed, command.publication.snapshot)) {
    throw portalError(
      'revision_conflict',
      'Portal content changed while the publication snapshot was being committed',
    )
  }
}

function snapshotToRow(
  snapshot: import('../domain/portal-publication-snapshot').PortalPublicationSnapshot,
) {
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

function activationToRow(
  activation: import('../domain/portal-publication-snapshot').PortalPublicationActivation,
) {
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

async function closeActivePublication(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  command: UpdatePortalCommand,
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

function assertDeleteCommand(command: DeletePortalCommand): void {
  const matches = (event: {
    organizationId: DeletePortalCommand['organizationId']
    propertyId: DeletePortalCommand['propertyId']
    portalId: DeletePortalCommand['portalId']
    occurredAt: Date
  }) =>
    event.organizationId === command.organizationId &&
    event.propertyId === command.propertyId &&
    event.portalId === command.portalId &&
    sameInstant(event.occurredAt, command.occurredAt)

  if (
    !matches(command.event) ||
    !matches(command.tokenRevokedEvent) ||
    command.event.sourceAggregateVersion !== command.revision.toISOString() ||
    command.tokenRevokedEvent.sourceAggregateVersion !== command.revision.toISOString() ||
    command.reason.trim().length === 0
  ) {
    throw portalError(
      'forbidden',
      'Tenant, resource, or version mismatch on Portal delete',
    )
  }
  if (command.revision.getTime() <= command.expectedUpdatedAt.getTime()) {
    throw portalError(
      'revision_conflict',
      'Portal command revision must advance monotonically',
    )
  }
}

export const createAtomicPortalCommandStore = (db: Database): PortalCommandStore => {
  return {
    ...createPortalLinkCommands(db),
    ...createPortalGroupCommands(db),
    ...createPortalTokenCommands(db),
    createPortal: async (command) =>
      trace('portal.commandStore.createPortal', async () => {
        assertCreateCommand(command)
        await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(portals)
            .values(portalToRow(command.portal))
            .returning({ updatedAt: portals.updatedAt })
          assertCommittedRevision(
            created,
            command.portal.updatedAt,
            'Portal',
            'Portal creation did not return its command revision',
          )
          if (command.initialResponsibleManagerId) {
            await tx.insert(portalResponsibleManagers).values({
              organizationId: command.organizationId,
              propertyId: command.portal.propertyId,
              portalId: command.portal.id,
              userId: command.initialResponsibleManagerId,
              effectiveFrom: command.portal.createdAt,
              createdBy: command.initialResponsibleManagerId,
            })
          }
          if (command.health) {
            await tx.insert(portalHealthIntervals).values({
              id: command.health.id,
              organizationId: unbrand(command.organizationId),
              propertyId: unbrand(command.portal.propertyId),
              portalId: unbrand(command.portal.id),
              status: command.health.value.status,
              reason: command.health.value.reason,
              sourceVersion: command.health.sourceVersion,
              effectiveFrom: command.health.effectiveAt,
              effectiveTo: null,
              observedAt: command.health.observedAt,
            })
          }
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.portal.createdAt,
          })
          if (command.responsibilityNeededEvent) {
            await insertOutboxRow(tx, command.responsibilityNeededEvent, {
              recordedAt: command.portal.createdAt,
            })
          }
        })
      }),

    updatePortal: async (command) =>
      trace('portal.commandStore.updatePortal', async () => {
        assertUpdateCommand(command)
        await db.transaction(async (tx) => {
          if (command.publication?.kind === 'publish') {
            await lockPortalPublicationProperty(
              tx,
              unbrand(command.organizationId),
              unbrand(command.propertyId),
            )
          }
          const reconcileLinkTexts = await watchPrimaryLocaleChange(tx, command)
          const [updated] = await tx
            .update(portals)
            .set({ ...buildPortalSetClause(command.patch), updatedAt: command.revision })
            .where(
              and(
                eq(portals.organizationId, unbrand(command.organizationId)),
                eq(portals.propertyId, unbrand(command.propertyId)),
                eq(portals.id, unbrand(command.portalId)),
                eq(portals.publicationState, command.event.previousPublicationState),
                eq(portals.updatedAt, command.expectedUpdatedAt),
                isNull(portals.deletedAt),
              ),
            )
            .returning({ updatedAt: portals.updatedAt })
          assertCommittedRevision(
            updated,
            command.revision,
            'Portal',
            'Portal changed while the update was being committed',
          )
          await reconcileLinkTexts()

          if (command.publication?.kind === 'publish') {
            // The Portal row is already locked (above); the working-copy
            // table locks come second, then the comparison reads the rows.
            await lockPortalWorkingCopyTables(tx)
            await assertSnapshotMatchesCommittedWorkingCopy(
              tx,
              command as UpdatePortalCommand & {
                publication: Extract<
                  NonNullable<UpdatePortalCommand['publication']>,
                  { kind: 'publish' }
                >
              },
            )
            const unexpectedlyActive = await closeActivePublication(
              tx,
              command,
              'replaced',
            )
            if (unexpectedlyActive !== 0) {
              throw portalError(
                'revision_conflict',
                'A non-published Portal unexpectedly retained an active publication',
              )
            }
            await tx
              .insert(portalPublicationSnapshots)
              .values(snapshotToRow(command.publication.snapshot))
            await tx
              .insert(portalPublicationActivations)
              .values(activationToRow(command.publication.activation))
            await resolvePortalPendingContentChanges(tx, {
              organizationId: unbrand(command.organizationId),
              propertyId: unbrand(command.propertyId),
              portalId: unbrand(command.portalId),
              snapshotId: command.publication.snapshot.id,
              resolvedAt: command.occurredAt,
            })
          } else if (command.publication?.kind === 'rollback') {
            const [target] = await tx
              .select({
                id: portalPublicationSnapshots.id,
                configurationDigest: portalPublicationSnapshots.configurationDigest,
              })
              .from(portalPublicationSnapshots)
              .where(
                and(
                  eq(
                    portalPublicationSnapshots.organizationId,
                    unbrand(command.organizationId),
                  ),
                  eq(portalPublicationSnapshots.propertyId, unbrand(command.propertyId)),
                  eq(portalPublicationSnapshots.portalId, unbrand(command.portalId)),
                  eq(portalPublicationSnapshots.id, command.publication.snapshotId),
                  eq(
                    portalPublicationSnapshots.version,
                    command.publication.snapshotVersion,
                  ),
                ),
              )
              .limit(1)
            if (!target) {
              throw portalError(
                'publication_snapshot_unavailable',
                'The requested rollback snapshot does not belong to this Portal',
              )
            }
            if (target.configurationDigest !== command.publication.publicationDigest) {
              throw portalError(
                'publication_snapshot_unavailable',
                'The rollback publication digest does not match its immutable snapshot',
              )
            }
            const closed = await closeActivePublication(tx, command, 'replaced')
            if (closed !== 1) {
              throw portalError(
                'revision_conflict',
                'Rollback requires exactly one active Portal publication',
              )
            }
            await tx
              .insert(portalPublicationActivations)
              .values(activationToRow(command.publication.activation))
          } else if (command.publication?.kind === 'deactivate') {
            // Legacy published rows can have no activation during the expand
            // migration. They must still be safely disable-able. More than one
            // is impossible under the partial unique index.
            await closeActivePublication(tx, command, command.publication.reason)
          }
          if (command.health) {
            await applyPortalHealthMutation(
              tx,
              command as UpdatePortalCommand & {
                health: NonNullable<UpdatePortalCommand['health']>
              },
            )
          }
          if (
            command.publication?.kind !== 'publish' &&
            hasPortalWorkingCopyPatch(command.patch)
          ) {
            await recordPortalPendingContentChange(tx, {
              organizationId: unbrand(command.organizationId),
              propertyId: unbrand(command.propertyId),
              portalId: unbrand(command.portalId),
              kind: 'portal_configuration',
              sourceVersion: command.revision.toISOString(),
              changedAt: command.occurredAt,
            })
          }
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.event.occurredAt,
          })
          if (command.lifecycleEvent) {
            await insertOutboxRow(tx, command.lifecycleEvent, {
              recordedAt: command.lifecycleEvent.occurredAt,
            })
          }
          if (command.localeSetEvent) {
            await insertOutboxRow(tx, command.localeSetEvent, {
              recordedAt: command.localeSetEvent.occurredAt,
            })
          }
        })
      }),

    deletePortal: async (command) =>
      trace('portal.commandStore.deletePortal', async () => {
        assertDeleteCommand(command)
        const revoked = await db.transaction(async (tx) => {
          const [deleted] = await tx
            .update(portals)
            .set({ deletedAt: command.occurredAt, updatedAt: command.revision })
            .where(
              and(
                eq(portals.organizationId, unbrand(command.organizationId)),
                eq(portals.propertyId, unbrand(command.propertyId)),
                eq(portals.id, unbrand(command.portalId)),
                eq(portals.updatedAt, command.expectedUpdatedAt),
                isNull(portals.deletedAt),
              ),
            )
            .returning({ updatedAt: portals.updatedAt })
          assertCommittedRevision(
            deleted,
            command.revision,
            'Portal',
            'Portal changed while the delete was being committed',
          )

          const revokedRows = await tx
            .update(portalTokens)
            .set({
              status: 'revoked',
              revokedAt: command.occurredAt,
              retiredAt: command.occurredAt,
              revokedBy: unbrand(command.revokedBy),
              revokedReason: command.reason.trim(),
              gracePeriodEnds: null,
            })
            .where(
              and(
                eq(portalTokens.organizationId, unbrand(command.organizationId)),
                eq(portalTokens.propertyId, unbrand(command.propertyId)),
                eq(portalTokens.portalId, unbrand(command.portalId)),
                or(
                  eq(portalTokens.status, 'active'),
                  eq(portalTokens.status, 'rotating'),
                ),
              ),
            )
            .returning({ id: portalTokens.id })

          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
          if (revokedRows.length > 0) {
            await insertOutboxRow(tx, command.tokenRevokedEvent, {
              recordedAt: command.occurredAt,
            })
          }
          return revokedRows.length
        })

        return { revoked }
      }),
  }
}
