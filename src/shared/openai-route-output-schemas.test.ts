import { describe, expect, it } from 'vitest'
import { zodTextFormat } from 'openai/helpers/zod'
import {
  AI_ANALYSIS_OUTPUT_SCHEMA,
  AI_PERSONALIZED_REPLY_OUTPUT_SCHEMA,
  AI_REPLY_SELECTION_OUTPUT_SCHEMA,
  AI_SYNTHETIC_CANARY_OUTPUT_SCHEMA,
  AI_TREND_SELECTION_OUTPUT_SCHEMA,
  AI_ROUTE_OUTPUT_JSON_SCHEMAS,
  CONCRETE_REPLY_LANGUAGE_PATTERN,
} from './openai-route-output-schemas'
import { REPLY_TEMPLATE_LANGUAGE_GROUPS } from './ai-review-language-catalogue'

const cases = [
  ['review-analysis', AI_ANALYSIS_OUTPUT_SCHEMA],
  ['reply-suggestion', AI_PERSONALIZED_REPLY_OUTPUT_SCHEMA],
  ['property-trend', AI_TREND_SELECTION_OUTPUT_SCHEMA],
  ['synthetic-canary', AI_SYNTHETIC_CANARY_OUTPUT_SCHEMA],
] as const

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('expected JSON Schema object')
  }
  return value as Readonly<Record<string, unknown>>
}

function requireStringField(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const field = value[key]
  if (typeof field !== 'string') throw new TypeError(`expected JSON Schema ${key}`)
  return field
}

