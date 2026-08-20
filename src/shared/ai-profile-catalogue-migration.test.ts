import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AI_OPERATION_PROFILES,
  AI_PROVIDER_DEPLOYMENT_PROFILE,
  AI_ROUTING_POLICY,
} from './ai-operation-profiles'
import {
  AI_RUNTIME_CAPABILITIES_V1,
  AI_RUNTIME_CAPABILITIES_V1_DIGEST,
} from './ai-runtime-capability-contract'

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/0046_ai-control-plane-and-operations.sql'),
  'utf8',
)
const laterMigrations = [
  '0047_ai-derivatives-and-property-calendar.sql',
  '0048_ai-lifecycle-authority.sql',
  '0049_ai-execution-admission.sql',
]
  .map((name) => readFileSync(resolve(process.cwd(), 'drizzle', name), 'utf8'))
  .join('\n')
const cumulativeSnapshots = [
  '0046_snapshot.json',
  '0047_snapshot.json',
  '0048_snapshot.json',
  '0049_snapshot.json',
].map(
  (name) =>
    JSON.parse(readFileSync(resolve(process.cwd(), 'drizzle', 'meta', name), 'utf8')) as {
      tables: Record<
        string,
        {
          checkConstraints: Record<string, { value: string }>
        }
      >
    },
)

function embeddedRows(source: string, table: string): unknown[] {
  const marker = `FROM public.${table} AS row_value) = '`
  const start = source.indexOf(marker)
  if (start < 0) throw new Error(`missing readiness row assertion for ${table}`)
  const valueStart = start + marker.length
  const valueEnd = source.indexOf("'::jsonb", valueStart)
  if (valueEnd < 0) throw new Error(`unterminated readiness row assertion for ${table}`)
  return JSON.parse(source.slice(valueStart, valueEnd).replaceAll("''", "'")) as unknown[]
}

const expectedProviderRows = [
  {
    profile_version: AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion,
    region: AI_PROVIDER_DEPLOYMENT_PROFILE.region,
    provider: AI_PROVIDER_DEPLOYMENT_PROFILE.provider,
    model_snapshot: AI_PROVIDER_DEPLOYMENT_PROFILE.modelSnapshot,
    reasoning_effort: AI_PROVIDER_DEPLOYMENT_PROFILE.reasoningEffort,
    service_tier: AI_PROVIDER_DEPLOYMENT_PROFILE.serviceTier,
    store: AI_PROVIDER_DEPLOYMENT_PROFILE.store,
    response_api_version: AI_PROVIDER_DEPLOYMENT_PROFILE.responseApiVersion,
    deployment_contract: AI_PROVIDER_DEPLOYMENT_PROFILE.deploymentContract,
    profile_digest: AI_PROVIDER_DEPLOYMENT_PROFILE.profileDigest,
  },
]
const expectedRoutingRows = [
  {
    version: AI_ROUTING_POLICY.version,
    region: AI_ROUTING_POLICY.region,
    provider_deployment_profile_version:
      AI_ROUTING_POLICY.providerDeploymentProfileVersion,
    policy_digest: AI_ROUTING_POLICY.policyDigest,
  },
]
const expectedOperationRows = AI_OPERATION_PROFILES.map((profile) => ({
  profile_version: profile.profileVersion,
  command: profile.command,
  capability: profile.capability,
  purpose: profile.purpose,
  source_route: profile.sourceRoute,
  gateway_path: profile.gatewayPath,
  caller_role: profile.callerRole,
  capability_runtime_profile_version: profile.capabilityRuntimeProfileVersion,
  provider_deployment_profile_version: profile.providerDeploymentProfileVersion,
  output_schema_name: profile.outputSchemaName,
  output_schema_digest: profile.outputSchemaDigest,
  prompt_digest: profile.promptDigest,
  artifact_attestations: profile.artifactAttestations,
  artifact_attestations_digest: profile.artifactAttestationsDigest,
  sdk_request_shape_digest: profile.sdkRequestShapeDigest,
  static_token_bearing_bytes: profile.staticTokenBearingBytes,
  static_token_bearing_digest: profile.staticTokenBearingDigest,
  source_byte_limit: profile.sourceByteLimit,
  provider_payload_byte_limit: profile.providerPayloadByteLimit,
  prepared_request_byte_limit: profile.preparedRequestByteLimit,
  response_byte_limit: profile.responseByteLimit,
  max_output_tokens: profile.maxOutputTokens,
  reasoning_effort: profile.reasoningEffort,
  provider_deadline_ms: profile.providerDeadlineMs,
  request_deadline_ms: profile.requestDeadlineMs,
  execution_lease_ms: profile.executionLeaseMs,
  profile_digest: profile.profileDigest,
})).sort((left, right) => left.profile_version.localeCompare(right.profile_version))
const expectedRuntimeRows = AI_RUNTIME_CAPABILITIES_V1.map((runtime) => ({
  runtime_profile_version: runtime.runtimeProfileVersion,
  capability: runtime.capability,
  purpose: runtime.purpose,
  source_route: runtime.sourceRoute,
  gateway_path: runtime.gatewayPath,
  gateway_profile_version: runtime.gatewayProfileVersion,
  caller: runtime.caller,
  operation_profile_version: runtime.operationProfileVersion,
  provider_deployment_profile_version: runtime.providerDeploymentProfileVersion,
  notice_version: runtime.noticeVersion,
  notice_digest: runtime.noticeDigest,
  catalogue_digest: AI_RUNTIME_CAPABILITIES_V1_DIGEST,
})).sort((left, right) =>
  left.runtime_profile_version.localeCompare(right.runtime_profile_version),
)
const expectedMembershipRows = AI_RUNTIME_CAPABILITIES_V1.map((runtime) => ({
  provider_deployment_profile_version: runtime.providerDeploymentProfileVersion,
  capability: runtime.capability,
  runtime_profile_version: runtime.runtimeProfileVersion,
  catalogue_digest: AI_RUNTIME_CAPABILITIES_V1_DIGEST,
})).sort((left, right) => left.capability.localeCompare(right.capability))

