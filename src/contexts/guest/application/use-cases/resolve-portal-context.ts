import type { PortalId } from '#/shared/domain/ids'
import type { PortalContextResolver } from '../ports/portal-context-resolver.port'
import { guestError } from '../../domain/errors'

export type ResolvePortalContextDeps = Readonly<{
  portalContextResolver: PortalContextResolver
}>

export type ResolvePortalContextInput = Readonly<{
  portalId: PortalId
}>

export const resolvePortalContext =
  (deps: ResolvePortalContextDeps) => async (input: ResolvePortalContextInput) => {
    const ctx = await deps.portalContextResolver.resolve(input.portalId)
    if (!ctx) {
      throw guestError('portal_not_found', 'Portal not found')
    }
    return ctx
  }

export type ResolvePortalContext = ReturnType<typeof resolvePortalContext>
