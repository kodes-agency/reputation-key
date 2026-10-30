import { describe, expect, it } from 'vitest'
import { buildClosedAnthropicRequest } from './request-builder'

const schema = Object.freeze({
  type: 'object',
  properties: Object.freeze({ ok: Object.freeze({ type: 'boolean' }) }),
  required: Object.freeze(['ok']),
  additionalProperties: false,
})

describe('closed Anthropic request builder', () => {
  it.each([
    ['none', 'disabled', 'low'],
    ['low', 'adaptive', 'low'],
    ['medium', 'adaptive', 'medium'],
    ['high', 'adaptive', 'high'],
  ] as const)(
    'maps %s to thinking %s and effort %s without forbidden fields',
    (reasoningEffort, thinking, effort) => {
      const request = buildClosedAnthropicRequest({
        developerPrompt: 'Classify this invented payload.',
        untrustedData: '{"invented":true}',
        wireSchema: schema,
        maxOutputTokens: 512,
        reasoningEffort,
        safetyIdentifier: `rk1_${'A'.repeat(43)}`,
      })
      expect(Object.keys(request).sort()).toEqual([
        'max_tokens',
        'messages',
        'metadata',
        'model',
        'output_config',
        'system',
        'thinking',
      ])
      expect(request.thinking.type).toBe(thinking)
      expect(request.output_config.effort).toBe(effort)
      expect(request.metadata.user_id).toBe(`rk1_${'A'.repeat(43)}`)
      expect(request).not.toHaveProperty('temperature')
      expect(request).not.toHaveProperty('stream')
      expect(Object.isFrozen(request)).toBe(true)
      expect(Object.isFrozen(request.output_config.format.schema)).toBe(true)
    },
  )

  it('rejects an invalid safety identifier and empty payload', () => {
    expect(() =>
      buildClosedAnthropicRequest({
        developerPrompt: 'Prompt.',
        untrustedData: '',
        wireSchema: schema,
        maxOutputTokens: 1,
        reasoningEffort: 'low',
        safetyIdentifier: 'rk1_short',
      } as never),
    ).toThrow(new TypeError('Invalid closed Anthropic request input'))
  })
})
