// Portal context — the one place a Portal's state change is committed.
//
// Every intent in `portal-intents.server.ts` decides what it may change and
// hands the result here; this builds the lifecycle events, the publication
// snapshot a go-live pins, the health fact and the locale-set fact, and writes
// them in one command.

import type { PortalRepository } from '../application/ports/portal.repository'
import type {
  PortalCommandStore,
  PortalPublicationMutation,
} from '../application/ports/portal-command-store.port'
import type { PortalPublicationRepository } from '../application/ports/portal-publication.repository'
import type { PortalTokenRepository } from '../application/ports/portal-token.repository'
import type { Portal, PortalTheme } from '../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { unbrand } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type {
  PropertyGoogleReviewDestinationPublicApi,
  PropertyLifecyclePublicApi,
} from '#/contexts/property/application/public-api'
import { assertPersonalPortalPublicText } from '../domain/personal-portal-public-text'
import { portalError } from '../domain/errors'
import {
  portalArchived,
  portalPublicationPublished,
  portalRestored,
  portalUpdated,
} from '../domain/events'
import type { VerifiedPublicationDestination } from '../domain/portal-publication-snapshot'
import type { PortalPublicationSource } from '../domain/portal-publication-source'
import { buildPortalPublicationSnapshot } from '../application/portal-publication-snapshot'
import { assertPortalHasOwnerAndAddress } from '../application/portal-publication-readiness'
import { nextPortalCommandAt } from '../application/portal-command-version'
import { buildLocaleSetFact, buildPortalHealthFact } from './portal-facts.server'

export type PortalIntentDeps = Readonly<{
  ratingGoalGuard: Readonly<{
    findRunningRatingGoalBlock(
      organizationId: string,
      propertyId: string,
      portalId: string,
    ): Promise<'portal' | 'last_collector' | 'staff_scan_target' | null>
  }>
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

export type PortalPatch = Readonly<{
  name: string
  slug: string
  description: string | null
  heroImageUrl: string | null
  theme: PortalTheme
  privateFeedbackThreshold: number
  skipPrivateRating: boolean
  publicationState: Portal['publicationState']
  primaryGuestLocale: Portal['primaryGuestLocale']
  additionalGuestLocales: Portal['additionalGuestLocales']
}>

function patchOf(existing: Portal, changes: Partial<PortalPatch>): PortalPatch {
  return {
    name: existing.name,
    slug: existing.slug,
    description: existing.description,
    heroImageUrl: existing.heroImageUrl,
    theme: existing.theme,
    privateFeedbackThreshold: existing.privateFeedbackThreshold,
    skipPrivateRating: existing.skipPrivateRating,
    publicationState: existing.publicationState,
    primaryGuestLocale: existing.primaryGuestLocale,
    additionalGuestLocales: existing.additionalGuestLocales,
    ...changes,
  }
}

function hasPortalChanges(existing: Portal, patch: PortalPatch): boolean {
  return (
    patch.name !== existing.name ||
    patch.slug !== existing.slug ||
    patch.description !== existing.description ||
    patch.heroImageUrl !== existing.heroImageUrl ||
    JSON.stringify(patch.theme) !== JSON.stringify(existing.theme) ||
    patch.privateFeedbackThreshold !== existing.privateFeedbackThreshold ||
    patch.skipPrivateRating !== existing.skipPrivateRating ||
    patch.primaryGuestLocale !== existing.primaryGuestLocale ||
    JSON.stringify(patch.additionalGuestLocales) !==
      JSON.stringify(existing.additionalGuestLocales) ||
    patch.publicationState !== existing.publicationState
  )
}

function applyPatchToPublicationSource(
  source: PortalPublicationSource,
  patch: PortalPatch,
): PortalPublicationSource {
  return {
    ...source,
    portal: { ...source.portal, name: patch.name, slug: patch.slug },
    privateFeedbackThreshold: patch.privateFeedbackThreshold,
    skipPrivateRating: patch.skipPrivateRating,
  }
}

async function buildGoLive(
  deps: PortalIntentDeps,
  existing: Portal,
  patch: PortalPatch,
  destination: VerifiedPublicationDestination | null,
  ctx: AuthContext,
  at: Date,
): Promise<PortalPublicationMutation> {
  if (!destination) {
    throw portalError(
      'publication_snapshot_unavailable',
      'A verified destination must be pinned to the publication snapshot',
    )
  }
  await assertPortalHasOwnerAndAddress(deps, ctx, existing, at)
  const [workingCopy, cursor] = await Promise.all([
    deps.publicationRepo.loadWorkingCopy(ctx.organizationId, existing.id),
    deps.publicationRepo.getCursor(ctx.organizationId, existing.id),
  ])
  if (!workingCopy) {
    throw portalError(
      'publication_snapshot_unavailable',
      'Portal publication content is unavailable',
    )
  }
  const publicSource = applyPatchToPublicationSource(workingCopy, {
    ...patch,
    name: existing.publicName ?? patch.name,
  })
  assertPersonalPortalPublicText(existing, publicSource)
  const snapshot = buildPortalPublicationSnapshot({
    id: deps.idGen(),
    portalId: unbrand(existing.id),
    organizationId: unbrand(existing.organizationId),
    propertyId: unbrand(existing.propertyId),
    version: cursor.nextSnapshotVersion,
    source: publicSource,
    destination,
    createdBy: unbrand(ctx.userId),
    createdAt: at,
  })
  return {
    kind: 'publish',
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
      activatedAt: at,
      deactivatedAt: null,
      deactivationReason: null,
    },
  }
}

