// Shared auth — the better-auth implementation of Identity's AuthSessionPort.
//
// ARC-03-T13: the composition root used to call `getAuth()` inline four times.
// The provider now lives behind one named adapter at the composition boundary,
// so the root selects an implementation instead of being one.

import { getAuth } from './auth'
import type { RequestHeadersProvider } from './tanstack-request-context'

/**
 * Named here rather than imported from the Identity context, for the reason in
 * tanstack-request-context.ts: shared may not depend on a context. Identity's
 * AuthSessionPort declares the same shape and the composition root joins them.
 */
export type AuthSessionOperations = Readonly<{
  setActiveOrganization: (organizationId: string) => Promise<void>
  updateOrganization: (data: Record<string, unknown>) => Promise<void>
  currentOrganizationName: () => Promise<string | null>
  verifyPassword: (
    input: Readonly<{ headers: Headers; password: string }>,
  ) => Promise<boolean>
}>

export type BetterAuthSessionDeps = Readonly<{
  requestContext: RequestHeadersProvider
}>

export function createBetterAuthSessionPort(
  deps: BetterAuthSessionDeps,
): AuthSessionOperations {
  return Object.freeze({
    setActiveOrganization: async (organizationId: string): Promise<void> => {
      const headers = await deps.requestContext.currentRequestHeaders()
      await getAuth().api.setActiveOrganization({ headers, body: { organizationId } })
    },
    updateOrganization: async (data: Record<string, unknown>): Promise<void> => {
      const headers = await deps.requestContext.currentRequestHeaders()
      await getAuth().api.updateOrganization({ headers, body: { data } })
    },
    currentOrganizationName: async (): Promise<string | null> => {
      const headers = await deps.requestContext.currentRequestHeaders()
      const organization = await getAuth().api.getFullOrganization({ headers })
      return organization?.name ?? null
    },
    verifyPassword: async ({
      headers,
      password,
    }: Readonly<{ headers: Headers; password: string }>): Promise<boolean> => {
      try {
        const result = await getAuth().api.verifyPassword({ headers, body: { password } })
        return result.status === true
      } catch {
        // A step-up that cannot be proven is not granted.
        return false
      }
    },
  })
}
