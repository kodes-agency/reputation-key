// Portal context — create portal use case
// Full 7-step pattern: authorize → validate refs → check uniqueness → build → persist → emit → return

import type { PortalRepository } from '../ports/portal.repository'
import type { PropertyPublicApi } from '#/contexts/property/application/public-api'
import type { EventBus } from '#/shared/events/event-bus'
import type { Portal, PortalId } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { CreatePortalInput } from '../dto/create-portal.dto'
export type { CreatePortalInput }
import { normalizeSlug } from '../../domain/rules'
import { buildPortal } from '../../domain/constructors'
import { portalError } from '../../domain/errors'
import { portalCreated } from '../../domain/events'
import { propertyId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertNewPortalPropertyAccess } from '../load-accessible-portal'
import { emitAndRecord, type OutboxRepository } from '#/shared/outbox'

export type CreatePortalDeps = Readonly<{
  portalRepo: PortalRepository
  propertyApi: PropertyPublicApi
  staffPublicApi: StaffPublicApi
  events: EventBus
  idGen: () => PortalId
  clock: () => Date
  outboxRepo?: OutboxRepository
}>

export const createPortal =
  (deps: CreatePortalDeps) =>
  async (input: CreatePortalInput, ctx: AuthContext): Promise<Portal> => {
    // 1. Authorize + 2. validate referenced property exists + assignment access (D6-001)
    await assertNewPortalPropertyAccess(
      deps,
      ctx,
      input.propertyId,
      'this role cannot create portals',
    )

    // 3. Check uniqueness — slug must be unique per org+property
    const candidateSlug = input.slug ?? normalizeSlug(input.name)
    if (
      await deps.portalRepo.slugExists(
        ctx.organizationId,
        input.propertyId,
        candidateSlug,
      )
    ) {
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
      now: deps.clock(),
    })

    if (portalResult.isErr()) {
      throw portalResult.error
    }

    const portal = portalResult.value

    // 5. Persist
    await deps.portalRepo.insert(ctx.organizationId, portal)

    // 6. Emit event
    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
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

export type CreatePortal = ReturnType<typeof createPortal>
