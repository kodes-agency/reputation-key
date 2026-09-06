import { z } from 'zod/v4'
import { canonicalProviderAuthorizationVector } from '#/shared/provider-ephemeral/authorization-binding'
import type {
  ImportDiscoveryAuthorization,
  ResolvedImportCandidate,
} from '../application/ports/google-import-reference-store.port'

const providerSuffix = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      !value.includes('/') &&
      !value.includes('?') &&
      !value.includes('#') &&
      !/\s/u.test(value) &&
      [...value].every((char) => {
        const code = char.charCodeAt(0)
        return code > 0x1f && code !== 0x7f
      }),
  )
const vectorValue = z.union([
  z.string().max(255),
  z.number().safe(),
  z.boolean(),
  z.null(),
])
const authorizationVector = z
  .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u), vectorValue)
  .refine(
    (value) =>
      Object.keys(value).length <= 64 &&
      Buffer.byteLength(JSON.stringify(value)) <= 16_384,
  )

export const durableImportAuthorizationSchema = z.object({
  organizationId: z.string().min(1).max(255),
  userId: z.string().min(1).max(255),
  connectionId: z.uuid(),
  connectionLifecycleVersion: z.number().int().safe().positive(),
  connectionAccessVersion: z.number().int().safe().positive(),
  credentialGeneration: z.number().int().safe().positive(),
  authorizationVector,
})

export const durableAccountPayloadSchema = z.object({
  accountId: providerSuffix,
  displayName: z.string().min(1).max(1_024),
  role: z.enum(['primary_owner', 'owner', 'manager', 'site_manager', 'unknown']),
})
export const durableAccountsCursorPayloadSchema = z.object({
  pageToken: z.string().min(1).max(2_048),
})
export const durableLocationsCursorPayloadSchema = z.object({
  accountRef: z.string().min(1).max(80),
  accountId: providerSuffix,
  accountDisplayName: z.string().min(1).max(1_024),
  pageToken: z.string().min(1).max(2_048),
})

const profile = z.object({
  name: z.string().min(1).max(4_096),
  address: z.string().min(1).max(4_096).nullable(),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/u)
    .nullable(),
  timezone: z.string().min(1).max(64),
  profileVersion: z.number().int().safe().positive(),
})
const eligibility = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create') }),
  z.object({ kind: z.literal('relink'), propertyId: z.string().min(1), profile }),
  z.object({ kind: z.literal('already_imported'), propertyId: z.string().min(1) }),
  z.object({ kind: z.literal('active_binding_conflict') }),
  z.object({ kind: z.literal('region_unavailable') }),
  z.object({ kind: z.literal('unavailable') }),
])
export const durableCandidatePayloadSchema = z.object({
  candidateId: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
  accountRef: z.string().min(1).max(80),
  accountId: providerSuffix,
  locationId: providerSuffix,
  accountDisplayName: z.string().min(1).max(1_024),
  businessName: z.string().min(1).max(4_096),
  address: z.string().min(1).max(4_096).nullable(),
  primaryCategory: z.string().min(1).max(4_096).nullable(),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/u)
    .nullable(),
  googleReviewUri: z.url().max(2_048).startsWith('https://').nullable(),
  eligibility,
  expectedSourceEpoch: z.number().int().safe().nonnegative().nullable(),
  expectedProfileVersion: z.number().int().safe().positive().nullable(),
  affectedPropertyId: z.string().min(1).max(255).nullable(),
})

export type DurableCandidatePayload = z.infer<typeof durableCandidatePayloadSchema>

export const sameDurableAuthorization = (
  stored: ImportDiscoveryAuthorization,
  expected: ImportDiscoveryAuthorization,
): boolean =>
  stored.organizationId === expected.organizationId &&
  stored.userId === expected.userId &&
  stored.connectionId === expected.connectionId &&
  stored.connectionLifecycleVersion === expected.connectionLifecycleVersion &&
  stored.connectionAccessVersion === expected.connectionAccessVersion &&
  stored.credentialGeneration === expected.credentialGeneration &&
  canonicalProviderAuthorizationVector(stored.authorizationVector) ===
    canonicalProviderAuthorizationVector(expected.authorizationVector)

export const affectedPropertyIdFor = (
  candidate: Pick<ResolvedImportCandidate, 'eligibility' | 'affectedPropertyId'>,
): string | null =>
  candidate.eligibility.kind === 'relink' ||
  candidate.eligibility.kind === 'already_imported'
    ? candidate.eligibility.propertyId
    : (candidate.affectedPropertyId ?? null)
