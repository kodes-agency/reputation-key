import { REPLY_DRAFTING_V2_SERVED_LANGUAGES } from './reply-drafting-v2-schema'
import { z } from 'zod/v4'
import { describe, expect, it } from 'vitest'
import { REPLY_DRAFTING_V2_OPERATION_PROFILE as profile } from './reply-drafting-v2-profile'
import { REPLY_DRAFTING_V2_PROFILE_DIGEST } from './reply-drafting-v2-contract'
import { REPLY_BODY_LINT_DIGEST } from './reply-drafting-v2-lint'
import {
  REPLY_DRAFTING_V2_EXAMPLES_DIGEST,
  pickReplyDraftingV2Examples,
  replyDraftingV2DeveloperMessage,
  resolveReplyDraftingV2Options,
  buildReplyDraftingV2Payload,
  validReplyDraftingV2Options,
} from './reply-drafting-v2-request'
import { REPLY_DRAFTING_V2_PROMPT } from './reply-drafting-v2-prompt'
import {
  AI_RUNTIME_CAPABILITY_CATALOGUE,
  getAiRuntimeCapability,
  isExecutionCompatibleWithConsent,
} from './ai-runtime-capability-contract'
import {
  MERCHANT_AI_NOTICE_VERSION,
  MERCHANT_AI_NOTICE_DIGEST,
} from './merchant-ai-notice-contract'
import ENGLISH from './reply-drafting-v2-examples.json'
import BULGARIAN from './reply-drafting-v2-examples-bg.json'

const PINS = {
  profile: 'a34e49f68d6249a1fb6242b5a7b7ce13a32d9b86b4182cbdead527bae888dd69',
  prompt: 'b6de6db2e52bd85713e81277b7b4eddc1a5788b37c2427bb872dae6c3581016f',
  schema: '2f7afcc12b767302d60d6b1f931fd7996d010dd7c24ba32246fff415c1d4dcd7',
  personalized: 'a7a78df2a8c208f211b902bf712d83b1f69a493d57444e3a638f08605d8a2802',
  lint: 'd4132531ab3caa7586c28931f8b87a899f07757527ea5ebcc235a02377685a3f',
  examples: '92b0f476a682aa90215900acf458898c112aa7da9243be336bff570db3a0fa90',
}

