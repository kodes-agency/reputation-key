// Organization query server functions (read operations).
// Per architecture: server/ contains TanStack Start server functions.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'

import { can } from '#/shared/domain/permissions'
import { getAuth } from '#/shared/auth/auth'
import { getContainer } from '#/composition'
import {
  extractOrgBillingFields,
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
        // No active organization is a valid state (new user, or org not yet
        // selected). Return a default instead of throwing — a thrown error
        // loses its `.code` across the server-function RPC boundary, so the
        // route beforeLoad can't recognize it and the page 500s.
        if (
          e instanceof Error &&
          'code' in e &&
          (e as { code: string }).code === 'no_active_org'
        ) {
          return { organization: null, role: 'Staff' as const }
        }
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
        const { identityPort } = getContainer()
        const members = await identityPort.listMembers(ctx)
        const mapped = members.map((m) => ({
          id: m.id,
          userId: m.userId,
          role: m.role,
          email: m.email,
          name: m.name,
          image: m.image,
          createdAt: m.createdAt,
        }))

        return { members: mapped, requestingRole: ctx.role }
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
