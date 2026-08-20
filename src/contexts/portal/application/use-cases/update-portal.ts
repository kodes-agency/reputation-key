// Portal context — update portal use case

import type { PortalRepository } from '../ports/portal.repository'
import type { PortalLinkRepository } from '../ports/portal-link.repository'
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
} from '../../domain/rules'
import { portalError } from '../../domain/errors'
import { portalUpdated } from '../../domain/events'
import type { Result } from '#/shared/domain'
import type { PortalError } from '../../domain/errors'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertPropertyAccess } from '../assert-property-access'
import { emitAndRecord, type OutboxRepository } from '#/shared/outbox'
import { transitionPortalPublication } from '../../domain/portal-publication'

export type UpdatePortalDeps = Readonly<{
  portalRepo: PortalRepository
  portalLinkRepo: PortalLinkRepository
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
  publicationState: Portal['publicationState']
}

function unwrap<T>(r: Result<T, PortalError>): T {
  if (r.isErr()) throw r.error
  return r.value
}

async function buildPortalPatch(
  input: UpdatePortalInput,
  existing: Portal,
  deps: UpdatePortalDeps,
  orgId: OrganizationId,
): Promise<PortalPatch> {
  const patch: PortalPatch = {
    name:
      input.name !== undefined ? unwrap(validatePortalName(input.name)) : existing.name,
    slug: existing.slug,
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
    publicationState: existing.publicationState,
  }
  if (
    input.publicationState !== undefined &&
    input.publicationState !== existing.publicationState
  ) {
    const transition = transitionPortalPublication(
      existing.publicationState,
      input.publicationState,
    )
    if (typeof transition !== 'string') {
      throw portalError(
        'invalid_publication_transition',
        `cannot transition portal from ${transition.from} to ${transition.to}`,
      )
    }
    patch.publicationState = transition

    if (transition === 'published') {
      // A portal with no destinations renders as a bare title for guests —
      // public-portal-content.tsx has nothing to lay out. The publication state
      // machine cannot see this, so the precondition lives here.
      const links = await deps.portalLinkRepo.listAllLinks(orgId, existing.id)
      if (links.length === 0) {
        throw portalError(
          'portal_has_no_links',
          'add at least one link before publishing this portal',
        )
      }
    }
  }

  if (input.slug !== undefined && input.slug !== existing.slug) {
    patch.slug = unwrap(validateSlug(input.slug))
    if (
      await deps.portalRepo.slugExists(
        orgId,
        existing.propertyId as string,
        patch.slug,
        existing.id,
      )
    ) {
      throw portalError('slug_taken', 'a portal with this slug already exists')
    }
  }

  return patch
}

function hasPortalChanges(existing: Portal, patch: PortalPatch): boolean {
  return (
    patch.name !== existing.name ||
    patch.slug !== existing.slug ||
    patch.description !== existing.description ||
    patch.heroImageUrl !== existing.heroImageUrl ||
    JSON.stringify(patch.theme) !== JSON.stringify(existing.theme) ||
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