describe('reply drafting v2, served release', () => {
  it('serves Spanish with English and Bulgarian through one serving selection', () => {
    expect(REPLY_DRAFTING_V2_SERVED_LANGUAGES).toEqual(['en-Latn', 'es-Latn', 'bg-Cyrl'])
  })
  it('pins every new artifact independently of v1', () => {
    expect({
      profile: profile.profileDigest,
      prompt: profile.promptDigest,
      schema: profile.outputSchemaDigest,
      personalized: REPLY_DRAFTING_V2_PROFILE_DIGEST,
      lint: REPLY_BODY_LINT_DIGEST,
      examples: REPLY_DRAFTING_V2_EXAMPLES_DIGEST,
    }).toEqual(PINS)
    expect(profile).toMatchObject({
      profileVersion: 'reply-suggestion-v2',
      reasoningEffort: 'medium',
      maxOutputTokens: 2048,
      developerPrompt: REPLY_DRAFTING_V2_PROMPT,
    })
  })
  it('serves v2 with streaming compatibility', () => {
    const dark = AI_RUNTIME_CAPABILITY_CATALOGUE.find(
      (row) => row.runtimeProfileVersion === 'reply-drafting-runtime-v2',
    )!
    expect(dark.served).toBe(true)
    expect(dark.noticesInForce).toContainEqual({
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
    })
    expect(getAiRuntimeCapability('reply_drafting')).toMatchObject({
      runtimeProfileVersion: 'reply-drafting-runtime-v2',
      operationProfileVersion: 'reply-suggestion-v2',
    })
    expect(
      isExecutionCompatibleWithConsent({
        capability: 'reply_drafting',
        acknowledgedNotice: {
          noticeVersion: MERCHANT_AI_NOTICE_VERSION,
          noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
        },
        servedExecution: dark,
      }),
    ).toBe(true)
  })
  it('uses the harness selection for every rating band and its separate Bulgarian book', () => {
    expect(pickReplyDraftingV2Examples(5, 0, 'es-Latn')).toEqual([
      ENGLISH.positive[0],
      ENGLISH.positive[2 % ENGLISH.positive.length],
      ENGLISH.positive[4 % ENGLISH.positive.length],
    ])
    expect(pickReplyDraftingV2Examples(3, 0, 'en-Latn')).toEqual([
      ENGLISH.mixed[0],
      ENGLISH.mixed[1],
      ENGLISH.complaint[0],
    ])
    expect(pickReplyDraftingV2Examples(1, 0, 'en-Latn')[1]).toEqual(ENGLISH.serious[0])
    expect(pickReplyDraftingV2Examples(2, 1, 'en-Latn')[1]).toEqual(
      ENGLISH.money[1 % ENGLISH.money.length],
    )
    expect(pickReplyDraftingV2Examples(1, 2, 'en-Latn')[1]).toEqual(
      ENGLISH.unclear[2 % ENGLISH.unclear.length],
    )
    expect(pickReplyDraftingV2Examples(5, 0, 'bg-Cyrl')).toEqual([
      BULGARIAN.positive[0],
      BULGARIAN.positive[1],
    ])
    expect(pickReplyDraftingV2Examples(3, 0, 'bg-Cyrl')).toEqual([
      BULGARIAN.mixed[0],
      BULGARIAN.positive[2],
      BULGARIAN.complaint[0],
    ])
    expect(pickReplyDraftingV2Examples(1, 0, 'bg-Cyrl')).toEqual([
      BULGARIAN.complaint[0],
      BULGARIAN.serious[0],
      BULGARIAN.complaint[1],
    ])
  })
  it('appends only synthetic examples and fixed problem descriptions', () => {
    const message = replyDraftingV2DeveloperMessage({
      rating: 1,
      variation: 2,
      languageCode: 'es-Latn',
      rewriteIssues: ['invitation', 'multiple_apologies'],
    })
    expect(message.startsWith(REPLY_DRAFTING_V2_PROMPT)).toBe(true)
    expect(message).toContain(
      'Examples of the style (other guests and businesses; never copy their wording):',
    )
    expect(message).toContain(
      'A previous draft for this review broke these rules: Leave contact and return invitations to the local frame; Apologize at most once. Write a new draft that follows every rule.',
    )
  })
  it('derives opening and apology from variation, enforces Shorter and rejects arbitrary starts', () => {
    const options = resolveReplyDraftingV2Options({
      languageCode: 'es-Latn',
      variation: 4,
      maxWords: 18,
    })
    expect(options).toEqual({
      variation: 4,
      opening: 2,
      apologyStart: 'Lamentamos',
      length: 'short',
      maxWords: 18,
    })
    expect(
      validReplyDraftingV2Options(
        { ...options, apologyStart: 'manager supplied text' },
        'es-Latn',
      ),
    ).toBe(false)
    expect(() =>
      resolveReplyDraftingV2Options({ languageCode: 'en-Latn', variation: -1 }),
    ).toThrow(TypeError)
    expect(() =>
      resolveReplyDraftingV2Options({
        languageCode: 'en-Latn',
        variation: 0,
        maxWords: 7,
      }),
    ).toThrow(z.ZodError)
    const payload = buildReplyDraftingV2Payload({
      rating: 1,
      tone: 'professional',
      languageCode: 'es-Latn',
      options,
      sentences: [{ n: 1, text: 'Source.' }],
    })
    expect(Object.keys(payload)).toEqual([
      'replyProfileVersion',
      'rating',
      'tone',
      'languageCode',
      'length',
      'maxWords',
      'opening',
      'apologyStart',
      'sentences',
    ])
    expect(payload).not.toHaveProperty('variation')
  })
})
