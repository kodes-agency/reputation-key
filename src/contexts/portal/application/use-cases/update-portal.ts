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
import {
  portalArchived,
  portalLocaleSetUpdated,
  portalPublicationPublished,
  portalRestored,
  portalUpdated,
} from '../../domain/events'
import type { Result } from '#/shared/domain'
import type { PortalError } from '../../domain/errors'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertPropertyAccess } from '../assert-property-access'
import { transitionPortalPublication } from '../../domain/portal-publication'
import type {
  PropertyGoogleReviewDestinationPublicApi,
  PropertyLifecyclePublicApi,
} from '#/contexts/property/application/public-api'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import type { PortalPublicationMutation } from '../ports/portal-command-store.port'
import type { PortalPublicationRepository } from '../ports/portal-publication.repository'
import type {
  PortalPublicationSource,
  VerifiedPublicationDestination,
} from '../../domain/portal-publication-snapshot'
import { buildPortalPublicationSnapshot } from '../portal-publication-snapshot'
import { nextPortalCommandAt } from '../portal-command-version'
import type { PortalTokenRepository } from '../ports/portal-token.repository'
import { derivePortalHealth } from '../../domain/portal-health'

export type UpdatePortalDeps = Readonly<{
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

type PortalPatch = {
  name: string
  slug: string
  description: string | null
  heroImageUrl: string | null
  theme: PortalTheme
  privateFeedbackThreshold: number
  publicationState: Portal['publicationState']
  primaryGuestLocale: Portal['primaryGuestLocale']
  additionalGuestLocales: Portal['additionalGuestLocales']
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
  | 'name'
  | 'description'
  | 'heroImageUrl'
  | 'theme'
  | 'privateFeedbackThreshold'
  | 'primaryGuestLocale'
  | 'additionalGuestLocales'
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
    primaryGuestLocale: input.primaryGuestLocale ?? existing.primaryGuestLocale,
    additionalGuestLocales:
      input.additionalGuestLocales ?? existing.additionalGuestLocales,
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

async function assertPropertyAllowsPublication(
  deps: UpdatePortalDeps,
  orgId: OrganizationId,
  existing: Portal,
): Promise<void> {
  let active = false
  try {
    active = await deps.propertyLifecycleApi.isPropertyActive(orgId, existing.propertyId)
  } catch {
    // The lifecycle authority is a publication safety gate. Its implementation
    // details are deliberately not exposed through the Portal error boundary.
  }
  if (!active) {
    throw portalError(
      'portal_inactive',
      'This Portal cannot be published while its Property is unavailable',
    )
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
    await assertPropertyAllowsPublication(deps, orgId, existing)
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
  if (
    content.additionalGuestLocales.includes(content.primaryGuestLocale) ||
    new Set(content.additionalGuestLocales).size !== content.additionalGuestLocales.length
  ) {
    throw portalError(
      'publication_snapshot_unavailable',
      'Additional guest locales must be unique and must not repeat the primary locale',
    )
  }
  if (
    input.publicationState === 'published' &&
    (input.primaryGuestLocale !== undefined || input.additionalGuestLocales !== undefined)
  ) {
    throw portalError(
      'publication_snapshot_unavailable',
      'Save guest locale changes before publishing the Portal',
    )
  }
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
    if (existing.responsibilityNeededSince !== null) {
      throw portalError(
        'responsible_manager_ineligible',
        'Assign at least one responsible manager before publishing',
      )
    }
    const address = await deps.portalTokenRepo.findResolvableSummaryForPortal(
      ctx.organizationId,
      existing.id,
      at,
    )
    if (!address?.hasPublishedAccessArtifact) {
      throw portalError(
        'token_unavailable',
        'Create the Portal public address before publishing',
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
    if (!workingCopy.experience) {
      throw portalError(
        'publication_snapshot_unavailable',
        'Complete the Property Brand Profile and every enabled guest locale before publishing',
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
    patch.primaryGuestLocale !== existing.primaryGuestLocale ||
    JSON.stringify(patch.additionalGuestLocales) !==
      JSON.stringify(existing.additionalGuestLocales) ||
    patch.publicationState !== existing.publicationState
  )
}

function assertArchivedMutationIsRestore(
  input: UpdatePortalInput,
  existing: Portal,
): void {
  if (existing.publicationState !== 'archived') return

  // Keep invalid attempts to publish an archived Portal on the ordinary
  // transition-error path. The sole accepted archived mutation is an explicit,
  // unbundled restore to Disabled; archived configuration itself is read-only.
  if (
    input.publicationState === 'published' ||
    input.publicationState === 'draft' ||
    (input.publicationState === 'archived' && Object.keys(input).length === 2)
  ) {
    return
  }
  const keys = Object.keys(input)
  const isRestoreOnly =
    input.publicationState === 'disabled' &&
    keys.length === 2 &&
    keys.includes('portalId') &&
    keys.includes('publicationState')
  if (!isRestoreOnly) {
    throw portalError(
      'portal_inactive',
      'Archived Portal configuration is read-only; restore it before editing',
    )
  }
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

    assertArchivedMutationIsRestore(input, existing)

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
    const publicationStateChanged = existing.publicationState !== patch.publicationState
    const localeSetChanged =
      existing.primaryGuestLocale !== patch.primaryGuestLocale ||
      JSON.stringify(existing.additionalGuestLocales) !==
        JSON.stringify(patch.additionalGuestLocales)
    const health = publicationStateChanged
      ? {
          id: deps.idGen(),
          value: derivePortalHealth({
            publicationState: patch.publicationState,
            propertyAvailable: true,
            hasActivePublicationSnapshot: patch.publicationState === 'published',
            hasResolvablePublicAddress: patch.publicationState === 'published',
            hasResponsibleManager:
              patch.publicationState === 'published'
                ? existing.responsibilityNeededSince === null
                : false,
            googleDestinationState:
              patch.publicationState === 'published' ? 'verified' : 'unavailable',
          }),
          sourceVersion: revision.toISOString(),
          effectiveAt: occurredAt,
          observedAt: occurredAt,
        }
      : undefined
    const lifecycleEvent =
      publication?.kind === 'publish'
        ? portalPublicationPublished({
            organizationId: ctx.organizationId,
            propertyId: existing.propertyId,
            portalId: pid,
            publicationSnapshotId: publication.snapshot.id,
            publicationVersion: publication.snapshot.version,
            publicationDigest: publication.snapshot.configurationDigest,
            userId: ctx.userId,
            sourceAggregateVersion: revision.toISOString(),
            occurredAt,
          })
        : existing.publicationState !== 'archived' &&
            patch.publicationState === 'archived'
          ? portalArchived({
              organizationId: ctx.organizationId,
              propertyId: existing.propertyId,
              portalId: pid,
              userId: ctx.userId,
              sourceAggregateVersion: revision.toISOString(),
              occurredAt,
            })
          : existing.publicationState === 'archived' &&
              patch.publicationState === 'disabled'
            ? portalRestored({
                organizationId: ctx.organizationId,
                propertyId: existing.propertyId,
                portalId: pid,
                userId: ctx.userId,
                sourceAggregateVersion: revision.toISOString(),
                occurredAt,
              })
            : undefined
    await deps.commandStore.updatePortal({
      organizationId: ctx.organizationId,
      propertyId: existing.propertyId,
      portalId: pid,
      actorUserId: ctx.userId,
      expectedUpdatedAt: existing.updatedAt,
      revision,
      occurredAt,
      patch,
      publication,
      health,
      lifecycleEvent,
      localeSetEvent: localeSetChanged
        ? portalLocaleSetUpdated({
            portalId: pid,
            organizationId: ctx.organizationId,
            propertyId: existing.propertyId,
            primaryGuestLocale: patch.primaryGuestLocale,
            additionalGuestLocales: patch.additionalGuestLocales,
            sourceAggregateVersion: revision.toISOString(),
            occurredAt,
          })
        : undefined,
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
