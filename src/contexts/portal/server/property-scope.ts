import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import type { Capability } from '#/shared/auth/beta-capabilities'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import type { PortalError } from '../domain/errors'

export type PortalResourceScope = Readonly<{
  organizationId: string
  propertyId: string
  portalId?: string
}>

type PortalScopeOperation = Readonly<{
  actor: AuthContext
  action: Permission
  capability: Capability
  notFound: PortalError
}>

export async function requirePortalResourceScope(
  input: PortalScopeOperation &
    Readonly<{ lookup: () => Promise<PortalResourceScope | null> }>,
): Promise<PortalResourceScope> {
  const scope = await input.lookup()
  if (!scope || scope.organizationId !== input.actor.organizationId) {
    throw input.notFound
  }

  await requireExecutionAllowed({
    actor: input.actor,
    action: input.action,
    capability: input.capability,
    propertyId: scope.propertyId,
  })
  return scope
}

export async function requireMatchingPortalResourceScopes(
  input: PortalScopeOperation &
    Readonly<{
      lookups: readonly (() => Promise<PortalResourceScope | null>)[]
    }>,
): Promise<PortalResourceScope> {
  const scopes = await Promise.all(input.lookups.map((lookup) => lookup()))
  const authoritative = scopes[0]
  if (
    !authoritative ||
    scopes.some(
      (scope) =>
        !scope ||
        scope.organizationId !== input.actor.organizationId ||
        scope.organizationId !== authoritative.organizationId ||
        scope.propertyId !== authoritative.propertyId ||
        (authoritative.portalId !== undefined &&
          scope.portalId !== undefined &&
          scope.portalId !== authoritative.portalId),
    )
  ) {
    throw input.notFound
  }

  await requireExecutionAllowed({
    actor: input.actor,
    action: input.action,
    capability: input.capability,
    propertyId: authoritative.propertyId,
  })
  return authoritative
}
