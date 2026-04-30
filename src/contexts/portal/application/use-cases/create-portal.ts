// Portal context — create portal use case
// Full 7-step pattern: authorize → validate refs → check uniqueness → build → persist → emit → return

import type { PortalRepository } from '../ports/portal.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { Portal, PortalId } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { CreatePortalInput } from '../dto/create-portal.dto'
import { can } from '#/shared/domain/permissions'
import { normalizeSlug } from '../../domain/rules'
import { buildPortal } from '../../domain/constructors'
import { portalError } from '../../domain/errors'
import { portalCreated } from '../../domain/events'
import { propertyId } from '#/shared/domain/ids'

// fallow-ignore-next-line unused-type
export type CreatePortalDeps = Readonly<{
  portalRepo: PortalRepository
  propertyExists: (orgId: string, propertyId: string) => Promise<boolean>
  events: EventBus
  idGen: () => PortalId
  clock: () => Date
}>

export const createPortal =
  (deps: CreatePortalDeps) =>
  async (input: CreatePortalInput, ctx: AuthContext): Promise<Portal> => {
    // 1. Authorize
    if (!can(ctx.role, 'portal.create')) {
      throw portalError('forbidden', 'this role cannot create portals')
    }

    // 2. Validate referenced property exists
    if (!(await deps.propertyExists(ctx.organizationId, input.propertyId))) {
      throw portalError('property_not_found', 'property not found in this organization')
    }

    // 3. Check uniqueness — slug must be unique per org
    const candidateSlug = input.slug ?? normalizeSlug(input.name)
    if (await deps.portalRepo.slugExists(ctx.organizationId, candidateSlug)) {
      throw portalError('slug_taken', 'a portal with this slug already exists')
    }

    // 4. Build domain object
    const portalResult = buildPortal({
      id: deps.idGen(),
      organizationId: ctx.organizationId,
      propertyId: propertyId(input.propertyId),
      entityType: input.entityType,
      entityId: input.entityId,
      name: input.name,
      providedSlug: input.slug,
      description: input.description,
      theme: input.theme,
      smartRoutingEnabled: input.smartRoutingEnabled,
      smartRoutingThreshold: input.smartRoutingThreshold,
      now: deps.clock(),
    })

    if (portalResult.isErr()) {
      throw portalResult.error
    }

    const portal = portalResult.value

    // 5. Persist
    await deps.portalRepo.insert(ctx.organizationId, portal)

    // 6. Emit event
    deps.events.emit(
      portalCreated({
        portalId: portal.id,
        organizationId: portal.organizationId,
        name: portal.name,
        slug: portal.slug,
        occurredAt: portal.createdAt,
      }),
    )

    // 7. Return
    return portal
  }

// fallow-ignore-next-line unused-type
export type CreatePortal = ReturnType<typeof createPortal>
