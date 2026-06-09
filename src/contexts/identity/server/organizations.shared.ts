// Shared types, helpers, and error mapping for organization server functions.
// Extracted from organizations.ts to keep each file ≤150 lines.

import { HTTP_STATUS } from '#/shared/http/status'
import { throwContextError } from '#/shared/auth/server-errors'
import { match } from 'ts-pattern'
import type { IdentityError, IdentityErrorCode } from '../domain/errors'

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 // 5MB

// ── Error → HTTP translation ──────────────────────────────────────
// Per architecture: "ts-pattern with .exhaustive() ensures new error codes
// force a compiler error here."

export const identityErrorStatus = (code: IdentityErrorCode): number =>
  match(code)
    .with('forbidden', () => HTTP_STATUS.FORBIDDEN)
    .with(
      'invalid_slug',
      'invalid_name',
      'validation_error',
      () => HTTP_STATUS.BAD_REQUEST,
    )
    .with('registration_failed', () => HTTP_STATUS.BAD_REQUEST)
    .with('org_setup_failed', () => HTTP_STATUS.CONFLICT)
    .with('member_not_found', 'invitation_not_found', () => HTTP_STATUS.NOT_FOUND)
    .exhaustive()

/** Throw a tagged IdentityError as an Error object (not Response).
 * Per architecture: "Server functions throw Error objects with .name, .message, .code, .status." */
export function throwIdentityError(e: IdentityError): never {
  throwContextError('IdentityError', e, identityErrorStatus(e.code))
}

// ── Types for better-auth API responses ──────────────────────────
// better-auth returns loosely-typed responses; we define precise shapes
// for the fields we actually use.

export type AuthMemberResponse = Readonly<{
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

export type AuthInvitationResponse = Readonly<{
  id: string
  email: string
  role: string
  status: string
  expiresAt: Date
  createdAt: Date
  organizationId?: string
  organization?: Readonly<{ name: string }>
}>

export type AuthOrganizationResponse = Readonly<{
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

// ── Helper: Extract billing fields from loosely-typed org response ────────

export function extractOrgBillingFields(org: unknown): {
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
