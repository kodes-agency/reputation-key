// Portal context — publish changes while live.
//
// A Portal that is already Published can publish its working copy again: a new
// immutable snapshot and activation replace the live ones in one commit, and
// the activation they replace closes as `replaced`. Nothing else about the
// Portal changes. A Portal that is not Published goes live through
// `updatePortal` (publishing), which is a state change; this is not.

import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId as toPortalId, unbrand } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type {
  PropertyGoogleReviewDestinationPublicApi,
  PropertyLifecyclePublicApi,
} from '#/contexts/property/application/public-api'
import type { PortalRepository } from '../ports/portal.repository'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import type { PortalPublicationRepository } from '../ports/portal-publication.repository'
import type { PortalTokenRepository } from '../ports/portal-token.repository'
import { loadPortalOrThrow } from '../load-accessible-portal'
import {
  assertPortalHasOwnerAndAddress,
  assertPropertyAllowsPublication,
  loadVerifiedGoogleReviewDestination,
} from '../portal-publication-readiness'
import { buildPortalPublicationSnapshot } from '../portal-publication-snapshot'
import { nextPortalCommandAt } from '../portal-command-version'
import { workingCopyMatchesSnapshot } from '../portal-working-copy-match'
import { portalError, isPortalError, type PortalErrorCode } from '../../domain/errors'
import { portalPublicationPublished, portalUpdated } from '../../domain/events'

export type PublishPortalChangesDeps = Readonly<{
  portalRepo: PortalRepository
  commandStore: PortalCommandStore
  publicationRepo: PortalPublicationRepository
  portalTokenRepo: Pick<PortalTokenRepository, 'findResolvableSummaryForPortal'>
  propertyGoogleReviewDestinationApi: PropertyGoogleReviewDestinationPublicApi
  propertyLifecycleApi: PropertyLifecyclePublicApi
  staffPublicApi: StaffPublicApi
  idGen: () => string
  clock: () => Date
}>

export type PublishPortalChangesResult =
  | Readonly<{
      outcome: 'published'
      snapshotId: string
      version: number
      configurationDigest: string
      activatedAt: Date
    }>
  /** Nothing was pending: the live version already says what the draft says. */
  | Readonly<{ outcome: 'unchanged'; version: number }>

export type PublishPortalsChangesResult = ReadonlyArray<
  Readonly<{ portalId: string }> &
    (
      | PublishPortalChangesResult
      | Readonly<{ outcome: 'failed'; code: PortalErrorCode; message: string }>
    )
>