describe('unshipped 0046 AI runtime catalogue', () => {
  it('seeds one provider, one route, four operation profiles, three runtimes, and three memberships from the executable contracts', () => {
    expect(embeddedRows(migration, 'ai_provider_deployment_profiles')).toEqual(
      expectedProviderRows,
    )
    expect(embeddedRows(migration, 'ai_routing_policies')).toEqual(expectedRoutingRows)
    expect(embeddedRows(migration, 'ai_operation_profiles')).toEqual(
      expectedOperationRows,
    )
    expect(embeddedRows(migration, 'ai_runtime_capability_profiles')).toEqual(
      expectedRuntimeRows,
    )
    expect(embeddedRows(migration, 'ai_provider_deployment_capabilities')).toEqual(
      expectedMembershipRows,
    )
    expect(expectedOperationRows.map((row) => row.profile_version)).toEqual([
      'property-trend-v1',
      'reply-suggestion-v1',
      'review-analysis-v1',
      'synthetic-canary-v1',
    ])
    expect(
      expectedOperationRows.find((row) => row.profile_version === 'synthetic-canary-v1'),
    ).toMatchObject({
      gateway_path: 'internal:synthetic-canary',
      capability: null,
      capability_runtime_profile_version: null,
    })
  })

  it('owns every production catalogue insert in 0046 with no later compatibility or sentinel seed', () => {
    for (const table of [
      'ai_provider_deployment_profiles',
      'ai_routing_policies',
      'ai_operation_profiles',
      'ai_runtime_capability_profiles',
      'ai_provider_deployment_capabilities',
    ]) {
      expect(migration.match(new RegExp(`INSERT INTO "${table}"`, 'gu'))).toHaveLength(1)
      expect(laterMigrations).not.toContain(`INSERT INTO "${table}"`)
    }
    const expectedContractConstraint = `jsonb_typeof("ai_provider_deployment_profiles"."deployment_contract") = 'object'\n        AND "ai_provider_deployment_profiles"."deployment_contract" = '${JSON.stringify(AI_PROVIDER_DEPLOYMENT_PROFILE.deploymentContract)}'::jsonb`
    for (const snapshot of cumulativeSnapshots) {
      expect(
        snapshot.tables['public.ai_provider_deployment_profiles']?.checkConstraints
          .ai_provider_profiles_contract_valid?.value,
      ).toEqual(expectedContractConstraint)
    }
    expect(`${migration}\n${laterMigrations}`).not.toMatch(
      /sentinel|placeholder-profile|compat-profile/iu,
    )
  })

  it('makes a single-field readiness mutation disagree with the compiled contract', () => {
    const mutated = migration.replace(
      `"profile_digest":"${AI_PROVIDER_DEPLOYMENT_PROFILE.profileDigest}"`,
      `"profile_digest":"${'0'.repeat(64)}"`,
    )
    expect(embeddedRows(mutated, 'ai_provider_deployment_profiles')).not.toEqual(
      expectedProviderRows,
    )
    expect(migration).toContain('CREATE TRIGGER "ai_provider_profiles_immutable"')
    expect(migration).toContain('CREATE TRIGGER "ai_provider_profiles_no_truncate"')
  })
})
