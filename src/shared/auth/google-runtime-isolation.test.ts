import { describe, expect, it } from 'vitest'
import { canonicalGoogleContentSha256 } from './google-content-approval'
import {
  GoogleRuntimeIsolationError,
  parseGoogleRuntimeIsolationProfile,
  validateGoogleRuntimeIsolationReadiness,
} from './google-runtime-isolation'

const imageDigests = {
  web: 'a'.repeat(64),
  worker: 'b'.repeat(64),
  execution_admission: 'c'.repeat(64),
  egress_gateway: 'd'.repeat(64),
  provider_redis: 'e'.repeat(64),
} as const

const protectedReplicas = [
  {
    replicaId: 'web-1',
    role: 'web' as const,
    workloadIdentity: 'web-identity-1',
    networkNamespaceIdentity: 'web-net-1',
    imageSha256: imageDigests.web,
    networkPolicyId: 'web-policy-7',
  },
  {
    replicaId: 'worker-1',
    role: 'worker' as const,
    workloadIdentity: 'worker-identity-1',
    networkNamespaceIdentity: 'worker-net-1',
    imageSha256: imageDigests.worker,
    networkPolicyId: 'worker-policy-7',
  },
  {
    replicaId: 'admission-1',
    role: 'execution_admission' as const,
    workloadIdentity: 'admission-identity-1',
    networkNamespaceIdentity: 'admission-net-1',
    imageSha256: imageDigests.execution_admission,
    networkPolicyId: 'admission-policy-7',
  },
  {
    replicaId: 'gateway-1',
    role: 'egress_gateway' as const,
    workloadIdentity: 'gateway-identity-1',
    networkNamespaceIdentity: 'gateway-net-1',
    imageSha256: imageDigests.egress_gateway,
    networkPolicyId: 'gateway-policy-7',
  },
  {
    replicaId: 'provider-redis-1',
    role: 'provider_redis' as const,
    workloadIdentity: 'provider-redis-identity-1',
    networkNamespaceIdentity: 'provider-redis-net-1',
    imageSha256: imageDigests.provider_redis,
    networkPolicyId: 'provider-redis-policy-7',
  },
]

const profile = () => ({
  version: 'google-content-egress-1' as const,
  enforcementPlane: 'infrastructure-control-plane' as const,
  targetEnvironment: 'production' as const,
  destinationEnforcement: 'namespace_firewall' as const,
  imageDigests,
  protectedReplicas,
  ipv4EgressDefault: 'deny' as const,
  ipv6EgressDefault: 'deny' as const,
  dnsResolverIdentity: 'dns-1',
  allowedInternalTuples: [
    {
      sourceIdentity: 'web-identity-1',
      destinationIdentity: 'gateway-identity-1',
      protocol: 'tcp' as const,
      port: 8443,
    },
    {
      sourceIdentity: 'worker-identity-1',
      destinationIdentity: 'gateway-identity-1',
      protocol: 'tcp' as const,
      port: 8443,
    },
    {
      sourceIdentity: 'gateway-identity-1',
      destinationIdentity: 'admission-identity-1',
      protocol: 'tcp' as const,
      port: 9443,
    },
  ],
  allowedGoogleOrigins: ['https://oauth2.googleapis.com'],
  controlPlanePolicyGeneration: 'generation-7',
})

const probes = (role: (typeof protectedReplicas)[number]['role']) => ({
  tlsIngress: 'pass' as const,
  establishedReplies: 'pass' as const,
  declaredInternalTuples: 'pass' as const,
  resolverDns: role === 'provider_redis' ? ('denied' as const) : ('pass' as const),
  googleOrigins: role === 'egress_gateway' ? ('pass' as const) : ('denied' as const),
  deniedPublicDns: true as const,
  deniedDnsOverHttpsTls: true as const,
  deniedDirectIpv4: true as const,
  deniedDirectIpv6: true as const,
  deniedAlternateClient: true as const,
  deniedMetadata: true as const,
  deniedSentinel: true as const,
  deniedUnexpectedInternalTuple: true as const,
  deniedDatabaseRedis: role === 'egress_gateway',
  deniedProvider: role === 'execution_admission',
  deniedAllNewOutbound: role === 'provider_redis',
})

const attestation = (profileValue = profile()) => ({
  schemaVersion: 'google-content-egress-attestation-1',
  source: 'infrastructure-control-plane-live-probe',
  profileSha256: canonicalGoogleContentSha256(profileValue),
  controlPlanePolicyGeneration: 'generation-7',
  observedAt: '2026-08-10T10:00:00.000Z',
  expiresAt: '2026-08-10T10:05:00.000Z',
  result: 'pass',
  probeId: 'probe-0000000001',
  replicas: profileValue.protectedReplicas.map((replica) => ({
    ...replica,
    probes: probes(replica.role),
  })),
})

function expectCode(run: () => unknown, code: GoogleRuntimeIsolationError['code']) {
  try {
    run()
    expect.fail(`expected ${code}`)
  } catch (error) {
    expect(error).toBeInstanceOf(GoogleRuntimeIsolationError)
    expect((error as GoogleRuntimeIsolationError).code).toBe(code)
  }
}