describe('AI route output schema authority', () => {
  it.each(cases)(
    'matches the exact OpenAI SDK strict draft-7 transform for %s',
    (route, schema) => {
      expect(AI_ROUTE_OUTPUT_JSON_SCHEMAS[route]).toEqual(
        zodTextFormat(schema, `repkey_${route.replaceAll('-', '_')}_v1`).schema,
      )
    },
  )

  it.each(cases)('returns recursively closed plain JSON for %s', (_route, schema) => {
    const result = AI_ROUTE_OUTPUT_JSON_SCHEMAS[_route]
    const visit = (value: unknown): void => {
      if (value === null || typeof value !== 'object') return
      expect(
        Object.getPrototypeOf(value) === Object.prototype ||
          Object.getPrototypeOf(value) === Array.prototype,
      ).toBe(true)
      expect(Object.getOwnPropertySymbols(value)).toEqual([])
      const descriptors = Object.getOwnPropertyDescriptors(value)
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (Array.isArray(value) && key === 'length') {
          expect(descriptor.enumerable).toBe(false)
          expect('value' in descriptor).toBe(true)
          continue
        }
        expect(descriptor.enumerable).toBe(true)
        expect('value' in descriptor).toBe(true)
        expect(descriptor.get).toBeUndefined()
        expect(descriptor.set).toBeUndefined()
        if ('value' in descriptor) visit(descriptor.value)
      }
    }
    visit(result)
    const sdkSchema = zodTextFormat(
      schema,
      `repkey_${_route.replaceAll('-', '_')}_v1`,
    ).schema
    expect(JSON.stringify(result)).toBe(JSON.stringify(sdkSchema))
  })

  it('enforces refinements the provider schema cannot express', () => {
    expect(
      AI_ANALYSIS_OUTPUT_SCHEMA.safeParse({
        sentiment: 'positive',
        sentimentValence: 50,
        primaryCategory: 'service',
        urgencySignals: ['health', 'health'],
      }).success,
    ).toBe(false)
    expect(
      AI_TREND_SELECTION_OUTPUT_SCHEMA.safeParse({
        selectedSignalIds: ['sentiment.positive.up', 'sentiment.positive.up'],
      }).success,
    ).toBe(false)
  })

  it('pins personalized reply evidence and trend signal grammars in provider-visible JSON schema', () => {
    const reply = requireRecord(AI_ROUTE_OUTPUT_JSON_SCHEMAS['reply-suggestion'])
    const replyProperties = requireRecord(reply.properties)
    const replyText = requireRecord(replyProperties.replyText)
    const grounding = requireRecord(replyProperties.grounding)
    const groundingItems = requireRecord(grounding.items)
    const groundingProperties = requireRecord(groundingItems.properties)
    const trend = requireRecord(AI_ROUTE_OUTPUT_JSON_SCHEMAS['property-trend'])
    const trendProperties = requireRecord(trend.properties)
    const selectedSignalIds = requireRecord(trendProperties.selectedSignalIds)
    const items = requireRecord(selectedSignalIds.items)
    expect(replyText).toMatchObject({ type: 'string', minLength: 24, maxLength: 1_200 })
    expect(grounding).toMatchObject({ type: 'array', minItems: 1, maxItems: 3 })
    expect(Object.keys(groundingProperties)).toEqual(['sourceExcerpt', 'replyExcerpt'])
    expect(requireStringField(items, 'pattern')).toContain('valence\\.overall')
  })

  it('keeps the retired template selection schema available only as a historical verifier', () => {
    expect(
      AI_REPLY_SELECTION_OUTPUT_SCHEMA.safeParse({
        templateId: 'appreciation_positive',
        languageCode: 'en-Latn',
      }).success,
    ).toBe(true)
    expect(AI_ROUTE_OUTPUT_JSON_SCHEMAS['reply-suggestion']).not.toEqual(
      zodTextFormat(AI_REPLY_SELECTION_OUTPUT_SCHEMA, 'repkey_reply_suggestion_v1')
        .schema,
    )
  })
  it('gives every provider-visible property a JSON Schema type (OpenAI rejects bare const)', () => {
    // OpenAI Structured Outputs answers 400 invalid_json_schema for any subschema
    // without a `type`, which is exactly what `z.literal` derives. That 400 is
    // reported as `output_invalid`, so it looked like a model fault and blocked
    // the release canary. Assert the shape the provider actually accepts.
    const untyped: string[] = []
    const walk = (node: unknown, path: string): void => {
      if (typeof node !== 'object' || node === null) return
      const record = node as Record<string, unknown>
      if ('const' in record && !('type' in record)) untyped.push(path)
      if ('enum' in record && !('type' in record)) untyped.push(path)
      for (const [key, value] of Object.entries(record)) {
        if (key === 'properties' || key === 'items' || key === '$defs')
          walk(value, `${path}.${key}`)
        else if (
          typeof value === 'object' &&
          value !== null &&
          (key === 'items' ||
            'type' in (value as Record<string, unknown>) ||
            'const' in (value as Record<string, unknown>) ||
            'enum' in (value as Record<string, unknown>) ||
            'properties' in (value as Record<string, unknown>))
        ) {
          walk(value, `${path}.${key}`)
        }
      }
    }
    for (const [route, schema] of Object.entries(AI_ROUTE_OUTPUT_JSON_SCHEMAS)) {
      walk(schema, route)
    }
    expect(untyped).toEqual([])
  })

  // CONCRETE_REPLY_LANGUAGE_PATTERN is a second, independent enumeration of the
  // reply languages: the catalogue decides which groups exist, this pattern decides
  // which the provider is allowed to answer. bg-Cyrl was added to the catalogue and
  // not here, so the model answered correctly and the gateway rejected it as
  // `output_invalid` — a silent tenant-route failure. Keep them in step.
  it('accepts every reply template language group the catalogue defines', () => {
    const rejected = REPLY_TEMPLATE_LANGUAGE_GROUPS.filter(
      (group) => !CONCRETE_REPLY_LANGUAGE_PATTERN.test(group),
    )
    expect(rejected).toEqual([])
  })

  it('accepts a region-suffixed form of every group and rejects an unknown group', () => {
    for (const group of REPLY_TEMPLATE_LANGUAGE_GROUPS) {
      expect(CONCRETE_REPLY_LANGUAGE_PATTERN.test(`${group}-BG`)).toBe(true)
    }
    expect(CONCRETE_REPLY_LANGUAGE_PATTERN.test('sw-Latn')).toBe(false)
    expect(CONCRETE_REPLY_LANGUAGE_PATTERN.test('bg-Latn')).toBe(false)
  })
})
