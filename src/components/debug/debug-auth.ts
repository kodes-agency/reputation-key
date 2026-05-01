// Debug server function — returns raw auth state for debugging role issues.
// Remove when no longer needed.

import { createServerFn } from '@tanstack/react-start'
import { getAuth } from '#/shared/auth/auth'
import { headersFromContext } from '#/shared/auth/headers'

type DebugMember = {
  userId: string
  name: string | undefined
  email: string | undefined
  role: string
}

type DebugActiveMember = DebugMember & { id: string; error?: string }

export const debugAuthState = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = headersFromContext()
  const auth = getAuth()

  const session = await auth.api.getSession({ headers })

  if (!session) {
    return {
      session: null as string | null,
      activeMember: null as DebugActiveMember | null,
      members: [] as DebugMember[],
    }
  }

  const activeOrgId = session.session.activeOrganizationId ?? null

  const activeMember: DebugActiveMember | null = await (async () => {
    try {
      const m = await auth.api.getActiveMember({ headers })
      const raw = m as {
        id: unknown
        userId?: unknown
        role?: unknown
        user?: { email?: unknown; name?: unknown }
      }
      return raw
        ? {
            id: String(raw.id ?? ''),
            userId: String(raw.userId ?? ''),
            role: String(raw.role ?? ''),
            email: String(raw.user?.email ?? ''),
            name: String(raw.user?.name ?? ''),
          }
        : null
    } catch (e) {
      return {
        id: '',
        userId: '',
        role: '',
        email: '',
        name: '',
        error: e instanceof Error ? e.message : String(e),
      }
    }
  })()

  const members: DebugMember[] = await (async () => {
    try {
      const list = await auth.api.listMembers({ headers })
      const raw = (
        Array.isArray(list) ? list : ((list as { members?: unknown })?.members ?? [])
      ) as Array<{
        user?: { id?: string; name?: string; email?: string }
        userId?: string
        role?: string
      }>
      return raw.map((m) => ({
        userId: String(m.user?.id ?? m.userId ?? ''),
        name: String(m.user?.name ?? ''),
        email: String(m.user?.email ?? ''),
        role: String(m.role ?? ''),
      }))
    } catch (e) {
      return [
        {
          userId: '',
          name: '',
          email: '',
          role: `ERROR: ${e instanceof Error ? e.message : String(e)}`,
        },
      ]
    }
  })()

  return {
    session: {
      userId: session.user.id,
      email: session.user.email,
      name: session.user.name,
      activeOrganizationId: activeOrgId,
    },
    activeMember,
    members,
  }
})
