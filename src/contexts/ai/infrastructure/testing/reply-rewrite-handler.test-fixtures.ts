import {
  NOW,
  SHA,
  createHarness,
} from '#/contexts/ai/infrastructure/testing/reply-handler.test-fixtures'
import type { GenerateReplySuggestionDependencies } from '#/contexts/ai/reply/generate-suggestion.server'
import { createGenerateReplySuggestion } from '#/contexts/ai/reply/generate-suggestion.server'
import {
  createAiGatewayRoutePreparer,
  type AiReplyOutputRefusal,
} from '#/shared/ai-provider-control/route-preparer'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import { generateKeyPairSync } from 'node:crypto'
import { expect, vi } from 'vitest'
const REJECTED_V2_OUTPUT = {
  languageCode: 'en-Latn',
  case: 'complaint',
  mainPoint: [1],
  avoidTerms: ['zephyrmarker', 'quartzmarker'],
  replyText: 'We are sorry. Call us about the zephyrmarker and quartzmarker, please.',
}
const V2_PROVENANCE_KEYS = generateKeyPairSync('ed25519')

// The dark factory seam exercises the new lifecycle without changing the served catalogue.
async function createV2Harness(
  outcomes: readonly (
    'accepted' | 'hard' | 'refused' | 'ambiguous' | 'scanner_unavailable'
  )[],
  afterFirst?: (base: Awaited<ReturnType<typeof createHarness>>) => void | Promise<void>,
) {
  const frame = {
    prefix: '',
    suffix: '',
    voiceDigest: SHA,
    reviewerDisplayName: null,
    contact: null,
    signerName: null,
    signerTitle: null,
    businessName: 'Example Hotel',
  }
  const base = await createHarness({
    replyLocalFrame: frame,
    reviewText: 'We waited a long time for the room to be ready.',
  })
  const charges = new Map<string, number>()
  const refusals: AiReplyOutputRefusal[] = []
  const gatewayPreparer = createAiGatewayRoutePreparer({
    requestBindingKeys: createVersionedHmacKeyring(`request-v1:${'07'.repeat(32)}`),
    safetyIdentifierKey: Buffer.alloc(32, 8),
    provenanceKid: 'reply-v1',
    provenancePrivateKey: V2_PROVENANCE_KEYS.privateKey,
    replyLanguageDetector: {
      detect: () => ({ language: 'en', probability: 0.99, reliable: true }),
    },
    now: () => NOW,
    onOutputRefused: (refusal) => refusals.push(refusal),
  })

  const { claim, claimExecution } = base.persistence.operations
  let providerCalls = 0
  const generateReply: ReturnType<
    typeof vi.fn<GenerateReplySuggestionDependencies['inference']['generateReply']>
  > = vi.fn<GenerateReplySuggestionDependencies['inference']['generateReply']>(
    async (request, signal) => {
      const admission = await base.persistence.settleProviderOperation(
        request.operationId,
      )
      if (!admission.ok) throw new Error('synthetic provider budget refused')
      charges.set(request.operationId, (charges.get(request.operationId) ?? 0) + 1)
      const outcome = outcomes[providerCalls++] ?? 'hard'
      if (providerCalls === 1) await afterFirst?.(base)
      let rewriteIssues: ReturnType<typeof gatewayPreparer.prepare>['repairIssues']
      if (outcome === 'hard') {
        const prepared = gatewayPreparer.prepare(request)
        expect(prepared.acceptProviderResult(REJECTED_V2_OUTPUT)).toBeNull()
        rewriteIssues = prepared.repairIssues
      }
      if (outcome !== 'accepted')
        return {
          route: 'reply-suggestion',
          status: 'error',
          code:
            outcome === 'ambiguous'
              ? 'operation_ambiguous'
              : outcome === 'refused'
                ? 'provider_refused'
                : outcome === 'scanner_unavailable'
                  ? 'policy_unavailable'
                  : 'output_invalid',
          retryAfterEpochMillis: null,
          ...(outcome === 'hard' ? { rewriteIssues: [...rewriteIssues!()] } : {}),
        }
      const response = await base.dependencies.inference.generateReply(request, signal)
      if (response.status !== 'success') throw new Error('Expected fixture success')
      return {
        ...response,
        result: {
          ...response.result,
          profileVersion: 'reply-draft-v4',
          case: 'complaint',
          mainPoint: [1],
          templateGroup: 'en-Latn',
        },
      }
    },
  )
  const dependencies: GenerateReplySuggestionDependencies = {
    ...base.dependencies,
    inference: { ...base.dependencies.inference, generateReply },
    replyVoices: {
      ...base.dependencies.replyVoices!,
      resolveV2Frame: async () => ({
        ...frame,
        candidates: [
          {
            prefix: '',
            suffix: '',
            thanks: false,
            choices: {
              closing: -1,
              signOff: 0,
              contactSentence: 0,
              emoji: 0,
              includeContact: true,
            },
          },
        ],
      }),
    },
    reviewSources: {
      ...base.dependencies.reviewSources,
      readForAi: async (input) => {
        const source = await base.dependencies.reviewSources.readForAi(input)
        return source.status === 'available'
          ? {
              ...source,
              observation: {
                ...source.observation,
                sentences: [{ number: 1, text: source.observation.text ?? '' }],
              },
            }
          : source
      },
    },
  }
  return {
    base,
    dependencies,
    generate: createGenerateReplySuggestion(dependencies, {
      parentOperationId: null,
      rewriteOrdinal: 0,
      rewriteIssues: [],
    }),
    generateReply,
    claim,
    claimExecution,
    storedOperations: base.persistence.storedOperations,
    refusals,
    charges,
  }
}

export { REJECTED_V2_OUTPUT, createV2Harness }
