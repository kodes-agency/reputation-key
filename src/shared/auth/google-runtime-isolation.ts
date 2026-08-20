import { z } from 'zod/v4'
import {
  GOOGLE_CONTENT_RUNTIME_ISOLATION_PROFILE_VERSION,
  GOOGLE_RUNTIME_ROLES,
  type GoogleContentRuntimeIsolationProfile,
  type GoogleRuntimeRole,
} from './google-content-contract'
import { canonicalGoogleContentSha256 } from './google-content-approval'

const identity = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/)
const sha256 = z.string().regex(/^[a-f0-9]{64}$/)
const origin = z
  .url()
  .refine((value) => new URL(value).origin === value, 'must be an origin without a path')
const role = z.enum(GOOGLE_RUNTIME_ROLES)
const imageDigests = z
  .object({
    web: sha256,
    worker: sha256,
    execution_admission: sha256,
    egress_gateway: sha256,
    provider_redis: sha256,
  })
  .strict()

const replicaSchema = z
  .object({
    replicaId: identity,
    role,
    workloadIdentity: identity,
    networkNamespaceIdentity: identity,
    imageSha256: sha256,
    networkPolicyId: identity,
  })
  .strict()

const tupleSchema = z
  .object({
    sourceIdentity: identity,
    destinationIdentity: identity,
    protocol: z.enum(['tcp', 'udp']),
    port: z.number().int().min(1).max(65_535),
  })
  .strict()

const runtimeIsolationProfileSchema = z
  .object({
    version: z.literal(GOOGLE_CONTENT_RUNTIME_ISOLATION_PROFILE_VERSION),
    enforcementPlane: z.literal('infrastructure-control-plane'),
    targetEnvironment: z.enum(['local_sandbox', 'production']),
    destinationEnforcement: z.enum([
      'namespace_firewall',
      'cni_network_policy',
      'cloud_egress_firewall',
    ]),
    imageDigests,
    protectedReplicas: z.array(replicaSchema).min(5).max(256),
    ipv4EgressDefault: z.literal('deny'),
    ipv6EgressDefault: z.literal('deny'),
    dnsResolverIdentity: identity,
    allowedInternalTuples: z.array(tupleSchema).min(3).max(512),
    allowedGoogleOrigins: z.array(origin).min(1).max(32),
    controlPlanePolicyGeneration: z.string().min(1).max(255),
  })
  .strict()

const probeResultsSchema = z
  .object({
    tlsIngress: z.literal('pass'),
    establishedReplies: z.literal('pass'),
    declaredInternalTuples: z.literal('pass'),
    resolverDns: z.enum(['pass', 'denied']),
    googleOrigins: z.enum(['pass', 'denied']),
    deniedPublicDns: z.literal(true),
    deniedDnsOverHttpsTls: z.literal(true),
    deniedDirectIpv4: z.literal(true),
    deniedDirectIpv6: z.literal(true),
    deniedAlternateClient: z.literal(true),
    deniedMetadata: z.literal(true),
    deniedSentinel: z.literal(true),
    deniedUnexpectedInternalTuple: z.literal(true),
    deniedDatabaseRedis: z.boolean(),
    deniedProvider: z.boolean(),
    deniedAllNewOutbound: z.boolean(),
  })
  .strict()

const liveProbeAttestationSchema = z
  .object({
    schemaVersion: z.literal('google-content-egress-attestation-1'),
    source: z.literal('infrastructure-control-plane-live-probe'),
    profileSha256: sha256,
    controlPlanePolicyGeneration: z.string().min(1).max(255),
    observedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    result: z.literal('pass'),
    probeId: z.string().min(16).max(255),
    replicas: z
      .array(
        z
          .object({
            replicaId: identity,
            role,
            workloadIdentity: identity,
            networkNamespaceIdentity: identity,
            imageSha256: sha256,
            networkPolicyId: identity,
            probes: probeResultsSchema,
          })
          .strict(),
      )
      .min(5)
      .max(256),
  })
  .strict()

export type GoogleRuntimeIsolationAttestation = z.infer<typeof liveProbeAttestationSchema>

