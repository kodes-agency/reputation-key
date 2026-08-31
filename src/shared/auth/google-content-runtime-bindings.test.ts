import { describe, expect, it } from 'vitest'
import { canonicalGoogleContentSha256 } from './google-content-approval'
import { GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION } from './google-content-contract'
import type { GoogleContentRuntimeBinding } from './google-content-authority'
import { parseGoogleContentRuntimeBindings } from './google-content-runtime-bindings'

function binding(
  capability: GoogleContentRuntimeBinding['capability'],
): GoogleContentRuntimeBinding {
  const digest = (label: string) => canonicalGoogleContentSha256(label)
  return {
    capability,
    targetPhase: 'local_sandbox',
    environmentProfile: 'sandbox',
    releaseSha: 'a'.repeat(40),
    evidenceManifestSha256: digest('manifest'),
    evidenceIndexSha256: digest('index'),
    deploymentAttestationSha256: digest('deployment'),
    adr0050Sha256: digest('adr'),
    googleContentPolicyVersion: 'google-content-live-1',
    googleOAuthContractVersion: 'google-oauth-oidc-1',
    googleProjectAttestationSha256: digest('project'),
    googleOAuthClientIdSha256: digest('client'),
    googleRedirectUriSha256: digest('redirect'),
    providerOriginProfileSha256: digest('origin'),
    runtimeIsolationProfileVersion: 'google-content-egress-1',
    runtimeIsolationProfileSha256: digest('isolation'),
    railwayClosedBetaCohort: null,
    railwayClosedBetaCohortSha256: null,
    railwayClosedBetaResidualRiskSha256: null,
    performanceCatalogVersion: '2026-08-05',
    routeCatalogueVersion: GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
    capabilityPolicyVersion: 'beta-local-2',
    executionPolicyVersion: 'beta-local-2',
    migrationHead: '0032_property-operation-receipts-expand',
    imageDigests: {
      web: `sha256:${digest('web')}`,
      worker: `sha256:${digest('worker')}`,
      googleExecutionAdmission: `sha256:${digest('admission')}`,
      googleEgressGateway: `sha256:${digest('gateway')}`,
      providerEphemeralRedis: `sha256:${digest('redis')}`,
    },
  }
}

describe('Google Content runtime bindings', () => {
  it('parses strict capability-keyed bindings', () => {
    const input = {
      'property.import_gbp_v2': binding('property.import_gbp_v2'),
      'property.read_gbp_performance': binding('property.read_gbp_performance'),
      'property.connect_gbp': binding('property.connect_gbp'),
      'property.publish_reply': binding('property.publish_reply'),
    }
    expect(parseGoogleContentRuntimeBindings(JSON.stringify(input))).toEqual(input)
  })

  it.each([
    ['malformed JSON', '{'],
    ['empty object', '{}'],
    [
      'capability/key mismatch',
      JSON.stringify({
        'property.import_gbp_v2': binding('property.read_gbp_performance'),
      }),
    ],
    [
      'unknown field',
      JSON.stringify({
        'property.import_gbp_v2': {
          ...binding('property.import_gbp_v2'),
          unexpected: true,
        },
      }),
    ],
  ])('rejects %s', (_case, input) => {
    expect(() => parseGoogleContentRuntimeBindings(input)).toThrow(/runtime bindings/i)
  })
})
