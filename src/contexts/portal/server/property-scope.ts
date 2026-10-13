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
    authoritative.organizationId !== input.actor.organizationId ||
    scopes.some((scope) => !sitsInScope(authoritative, scope))
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

/**
 * Resources a caller named beside a scope the policy has already admitted: each
 * must exist and sit in that scope. It asks no policy, so it runs only after
 * `requirePortalResourceScope` or `requireMatchingPortalResourceScopes` has
 * returned that scope. A request that names many rows (a link reorder) is read
 * this way, so a caller the policy refuses never costs a lookup per row.
 */
export async function requireResourcesInPortalScope(
  input: Readonly<{
    scope: PortalResourceScope
    notFound: PortalError
    lookups: readonly (() => Promise<PortalResourceScope | null>)[]
  }>,
): Promise<void> {
  const scopes = await Promise.all(input.lookups.map((lookup) => lookup()))
  if (scopes.some((scope) => !sitsInScope(input.scope, scope))) throw input.notFound
}

/** Same Organization and Property, and the same Portal where both name one. */
function sitsInScope(
  authoritative: PortalResourceScope,
  scope: PortalResourceScope | null,
): boolean {
  if (!scope) return false
  return (
    scope.organizationId === authoritative.organizationId &&
    scope.propertyId === authoritative.propertyId &&
    (authoritative.portalId === undefined ||
      scope.portalId === undefined ||
      scope.portalId === authoritative.portalId)
  )
}
