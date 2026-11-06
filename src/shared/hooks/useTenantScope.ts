import { useRouterState } from '@tanstack/react-router'
import { tenantScope, type TenantScope } from '#/shared/queries/tenant-scope'

export function useTenantScope(): TenantScope {
  const scope = useRouterState({
    select: (state): TenantScope | null => {
      const context = state.matches.at(-1)?.context as
        | {
            user?: { id: string }
            activeOrganization?: { id: string } | null
            staffUserId?: string
            entry?: { kind: string; userId?: string }
          }
        | undefined
      const userId = context?.staffUserId ?? context?.user?.id ?? context?.entry?.userId
      if (!userId) return null
      return tenantScope({
        user: { id: userId },
        activeOrganization: context?.staffUserId ? null : context?.activeOrganization,
      })
    },
    structuralSharing: true,
  })
  if (!scope) throw new Error('A signed-in query requires a person in route context')
  return scope
}
