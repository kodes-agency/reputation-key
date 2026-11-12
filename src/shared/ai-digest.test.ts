import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { digestOf } from './ai-digest'
import { AI_PROVIDER_DEPLOYMENT_PROFILE_V2 } from './ai-provider-deployment-profile'
import { AI_RUNTIME_CAPABILITIES_V1_DIGEST } from './ai-runtime-capability-contract'
import { REVIEW_ANALYSIS_NORMALIZATION_DIGEST } from './review-analysis-v3-normalizer'
import { REVIEW_ANALYSIS_V3_LOGICAL_ARTIFACTS_DIGEST } from './review-analysis-v3-artifacts'
import { REPLY_DRAFTING_V2_PROFILE_DIGEST } from './reply-drafting-v2-contract'
import { REPLY_DRAFTING_V2_EXAMPLES_DIGEST } from './reply-drafting-v2-request'
import { REPLY_BODY_LINT_DIGEST } from './reply-drafting-v2-lint'
import { AI_PERSONALIZED_REPLY_PROFILE_DIGEST } from './ai-personalized-reply-contract'
import { AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST } from './ai-reply-output-leakage'
import { AI_STRUCTURED_MARKER_DETECTORS_DIGEST } from './ai-structured-marker-detectors'
import { AI_REPLY_TEMPLATE_CATALOGUE_DIGEST } from './ai-reply-template-catalogue'
import {
  OPENAI_NORMALIZED_EVIDENCE_CLAIMS_DIGEST_V1,
  OPENAI_REQUEST_SHAPE_V1_DIGEST,
} from './ai-openai-provider-profile'
import { AI_REDACTION_PROFILE_DIGEST } from './ai-deterministic-redactor'
import { AI_OPERATION_PROFILES, AI_ROUTING_POLICY } from './ai-operation-profiles'

describe('the AI digest rule', () => {
  it('hashes the domain, then the RFC 8785 form of the value', () => {
    const expected = createHash('sha256')
      .update('repkey-example-v1\0', 'utf8')
      .update('{"a":[1,"é"],"b":true}', 'utf8')
      .digest('hex')

    expect(digestOf('repkey-example-v1\0', { b: true, a: [1, 'é'] })).toBe(expected)
  })

  it('separates equal values under different domains', () => {
    expect(digestOf('repkey-a-v1\0', { x: 1 })).not.toBe(
      digestOf('repkey-b-v1\0', { x: 1 }),
    )
  })
})

// Stored operations, reply provenance and admission carry these digests, among
// them operations recorded under review-analysis-v2 and reply-suggestion-v1.
// Each literal is the value the build before the one digest rule computed, so a
// stored row's recorded digest still equals what this build recomputes.
describe('digests that stored operations and provenance carry', () => {
  it.each([
    [
      'provider deployment profile',
      AI_PROVIDER_DEPLOYMENT_PROFILE_V2.profileDigest,
      '07a1b133ea2c519ed61fc18ca376cc7e4494b48bbf738d5705739293722962b3',
    ],
    [
      'runtime capabilities',
      AI_RUNTIME_CAPABILITIES_V1_DIGEST,
      '0ea28fcff09749fe6c677c342aa695cc69bddc85dcecc1ea3ad1a59eff928921',
    ],
    [
      'routing policy',
      AI_ROUTING_POLICY.policyDigest,
      'dce9ee5026db127ea4405639caa35e650aa8c6f29632220b1347f4f381e366ca',
    ],
    [
      'analysis normalization',
      REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
      'd3f2d832717d9639c41eeefc65255f87c51e6e92d61cfeafff329af736e955fb',
    ],
    [
      'analysis v3 logical artifacts',
      REVIEW_ANALYSIS_V3_LOGICAL_ARTIFACTS_DIGEST,
      'b50e8b7daa3a2aa39e098986816cbf1236f6be0f4c87c62e57a9d9b479ec4173',
    ],
    [
      'reply v1 profile',
      AI_PERSONALIZED_REPLY_PROFILE_DIGEST,
      '0ef5ff1301c271e6cb46898d7dda42b01073d456a6f89b9e286fc673ae112dec',
    ],
    [
      'reply v2 profile',
      REPLY_DRAFTING_V2_PROFILE_DIGEST,
      'f7a7277c2a255a59284d8b17131e39a6c1a4f82c1f8490d0db1c51d6f5c7ccfe',
    ],
    [
      'reply v2 examples',
      REPLY_DRAFTING_V2_EXAMPLES_DIGEST,
      '6fe9ecfd870155b005157494eff115c8f625eca28f5fad371fa015b2f103bf96',
    ],
    [
      'reply body lint',
      REPLY_BODY_LINT_DIGEST,
      '6f4c77231fda1f6642949cee9d2107c5bed4b7d81d64eea27266d6f44c0ade5b',
    ],
    [
      'reply output leakage',
      AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
      '50c6b85ddbdb810911de7b8aa22c28130d7acf703d0536ab125411a0787f5c3d',
    ],
    [
      'structured marker detectors',
      AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
      'b1b9fb7cd70cf6c1216cff2771fb50623c10602db9029efc8580dd8af879fe6f',
    ],
    [
      'reply template catalogue',
      AI_REPLY_TEMPLATE_CATALOGUE_DIGEST,
      'ff5f572e9c8ce06fc384bdc4cdd911457510fdd0daed571a53d2348faa8bd89f',
    ],
    [
      'redaction profile',
      AI_REDACTION_PROFILE_DIGEST,
      '6596406117004bce574f309c39ea4eba81f4856a08722a0f4b5fb09b6832702a',
    ],
    [
      'OpenAI request shape',
      OPENAI_REQUEST_SHAPE_V1_DIGEST,
      '0bf52569683db47a551f212b33a8e19dfdd768f0a70047740b5f57a72c11ce37',
    ],
    [
      'OpenAI evidence claims',
      OPENAI_NORMALIZED_EVIDENCE_CLAIMS_DIGEST_V1,
      '33aebd2c6985580b83ea6ccab6b3f0157bc1a17cc3e186eae3c076bfe09ac9ef',
    ],
  ])('keeps the %s digest', (_name, actual, recorded) => {
    expect(actual).toBe(recorded)
  })

  it('keeps every served operation profile digest', () => {
    expect(
      Object.fromEntries(
        AI_OPERATION_PROFILES.map((profile) => [
          profile.profileVersion,
          profile.profileDigest,
        ]),
      ),
    ).toEqual({
      'review-analysis-v3':
        'd25c3e071e309060f7d7fafa7b65d95c54d1e0cf98841b8dc9449f5e3414b943',
      'reply-suggestion-v2':
        '96cc3926f0e9d0110b15e05be0233ff50270699ccee833caac0b4480c9b27642',
      'synthetic-canary-v1':
        '6f986a1fe771b2d92d7e16acc09e39cc63aaba4a4f6a9203ad61a0412189f9f5',
    })
  })
})
