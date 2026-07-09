// Shared types, helpers, and error mapping for organization server functions.
// Extracted from organizations.ts to keep each file ≤150 lines.

import { HTTP_STATUS } from '#/shared/http/status'
import { match } from 'ts-pattern'
import {
  DEFAULT_RESPONSE_SLA_HOURS,
  extractResponseSlaHours,
} from '#/shared/domain/response-sla'
import type { IdentityErrorCode } from '../domain/errors'

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
    .with('org_setup_failed', 'already_exists', 'last_owner', () => HTTP_STATUS.CONFLICT)
    .with('member_not_found', 'invitation_not_found', () => HTTP_STATUS.NOT_FOUND)
    .exhaustive()

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
  responseSlaHours: number
}>
// ── Response SLA (from the shared kernel) ───────────────────────────
// Defined in shared/domain so the dashboard context can read it without
// importing from identity's server layer.
export { DEFAULT_RESPONSE_SLA_HOURS, extractResponseSlaHours }

// ── Helper: Extract billing/settings fields from loosely-typed org response ──

export function extractOrgBillingFields(org: unknown): {
  contactEmail: string | null
  billingCompanyName: string | null
  billingAddress: string | null
  billingCity: string | null
  billingPostalCode: string | null
  billingCountry: string | null
  responseSlaHours: number
} {
  const o = org as Record<string, unknown>
  return {
    contactEmail: (o.contactEmail as string | null) ?? null,
    billingCompanyName: (o.billingCompanyName as string | null) ?? null,
    billingAddress: (o.billingAddress as string | null) ?? null,
    billingCity: (o.billingCity as string | null) ?? null,
    billingPostalCode: (o.billingPostalCode as string | null) ?? null,
    billingCountry: (o.billingCountry as string | null) ?? null,
    responseSlaHours: extractResponseSlaHours(o),
  }
}
