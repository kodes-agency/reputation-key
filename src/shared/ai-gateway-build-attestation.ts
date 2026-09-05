import { createHash } from 'node:crypto'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
import { AI_GATEWAY_KEY_INVENTORY_V1 } from './ai-openai-provider-profile'

export const AI_GATEWAY_BUILD_ATTESTATION_VERSION = 'ai-egress-gateway-build-v1' as const

export const AI_GATEWAY_BUILD_ATTESTATION_V1 = Object.freeze({
  version: AI_GATEWAY_BUILD_ATTESTATION_VERSION,
  sdk: Object.freeze({
    package: 'openai',
    version: '7.4.0',
    soleProductionImportRoot: 'services/ai-egress-gateway/',
  }),
  image: Object.freeze({
    dockerfile: 'Dockerfile.ai-egress-gateway',
    buildConfig: 'tsup.ai-egress-gateway.config.ts',
    runtimeAssetBuildConfig: 'tsup.ai-egress-gateway-runtime-assets.config.ts',
    runtimeAssetVerifier: 'scripts/verify-ai-gateway-runtime-assets.ts',
    bundleInventoryVerifier: 'scripts/verify-ai-egress-gateway-bundle.mjs',
    bundleDirectory: 'dist-ai-egress-gateway',
    oneImmutableImageDigest: true,
    initialReplicas: 1,
    postDrillReplicas: 2,
  }),
  localProviderStubTransport: Object.freeze({
    sourceEntry: 'services/ai-egress-gateway/local-provider-entry.ts',
    transportSource: 'services/ai-egress-gateway/local-provider-transport.ts',
    buildConfig: 'tsup.ai-egress-gateway-local.config.ts',
    bundleEntry: 'dist-ai-egress-gateway-local/local-provider-entry.js',
    dockerTarget: 'local-provider',
    command: Object.freeze([
      'node',
      'dist-ai-egress-gateway-local/local-provider-entry.js',
    ]),
    destination: 'http://ai-provider-stub:4102/v1/responses',
    productionImportForbidden: true,
    productionSelectable: false,
  }),
  keyInventory: AI_GATEWAY_KEY_INVENTORY_V1,
  production: Object.freeze({
    sourceEntry: 'services/ai-egress-gateway/index.ts',
    bundleEntry: 'dist-ai-egress-gateway/index.js',
    command: Object.freeze(['node', 'dist-ai-egress-gateway/index.js']),
    independentImportClosure: true,
  }),
  syntheticCanary: Object.freeze({
    sourceEntry: 'services/ai-egress-gateway/canary-entry.ts',
    bundleEntry: 'dist-ai-egress-gateway/canary.js',
    commandOverride: Object.freeze(['node', 'dist-ai-egress-gateway/canary.js']),
    sameGatewayImageDigestRequired: true,
    independentImportClosure: true,
    productionImportForbidden: true,
    httpRoute: false,
  }),
  runtimeEgressProbe: Object.freeze({
    sourceEntry: 'services/ai-egress-gateway/runtime-egress-probe.ts',
    buildConfig: 'tsup.ai-egress-probe.config.ts',
    bundleDirectory: 'dist-ai-egress-probe',
    bundleEntry: 'dist-ai-egress-probe/runtime-egress-probe.js',
    commandOverride: Object.freeze([
      'node',
      'dist-ai-egress-probe/runtime-egress-probe.js',
    ]),
    sameGatewayImageDigestRequired: true,
    independentImportClosure: true,
    productionImportForbidden: true,
  }),
  serverOnlyArtifacts: Object.freeze([
    'src/shared/ai-deterministic-redactor.ts',
    'src/shared/ai-reply-language-verifier.ts',
    'src/shared/ai-language-script-consistency.ts',
    'src/shared/ai-zh-orthography-verifier.ts',
    'src/shared/ai-structured-marker-detectors.ts',
    'src/shared/ai-reply-output-leakage.ts',
    'src/shared/ai-reply-template-catalogue.ts',
  ]),
  browserRoots: Object.freeze(['src/components/', 'src/routes/', 'src/hooks/']),
  providerEndpoint: 'https://api.openai.com/v1/responses',
  providerEndpointOverride: false,
  providerStub: Object.freeze({
    sourceEntry: 'e2e/fixtures/ai-provider-stub.ts',
    productionSelectable: false,
  }),
})

export const AI_GATEWAY_BUILD_ATTESTATION_DIGEST = createHash('sha256')
  .update('repkey-ai-egress-gateway-build-v1\0', 'utf8')
  .update(canonicalizeRfc8785(AI_GATEWAY_BUILD_ATTESTATION_V1), 'utf8')
  .digest('hex')
