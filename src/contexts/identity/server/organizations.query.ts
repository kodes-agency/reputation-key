// Organization query server functions (read operations).
// Per architecture: server/ contains TanStack Start server functions.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'

import { canForContext } from '#/shared/domain/permissions'
import { getContainer } from '#/composition'

// ── Get active organization ────────────────────────────────────────

export const getActiveOrganization = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () => {
      try {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!canForContext(ctx, 'dashboard.read')) {
          throwContextError(
            'AuthError',
            {
              code: 'forbidden',
              message: 'Insufficient permissions to read organization',
            },
            403,
          )
        }
        const { identityPort } = getContainer()

        const org = await identityPort.getActiveOrg(headers)

        if (!org) {
          return { organization: null, role: ctx.role }
        }

        return {
          organization: {
            id: org.id,
            name: org.name,
            slug: org.slug,
            logo: org.logo,
            createdAt: org.createdAt,
            contactEmail: org.contactEmail,
            billingCompanyName: org.billingCompanyName,
            billingAddress: org.billingAddress,
            billingCity: org.billingCity,
            billingPostalCode: org.billingPostalCode,
            billingCountry: org.billingCountry,
            responseSlaHours: org.responseSlaHours,
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
        if (!canForContext(ctx, 'member.list')) {
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
        const { identityPort } = getContainer()

        const organizations = await identityPort.listUserOrganizations(headers)

        return { organizations }
      } catch (e) {
        throw catchUntagged(e)
      }
    },
    'GET',
    'identity.listUserOrganizations',
  ),
)
