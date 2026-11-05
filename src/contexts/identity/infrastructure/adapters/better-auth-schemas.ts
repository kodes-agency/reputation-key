// Zod schemas for better-auth server API responses.
// Per architecture: validate external boundaries instead of casting.
// better-auth's server-side types return `Response` at compile time but
// parsed objects at runtime (better-auth/better-auth#6332). These schemas
// give us runtime safety and remove the need for `as unknown` casts.

import { z } from 'zod/v4'
import { identityError } from '../../domain/errors'
import type { IdentityErrorCode } from '../../domain/errors'

// ── Primitive schemas ───────────────────────────────────────────────

/** Invitation object returned by better-auth. */
export const betterAuthInvitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string(),
  // 'expired' is written by Identity (a lapsed invitation superseded by
  // another Organization's invite); Better Auth reads it back as free text.
  status: z.enum(['pending', 'accepted', 'rejected', 'canceled', 'expired']),
  expiresAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  organizationId: z.string().optional(),
  organization: z
    .object({
      name: z.string(),
    })
    .optional(),
  // Additional field added via auth.ts schema config — nullable column, so
  // accept null (better-auth returns null, not undefined, when unset on list).
  propertyIds: z.string().nullish(),
})

/** Organization object returned by better-auth. */
export const betterAuthOrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  logo: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
  contactEmail: z.string().nullable().optional(),
})

// ── Response schemas ────────────────────────────────────────────────

/** signUpEmail response — { token?: string | null, user: { id: string } } */
export const signUpResponseSchema = z.object({
  token: z.string().nullable().optional(),
  user: z.object({
    id: z.string(),
  }),
})

/** listUserInvitations response — array of invitations (may include org info). */
export const listUserInvitationsResponseSchema = z.array(betterAuthInvitationSchema)

// ── Parser helper ───────────────────────────────────────────────────

/** Parse a better-auth API response through a Zod schema.
 * Throws an IdentityError on validation failure so callers can
 * distinguish schema mismatches from other errors. */
export function parseBetterAuthResponse<T>(
  schema: z.ZodSchema<T>,
  raw: unknown,
  code: IdentityErrorCode,
  message: string,
): T {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw identityError(code, message, {
      zodIssues: parsed.error.issues.map((i) => i.message),
    })
  }
  return parsed.data
}
