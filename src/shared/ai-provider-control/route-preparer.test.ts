import { generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_OPERATION_PROFILES } from '#/shared/ai-operation-profiles'
import {
  AI_REVIEW_LANGUAGE_REGION_ICU_VERSION,
  AI_REVIEW_LANGUAGE_REGION_NODE_VERSION,
  AI_REVIEW_LANGUAGE_REGION_UNICODE_VERSION,
} from '#/shared/generated/ai-review-language-canonical-regions-v1'
import { type AiReplyOutputRefusal, createAiGatewayRoutePreparer } from './route-preparer'
import { preparableV3Request } from './review-evidence.test-fixtures'
import { createSensitiveSourceLease } from './source-lease'

function preparer(
  detect: (text: string) => Readonly<{
    language: string
    probability: number
    reliable: boolean
  }> = () => ({ language: 'en', probability: 1, reliable: true }),
  onOutputRefused?: (refusal: AiReplyOutputRefusal) => void,
) {
  const provenance = generateKeyPairSync('ed25519')
  return createAiGatewayRoutePreparer({
    ...(onOutputRefused ? { onOutputRefused } : {}),
    safetyIdentifierKey: Buffer.alloc(32, 7),
    replyLanguageDetector: {
      detect,
    },
    provenanceKid: 'provenance-v1',
    provenancePrivateKey: provenance.privateKey,
  })
}

// A v3 provider answer: one complaint, stated by the first sentence of the review.
const acceptedAnalysis = Object.freeze({
  sentiment: 'negative',
  mentions: Object.freeze([
    Object.freeze({
      topic: 'speed_waiting',
      polarity: 'negative',
      strength: 'clear',
      thing: 'check-in',
      issue: 'slow',
      sentences: Object.freeze([2]),
      names_person: null,
    }),
  ]),
  urgent: null,
})
const fakeReceipt = () => ({ marker: 'settled-receipt' }) as never
const fakeAdmission = () => ({}) as never

beforeEach(() => {
  vi.spyOn(process.versions, 'node', 'get').mockReturnValue(
    AI_REVIEW_LANGUAGE_REGION_NODE_VERSION,
  )
  vi.spyOn(process.versions, 'icu', 'get').mockReturnValue(
    AI_REVIEW_LANGUAGE_REGION_ICU_VERSION,
  )
  vi.spyOn(process.versions, 'unicode', 'get').mockReturnValue(
    AI_REVIEW_LANGUAGE_REGION_UNICODE_VERSION,
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('gateway route-preparer source lifetime', () => {
  it('keeps response closures source-free after the lease scrubs the original source root', () => {
    const request = preparableV3Request()
    const sourceReference = new WeakRef(request.source)
    const lease = createSensitiveSourceLease<typeof request>()
    lease.attachSource(request, (root) => root.source)
    const prepared = lease.read((leased) => preparer().prepare(leased))
    expect(lease.inspect()).toMatchObject({
      disposed: true,
      hasSource: false,
      allOwnedChunksZeroed: true,
    })
    expect(sourceReference.deref()).toEqual({
      kind: null,
      text: null,
      rating: null,
      languageCode: null,
      reviewedAtEpochMillis: null,
      sentences: null,
    })
    const accepted = prepared.acceptProviderResult(acceptedAnalysis)
    expect(accepted).not.toBeNull()
    expect(accepted?.buildResponse(fakeReceipt(), fakeAdmission())).toMatchObject({
      route: 'review-analysis',
      status: 'success',
      result: { contract: 'review-analysis-v3' },
    })
  })

  it('isolates result acceptance and response construction from later request mutation', () => {
    const request = preparableV3Request()
    const lease = createSensitiveSourceLease<typeof request>()
    lease.attachSource(request, (root) => root.source)
    const prepared = lease.read((leased) => preparer().prepare(leased))
    Object.assign(request as unknown as Record<string, unknown>, {
      route: 'reply-suggestion',
      operationId: 'mutated-operation',
      actorId: 'mutated-actor',
    })
    Object.assign(request.binding as unknown as Record<string, unknown>, {
      operationProfileVersion: 'mutated-profile',
      sourceEpoch: 999,
    })
    const accepted = prepared.acceptProviderResult(acceptedAnalysis)
    expect(accepted).not.toBeNull()
    const response = accepted?.buildResponse(fakeReceipt(), fakeAdmission())
    expect(response).toMatchObject({
      route: 'review-analysis',
      status: 'success',
      result: { contract: 'review-analysis-v3' },
    })
    expect(JSON.stringify(response)).not.toContain('mutated')
  })

  it('derives preparation limits from the pinned operation catalogue', () => {
    const request = preparableV3Request()
    const lease = createSensitiveSourceLease<typeof request>()
    lease.attachSource(request, (root) => root.source)
    const prepared = lease.read((leased) => preparer().prepare(leased))
    const profile = AI_OPERATION_PROFILES.find(
      (entry) =>
        entry.sourceRoute === 'review-analysis' &&
        entry.profileVersion === request.binding.operationProfileVersion,
    )
    expect(profile).toBeDefined()
    expect(prepared.invocation.descriptor.limits).toMatchObject({
      sourceBytes: profile?.sourceByteLimit,
      providerPayloadBytes: profile?.providerPayloadByteLimit,
      preparedRequestBytes: profile?.preparedRequestByteLimit,
      responseBytes: profile?.responseByteLimit,
      outputTokens: profile?.maxOutputTokens,
    })
  })

  // A refused draft lands on the operation as one opaque `output_invalid`,
  // after the provider has been billed and while the operator is shown a local
  // fallback. Attributing eleven real refusals on the beta property required
  // attaching a probe to the running process, so each rule now names itself.
})
