import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import {
  AI_INTERNAL_RESPONSE_MAX_BYTES,
  aiAdmissionDescriptorSchema,
  aiSettlementRequestSchema,
  type AiAdmissionDescriptorV1,
} from './ai-internal-transport-contract'
import { aiAdmissionDescriptorDigest } from './ai-provider-control/execution-admission'
import { descriptorForTest as descriptor } from './ai-provider-control/execution-admission.test-fixtures'

const UUIDS = {
  operation: '10000000-0000-4000-8000-000000000001',
  permit: '10000000-0000-4000-8000-000000000002',
} as const
import {
  AI_INTERNAL_JSON_MAX_DEPTH,
  AI_INTERNAL_JSON_MAX_NODES,
  explainJsonBytesRejection,
  parseAiInternalJsonBytes,
  parseAiProviderJsonBytes,
} from './ai-json'

describe('AI internal raw JSON transport', () => {
  const schema = z
    .object({ nested: z.object({ value: z.number().int().safe() }).strict() })
    .strict()

  it('accepts strict UTF-8 JSON and rejects duplicate, trailing, unsafe, BOM, and invalid-scalar input', () => {
    expect(
      parseAiInternalJsonBytes(
        new TextEncoder().encode('{"nested":{"value":1}}'),
        64,
        schema,
      ),
    ).toEqual({ nested: { value: 1 } })

    for (const raw of [
      '{"nested":{"value":1,"value":2}}',
      '{"nested":{"value":1}} null',
      '{"nested":{"value":9007199254740992}}',
      '{"nested":{"value":"\\ud800"}}',
    ]) {
      expect(() =>
        parseAiInternalJsonBytes(new TextEncoder().encode(raw), 128, schema),
      ).toThrow(/AI internal request is invalid/)
    }
    expect(() =>
      parseAiInternalJsonBytes(Uint8Array.of(0xef, 0xbb, 0xbf, 0x7b, 0x7d), 64, schema),
    ).toThrow(/AI internal request is invalid/)
  })

  it('accepts fractional numbers for provider bodies only, keeping every other rule', () => {
    const fractional = new TextEncoder().encode('{"top_p":0.98}')
    expect(parseAiProviderJsonBytes(fractional, 128, z.unknown())).toEqual({
      top_p: 0.98,
    })
    expect(() => parseAiInternalJsonBytes(fractional, 128, z.unknown())).toThrow(
      /AI internal request is invalid/,
    )
    for (const raw of [
      '{"top_p":0.98,"top_p":0.5}',
      '{"top_p":0.98} null',
      '{"value":"\\ud800"}',
    ]) {
      expect(() =>
        parseAiProviderJsonBytes(new TextEncoder().encode(raw), 128, z.unknown()),
      ).toThrow(/AI internal request is invalid/)
    }
    expect(() => parseAiProviderJsonBytes(fractional, 4, z.unknown())).toThrow(
      /AI internal request is invalid/,
    )
  })

  it('names the rejected rule and JSON path for the number policy in force', () => {
    const fractional = new TextEncoder().encode('{"a":{"b":[1,0.98]}}')
    expect(explainJsonBytesRejection(fractional, 128)).toBe(
      'scan:ok;parse:ok;validate:number_not_integer:$.a.b[1]=0.98;nodes:5',
    )
    expect(explainJsonBytesRejection(fractional, 128, 'finite-numbers')).toBe(
      'scan:ok;parse:ok;validate:ok;nodes:5',
    )
    expect(explainJsonBytesRejection(new TextEncoder().encode('{'), 128)).toBe(
      'scan:fail;parse:fail',
    )
    expect(explainJsonBytesRejection(new Uint8Array(0), 128)).toBe('byte_length:0')
  })

  it('rejects trailing high, mid-string high, and lone low surrogates in raw JSON strings', () => {
    const stringSchema = z.object({ value: z.string() }).strict()
    for (const raw of [
      '{"value":"\\ud800"}',
      '{"value":"before\\ud800after"}',
      '{"value":"\\udc00"}',
    ]) {
      expect(() =>
        parseAiInternalJsonBytes(new TextEncoder().encode(raw), 128, stringSchema),
      ).toThrow(/AI internal request is invalid/)
    }
    expect(
      parseAiInternalJsonBytes(
        new TextEncoder().encode('{"value":"\\ud83d\\ude00"}'),
        128,
        stringSchema,
      ),
    ).toEqual({ value: '😀' })
  })

  it('enforces the decoded-byte cap before parsing', () => {
    expect(() =>
      parseAiInternalJsonBytes(
        new TextEncoder().encode('{"nested":{"value":1}}'),
        8,
        schema,
      ),
    ).toThrow(/AI internal request is invalid/)
    expect(AI_INTERNAL_RESPONSE_MAX_BYTES).toBe(65_536)
  })

  it('bounds JSON depth at the scanner and parsed-value audit boundary', () => {
    const nested = (depth: number) =>
      `${'{"value":'.repeat(depth - 1)}null${'}'.repeat(depth - 1)}`

    expect(() =>
      parseAiInternalJsonBytes(
        new TextEncoder().encode(nested(AI_INTERNAL_JSON_MAX_DEPTH - 1)),
        AI_INTERNAL_RESPONSE_MAX_BYTES,
        z.unknown(),
      ),
    ).not.toThrow()
    expect(() =>
      parseAiInternalJsonBytes(
        new TextEncoder().encode(nested(AI_INTERNAL_JSON_MAX_DEPTH)),
        AI_INTERNAL_RESPONSE_MAX_BYTES,
        z.unknown(),
      ),
    ).not.toThrow()
    expect(() =>
      parseAiInternalJsonBytes(
        new TextEncoder().encode(nested(AI_INTERNAL_JSON_MAX_DEPTH + 1)),
        AI_INTERNAL_RESPONSE_MAX_BYTES,
        z.unknown(),
      ),
    ).toThrow(/AI internal request is invalid/)
  })

  it('bounds the total JSON value-node count', () => {
    const array = (entries: number) =>
      `[${Array.from({ length: entries }, () => '0').join(',')}]`

    expect(() =>
      parseAiInternalJsonBytes(
        new TextEncoder().encode(array(AI_INTERNAL_JSON_MAX_NODES - 1)),
        AI_INTERNAL_RESPONSE_MAX_BYTES,
        z.unknown(),
      ),
    ).not.toThrow()
    expect(() =>
      parseAiInternalJsonBytes(
        new TextEncoder().encode(array(AI_INTERNAL_JSON_MAX_NODES)),
        AI_INTERNAL_RESPONSE_MAX_BYTES,
        z.unknown(),
      ),
    ).toThrow(/AI internal request is invalid/)
  })
})

