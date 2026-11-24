import {
  assertPersonalPortalPublicText,
  withoutInheritedBrand,
} from '../domain/personal-portal-public-text'
// Portal context — publish changes while live.
//
// A Portal that is already Published can publish its working copy again: a new
// immutable snapshot and activation replace the live ones in one commit, and
// the activation they replace closes as `replaced`. Nothing else about the
// Portal changes. A Portal that is not Published goes live through
// `updatePortal` (publishing), which is a state change; this is not.

import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId as toPortalId, unbrand } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/public-api'
import type {
  PropertyGoogleReviewDestinationPublicApi,
  PropertyLifecyclePublicApi,
} from '#/contexts/property/public-api'
import type { PortalRepository } from './portal-repository.port.server'
import type {
  PortalCommandStore,
  RepublishPortalCommand,
} from './portal-command-store-port.server'
import type { PortalPublicationRepository } from './portal-publication-repository.port.server'
import type { PortalTokenRepository } from '../addresses/portal-token-repository.port.server'
import { loadPortalOrThrow } from './load-accessible-portal.server'
import {
  assertPortalHasOwnerAndAddress,
  assertPropertyAllowsPublication,
  findVerifiedGoogleReviewDestination,
  requireVerifiedGoogleReviewDestination,
} from './portal-publication-readiness.server'
import { buildPortalPublicationSnapshot } from './portal-publication-snapshot.server'
import { nextPortalCommandAt } from './portal-command-version.server'
import {
  destinationMatchesSnapshot,
  workingCopyMatchesSnapshot,
} from './portal-working-copy-match.server'
import { portalError, isPortalError, type PortalErrorCode } from '../domain/errors'
import { portalPublicationPublished, portalUpdated } from '../domain/events'

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

/**
 * Authorise, load, decide whether anything is pending, ask the readiness gates,
 * and build the command that replaces the live version. Returns the live
 * version when nothing is pending.
 */
const planPortalRepublish =
  (deps: PublishPortalChangesDeps) =>
  async (
    input: Readonly<{ portalId: string }>,
    ctx: AuthContext,
  ): Promise<
    Readonly<{ unchangedVersion: number }> | Readonly<{ command: RepublishPortalCommand }>
  > => {
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

    const [workingCopyWithLook, live, cursor, openChanges] = await Promise.all([
      deps.publicationRepo.loadWorkingCopyWithLook(ctx.organizationId, pid),
      deps.publicationRepo.findActiveForPortal(ctx.organizationId, pid),
      deps.publicationRepo.getCursor(ctx.organizationId, pid),
      deps.publicationRepo.listOpenPendingContentChanges(
        ctx.organizationId,
        portal.propertyId,
        pid,
      ),
    ])
    const workingCopy = workingCopyWithLook?.source
    if (workingCopyWithLook)
      assertPersonalPortalPublicText(
        portal,
        withoutInheritedBrand(
          workingCopyWithLook.source,
          workingCopyWithLook.lookSources.identity,
        ),
      )
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
    // Pending is a recorded change, a draft that no longer says what the live
    // version says, or a live version pinned to a Google destination the
    // Property has since left (a relink), which closes the guest gateway.
    const verifiedDestination = await findVerifiedGoogleReviewDestination(
      deps,
      ctx.organizationId,
      portal,
    )
    const destinationMoved =
      verifiedDestination !== null &&
      !destinationMatchesSnapshot(verifiedDestination, live)
    if (
      openChanges.length === 0 &&
      !destinationMoved &&
      workingCopyMatchesSnapshot(workingCopy, live)
    ) {
      return { unchangedVersion: live.version }
    }

    await assertPropertyAllowsPublication(deps, ctx.organizationId, portal)
    const destination = requireVerifiedGoogleReviewDestination(verifiedDestination)
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
    return {
      command: {
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
      },
    }
  }

/**
 * With `reviewedDigest` (what the review showed), the draft must still say
 * exactly that: otherwise nothing is written and the manager reviews again.
 * Callers that just wrote the draft themselves publish without it.
 */
export const publishPortalChanges =
  (deps: PublishPortalChangesDeps) =>
  async (
    input: Readonly<{ portalId: string; reviewedDigest?: string }>,
    ctx: AuthContext,
  ): Promise<PublishPortalChangesResult> => {
    const plan = await planPortalRepublish(deps)(input, ctx)
    if ('unchangedVersion' in plan) {
      return { outcome: 'unchanged', version: plan.unchangedVersion }
    }
    const { command } = plan
    if (
      input.reviewedDigest !== undefined &&
      input.reviewedDigest !== command.snapshot.configurationDigest
    ) {
      throw portalError(
        'revision_conflict',
        'The Portal changed after you reviewed it. Review the changes again before publishing',
      )
    }
    await deps.commandStore.republishPortal(command)
    return {
      outcome: 'published',
      snapshotId: command.snapshot.id,
      version: command.snapshot.version,
      configurationDigest: command.snapshot.configurationDigest,
      activatedAt: command.occurredAt,
    }
  }

export type PublishPortalChanges = ReturnType<typeof publishPortalChanges>

/**
 * Publish several Portals' changes, one after another, and say what happened to
 * each. A Property-look change reaches every live Portal of the Property, and
 * each of them is its own commit: one that cannot be published (its address is
 * gone, a language has no text) is reported and does not hold back the rest.
 * Each Portal is authorized on its own, so a manager sees `forbidden` for a
 * Portal outside their Properties (the server function checks every scope up
 * front and refuses the whole request for one; it lets a Portal that no longer
 * exists through, and that Portal reads `portal_not_found` here). Running it again is safe: a Portal that
 * already went live reads as `unchanged`. A fault that is not a Portal error
 * stops the batch and surfaces, because there is no per-Portal answer to give.
 * A Portal that names the `reviewedDigest` it was reviewed at is refused, like
 * a single publication, when its draft has changed since; the others still go.
 * The size of a batch is bounded where it enters (the DTO), not here.
 */
export const publishPortalsChanges =
  (deps: PublishPortalChangesDeps) =>
  async (
    input: Readonly<{
      portals: ReadonlyArray<Readonly<{ portalId: string; reviewedDigest?: string }>>
    }>,
    ctx: AuthContext,
  ): Promise<PublishPortalsChangesResult> => {
    const portals = [
      ...new Map(input.portals.map((portal) => [portal.portalId, portal])).values(),
    ]
    const publishOne = publishPortalChanges(deps)
    const results: Array<PublishPortalsChangesResult[number]> = []
    for (const { portalId, reviewedDigest } of portals) {
      try {
        results.push({
          portalId,
          ...(await publishOne({ portalId, reviewedDigest }, ctx)),
        })
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
