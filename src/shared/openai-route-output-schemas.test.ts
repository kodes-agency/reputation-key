import { describe, expect, it } from 'vitest'
import { zodTextFormat } from 'openai/helpers/zod'
import {
  AI_ANALYSIS_OUTPUT_SCHEMA,
  AI_REPLY_SELECTION_OUTPUT_SCHEMA,
  AI_SYNTHETIC_CANARY_OUTPUT_SCHEMA,
  AI_TREND_SELECTION_OUTPUT_SCHEMA,
  AI_ROUTE_OUTPUT_JSON_SCHEMAS,
} from './openai-route-output-schemas'

const cases = [
  ['review-analysis', AI_ANALYSIS_OUTPUT_SCHEMA],
  ['reply-suggestion', AI_REPLY_SELECTION_OUTPUT_SCHEMA],
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

  it('pins concrete language and trend signal grammars in provider-visible JSON schema', () => {
    const reply = requireRecord(AI_ROUTE_OUTPUT_JSON_SCHEMAS['reply-suggestion'])
    const replyProperties = requireRecord(reply.properties)
    const languageCode = requireRecord(replyProperties.languageCode)
    const trend = requireRecord(AI_ROUTE_OUTPUT_JSON_SCHEMAS['property-trend'])
    const trendProperties = requireRecord(trend.properties)
    const selectedSignalIds = requireRecord(trendProperties.selectedSignalIds)
    const items = requireRecord(selectedSignalIds.items)
    expect(requireStringField(languageCode, 'pattern')).toContain('zh-(?:Hans|Hant)')
    expect(requireStringField(items, 'pattern')).toContain('valence\\.overall')
  })
})
