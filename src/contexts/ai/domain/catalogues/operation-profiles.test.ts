import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  AI_REDACTION_PROFILE_DIGEST,
  AI_REDACTION_PROFILE_VERSION,
} from '#/shared/ai-deterministic-redactor'
import {
  AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST,
  AI_LANGUAGE_SCRIPT_CONSISTENCY_VERSION,
} from '#/shared/ai-language-script-consistency'
import {
  AI_PROPERTY_TREND_CONTRACT_DIGEST,
  AI_PROPERTY_TREND_CONTRACT_VERSION,
  AI_TREND_RENDER_PROFILE_DIGEST,
  AI_TREND_RENDER_PROFILE_VERSION,
} from '#/shared/ai-property-trend-contract'
import {
  AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST,
  AI_REPLY_LANGUAGE_VERIFIER_VERSION,
} from '#/shared/ai-reply-language-verifier'
import {
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
} from '#/shared/ai-reply-output-leakage'
import {
  AI_REPLY_TEMPLATE_CATALOGUE_DIGEST,
  AI_REPLY_TEMPLATE_CATALOGUE_VERSION,
} from '#/shared/ai-reply-template-catalogue'
import {
  AI_REVIEW_LANGUAGE_CATALOGUE_VERSION,
  LANGUAGE_CATALOGUE_DIGEST,
} from '#/shared/ai-review-language-catalogue'
import {
  AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  AI_STRUCTURED_MARKER_DETECTORS_VERSION,
} from '#/shared/ai-structured-marker-detectors'
import {
  AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST,
  AI_ZH_ORTHOGRAPHY_VERSION,
} from '#/shared/ai-zh-orthography-verifier'
import {
  AI_PERSONALIZED_REPLY_PROFILE_DIGEST,
  AI_PERSONALIZED_REPLY_PROFILE_VERSION,
} from '#/shared/ai-personalized-reply-contract'
import { canonicalizeRfc8785 } from '#/shared/merchant-ai-notice-contract'
import {
  buildClosedOpenAiRequest,
  OPENAI_PROMPT_VERSIONS,
  renderOpenAiStaticTokenBearingMaterial,
} from '#/shared/ai-openai-request-contract'
import { AI_ROUTE_OUTPUT_JSON_SCHEMAS } from '#/shared/openai-route-output-schemas'
import {
  AI_OPERATION_PROFILES,
  AI_PROVIDER_DEPLOYMENT_PROFILE,
  AI_ROUTING_POLICY,
} from '../../../../shared/ai-operation-profiles'

const sha256 = (domain: string, value: unknown): string =>
  createHash('sha256')
    .update(domain, 'utf8')
    .update(canonicalizeRfc8785(value), 'utf8')
    .digest('hex')