export const publishPortalChanges =
  (deps: PublishPortalChangesDeps) =>
  async (
    input: Readonly<{ portalId: string }>,
    ctx: AuthContext,
  ): Promise<PublishPortalChangesResult> => {
    const pid = toPortalId(input.portalId)
    const portal = await loadPortalOrThrow(deps, ctx, pid, {
      permission: 'portal.update',
      forbiddenMessage: 'Insufficient permissions to publish Portal changes',
    })
    if (portal.publicationState !== 'published') {
      throw portalError(
        'invalid_publication_transition',
        'Only a Portal that is live can publish its changes; publish it first',
      )
    }

    const [workingCopy, live, cursor, openChanges] = await Promise.all([
      deps.publicationRepo.loadWorkingCopy(ctx.organizationId, pid),
      deps.publicationRepo.findActiveForPortal(ctx.organizationId, pid),
      deps.publicationRepo.getCursor(ctx.organizationId, pid),
      deps.publicationRepo.listOpenPendingContentChanges?.(
        ctx.organizationId,
        portal.propertyId,
        pid,
      ) ?? Promise.resolve([]),
    ])
    if (!workingCopy) {
      throw portalError(
        'publication_snapshot_unavailable',
        'Portal publication content is unavailable',
      )
    }
    if (!live) {
      throw portalError(
        'publication_snapshot_unavailable',
        'This Portal has no live version to replace',
      )
    }
    // The same question the History tab asks: a recorded change, or a draft
    // that no longer says what the live version says.
    if (openChanges.length === 0 && workingCopyMatchesSnapshot(workingCopy, live)) {
      return { outcome: 'unchanged', version: live.version }
    }

    await assertPropertyAllowsPublication(deps, ctx.organizationId, portal)
    const destination = await loadVerifiedGoogleReviewDestination(
      deps,
      ctx.organizationId,
      portal,
    )
    const occurredAt = deps.clock()
    await assertPortalHasOwnerAndAddress(deps, ctx, portal, occurredAt)

    const snapshot = buildPortalPublicationSnapshot({
      id: deps.idGen(),
      portalId: unbrand(pid),
      organizationId: unbrand(portal.organizationId),
      propertyId: unbrand(portal.propertyId),
      version: cursor.nextSnapshotVersion,
      source: workingCopy,
      destination,
      createdBy: unbrand(ctx.userId),
      createdAt: occurredAt,
    })
    const revision = nextPortalCommandAt(occurredAt, portal.updatedAt)
    await deps.commandStore.republishPortal({
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      portalId: pid,
      actorUserId: ctx.userId,
      expectedUpdatedAt: portal.updatedAt,
      revision,
      occurredAt,
      snapshot,
      activation: {
        id: deps.idGen(),
        organizationId: snapshot.organizationId,
        propertyId: snapshot.propertyId,
        portalId: snapshot.portalId,
        snapshotId: snapshot.id,
        activationSequence: cursor.nextActivationSequence,
        kind: 'publish',
        activatedBy: unbrand(ctx.userId),
        activatedAt: occurredAt,
        deactivatedAt: null,
        deactivationReason: null,
      },
      lifecycleEvent: portalPublicationPublished({
        organizationId: ctx.organizationId,
        propertyId: portal.propertyId,
        portalId: pid,
        publicationSnapshotId: snapshot.id,
        publicationVersion: snapshot.version,
        publicationDigest: snapshot.configurationDigest,
        userId: ctx.userId,
        sourceAggregateVersion: revision.toISOString(),
        occurredAt,
      }),
      event: portalUpdated({
        portalId: pid,
        organizationId: ctx.organizationId,
        propertyId: portal.propertyId,
        previousPublicationState: 'published',
        publicationState: 'published',
        sourceAggregateVersion: revision.toISOString(),
        occurredAt,
      }),
    })
    return {
      outcome: 'published',
      snapshotId: snapshot.id,
      version: snapshot.version,
      configurationDigest: snapshot.configurationDigest,
      activatedAt: occurredAt,
    }
  }

export type PublishPortalChanges = ReturnType<typeof publishPortalChanges>

/**
 * Publish several Portals' changes, one after another, and say what happened to
 * each. A Property-look change reaches every live Portal of the Property, and
 * each of them is its own commit: one that cannot be published (its address is
 * gone, a language has no text) is reported and does not hold back the rest.
 * Each Portal is authorized on its own, so a manager sees `forbidden` for a
 * Portal outside their Properties. Running it again is safe: a Portal that
 * already went live reads as `unchanged`. A fault that is not a Portal error
 * stops the batch and surfaces, because there is no per-Portal answer to give.
 * The size of a batch is bounded where it enters (the DTO), not here.
 */
export const publishPortalsChanges =
  (deps: PublishPortalChangesDeps) =>
  async (
    input: Readonly<{ portalIds: ReadonlyArray<string> }>,
    ctx: AuthContext,
  ): Promise<PublishPortalsChangesResult> => {
    const portalIds = [...new Set(input.portalIds)]
    const publishOne = publishPortalChanges(deps)
    const results: Array<PublishPortalsChangesResult[number]> = []
    for (const portalId of portalIds) {
      try {
        results.push({ portalId, ...(await publishOne({ portalId }, ctx)) })
      } catch (error) {
        if (!isPortalError(error)) throw error
        results.push({
          portalId,
          outcome: 'failed',
          code: error.code,
          message: error.message,
        })
      }
    }
    return results
  }

export type PublishPortalsChanges = ReturnType<typeof publishPortalsChanges>
