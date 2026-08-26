// Portal context — update portal use case

import type { PortalRepository } from '../ports/portal.repository'
import type { Portal, PortalTheme } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { UpdatePortalInput } from '../dto/update-portal.dto'
export type { UpdatePortalInput }
import { canForContext } from '#/shared/domain/permissions'
import { portalId as toPortalId, unbrand, type OrganizationId } from '#/shared/domain/ids'
import {
  validatePortalName,
  validateSlug,
  validateDescription,
  validatePortalTheme,
  validatePrivateFeedbackThreshold,
} from '../../domain/rules'
import { portalError } from '../../domain/errors'
import { portalUpdated } from '../../domain/events'
import type { Result } from '#/shared/domain'
import type { PortalError } from '../../domain/errors'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertPropertyAccess } from '../assert-property-access'
import { transitionPortalPublication } from '../../domain/portal-publication'
import type { PropertyGoogleReviewDestinationPublicApi } from '#/contexts/property/application/public-api'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import type { PortalPublicationMutation } from '../ports/portal-command-store.port'
import type { PortalPublicationRepository } from '../ports/portal-publication.repository'
import type {
  PortalPublicationSource,
  VerifiedPublicationDestination,
} from '../../domain/portal-publication-snapshot'
import { buildPortalPublicationSnapshot } from '../portal-publication-snapshot'
import { nextPortalCommandAt } from '../portal-command-version'

export type UpdatePortalDeps = Readonly<{
  portalRepo: PortalRepository
  commandStore: PortalCommandStore
  publicationRepo: PortalPublicationRepository
  propertyGoogleReviewDestinationApi: PropertyGoogleReviewDestinationPublicApi
  staffPublicApi: StaffPublicApi
  idGen: () => string
  clock: () => Date
}>

type PortalPatch = {
  name: string
  slug: string
  description: string | null
  heroImageUrl: string | null
  theme: PortalTheme
  privateFeedbackThreshold: number
  publicationState: Portal['publicationState']
}

function unwrap<T>(r: Result<T, PortalError>): T {
  if (r.isErr()) throw r.error
  return r.value
}

/** Fields patchable without I/O. `undefined` leaves a field alone; `null` clears it. */
export function resolvePortalContentFields(
  input: UpdatePortalInput,
  existing: Portal,
): Pick<
  PortalPatch,
  'name' | 'description' | 'heroImageUrl' | 'theme' | 'privateFeedbackThreshold'
> {
  const requestedHeroImageUrl = (input as { heroImageUrl?: unknown }).heroImageUrl
  if (requestedHeroImageUrl !== undefined && requestedHeroImageUrl !== null) {
    throw portalError(
      'invalid_url',
      'Portal hero image URLs are server-owned upload derivatives',
    )
  }
  return {
    name:
      input.name !== undefined ? unwrap(validatePortalName(input.name)) : existing.name,
    description:
      input.description !== undefined
        ? unwrap(validateDescription(input.description))
        : existing.description,
    // `null` clears the hero image; `undefined` (absent key) leaves it untouched.
    heroImageUrl: input.heroImageUrl === null ? null : existing.heroImageUrl,
    theme:
      input.theme !== undefined
        ? unwrap(validatePortalTheme(input.theme))
        : existing.theme,
    privateFeedbackThreshold:
      input.privateFeedbackThreshold !== undefined
        ? unwrap(validatePrivateFeedbackThreshold(input.privateFeedbackThreshold))
        : existing.privateFeedbackThreshold,
  }
}

async function loadVerifiedGoogleReviewDestination(
  deps: UpdatePortalDeps,
  orgId: OrganizationId,
  existing: Portal,
): Promise<VerifiedPublicationDestination> {
  const destination =
    await deps.propertyGoogleReviewDestinationApi.getGoogleReviewDestination(
      orgId,
      existing.propertyId,
    )
  if (
    destination?.state !== 'verified' ||
    destination.uri === null ||
    destination.retrievedAt === null ||
    destination.sourceEpoch === null ||
    destination.profileVersion === null
  ) {
    throw portalError(
      'google_review_destination_unavailable',
      'connect and refresh this property’s Google review destination before publishing',
    )
  }
  return {
    state: 'verified',
    uri: destination.uri,
    retrievedAt: destination.retrievedAt,
    sourceEpoch: destination.sourceEpoch,
    profileVersion: destination.profileVersion,
  }
}

type PublicationStateResolution = Readonly<{
  state: Portal['publicationState']
  destination: VerifiedPublicationDestination | null
}>

async function resolvePublicationState(
  input: UpdatePortalInput,
  existing: Portal,
  deps: UpdatePortalDeps,
  orgId: OrganizationId,
): Promise<PublicationStateResolution> {
  const requested = input.publicationState
  if (requested === undefined || requested === existing.publicationState) {
    return { state: existing.publicationState, destination: null }
  }
  const transition = transitionPortalPublication(existing.publicationState, requested)
  if (typeof transition !== 'string') {
    throw portalError(
      'invalid_publication_transition',
      `cannot transition portal from ${transition.from} to ${transition.to}`,
    )
  }
  if (transition === 'published') {
    return {
      state: transition,
      destination: await loadVerifiedGoogleReviewDestination(deps, orgId, existing),
    }
  }
  return { state: transition, destination: null }
}

