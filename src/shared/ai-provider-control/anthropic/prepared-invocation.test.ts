import { describe, expect, it, vi } from 'vitest'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import { createPreparedAnthropicInvocation } from './prepared-invocation'
import { buildClosedAnthropicRequest } from './request-builder'

describe('prepared Anthropic invocation', () => {
  it('refuses a request whose user message is not its canonical provider payload', () => {
    const sdkRequest = buildClosedAnthropicRequest({
      developerPrompt: 'Classify invented data.',
      untrustedData: '{"invented":true}',
      wireSchema: {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
        additionalProperties: false,
      },
      maxOutputTokens: 10,
      reasoningEffort: 'low',
      safetyIdentifier: `rk1_${'A'.repeat(43)}`,
    })
    const createDescriptor = vi.fn()

    expect(() =>
      createPreparedAnthropicInvocation({
        sourceBytes: Uint8Array.of(1),
        providerPayload: { invented: false },
        sdkRequest,
        createDescriptor,
        requestBindingKeys: createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`),
      }),
    ).toThrow(
      new TypeError('Closed Anthropic request is not derived from its provider payload'),
    )
    expect(createDescriptor).not.toHaveBeenCalled()
  })
})
