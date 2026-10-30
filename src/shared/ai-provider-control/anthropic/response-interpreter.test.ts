import { describe, expect, it, vi } from 'vitest'
import type { PreparedAnthropicInvocation } from './prepared-invocation'
import { interpretAnthropicMessage } from './response-interpreter'

function invocation(): PreparedAnthropicInvocation {
  return {
    descriptor: {
      subjectKind: 'property',
      route: 'review-analysis',
      binding: { operationProfileVersion: 'review-analysis-v3' },
      providerPayloadByteCount: 10,
      limits: { outputTokens: 100 },
    },
    sdkRequest: { max_tokens: 100 },
  } as PreparedAnthropicInvocation
}

const usage = {
  input_tokens: 10,
  output_tokens: 8,
  output_tokens_details: { thinking_tokens: 3 },
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    stop_reason: 'end_turn',
    stop_details: null,
    content: [{ type: 'text', text: '{"ok":true}' }],
    usage,
    ...overrides,
  }
}

describe('Anthropic Message interpretation', () => {
  it('ignores thinking blocks and returns one plain-object answer unchanged', () => {
    const outOfRange = { sentence: 0, phrase: 'x'.repeat(81), mentions: 49 }
    const outcome = interpretAnthropicMessage(
      message({
        content: [
          { type: 'thinking', thinking: '' },
          { type: 'redacted_thinking', data: 'redacted' },
          { type: 'text', text: JSON.stringify(outOfRange) },
        ],
      }),
      invocation(),
      4_096,
    )
    expect(outcome).toMatchObject({ disposition: 'success', result: outOfRange })
  })

  it.each([
    [[], 'zero text blocks'],
    [
      [
        { type: 'text', text: '{}' },
        { type: 'text', text: '{}' },
      ],
      'two text blocks',
    ],
    [[{ type: 'tool_use', id: 'invented' }], 'a tool block'],
    [[{ type: 'text', text: '[]' }], 'an array answer'],
    [[{ type: 'text', text: 'null' }], 'a null answer'],
    [[{ type: 'text', text: '7' }], 'a scalar answer'],
  ])('refuses %s without releasing content', (content, _description) => {
    const outcome = interpretAnthropicMessage(message({ content }), invocation(), 4_096)
    expect(outcome).toMatchObject({
      disposition: 'output_invalid',
      result: null,
      usageKnown: true,
    })
  })

  it.each([
    ['max_tokens', 'output_truncated'],
    ['model_context_window_exceeded', 'output_truncated'],
    ['stop_sequence', 'output_invalid'],
    ['tool_use', 'output_invalid'],
    ['pause_turn', 'output_invalid'],
  ])('maps stop reason %s to %s', (stopReason, disposition) => {
    expect(
      interpretAnthropicMessage(
        message({ stop_reason: stopReason }),
        invocation(),
        4_096,
      ),
    ).toMatchObject({ disposition, result: null, usageKnown: true })
  })

  it.each(['general_harms', null] as const)(
    'reports a billed refusal with category %s but never its explanation',
    (category) => {
      const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
      const outcome = interpretAnthropicMessage(
        message({
          stop_reason: 'refusal',
          stop_details: {
            type: 'refusal',
            category,
            explanation: 'invented sensitive explanation',
          },
        }),
        invocation(),
        4_096,
      )
      expect(outcome).toMatchObject({
        disposition: 'provider_refused',
        usageKnown: true,
        providerRetryable: false,
      })
      expect(String(write.mock.calls[0]?.[0])).toContain(
        `"category":${category === null ? 'null' : `"${category}"`}`,
      )
      expect(String(write.mock.calls[0]?.[0])).not.toContain('explanation')
      write.mockRestore()
    },
  )

  it('keeps the usage of a billed answer whose stop reason is new to us', () => {
    expect(
      interpretAnthropicMessage(
        message({ stop_reason: 'a_reason_added_next_year' }),
        invocation(),
        4_096,
      ),
    ).toMatchObject({ disposition: 'output_invalid', result: null, usageKnown: true })
  })

  it('keeps the usage of a billed answer that is not shaped like a message', () => {
    expect(
      interpretAnthropicMessage(
        { usage, content: 'not an array', stop_reason: 'end_turn' },
        invocation(),
        4_096,
      ),
    ).toMatchObject({ disposition: 'output_invalid', result: null, usageKnown: true })
  })

  it('names a refusal category it does not know as unlisted, never in the provider words', () => {
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const outcome = interpretAnthropicMessage(
      message({
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'a category invented later' },
      }),
      invocation(),
      4_096,
    )
    expect(outcome).toMatchObject({ disposition: 'provider_refused', usageKnown: true })
    expect(String(write.mock.calls[0]?.[0])).toContain('"category":"unlisted"')
    expect(String(write.mock.calls[0]?.[0])).not.toContain('invented')
    write.mockRestore()
  })

  it('keeps the reported refusal when usage is malformed', () => {
    expect(
      interpretAnthropicMessage(
        message({ stop_reason: 'refusal', usage: null }),
        invocation(),
        4_096,
      ),
    ).toMatchObject({
      disposition: 'output_invalid',
      reportedDisposition: 'provider_refused',
      usageKnown: false,
    })
  })
})
