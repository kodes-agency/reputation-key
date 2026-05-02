// Identity context — server functions for organization and member management
// Per architecture: server/ contains TanStack Start server functions.
// These are thin — they validate input, resolve auth context, call use cases,
// and translate tagged errors to HTTP responses.

import { createServerFn } from '@tanstack/react-start'
import { match } from 'ts-pattern'
import { z } from 'zod/v4'
import { getAuth } from '#/shared/auth/auth'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError } from '#/shared/auth/server-errors'
import { toDomainRole } from '#/shared/domain/roles'
import { getContainer } from '#/composition'
import {
  inviteMemberInputSchema,
  acceptInvitationInputSchema,
  updateMemberRoleInputSchema,
  removeMemberInputSchema,
  registerUserInputSchema,
  registerMemberInputSchema,
  setActiveOrgInputSchema,
  signInInputSchema,
} from '../application/dto/invitation.dto'
import { isIdentityError } from '../domain/errors'
import type { IdentityError, IdentityErrorCode } from '../domain/errors'

// ── Error → HTTP translation ──────────────────────────────────────
// Per architecture: "ts-pattern with .exhaustive() ensures new error codes
// force a compiler error here."

export const identityErrorStatus = (code: IdentityErrorCode): number =>
  match(code)
    .with('forbidden', () => 403)
    .with('invalid_slug', 'invalid_name', () => 400)
    .with('registration_failed', () => 400)
    .with('org_setup_failed', () => 409)
    .with('member_not_found', 'invitation_not_found', () => 404)
    .exhaustive()

/** Throw a tagged IdentityError as an Error object (not Response).
 * Per architecture: "Server functions throw Error objects with .name, .message, .code, .status." */
function throwIdentityError(e: IdentityError): never {
  throwContextError('IdentityError', e, identityErrorStatus(e.code))
}

// ── Types for better-auth API responses ──────────────────────────
// better-auth returns loosely-typed responses; we define precise shapes
// for the fields we actually use.

type AuthMemberResponse = Readonly<{
  id: string
  userId: string
  role: string
  createdAt: Date
  user: Readonly<{
    id: string
    email: string
    name: string
    image: string | null
  }>
}>

type AuthInvitationResponse = Readonly<{
  id: string
  email: string
  role: string
  status: string
  expiresAt: Date
  createdAt: Date
  organizationId?: string
  organization?: Readonly<{ name: string }>
}>

type AuthOrganizationResponse = Readonly<{
  id: string
  name: string
  slug: string
  logo: string | null
  createdAt: Date
  contactEmail: string | null
  billingCompanyName: string | null
  billingAddress: string | null
  billingCity: string | null
  billingPostalCode: string | null
  billingCountry: string | null
}>

// headersFromContext is imported from shared/auth/headers.ts —
// single source of truth for extracting request headers in server context.

// ── Helper: Extract billing fields from loosely-typed org response ────────

function extractOrgBillingFields(org: unknown): {
  contactEmail: string | null
  billingCompanyName: string | null
  billingAddress: string | null
  billingCity: string | null
  billingPostalCode: string | null
  billingCountry: string | null
} {
  const o = org as Record<string, unknown>
  return {
    contactEmail: (o.contactEmail as string | null) ?? null,
    billingCompanyName: (o.billingCompanyName as string | null) ?? null,
    billingAddress: (o.billingAddress as string | null) ?? null,
    billingCity: (o.billingCity as string | null) ?? null,
    billingPostalCode: (o.billingPostalCode as string | null) ?? null,
    billingCountry: (o.billingCountry as string | null) ?? null,
  }
}

// ── Get active organization ────────────────────────────────────────

export const getActiveOrganization = createServerFn({ method: 'GET' }).handler(
  async () => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)
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
  },
)

// ── List members ────────────────────────────────────────────────────

export const listMembers = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = headersFromContext()
  const ctx = await resolveTenantContext(headers)
  const auth = getAuth()

  const result = await auth.api.listMembers({ headers })

  const rawMembers = (result?.members ?? result ?? []) as AuthMemberResponse[]
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
})

// ── Invite member ──────────────────────────────────────────────────
// Uses the use case through the composition root.

export const inviteMember = createServerFn({ method: 'POST' })
  .inputValidator(inviteMemberInputSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)

    try {
      const { useCases } = getContainer()
      await useCases.inviteMember(data, ctx)
    } catch (e) {
      if (isIdentityError(e)) throwIdentityError(e)
      throw e
    }
  })

// ── Accept invitation ──────────────────────────────────────────────

export const acceptInvitation = createServerFn({ method: 'POST' })
  .inputValidator(acceptInvitationInputSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const auth = getAuth()

    await auth.api.acceptInvitation({
      headers,
      body: { invitationId: data.invitationId },
    })
  })

// ── Reject invitation ──────────────────────────────────────────────

export const rejectInvitation = createServerFn({ method: 'POST' })
  .inputValidator(acceptInvitationInputSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const auth = getAuth()

    await auth.api.rejectInvitation({
      headers,
      body: { invitationId: data.invitationId },
    })
  })

// ── Cancel invitation ──────────────────────────────────────────────

export const cancelInvitation = createServerFn({ method: 'POST' })
  .inputValidator(acceptInvitationInputSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    await resolveTenantContext(headers)
    const auth = getAuth()

    await auth.api.cancelInvitation({
      headers,
      body: { invitationId: data.invitationId },
    })
  })

// ── Resend invitation ──────────────────────────────────────────────
// Uses the use case through the composition root.

