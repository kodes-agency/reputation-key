// Organization query server functions (read operations).
// Per architecture: server/ contains TanStack Start server functions.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { requireAuth, resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { toDomainRole } from '#/shared/domain/roles'
import { can } from '#/shared/domain/permissions'
import { getAuth } from '#/shared/auth/auth'
import {
  extractOrgBillingFields,
  type AuthMemberResponse,
  type AuthOrganizationResponse,
} from './organizations.shared'

// ── Get active organization ────────────────────────────────────────

export const getActiveOrganization = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () => {
      try {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'dashboard.read')) {
          throwContextError(
            'AuthError',
            {
              code: 'forbidden',
              message: 'Insufficient permissions to read organization',
            },
            403,
          )
        }
        const auth = getAuth()

        const org = await auth.api.getFullOrganization({ headers })

        if (!org) {
          return { organization: null, role: ctx.role }
        }

        return {
          organization: {
            id: org.id,
            name: org.name,
            slug: org.slug,
            logo: org.logo ?? null,
            createdAt: org.createdAt,
            ...extractOrgBillingFields(org),
          },
          role: ctx.role,
        }
      } catch (e) {
        throw catchUntagged(e)
      }
    },
    'GET',
    'identity.getActiveOrganization',
  ),
)

// ── List members ────────────────────────────────────────────────────

export const listMembers = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () => {
      try {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'member.list')) {
          throwContextError(
            'AuthError',
            { code: 'forbidden', message: 'Insufficient permissions to list members' },
            403,
          )
        }
        const auth = getAuth()

        const result = await auth.api.listMembers({ headers })

        // F048: Null-safe fallback for listMembers response
        const rawMembers = (result?.members ??
          (Array.isArray(result) ? result : null)) as AuthMemberResponse[] | null
        if (!rawMembers) {
          return { members: [], requestingRole: ctx.role }
        }
        const members = rawMembers.map((m) => ({
          id: m.id,
          userId: m.userId,
          role: toDomainRole(m.role),
          email: m.user?.email ?? '',
          name: m.user?.name ?? '',
          image: m.user?.image ?? null,
          createdAt: m.createdAt,
        }))

        return { members, requestingRole: ctx.role }
      } catch (e) {
        throw catchUntagged(e)
      }
    },
    'GET',
    'identity.listMembers',
  ),
)

// ── List user's organizations ──────────────────────────────────────

export const listUserOrganizations = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () => {
      try {
        const headers = await headersFromContext()
        await requireAuth(headers)
        const auth = getAuth()

        const result = await auth.api.listOrganizations({ headers })

        const rawOrgs = (
          Array.isArray(result) ? result : []
        ) as AuthOrganizationResponse[]
        const organizations = rawOrgs.map((org) => ({
          id: org.id,
          name: org.name,
          slug: org.slug,
          logo: org.logo ?? null,
          createdAt: org.createdAt,
          ...extractOrgBillingFields(org),
        }))

        return { organizations }
      } catch (e) {
        throw catchUntagged(e)
      }
    },
    'GET',
    'identity.listUserOrganizations',
  ),
)