export type GoogleRuntimeIsolationErrorCode =
  | 'profile_json_invalid'
  | 'profile_malformed'
  | 'profile_duplicate'
  | 'runtime_role_missing'
  | 'runtime_image_vector_mismatch'
  | 'runtime_policy_tuple_invalid'
  | 'attestation_json_invalid'
  | 'attestation_malformed'
  | 'attestation_replica_mismatch'
  | 'attestation_probe_incomplete'
  | 'provider_origin_drift'
  | 'control_plane_generation_drift'
  | 'profile_digest_drift'
  | 'attestation_stale'
  | 'target_environment_drift'

export class GoogleRuntimeIsolationError extends Error {
  readonly code: GoogleRuntimeIsolationErrorCode

  constructor(code: GoogleRuntimeIsolationErrorCode) {
    super(`Google runtime isolation denied: ${code}`)
    this.name = 'GoogleRuntimeIsolationError'
    this.code = code
  }
}

function deny(code: GoogleRuntimeIsolationErrorCode): never {
  throw new GoogleRuntimeIsolationError(code)
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length
}

function tupleKey(
  tuple: GoogleContentRuntimeIsolationProfile['allowedInternalTuples'][number],
): string {
  return `${tuple.sourceIdentity}\0${tuple.destinationIdentity}\0${tuple.protocol}\0${tuple.port}`
}

function roleReplicas(
  profile: GoogleContentRuntimeIsolationProfile,
  roleName: GoogleRuntimeRole,
) {
  return profile.protectedReplicas.filter((replica) => replica.role === roleName)
}

function validateProfileSemantics(profile: GoogleContentRuntimeIsolationProfile): void {
  if (
    !unique(profile.allowedGoogleOrigins) ||
    !unique(profile.allowedInternalTuples.map(tupleKey)) ||
    !unique(profile.protectedReplicas.map((replica) => replica.replicaId)) ||
    !unique(profile.protectedReplicas.map((replica) => replica.workloadIdentity)) ||
    !unique(profile.protectedReplicas.map((replica) => replica.networkNamespaceIdentity))
  ) {
    deny('profile_duplicate')
  }
  for (const roleName of GOOGLE_RUNTIME_ROLES) {
    if (roleReplicas(profile, roleName).length === 0) deny('runtime_role_missing')
  }
  for (const replica of profile.protectedReplicas) {
    if (replica.imageSha256 !== profile.imageDigests[replica.role]) {
      deny('runtime_image_vector_mismatch')
    }
  }

  const identityRole = new Map(
    profile.protectedReplicas.map((replica) => [replica.workloadIdentity, replica.role]),
  )
  const tuples = profile.allowedInternalTuples
  if (
    tuples.some(
      (tuple) =>
        tuple.sourceIdentity === profile.dnsResolverIdentity ||
        identityRole.get(tuple.sourceIdentity) === 'provider_redis',
    )
  ) {
    deny('runtime_policy_tuple_invalid')
  }
  const hasRoleTuple = (sourceRole: GoogleRuntimeRole, targetRole: GoogleRuntimeRole) =>
    tuples.some(
      (tuple) =>
        identityRole.get(tuple.sourceIdentity) === sourceRole &&
        identityRole.get(tuple.destinationIdentity) === targetRole,
    )
  if (
    !hasRoleTuple('web', 'egress_gateway') ||
    !hasRoleTuple('worker', 'egress_gateway') ||
    !hasRoleTuple('egress_gateway', 'execution_admission')
  ) {
    deny('runtime_policy_tuple_invalid')
  }
}

export function parseGoogleRuntimeIsolationProfile(
  raw: string,
): GoogleContentRuntimeIsolationProfile {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    deny('profile_json_invalid')
  }
  const parsed = runtimeIsolationProfileSchema.safeParse(value)
  if (!parsed.success) deny('profile_malformed')
  const profile: GoogleContentRuntimeIsolationProfile = parsed.data
  validateProfileSemantics(profile)
  return profile
}

function validateProbe(
  roleName: GoogleRuntimeRole,
  probes: z.infer<typeof probeResultsSchema>,
): boolean {
  if (roleName === 'provider_redis') {
    return (
      probes.resolverDns === 'denied' &&
      probes.googleOrigins === 'denied' &&
      probes.deniedAllNewOutbound
    )
  }
  if (probes.resolverDns !== 'pass' || probes.deniedAllNewOutbound) return false
  if (roleName === 'egress_gateway') {
    return probes.googleOrigins === 'pass' && probes.deniedDatabaseRedis
  }
  if (probes.googleOrigins !== 'denied') return false
  if (roleName === 'execution_admission') return probes.deniedProvider
  return true
}