describe('Google runtime isolation readiness', () => {
  it('accepts exact five-image, replica, policy, origin, and live-probe parity', () => {
    const result = validateGoogleRuntimeIsolationReadiness({
      profileRaw: JSON.stringify(profile()),
      attestationRaw: JSON.stringify(attestation()),
      expectedControlPlanePolicyGeneration: 'generation-7',
      expectedGoogleOrigins: ['https://oauth2.googleapis.com'],
      expectedTargetEnvironment: 'production',
      expectedImageDigests: imageDigests,
      now: new Date('2026-08-10T10:01:00.000Z'),
    })
    expect(result.profile.protectedReplicas).toHaveLength(5)
  })

  it.each([
    [
      'origin drift',
      { expectedGoogleOrigins: ['https://www.googleapis.com'] },
      'provider_origin_drift',
    ],
    [
      'generation drift',
      { expectedControlPlanePolicyGeneration: 'generation-8' },
      'control_plane_generation_drift',
    ],
    [
      'stale attestation',
      { now: new Date('2026-08-10T10:06:00.000Z') },
      'attestation_stale',
    ],
    [
      'environment drift',
      { expectedTargetEnvironment: 'local_sandbox' },
      'target_environment_drift',
    ],
  ] as const)('rejects %s', (_label, override, code) => {
    expectCode(
      () =>
        validateGoogleRuntimeIsolationReadiness({
          profileRaw: JSON.stringify(profile()),
          attestationRaw: JSON.stringify(attestation()),
          expectedControlPlanePolicyGeneration: 'generation-7',
          expectedGoogleOrigins: ['https://oauth2.googleapis.com'],
          expectedTargetEnvironment: 'production',
          expectedImageDigests: imageDigests,
          now: new Date('2026-08-10T10:01:00.000Z'),
          ...override,
        }),
      code,
    )
  })

  it('rejects image substitution, missing replicas, and incomplete probes', () => {
    const substituted = attestation()
    substituted.replicas[2] = {
      ...substituted.replicas[2],
      imageSha256: 'f'.repeat(64),
    }
    expectCode(
      () =>
        validateGoogleRuntimeIsolationReadiness({
          profileRaw: JSON.stringify(profile()),
          attestationRaw: JSON.stringify(substituted),
          expectedControlPlanePolicyGeneration: 'generation-7',
          expectedGoogleOrigins: ['https://oauth2.googleapis.com'],
          now: new Date('2026-08-10T10:01:00.000Z'),
        }),
      'runtime_image_vector_mismatch',
    )

    const missing = attestation()
    missing.replicas.pop()
    expectCode(
      () =>
        validateGoogleRuntimeIsolationReadiness({
          profileRaw: JSON.stringify(profile()),
          attestationRaw: JSON.stringify(missing),
          expectedControlPlanePolicyGeneration: 'generation-7',
          expectedGoogleOrigins: ['https://oauth2.googleapis.com'],
          now: new Date('2026-08-10T10:01:00.000Z'),
        }),
      'attestation_malformed',
    )

    const providerRedisEscape = attestation()
    providerRedisEscape.replicas[4] = {
      ...providerRedisEscape.replicas[4],
      probes: {
        ...providerRedisEscape.replicas[4].probes,
        deniedAllNewOutbound: false,
      },
    }
    expectCode(
      () =>
        validateGoogleRuntimeIsolationReadiness({
          profileRaw: JSON.stringify(profile()),
          attestationRaw: JSON.stringify(providerRedisEscape),
          expectedControlPlanePolicyGeneration: 'generation-7',
          expectedGoogleOrigins: ['https://oauth2.googleapis.com'],
          now: new Date('2026-08-10T10:01:00.000Z'),
        }),
      'attestation_probe_incomplete',
    )
  })

  it('rejects duplicate identities, provider-Redis egress, and additive fields', () => {
    expectCode(
      () =>
        parseGoogleRuntimeIsolationProfile(
          JSON.stringify({
            ...profile(),
            protectedReplicas: [
              ...protectedReplicas.slice(0, 4),
              {
                ...protectedReplicas[4],
                workloadIdentity: protectedReplicas[0].workloadIdentity,
              },
            ],
          }),
        ),
      'profile_duplicate',
    )
    expectCode(
      () =>
        parseGoogleRuntimeIsolationProfile(
          JSON.stringify({
            ...profile(),
            allowedInternalTuples: [
              ...profile().allowedInternalTuples,
              {
                sourceIdentity: 'provider-redis-identity-1',
                destinationIdentity: 'dns-1',
                protocol: 'udp',
                port: 53,
              },
            ],
          }),
        ),
      'runtime_policy_tuple_invalid',
    )
    expectCode(
      () =>
        parseGoogleRuntimeIsolationProfile(
          JSON.stringify({ ...profile(), unapproved: true }),
        ),
      'profile_malformed',
    )
  })
})
