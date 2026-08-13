import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import type { TeamError } from '../domain/errors'

export type TeamResourceScope = Readonly<{
  organizationId: string
  propertyId: string
  teamId?: string
}>

type TeamScopeOperation = Readonly<{
  actor: AuthContext
  action: Permission
  notFound: TeamError
}>

export async function requireTeamResourceScope(
  input: TeamScopeOperation &
    Readonly<{ lookup: () => Promise<TeamResourceScope | null> }>,
): Promise<TeamResourceScope> {
  const scope = await input.lookup()
  if (!scope || scope.organizationId !== input.actor.organizationId) {
    throw input.notFound
  }

  await requireExecutionAllowed({
    actor: input.actor,
    action: input.action,
    propertyId: scope.propertyId,
  })
  return scope
}

export async function requireMatchingTeamResourceScopes(
  input: TeamScopeOperation &
    Readonly<{
      lookups: readonly (() => Promise<TeamResourceScope | null>)[]
    }>,
): Promise<TeamResourceScope> {
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
        (authoritative.teamId !== undefined &&
          scope.teamId !== undefined &&
          scope.teamId !== authoritative.teamId),
    )
  ) {
    throw input.notFound
  }

  await requireExecutionAllowed({
    actor: input.actor,
    action: input.action,
    propertyId: authoritative.propertyId,
  })
  return authoritative
}