export const resendInvitation = createServerFn({ method: 'POST' })
  .inputValidator(acceptInvitationInputSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)

    try {
      const { useCases } = getContainer()
      await useCases.resendInvitation(data, ctx)
    } catch (e) {
      if (isIdentityError(e)) throwIdentityError(e)
      throw e
    }
  })

// ── List invitations ────────────────────────────────────────────────
// Uses the use case through the composition root.

export const listInvitations = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = headersFromContext()
  const ctx = await resolveTenantContext(headers)

  try {
    const { useCases } = getContainer()
    return await useCases.listInvitations(undefined, ctx)
  } catch (e) {
    if (isIdentityError(e)) throwIdentityError(e)
    throw e
  }
})

// ── Update member role ──────────────────────────────────────────────
// Uses the use case through the composition root.

export const updateMemberRole = createServerFn({ method: 'POST' })
  .inputValidator(updateMemberRoleInputSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)

    try {
      const { useCases } = getContainer()
      await useCases.updateMemberRole(data, ctx)
    } catch (e) {
      if (isIdentityError(e)) throwIdentityError(e)
      throw e
    }
  })

// ── Remove member ──────────────────────────────────────────────────
// Uses the use case through the composition root.

export const removeMember = createServerFn({ method: 'POST' })
  .inputValidator(removeMemberInputSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)

    try {
      const { useCases } = getContainer()
      await useCases.removeMember(data, ctx)
    } catch (e) {
      if (isIdentityError(e)) throwIdentityError(e)
      throw e
    }
  })

// ── List user invitations (for accept invitation page) ──────────────

export const listUserInvitations = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = headersFromContext()
  const auth = getAuth()

  const result = await auth.api.listUserInvitations({ headers })

  const rawInvitations = (Array.isArray(result) ? result : []) as AuthInvitationResponse[]
  const invitations = rawInvitations.map((inv) => ({
    id: inv.id,
    organizationId: inv.organizationId,
    organizationName: inv.organization?.name ?? 'Unknown Organization',
    email: inv.email,
    role: toDomainRole(inv.role),
    status: inv.status,
    expiresAt: inv.expiresAt,
    createdAt: inv.createdAt,
  }))

  return { invitations }
})

// ── Set active organization ────────────────────────────────────────

export const setActiveOrganization = createServerFn({ method: 'POST' })
  .inputValidator(setActiveOrgInputSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const auth = getAuth()

    await auth.api.setActiveOrganization({
      headers,
      body: { organizationId: data.organizationId },
    })
  })

// ── List user's organizations ──────────────────────────────────────

export const listUserOrganizations = createServerFn({ method: 'GET' }).handler(
  async () => {
    const headers = headersFromContext()
    const auth = getAuth()

    const session = await auth.api.getSession({ headers })
    if (!session) {
      return { organizations: [] }
    }

    const result = await auth.api.listOrganizations({ headers })

    const rawOrgs = (Array.isArray(result) ? result : []) as AuthOrganizationResponse[]
    const organizations = rawOrgs.map((org) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      logo: org.logo ?? null,
      createdAt: org.createdAt,
      ...extractOrgBillingFields(org),
    }))

    return { organizations }
  },
)

// ── Register user only (no organization) ────────────────────────────
// Used by invited members joining an existing org via /join.
// Per architecture: server function is thin — validate input, call use case, translate errors.

export const registerMember = createServerFn({ method: 'POST' })
  .inputValidator(registerMemberInputSchema)
  .handler(async ({ data }) => {
    try {
      const { useCases } = getContainer()
      await useCases.registerUser(data)
    } catch (e) {
      if (isIdentityError(e)) throwIdentityError(e)
      throw e
    }
  })

// ── Register user + create organization ────────────────────────────
// Uses the use case through the composition root.

export const registerUserAndOrg = createServerFn({ method: 'POST' })
  .inputValidator(registerUserInputSchema)
  .handler(async ({ data }) => {
    try {
      const { useCases } = getContainer()
      await useCases.registerUserAndOrg(data)
    } catch (e) {
      if (isIdentityError(e)) throwIdentityError(e)
      throw e
    }
  })

// ── Sign in user ────────────────────────────────────────────────────
// Direct delegation: no use case because this is pure delegation to better-auth.

export const signInUser = createServerFn({ method: 'POST' })
  .inputValidator(signInInputSchema)
  .handler(async ({ data }) => {
    const auth = getAuth()

    try {
      await auth.api.signInEmail({
        body: { email: data.email, password: data.password },
      })
    } catch {
      throwContextError(
        'AuthError',
        { code: 'invalid_credentials', message: 'Invalid email or password' },
        401,
      )
    }
  })

// ── Update organization ──────────────────────────────────────────────
// Updates organization metadata including billing fields.

const updateOrganizationInputSchema = z
  .object({
    name: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    logo: z.string().nullable().optional(),
    contactEmail: z.string().email().nullable().optional(),
    billingCompanyName: z.string().nullable().optional(),
    billingAddress: z.string().nullable().optional(),
    billingCity: z.string().nullable().optional(),
    billingPostalCode: z.string().nullable().optional(),
    billingCountry: z.string().nullable().optional(),
  })
  .strict()

export const updateOrganization = createServerFn({ method: 'POST' })
  .inputValidator(updateOrganizationInputSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)
    const auth = getAuth()

    // Validate role - only Owner or PropertyManager can update organization
    if (ctx.role !== 'Owner' && ctx.role !== 'PropertyManager') {
      throwContextError(
        'AuthError',
        {
          code: 'forbidden',
          message: 'Only Owner or PropertyManager can update organization',
        },
        403,
      )
    }

    await auth.api.updateOrganization({
      headers,
      body: { data },
    })
  })
