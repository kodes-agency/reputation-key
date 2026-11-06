import { useRouterState } from '@tanstack/react-router'
import { tenantScope, type TenantScope } from '#/shared/queries/tenant-scope'

export function useTenantScope(): TenantScope {
  const scope = useRouterState({
    select: (state): TenantScope | null => {
      // A pending boundary presents the whole destination branch before every
      // descendant's beforeLoad has inherited its parent's context.
      for (let index = state.matches.length - 1; index >= 0; index--) {
        const context = state.matches[index]?.context as
          | {
              user?: { id: string }
              activeOrganization?: { id: string } | null
              staffUserId?: string
              entry?: { kind: string; userId?: string }
            }
          | undefined
        const userId = context?.staffUserId ?? context?.user?.id ?? context?.entry?.userId
        if (!userId) continue
        return tenantScope({
          user: { id: userId },
          activeOrganization: context?.staffUserId ? null : context?.activeOrganization,
        })
      }
      return null
    },
    structuralSharing: true,
  })
  if (!scope) throw new Error('A signed-in query requires a person in route context')
  return scope
}