function lifecycleEventFor(
  existing: Portal,
  patch: PortalPatch,
  publication: PortalPublicationMutation | undefined,
  ctx: AuthContext,
  revision: Date,
  occurredAt: Date,
) {
  const base = {
    organizationId: ctx.organizationId,
    propertyId: existing.propertyId,
    portalId: existing.id,
    userId: ctx.userId,
    sourceAggregateVersion: revision.toISOString(),
    occurredAt,
  }
  if (publication?.kind === 'publish') {
    return portalPublicationPublished({
      ...base,
      publicationSnapshotId: publication.snapshot.id,
      publicationVersion: publication.snapshot.version,
      publicationDigest: publication.snapshot.configurationDigest,
    })
  }
  if (existing.publicationState !== 'archived' && patch.publicationState === 'archived') {
    return portalArchived(base)
  }
  if (existing.publicationState === 'archived' && patch.publicationState === 'disabled') {
    return portalRestored(base)
  }
  return undefined
}

/**
 * Writes `changes` over the Portal as one command. Nothing is written, and the
 * Portal comes back as it was, when nothing differs. `destination` is the
 * verified destination a go-live pins; only a go-live needs it.
 */
export async function commitPortalChange(
  deps: PortalIntentDeps,
  ctx: AuthContext,
  existing: Portal,
  changes: Partial<PortalPatch>,
  destination: VerifiedPublicationDestination | null = null,
): Promise<Portal> {
  const patch = patchOf(existing, changes)
  if (!hasPortalChanges(existing, patch)) return existing

  const occurredAt = deps.clock()
  const revision = nextPortalCommandAt(occurredAt, existing.updatedAt)
  const wasPublished = existing.publicationState === 'published'
  const publication: PortalPublicationMutation | undefined =
    !wasPublished && patch.publicationState === 'published'
      ? await buildGoLive(deps, existing, patch, destination, ctx, occurredAt)
      : wasPublished &&
          (patch.publicationState === 'disabled' || patch.publicationState === 'archived')
        ? { kind: 'deactivate', reason: patch.publicationState, at: occurredAt }
        : undefined
  const health =
    existing.publicationState !== patch.publicationState
      ? buildPortalHealthFact({
          id: deps.idGen(),
          publicationState: patch.publicationState,
          hasResponsibleManager:
            patch.publicationState === 'published'
              ? existing.responsibilityNeededSince === null
              : false,
          sourceVersion: revision.toISOString(),
          at: occurredAt,
        })
      : undefined

  await deps.commandStore.updatePortal({
    organizationId: ctx.organizationId,
    propertyId: existing.propertyId,
    portalId: existing.id,
    actorUserId: ctx.userId,
    expectedUpdatedAt: existing.updatedAt,
    revision,
    occurredAt,
    patch,
    publication,
    health,
    lifecycleEvent: lifecycleEventFor(
      existing,
      patch,
      publication,
      ctx,
      revision,
      occurredAt,
    ),
    localeSetEvent: buildLocaleSetFact(existing, patch, revision, occurredAt),
    event: portalUpdated({
      portalId: existing.id,
      organizationId: ctx.organizationId,
      propertyId: existing.propertyId,
      previousPublicationState: existing.publicationState,
      publicationState: patch.publicationState,
      sourceAggregateVersion: revision.toISOString(),
      occurredAt,
    }),
  })

  return { ...existing, ...patch, updatedAt: revision }
}
