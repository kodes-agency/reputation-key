import { describe, expect, it } from 'vitest'
import { zodTextFormat } from 'openai/helpers/zod'
import {
  AI_SYNTHETIC_CANARY_OUTPUT_SCHEMA,
  AI_ROUTE_OUTPUT_JSON_SCHEMAS,
} from './ai-route-output-schemas'
import { replyDraftingV2OutputSchema } from './reply-drafting-v2-schema'
import {
  REVIEW_ANALYSIS_V3_MAX_MENTIONS,
  REVIEW_ANALYSIS_V3_MAX_SENTENCE_REFS,
  REVIEW_ANALYSIS_V3_PROVIDER_ANSWER_SCHEMA,
  REVIEW_ANALYSIS_V3_STORED_SCHEMA,
} from './review-analysis-v3'
import { REVIEW_TOPICS_V3 } from './review-topic-taxonomy'

const cases = [
  ['review-analysis-v3', REVIEW_ANALYSIS_V3_PROVIDER_ANSWER_SCHEMA],
  ['reply-suggestion-v2', replyDraftingV2OutputSchema],
  ['synthetic-canary', AI_SYNTHETIC_CANARY_OUTPUT_SCHEMA],
] as const

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('expected JSON Schema object')
  }
  return value as Readonly<Record<string, unknown>>
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
    const repeatedMention = {
      sentiment: 'negative',
      mentions: [
        {
          topic: 'facilities_equipment',
          polarity: 'negative',
          strength: 'clear',
          thing: 'air conditioning',
          issue: 'not working',
          sentences: [1],
          names_person: null,
        },
        {
          topic: 'facilities_equipment',
          polarity: 'negative',
          strength: 'strong',
          thing: 'air conditioning',
          issue: 'very weak',
          sentences: [2],
          names_person: null,
        },
      ],
      urgent: null,
    }
    expect(
      REVIEW_ANALYSIS_V3_PROVIDER_ANSWER_SCHEMA.safeParse(repeatedMention).success,
    ).toBe(true)
    expect(REVIEW_ANALYSIS_V3_STORED_SCHEMA.safeParse(repeatedMention).success).toBe(
      false,
    )
  })

  it('pins the strict review-analysis-v3 provider-visible shape', () => {
    const root = requireRecord(AI_ROUTE_OUTPUT_JSON_SCHEMAS['review-analysis-v3'])
    const properties = requireRecord(root.properties)
    const mentions = requireRecord(properties.mentions)
    const mention = requireRecord(mentions.items)
    const mentionProperties = requireRecord(mention.properties)
    const topic = requireRecord(mentionProperties.topic)
    const sentences = requireRecord(mentionProperties.sentences)
    const urgent = requireRecord(properties.urgent)

    expect(root.additionalProperties).toBe(false)
    expect(root.required).toEqual(['sentiment', 'mentions', 'urgent'])
    expect(Object.keys(properties)).toEqual(['sentiment', 'mentions', 'urgent'])
    expect(mentions.maxItems).toBe(REVIEW_ANALYSIS_V3_MAX_MENTIONS)
    expect(mention.additionalProperties).toBe(false)
    expect(mention.required).toEqual([
      'topic',
      'polarity',
      'strength',
      'thing',
      'issue',
      'sentences',
      'names_person',
    ])
    expect(topic.enum).toEqual(REVIEW_TOPICS_V3)
    expect(sentences.minItems).toBe(1)
    expect(sentences.maxItems).toBe(REVIEW_ANALYSIS_V3_MAX_SENTENCE_REFS)
    expect(urgent.anyOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          additionalProperties: false,
          required: ['reason'],
        }),
      ]),
    )
    expect(properties).not.toHaveProperty('id')
  })

  it('closes every object in the review-analysis-v3 JSON schema', () => {
    const openObjects: string[] = []
    const visit = (value: unknown, path: string): void => {
      if (value === null || typeof value !== 'object') return
      const record = value as Readonly<Record<string, unknown>>
      if (record.type === 'object' && record.additionalProperties !== false) {
        openObjects.push(path)
      }
      for (const [key, child] of Object.entries(record)) {
        visit(child, `${path}.${key}`)
      }
    }
    visit(AI_ROUTE_OUTPUT_JSON_SCHEMAS['review-analysis-v3'], '$')
    expect(openObjects).toEqual([])
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
})