export function validateGoogleRuntimeIsolationReadiness(
  input: Readonly<{
    profileRaw: string
    attestationRaw: string
    expectedControlPlanePolicyGeneration: string
    expectedGoogleOrigins: readonly string[]
    expectedTargetEnvironment?: 'local_sandbox' | 'production'
    expectedImageDigests?: Readonly<Record<GoogleRuntimeRole, string>>
    now: Date
  }>,
): Readonly<{
  profile: GoogleContentRuntimeIsolationProfile
  attestation: GoogleRuntimeIsolationAttestation
  profileSha256: string
}> {
  const profile = parseGoogleRuntimeIsolationProfile(input.profileRaw)
  if (
    input.expectedTargetEnvironment &&
    profile.targetEnvironment !== input.expectedTargetEnvironment
  ) {
    deny('target_environment_drift')
  }
  if (
    input.expectedImageDigests &&
    canonicalGoogleContentSha256(profile.imageDigests) !==
      canonicalGoogleContentSha256(input.expectedImageDigests)
  ) {
    deny('runtime_image_vector_mismatch')
  }

  let attestationValue: unknown
  try {
    attestationValue = JSON.parse(input.attestationRaw)
  } catch {
    deny('attestation_json_invalid')
  }
  const parsedAttestation = liveProbeAttestationSchema.safeParse(attestationValue)
  if (!parsedAttestation.success) deny('attestation_malformed')
  const attestation = parsedAttestation.data
  const profileSha256 = canonicalGoogleContentSha256(profile)
  const expectedOrigins = [...input.expectedGoogleOrigins].sort()
  const actualOrigins = [...profile.allowedGoogleOrigins].sort()
  if (
    canonicalGoogleContentSha256(actualOrigins) !==
    canonicalGoogleContentSha256(expectedOrigins)
  ) {
    deny('provider_origin_drift')
  }
  if (
    profile.controlPlanePolicyGeneration !== input.expectedControlPlanePolicyGeneration ||
    attestation.controlPlanePolicyGeneration !==
      input.expectedControlPlanePolicyGeneration
  ) {
    deny('control_plane_generation_drift')
  }
  if (attestation.profileSha256 !== profileSha256) deny('profile_digest_drift')

  const observedAt = Date.parse(attestation.observedAt)
  const expiresAt = Date.parse(attestation.expiresAt)
  const nowMs = input.now.getTime()
  if (observedAt > nowMs + 60_000 || expiresAt <= nowMs || expiresAt <= observedAt) {
    deny('attestation_stale')
  }
  if (
    !unique(attestation.replicas.map((replica) => replica.replicaId)) ||
    !unique(attestation.replicas.map((replica) => replica.workloadIdentity)) ||
    !unique(attestation.replicas.map((replica) => replica.networkNamespaceIdentity)) ||
    attestation.replicas.length !== profile.protectedReplicas.length
  ) {
    deny('attestation_replica_mismatch')
  }
  const observedById = new Map(
    attestation.replicas.map((replica) => [replica.replicaId, replica]),
  )
  for (const expected of profile.protectedReplicas) {
    const observed = observedById.get(expected.replicaId)
    if (
      !observed ||
      observed.role !== expected.role ||
      observed.workloadIdentity !== expected.workloadIdentity ||
      observed.networkNamespaceIdentity !== expected.networkNamespaceIdentity ||
      observed.networkPolicyId !== expected.networkPolicyId
    ) {
      deny('attestation_replica_mismatch')
    }
    if (
      observed.imageSha256 !== expected.imageSha256 ||
      observed.imageSha256 !== profile.imageDigests[expected.role]
    ) {
      deny('runtime_image_vector_mismatch')
    }
    if (!validateProbe(expected.role, observed.probes)) {
      deny('attestation_probe_incomplete')
    }
  }
  return Object.freeze({ profile, attestation, profileSha256 })
}
