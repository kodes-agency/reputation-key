const SHA = /^[0-9a-f]{40}$/
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/
const REGION = /^[a-z0-9][a-z0-9-]{0,31}$/
const RESOURCE_ID = /^[A-Za-z0-9._:-]{1,256}$/

export const AI_EGRESS_PROBE_START_COMMAND =
  'node dist-ai-egress-probe/runtime-egress-probe.js' as const

export const AI_EGRESS_PROBE_DEPLOYMENT_CONTRACT_V1 = Object.freeze({
  version: 'ai-egress-probe-deployment-v1',
  imageAuthority: 'exact-ai-egress-gateway-candidate-digest',
  startCommand: AI_EGRESS_PROBE_START_COMMAND,
  environmentKeys: Object.freeze([
    'AI_EGRESS_PROBE_RELEASE_SHA',
    'AI_EGRESS_PROBE_IMAGE_DIGEST',
    'AI_EGRESS_PROBE_REGION',
  ] as const),
  residueKinds: Object.freeze([
    'service',
    'deployment',
    'domain',
    'variable',
    'credential',
    'build',
  ] as const),
})

export type AiEgressProbeDeploymentPlanV1 = Readonly<{
  version: 'ai-egress-probe-deployment-v1'
  releaseSha: string
  gatewayImageDigest: string
  probeImageDigest: string
  region: string
  startCommand: typeof AI_EGRESS_PROBE_START_COMMAND
}>

export type AiEgressProbeCleanupReceiptV1 = Readonly<{
  version: 'ai-egress-probe-cleanup-v1'
  releaseSha: string
  gatewayImageDigest: string
  region: string
  createdResourceIds: Readonly<
    Record<
      (typeof AI_EGRESS_PROBE_DEPLOYMENT_CONTRACT_V1.residueKinds)[number],
      readonly string[]
    >
  >
  residualActiveResourceIds: readonly string[]
}>

function exactObject(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  )
}

function canonicalIds(value: unknown): value is readonly string[] {
  if (
    !Array.isArray(value) ||
    value.some((id) => typeof id !== 'string' || !RESOURCE_ID.test(id))
  ) {
    return false
  }
  return value.every((id, index) => index === 0 || value[index - 1]! < id)
}

function freezeCanonicalIds(value: unknown): readonly string[] {
  if (!canonicalIds(value)) {
    throw new TypeError('AI egress probe cleanup receipt is invalid')
  }
  return Object.freeze([...value])
}

export function parseAiEgressProbeDeploymentPlanV1(
  value: unknown,
): AiEgressProbeDeploymentPlanV1 {
  if (
    !exactObject(value, [
      'version',
      'releaseSha',
      'gatewayImageDigest',
      'probeImageDigest',
      'region',
      'startCommand',
    ]) ||
    value.version !== AI_EGRESS_PROBE_DEPLOYMENT_CONTRACT_V1.version ||
    typeof value.releaseSha !== 'string' ||
    !SHA.test(value.releaseSha) ||
    typeof value.gatewayImageDigest !== 'string' ||
    !IMAGE_DIGEST.test(value.gatewayImageDigest) ||
    value.probeImageDigest !== value.gatewayImageDigest ||
    typeof value.region !== 'string' ||
    !REGION.test(value.region) ||
    value.startCommand !== AI_EGRESS_PROBE_START_COMMAND
  ) {
    throw new TypeError('AI egress probe deployment plan is invalid')
  }
  return Object.freeze(value as AiEgressProbeDeploymentPlanV1)
}

export function parseAiEgressProbeCleanupReceiptV1(
  value: unknown,
): AiEgressProbeCleanupReceiptV1 {
  if (
    !exactObject(value, [
      'version',
      'releaseSha',
      'gatewayImageDigest',
      'region',
      'createdResourceIds',
      'residualActiveResourceIds',
    ]) ||
    value.version !== 'ai-egress-probe-cleanup-v1' ||
    typeof value.releaseSha !== 'string' ||
    !SHA.test(value.releaseSha) ||
    typeof value.gatewayImageDigest !== 'string' ||
    !IMAGE_DIGEST.test(value.gatewayImageDigest) ||
    typeof value.region !== 'string' ||
    !REGION.test(value.region) ||
    !exactObject(
      value.createdResourceIds,
      AI_EGRESS_PROBE_DEPLOYMENT_CONTRACT_V1.residueKinds,
    )
  ) {
    throw new TypeError('AI egress probe cleanup receipt is invalid')
  }
  const rawIds = value.createdResourceIds
  const createdResourceIds = Object.freeze({
    service: freezeCanonicalIds(rawIds.service),
    deployment: freezeCanonicalIds(rawIds.deployment),
    domain: freezeCanonicalIds(rawIds.domain),
    variable: freezeCanonicalIds(rawIds.variable),
    credential: freezeCanonicalIds(rawIds.credential),
    build: freezeCanonicalIds(rawIds.build),
  })
  const residualActiveResourceIds = freezeCanonicalIds(value.residualActiveResourceIds)
  if (residualActiveResourceIds.length !== 0) {
    throw new TypeError('AI egress probe cleanup receipt is invalid')
  }
  return Object.freeze({
    version: value.version,
    releaseSha: value.releaseSha,
    gatewayImageDigest: value.gatewayImageDigest,
    region: value.region,
    createdResourceIds,
    residualActiveResourceIds,
  })
}
