// Identity context — server functions for organization and member management
// Per architecture: server/ contains TanStack Start server functions.
// These are thin — they validate input, resolve auth context, call use cases,
// and translate tagged errors to HTTP responses.

import { createServerFn } from '@tanstack/react-start'
import { match } from 'ts-pattern'
import { getAuth } from '#/shared/auth/auth'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
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
import type { IdentityError } from '../domain/errors'

// ── Error → HTTP translation ──────────────────────────────────────
// Per architecture: "ts-pattern with .exhaustive() ensures new error codes
// force a compiler error here."

export const identityErrorToResponse = (e: IdentityError) =>
  match(e.code)
    .with('forbidden', () => ({
      status: 403 as const,
      body: { error: e.code, message: e.message },
    }))
    .with('invalid_slug', 'invalid_name', () => ({
      status: 400 as const,
      body: { error: e.code, message: e.message },
    }))
    .with('registration_failed', () => ({
      status: 400 as const,
      body: { error: e.code, message: e.message },
    }))
    .with('org_setup_failed', () => ({
      // 409 Conflict — user account exists but org creation failed.
      // Client interprets this as "sign in first, then create an org."
      status: 409 as const,
      body: { error: e.code, message: e.message },
    }))
    .with('member_not_found', 'invitation_not_found', () => ({
      status: 404 as const,
      body: { error: e.code, message: e.message },
    }))
    .exhaustive()

/** Throw a tagged IdentityError as an HTTP Response. */
function throwIdentityError(e: IdentityError): never {
  const { status, body } = identityErrorToResponse(e)
  throw new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// ── Types for better-auth API responses ──────────────────────────
// better-auth returns loosely-typed responses; we define precise shapes
// for the fields we actually use.

type AuthMemberResponse = Readonly<{
  id: string
  userId: string
  role: string
  createdAt: Date
  user: Readonly<{ id: string; email: string; name: string; image: string | null }>
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
}>

// headersFromContext is imported from shared/auth/headers.ts —
// single source of truth for extracting request headers in server context.

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

export const resendInvitation = createServerFn({ method: 'POST' })
  .inputValidator(acceptInvitationInputSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    await resolveTenantContext(headers)

    // Look up the invitation to get the email and role for resending
    const auth = getAuth()
    const result = await auth.api.listInvitations({ headers })
    const invitations = (Array.isArray(result) ? result : []) as AuthInvitationResponse[]
    const invitation = invitations.find((inv) => inv.id === data.invitationId)

    if (!invitation) {
      throw new Response(
        JSON.stringify({
          error: 'invitation_not_found',
          message: 'Invitation not found',
        }),
        {
          status: 404,
          headers: { 'content-type': 'application/json' },
        },
      )
    }

    // Re-create with resend flag — better-auth handles deduplication
    await auth.api.createInvitation({
      headers,
      body: {
        email: invitation.email,
        role: invitation.role as 'owner' | 'admin' | 'member',
        resend: true,
      },
    })
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
      throw new Response(
        JSON.stringify({
          error: 'invalid_credentials',
          message: 'Invalid email or password',
        }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      )
    }
  })