describe('PR5 immutable AI execution catalogues', () => {
  it('pins the sole OpenAI SDK 7.4.0 deployment contract without fallback or stateful features', () => {
    expect(AI_PROVIDER_DEPLOYMENT_PROFILE).toMatchObject({
      profileVersion: 'private-beta-global-v1',
      region: 'global',
      provider: 'openai',
      modelSnapshot: 'gpt-5.6-luna',
      reasoningEffort: 'route-profile-effort',
      serviceTier: 'default',
      store: false,
      responseApiVersion: 'responses-v1',
      deploymentContract: {
        sdkVersion: '7.4.0',
        endpoint: 'https://api.openai.com/v1/responses',
        runtime: {
          nodeImage:
            'node:22-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5',
          nodeVersion: '22.23.2',
          icuVersion: '78.2',
          unicodeVersion: '17.0',
        },
        promptCacheRetention: '24h',
        promptCacheMode: 'automatic_prefix_16_shards',
        promptCacheOptions: 'absent',
        promptCacheBreakpoint: 'absent',
        truncation: 'disabled',
        tools: 'empty_array',
        metadata: 'absent',
        conversation: 'absent',
        previousResponseId: 'absent',
        stream: false,
        background: false,
        providerFallback: 'none',
        providerIdempotencyMode: 'none',
        sdkMaxRetries: 0,
        maxHttpRequestsPerPermit: 1,
        redirectMode: 'manual_no_follow',
        successStatus: 200,
        successMediaTypeProfile: 'application-json-utf8-v1',
        clientRequestIdProfile: 'openai-client-request-id-v1',
        retryAfterProfile: 'delta-seconds-1-to-300-v1',
        statusDispositionProfile: 'openai-status-disposition-v1',
        retryableCompleteStatuses: [429, 500, 502, 503, 504],
      },
    })
    const { profileDigest, ...profile } = AI_PROVIDER_DEPLOYMENT_PROFILE
    expect(profileDigest).toBe(
      sha256('repkey-ai-provider-deployment-profile-v1\0', profile),
    )
  })

  it('pins the one global routing row and exactly three normal plus isolated canary profiles', () => {
    expect(AI_ROUTING_POLICY).toEqual({
      version: 1,
      region: 'global',
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      policyDigest: AI_ROUTING_POLICY.policyDigest,
    })
    expect(AI_OPERATION_PROFILES.map((profile) => profile.profileVersion)).toEqual([
      'review-analysis-v1',
      'reply-suggestion-v1',
      'property-trend-v1',
      'synthetic-canary-v1',
    ])
    expect(AI_OPERATION_PROFILES.map((profile) => profile.capability)).toEqual([
      'review_analysis',
      'reply_drafting',
      'property_trends',
      null,
    ])
    expect(AI_OPERATION_PROFILES.map((profile) => profile.gatewayPath)).toEqual([
      '/v1/review-analysis',
      '/v1/reply-suggestion',
      '/v1/property-trend',
      'internal:synthetic-canary',
    ])
  })

  it('pins exact outer/provider deadlines, byte caps, output caps, and leases', () => {
    expect(
      AI_OPERATION_PROFILES.map(
        ({
          profileVersion,
          sourceByteLimit,
          providerPayloadByteLimit,
          preparedRequestByteLimit,
          responseByteLimit,
          maxOutputTokens,
          reasoningEffort,
          providerDeadlineMs,
          requestDeadlineMs,
          executionLeaseMs,
        }) => ({
          profileVersion,
          sourceByteLimit,
          providerPayloadByteLimit,
          preparedRequestByteLimit,
          responseByteLimit,
          maxOutputTokens,
          reasoningEffort,
          providerDeadlineMs,
          requestDeadlineMs,
          executionLeaseMs,
        }),
      ),
    ).toEqual([
      {
        profileVersion: 'review-analysis-v1',
        sourceByteLimit: 16_384,
        providerPayloadByteLimit: 16_384,
        preparedRequestByteLimit: 65_536,
        responseByteLimit: 131_072,
        maxOutputTokens: 1_024,
        reasoningEffort: 'low',
        providerDeadlineMs: 60_000,
        requestDeadlineMs: 70_000,
        executionLeaseMs: 120_000,
      },
      {
        profileVersion: 'reply-suggestion-v1',
        sourceByteLimit: 16_384,
        providerPayloadByteLimit: 16_384,
        preparedRequestByteLimit: 65_536,
        responseByteLimit: 131_072,
        maxOutputTokens: 1_024,
        reasoningEffort: 'low',
        providerDeadlineMs: 60_000,
        requestDeadlineMs: 70_000,
        executionLeaseMs: 120_000,
      },
      {
        profileVersion: 'property-trend-v1',
        sourceByteLimit: 65_536,
        providerPayloadByteLimit: 65_536,
        preparedRequestByteLimit: 131_072,
        responseByteLimit: 131_072,
        maxOutputTokens: 2_048,
        reasoningEffort: 'low',
        providerDeadlineMs: 90_000,
        requestDeadlineMs: 100_000,
        executionLeaseMs: 150_000,
      },
      {
        profileVersion: 'synthetic-canary-v1',
        sourceByteLimit: 16_384,
        providerPayloadByteLimit: 16_384,
        preparedRequestByteLimit: 65_536,
        responseByteLimit: 131_072,
        // Ceilings are sized to measured usage at 'low' (39 output tokens for the
        // canary marker), not to absorb runaway reasoning. A tight ceiling turns a
        // provider runaway into a fast failure instead of a ~55s one.
        maxOutputTokens: 512,
        reasoningEffort: 'low',
        providerDeadlineMs: 60_000,
        requestDeadlineMs: 70_000,
        executionLeaseMs: 120_000,
      },
    ])
  })

  it('uses schema-closed derivative, grounded draft, selected-signal, and canary outputs', () => {
    const [analysis, reply, trend, canary] = AI_OPERATION_PROFILES
    expect(analysis?.outputSchema).toMatchObject({
      additionalProperties: false,
      required: ['sentiment', 'sentimentValence', 'primaryCategory', 'urgencySignals'],
    })
    expect(reply?.outputSchema).toEqual(AI_ROUTE_OUTPUT_JSON_SCHEMAS['reply-suggestion'])
    expect(trend?.outputSchema).toEqual(AI_ROUTE_OUTPUT_JSON_SCHEMAS['property-trend'])
    expect(canary?.capabilityRuntimeProfileVersion).toBeNull()

    for (const entry of AI_OPERATION_PROFILES) {
      expect(entry.outputSchemaDigest).toBe(
        sha256('repkey-ai-output-schema-v1\0', entry.outputSchema),
      )
      expect(entry.promptDigest).toBe(
        sha256('repkey-ai-developer-prompt-v1\0', entry.developerPrompt),
      )
      const {
        outputSchema: _outputSchema,
        developerPrompt: _developerPrompt,
        profileDigest,
        ...persisted
      } = entry
      expect(profileDigest).toBe(
        sha256('repkey-ai-operation-profile-v1\0', {
          ...persisted,
          outputSchemaDigest: entry.outputSchemaDigest,
          promptDigest: entry.promptDigest,
        }),
      )
    }
  })

  it('binds every deterministic source, language, render, and SDK artifact into the immutable profiles', () => {
    const [analysis, reply, trend, canary] = AI_OPERATION_PROFILES
    expect(analysis?.artifactAttestations).toMatchObject({
      source: {
        redactionProfileVersion: AI_REDACTION_PROFILE_VERSION,
        redactionProfileDigest: AI_REDACTION_PROFILE_DIGEST,
        structuredMarkerDetectorVersion: AI_STRUCTURED_MARKER_DETECTORS_VERSION,
        structuredMarkerDetectorDigest: AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
        languageCatalogueVersion: AI_REVIEW_LANGUAGE_CATALOGUE_VERSION,
        languageCatalogueDigest: LANGUAGE_CATALOGUE_DIGEST,
      },
    })
    expect(reply?.artifactAttestations).toMatchObject({
      source: {
        replyLanguageVerifierVersion: AI_REPLY_LANGUAGE_VERIFIER_VERSION,
        replyLanguageVerifierDigest: AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST,
        languageScriptConsistencyVersion: AI_LANGUAGE_SCRIPT_CONSISTENCY_VERSION,
        languageScriptConsistencyDigest: AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST,
        zhOrthographyVerifierVersion: AI_ZH_ORTHOGRAPHY_VERSION,
        zhOrthographyVerifierDigest: AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST,
        replyTemplateCatalogueVersion: AI_REPLY_TEMPLATE_CATALOGUE_VERSION,
        replyTemplateCatalogueDigest: AI_REPLY_TEMPLATE_CATALOGUE_DIGEST,
        outputLeakageProfileVersion: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
        outputLeakageProfileDigest: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
        personalizedReplyProfileVersion: AI_PERSONALIZED_REPLY_PROFILE_VERSION,
        personalizedReplyProfileDigest: AI_PERSONALIZED_REPLY_PROFILE_DIGEST,
      },
    })
    expect(trend?.artifactAttestations).toMatchObject({
      trend: {
        trendContractVersion: AI_PROPERTY_TREND_CONTRACT_VERSION,
        trendContractDigest: AI_PROPERTY_TREND_CONTRACT_DIGEST,
        trendRenderVersion: AI_TREND_RENDER_PROFILE_VERSION,
        trendRenderDigest: AI_TREND_RENDER_PROFILE_DIGEST,
      },
    })
    expect(canary?.artifactAttestations).toMatchObject({
      promptCacheShard: 0,
      safetyIdentifierProfileVersion: 'synthetic-canary-safety-v1',
    })
    for (const profile of AI_OPERATION_PROFILES) {
      expect(profile.staticTokenBearingBytes).toBeGreaterThan(0)
      expect(profile.staticTokenBearingDigest).toMatch(/^[0-9a-f]{64}$/)
      expect(profile.sdkRequestShapeDigest).toBe(
        AI_PROVIDER_DEPLOYMENT_PROFILE.deploymentContract.requestShapeDigest,
      )
      expect(profile.artifactAttestationsDigest).toBe(
        sha256('repkey-ai-operation-artifacts-v1\0', profile.artifactAttestations),
      )
    }
  })
  it('renders the exact gateway message/schema wrapper for every static token reservation', () => {
    for (const profile of AI_OPERATION_PROFILES) {
      const format = Object.freeze({
        type: 'json_schema' as const,
        name: profile.outputSchemaName,
        strict: true as const,
        schema: profile.outputSchema,
      })
      const rendered = renderOpenAiStaticTokenBearingMaterial({
        developerMessage: profile.developerPrompt,
        format,
      })
      expect(rendered.byteLength).toBe(profile.staticTokenBearingBytes)
      expect(rendered.digest).toBe(profile.staticTokenBearingDigest)

      const request = buildClosedOpenAiRequest({
        route: profile.sourceRoute,
        promptVersion: OPENAI_PROMPT_VERSIONS[profile.sourceRoute],
        promptCacheShard: profile.sourceRoute === 'synthetic-canary' ? 0 : 1,
        developerMessage: profile.developerPrompt,
        untrustedData: '{"fixture":true}',
        format,
        maxOutputTokens: profile.maxOutputTokens,
        reasoningEffort: profile.reasoningEffort,
        safetyIdentifier: `rk1_${'A'.repeat(43)}`,
      })
      expect(rendered.material).toEqual({
        input: [request.input[0], { role: request.input[1].role, content: '' }],
        text: request.text,
      })

      const mutated = renderOpenAiStaticTokenBearingMaterial({
        developerMessage: `${profile.developerPrompt}x`,
        format,
      })
      expect(mutated.byteLength).toBe(profile.staticTokenBearingBytes + 1)
      expect(mutated.digest).not.toBe(profile.staticTokenBearingDigest)
    }
  })

  it('binds only the observed PostgreSQL 16 image and the real calendar authorities', () => {
    for (const profile of AI_OPERATION_PROFILES.slice(0, 3)) {
      expect(profile.artifactAttestations).toMatchObject({
        calendar: {
          profileVersion: 'property-calendar-v1',
          epochMillisFunction: 'ai_epoch_millis_v1',
          localCalendarFunction: 'resolve_ai_property_local_date_v1',
          localMidnightFunction: 'ai_property_local_midnight_v1',
          databaseImageDigest:
            '33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20',
          testedPostgresMajorVersions: [16],
        },
      })
    }
    const mutated = {
      ...(AI_OPERATION_PROFILES[0]?.artifactAttestations.calendar as Record<
        string,
        unknown
      >),
      databaseImageDigest: '0'.repeat(64),
    }
    expect(mutated).not.toEqual(AI_OPERATION_PROFILES[0]?.artifactAttestations.calendar)
  })
})