async function resolveSlug(
  input: UpdatePortalInput,
  existing: Portal,
  deps: UpdatePortalDeps,
  orgId: OrganizationId,
): Promise<string> {
  // An unchanged slug is not re-validated and never hits the uniqueness probe.
  if (input.slug === undefined || input.slug === existing.slug) return existing.slug
  const slug = unwrap(validateSlug(input.slug))
  const taken = await deps.portalRepo.slugExists(
    orgId,
    existing.propertyId as string,
    slug,
    existing.id,
  )
  if (taken) {
    throw portalError('slug_taken', 'a portal with this slug already exists')
  }
  return slug
}

async function buildPortalPatch(
  input: UpdatePortalInput,
  existing: Portal,
  deps: UpdatePortalDeps,
  orgId: OrganizationId,
): Promise<
  Readonly<{
    patch: PortalPatch
    publicationDestination: VerifiedPublicationDestination | null
  }>
> {
  // Order is load-bearing: content validation, then the publication precondition,
  // then slug uniqueness — so which error surfaces first stays stable.
  const content = resolvePortalContentFields(input, existing)
  const publication = await resolvePublicationState(input, existing, deps, orgId)
  const slug = await resolveSlug(input, existing, deps, orgId)
  return {
    patch: { ...content, slug, publicationState: publication.state },
    publicationDestination: publication.destination,
  }
}

function applyPatchToPublicationSource(
  source: PortalPublicationSource,
  patch: PortalPatch,
): PortalPublicationSource {
  return {
    ...source,
    portal: {
      ...source.portal,
      name: patch.name,
      slug: patch.slug,
      description: patch.description,
      heroImageUrl: patch.heroImageUrl,
      theme: patch.theme,
    },
    privateFeedbackThreshold: patch.privateFeedbackThreshold,
  }
}

async function buildPublicationMutation(
  deps: UpdatePortalDeps,
  existing: Portal,
  patch: PortalPatch,
  destination: VerifiedPublicationDestination | null,
  ctx: AuthContext,
  at: Date,
): Promise<PortalPublicationMutation | undefined> {
  if (
    existing.publicationState !== 'published' &&
    patch.publicationState === 'published'
  ) {
    if (!destination) {
      throw portalError(
        'publication_snapshot_unavailable',
        'A verified destination must be pinned to the publication snapshot',
      )
    }
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
    const snapshot = buildPortalPublicationSnapshot({
      id: deps.idGen(),
      portalId: unbrand(existing.id),
      organizationId: unbrand(existing.organizationId),
      propertyId: unbrand(existing.propertyId),
      version: cursor.nextSnapshotVersion,
      source: applyPatchToPublicationSource(workingCopy, patch),
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
  if (
    existing.publicationState === 'published' &&
    (patch.publicationState === 'disabled' || patch.publicationState === 'archived')
  ) {
    return { kind: 'deactivate', reason: patch.publicationState, at }
  }
  return undefined
}

function hasPortalChanges(existing: Portal, patch: PortalPatch): boolean {
  return (
    patch.name !== existing.name ||
    patch.slug !== existing.slug ||
    patch.description !== existing.description ||
    patch.heroImageUrl !== existing.heroImageUrl ||
    JSON.stringify(patch.theme) !== JSON.stringify(existing.theme) ||
    patch.privateFeedbackThreshold !== existing.privateFeedbackThreshold ||
    patch.publicationState !== existing.publicationState
  )
}

function buildUpdatedPortal(
  existing: Portal,
  patch: PortalPatch,
  updatedAt: Date,
): Portal {
  return {
    ...existing,
    ...patch,
    updatedAt,
  }
}

export const updatePortal =
  (deps: UpdatePortalDeps) =>
  async (input: UpdatePortalInput, ctx: AuthContext): Promise<Portal> => {
    if (!canForContext(ctx, 'portal.update')) {
      throw portalError('forbidden', 'this role cannot edit portals')
    }

    const pid = toPortalId(input.portalId)
    const existing = await deps.portalRepo.findById(ctx.organizationId, pid)
    if (!existing) {
      throw portalError('portal_not_found', 'portal not found in this organization')
    }
    // Enforce property-assignment scoping (D6-001.)
    await assertPropertyAccess(
      deps.staffPublicApi,
      ctx,
      'portal.update',
      existing.propertyId,
    )

    const { patch, publicationDestination } = await buildPortalPatch(
      input,
      existing,
      deps,
      ctx.organizationId,
    )

    if (!hasPortalChanges(existing, patch)) {
      return existing
    }

    const occurredAt = deps.clock()
    const revision = nextPortalCommandAt(occurredAt, existing.updatedAt)
    const publication = await buildPublicationMutation(
      deps,
      existing,
      patch,
      publicationDestination,
      ctx,
      occurredAt,
    )
    await deps.commandStore.updatePortal({
      organizationId: ctx.organizationId,
      propertyId: existing.propertyId,
      portalId: pid,
      expectedUpdatedAt: existing.updatedAt,
      revision,
      occurredAt,
      patch,
      publication,
      event: portalUpdated({
        portalId: pid,
        organizationId: ctx.organizationId,
        propertyId: existing.propertyId,
        previousPublicationState: existing.publicationState,
        publicationState: patch.publicationState,
        sourceAggregateVersion: revision.toISOString(),
        occurredAt,
      }),
    })

    return buildUpdatedPortal(existing, patch, revision)
  }

export type UpdatePortal = ReturnType<typeof updatePortal>
