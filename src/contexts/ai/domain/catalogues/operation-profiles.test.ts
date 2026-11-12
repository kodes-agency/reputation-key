import { openAiAttestationOf } from '#/shared/ai-openai-provider-attestation'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  AI_REDACTION_PROFILE_DIGEST,
  AI_REDACTION_PROFILE_VERSION,
} from '#/shared/ai-deterministic-redactor'
import { AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST } from '#/shared/ai-language-script-consistency'
import { AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST } from '#/shared/ai-reply-language-verifier'
import {
  AI_REVIEW_LANGUAGE_CATALOGUE_VERSION,
  LANGUAGE_CATALOGUE_DIGEST,
} from '#/shared/ai-review-language-catalogue'
import {
  AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  AI_STRUCTURED_MARKER_DETECTORS_VERSION,
} from '#/shared/ai-structured-marker-detectors'
import { canonicalizeRfc8785 } from '#/shared/merchant-ai-notice-contract'
import {
  buildClosedOpenAiRequest,
  OPENAI_PROMPT_VERSIONS,
  renderOpenAiStaticTokenBearingMaterial,
} from '#/shared/ai-openai-request-contract'
import { AI_ROUTE_OUTPUT_JSON_SCHEMAS } from '#/shared/ai-route-output-schemas'
import {
  AI_OPERATION_PROFILES,
  AI_PROVIDER_DEPLOYMENT_PROFILE,
  AI_ROUTING_POLICY,
} from '../../../../shared/ai-operation-profiles'
import { ASPECT_TAXONOMY_V1, ASPECT_TAXONOMY_V1_DIGEST } from '#/shared/aspect-taxonomy'

const sha256 = (domain: string, value: unknown): string =>
  createHash('sha256')
    .update(domain, 'utf8')
    .update(canonicalizeRfc8785(value), 'utf8')
    .digest('hex')

describe('PR5 immutable AI execution catalogues', () => {
  it('pins the OpenAI SDK 7.43.0 deployment contract without fallback or stateful features', () => {
    expect(AI_PROVIDER_DEPLOYMENT_PROFILE).toMatchObject({
      profileVersion: 'private-beta-global-v2',
      region: 'global',
      provider: 'openai',
      // The plain id: the account has no dated snapshot of it.
      modelSnapshot: 'gpt-6-luna',
      // The envelope names both providers by attestation digest; the operator's
      // choice (OpenAI alone) is not part of it.
      providers: {
        openai: expect.stringMatching(/^[0-9a-f]{64}$/),
        anthropic: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      reasoningEffort: 'route-profile-effort',
      serviceTier: 'default',
      store: false,
      responseApiVersion: 'responses-v1',
      deploymentContract: {
        sdkVersion: '7.43.0',
        endpoint: 'https://api.openai.com/v1/responses',
        runtime: {
          nodeImage:
            'node:22.23.4-trixie-slim@sha256:2117f713a417f3aff682ac8f5bc2ebbdf1beed51f36e67ab1e0fd3866b6d2d8f',
          nodeVersion: '22.23.4',
          icuVersion: '78.3',
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
      sha256('repkey-ai-provider-deployment-profile-v2\0', profile),
    )
  })

  it('pins the one global routing row, the two served profiles and the isolated canary', () => {
    expect(AI_ROUTING_POLICY).toEqual({
      version: 1,
      region: 'global',
      providerDeploymentProfileVersion: 'private-beta-global-v2',
      policyDigest: AI_ROUTING_POLICY.policyDigest,
    })
    expect(AI_OPERATION_PROFILES.map((profile) => profile.profileVersion)).toEqual([
      'review-analysis-v3',
      'reply-suggestion-v2',
      'synthetic-canary-v1',
    ])
    expect(AI_OPERATION_PROFILES.map((profile) => profile.capability)).toEqual([
      'review_analysis',
      'reply_drafting',
      null,
    ])
    expect(AI_OPERATION_PROFILES.map((profile) => profile.gatewayPath)).toEqual([
      '/v1/review-analysis',
      '/v1/reply-suggestion',
      'internal:synthetic-canary',
    ])
    expect(
      AI_OPERATION_PROFILES.map((profile) => [
        profile.profileVersion,
        profile.providerDeploymentProfileVersion,
      ]),
    ).toEqual([
      ['review-analysis-v3', 'private-beta-global-v2'],
      ['reply-suggestion-v2', 'private-beta-global-v3'],
      ['synthetic-canary-v1', 'private-beta-global-v2'],
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
        // 48 mentions of about 60 tokens each at 'low' effort; the quality check
        // (424 invented reviews, gpt-6-luna) used a mean of 284 output tokens.
        profileVersion: 'review-analysis-v3',
        sourceByteLimit: 16_384,
        providerPayloadByteLimit: 57_344,
        preparedRequestByteLimit: 131_072,
        responseByteLimit: 131_072,
        maxOutputTokens: 4_096,
        reasoningEffort: 'low',
        providerDeadlineMs: 60_000,
        requestDeadlineMs: 70_000,
        executionLeaseMs: 120_000,
      },
      {
        profileVersion: 'reply-suggestion-v2',
        sourceByteLimit: 16_384,
        providerPayloadByteLimit: 57_344,
        preparedRequestByteLimit: 131_072,
        responseByteLimit: 1_048_576,
        maxOutputTokens: 4_096,
        reasoningEffort: 'medium',
        providerDeadlineMs: 60_000,
        requestDeadlineMs: 70_000,
        executionLeaseMs: 120_000,
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
    const [analysis, reply, canary] = AI_OPERATION_PROFILES
    expect(analysis?.outputSchema).toEqual(
      AI_ROUTE_OUTPUT_JSON_SCHEMAS['review-analysis-v3'],
    )
    expect(analysis?.outputSchema).toMatchObject({ additionalProperties: false })
    expect(reply?.outputSchema).toEqual(
      AI_ROUTE_OUTPUT_JSON_SCHEMAS['reply-suggestion-v2'],
    )
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
    const [analysis, reply, canary] = AI_OPERATION_PROFILES
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
    expect(ASPECT_TAXONOMY_V1_DIGEST).toBe(
      createHash('sha256')
        .update('repkey-aspect-taxonomy-v1\0', 'utf8')
        .update(canonicalizeRfc8785(ASPECT_TAXONOMY_V1), 'utf8')
        .digest('hex'),
    )
    expect(reply?.artifactAttestations).toMatchObject({
      source: {
        redactionProfileVersion: AI_REDACTION_PROFILE_VERSION,
        redactionProfileDigest: AI_REDACTION_PROFILE_DIGEST,
        languageCatalogueDigest: LANGUAGE_CATALOGUE_DIGEST,
      },
      languageVerifier: AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST,
      scriptVerifier: AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST,
    })
    expect(canary?.artifactAttestations).toMatchObject({
      promptCacheShard: 0,
      safetyIdentifierProfileVersion: 'synthetic-canary-safety-v1',
    })
    for (const profile of AI_OPERATION_PROFILES) {
      expect(profile.staticTokenBearingBytes).toBeGreaterThan(0)
      expect(profile.staticTokenBearingDigest).toMatch(/^[0-9a-f]{64}$/)
      expect(profile.sdkRequestShapeDigest).toBe(
        openAiAttestationOf(profile).requestShape.digest,
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
    for (const profile of AI_OPERATION_PROFILES.slice(0, 2)) {
      expect(profile.artifactAttestations).toMatchObject({
        calendar: {
          profileVersion: 'property-calendar-v1',
          epochMillisFunction: 'ai_epoch_millis_v1',
          localCalendarFunction: 'ai_property_local_date_v1',
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