describe('AI settlement transport', () => {
  const valid = {
    operationId: UUIDS.operation,
    permitId: UUIDS.permit,
    attemptNumber: 1,
    disposition: 'success',
    reportedDisposition: 'success',
    usageKnown: true,
    inputTokens: 100,
    cachedInputTokens: 20,
    outputTokens: 30,
    reasoningTokens: 10,
    retryAfterSeconds: null,
    providerRetryable: false,
  } as const

  it('accepts bounded detailed usage and rejects internally inconsistent usage', () => {
    expect(aiSettlementRequestSchema.parse(valid)).toEqual(valid)
    expect(
      aiSettlementRequestSchema.safeParse({ ...valid, cachedInputTokens: 101 }).success,
    ).toBe(false)
    expect(
      aiSettlementRequestSchema.safeParse({
        ...valid,
        disposition: 'no_dispatch',
      }).success,
    ).toBe(false)
    expect(
      aiSettlementRequestSchema.safeParse({ ...valid, retryAfterSeconds: 10 }).success,
    ).toBe(false)
    expect(
      aiSettlementRequestSchema.safeParse({
        ...valid,
        disposition: 'transport_ambiguous',
        reportedDisposition: 'transport_ambiguous',
        usageKnown: false,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      }).success,
    ).toBe(true)
    expect(
      aiSettlementRequestSchema.safeParse({
        ...valid,
        disposition: 'output_invalid',
        usageKnown: false,
        inputTokens: 1,
      }).success,
    ).toBe(false)
    expect(
      aiSettlementRequestSchema.safeParse({
        ...valid,
        disposition: 'no_dispatch',
        reportedDisposition: 'no_dispatch',
        usageKnown: false,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      }).success,
    ).toBe(true)
  })

  it('rejects admission-only disposition overrides from gateway settlement requests', () => {
    for (const forbidden of ['source_stale', 'policy_denied'] as const) {
      expect(
        aiSettlementRequestSchema.safeParse({
          ...valid,
          disposition: forbidden,
          reportedDisposition: forbidden,
        }).success,
      ).toBe(false)
      expect(
        aiSettlementRequestSchema.safeParse({
          ...valid,
          reportedDisposition: forbidden,
        }).success,
      ).toBe(false)
    }
  })
})

describe('AI admission descriptor', () => {
  it('accepts the exact strict descriptor and digests every field', () => {
    const value = descriptor()
    expect(aiAdmissionDescriptorSchema.parse(value)).toEqual(value)
    expect(aiAdmissionDescriptorSchema.safeParse({ ...value, extra: true }).success).toBe(
      false,
    )
    const digest = aiAdmissionDescriptorDigest(value)
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
    expect(aiAdmissionDescriptorDigest(structuredClone(value))).toBe(digest)
    for (const mutated of [
      { ...value, attemptNumber: 2 },
      { ...value, sourceDigest: 'b'.repeat(64) },
      { ...value, limits: { ...value.limits, costMicros: value.limits.costMicros + 1 } },
      { ...value, callerDeadlineEpochMillis: value.callerDeadlineEpochMillis + 1 },
    ] as AiAdmissionDescriptorV1[]) {
      expect(aiAdmissionDescriptorDigest(mutated)).not.toBe(digest)
    }
  })
})
