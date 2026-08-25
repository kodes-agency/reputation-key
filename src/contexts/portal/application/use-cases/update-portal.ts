// Portal context — update portal use case

import type { PortalRepository } from '../ports/portal.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { Portal, PortalTheme } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { UpdatePortalInput } from '../dto/update-portal.dto'
export type { UpdatePortalInput }
import { canForContext } from '#/shared/domain/permissions'
import { portalId as toPortalId, type OrganizationId } from '#/shared/domain/ids'
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
import { emitAndRecord, type OutboxRepository } from '#/shared/outbox'
import { transitionPortalPublication } from '../../domain/portal-publication'
import type { PropertyGoogleReviewDestinationPublicApi } from '#/contexts/property/application/public-api'

export type UpdatePortalDeps = Readonly<{
  portalRepo: PortalRepository
  propertyGoogleReviewDestinationApi: PropertyGoogleReviewDestinationPublicApi
  staffPublicApi: StaffPublicApi
  events: EventBus
  clock: () => Date
  outboxRepo?: OutboxRepository
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
  return {
    name:
      input.name !== undefined ? unwrap(validatePortalName(input.name)) : existing.name,
    description:
      input.description !== undefined
        ? unwrap(validateDescription(input.description))
        : existing.description,
    // `null` clears the hero image; `undefined` (absent key) leaves it untouched.
    heroImageUrl:
      input.heroImageUrl !== undefined ? input.heroImageUrl : existing.heroImageUrl,
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

async function assertGoogleReviewDestinationAvailable(
  deps: UpdatePortalDeps,
  orgId: OrganizationId,
  existing: Portal,
): Promise<void> {
  const destination =
    await deps.propertyGoogleReviewDestinationApi.getGoogleReviewDestination(
      orgId,
      existing.propertyId,
    )
  if (destination?.state !== 'verified' || destination.uri === null) {
    throw portalError(
      'google_review_destination_unavailable',
      'connect and refresh this property’s Google review destination before publishing',
    )
  }
}

async function resolvePublicationState(
  input: UpdatePortalInput,
  existing: Portal,
  deps: UpdatePortalDeps,
  orgId: OrganizationId,
): Promise<Portal['publicationState']> {
  const requested = input.publicationState
  if (requested === undefined || requested === existing.publicationState) {
    return existing.publicationState
  }
  const transition = transitionPortalPublication(existing.publicationState, requested)
  if (typeof transition !== 'string') {
    throw portalError(
      'invalid_publication_transition',
      `cannot transition portal from ${transition.from} to ${transition.to}`,
    )
  }
  if (transition === 'published') {
    await assertGoogleReviewDestinationAvailable(deps, orgId, existing)
  }
  return transition
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
): Promise<PortalPatch> {
  // Order is load-bearing: content validation, then the publication precondition,
  // then slug uniqueness — so which error surfaces first stays stable.
  const content = resolvePortalContentFields(input, existing)
  const publicationState = await resolvePublicationState(input, existing, deps, orgId)
  const slug = await resolveSlug(input, existing, deps, orgId)
  return { ...content, slug, publicationState }
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

    const patch = await buildPortalPatch(input, existing, deps, ctx.organizationId)

    if (!hasPortalChanges(existing, patch)) {
      return existing
    }

    const updatedAt = deps.clock()
    await deps.portalRepo.update(ctx.organizationId, pid, {
      ...patch,
      updatedAt,
    })

    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
      portalUpdated({
        portalId: pid,
        organizationId: ctx.organizationId,
        name: patch.name,
        slug: patch.slug,
        occurredAt: updatedAt,
      }),
    )

    return buildUpdatedPortal(existing, patch, updatedAt)
  }

export type UpdatePortal = ReturnType<typeof updatePortal>
