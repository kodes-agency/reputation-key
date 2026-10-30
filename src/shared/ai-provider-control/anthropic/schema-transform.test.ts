import { describe, expect, it } from 'vitest'
import { AI_ROUTE_OUTPUT_JSON_SCHEMAS } from '#/shared/ai-route-output-schemas'
import { REVIEW_CAUSE_PHRASE_PATTERN } from '#/shared/review-analysis-v3'
import { anthropicWireSchemaOf } from './schema-transform'

// A cause phrase's bounds as the transform writes them into its description: the pattern
// is not a keyword Anthropic's structured outputs enforce, so it travels as text.
const CAUSE_DESCRIPTION = `{maxLength: 80, pattern: ${JSON.stringify(REVIEW_CAUSE_PHRASE_PATTERN.source)}}`

const UNSUPPORTED = new Set([
  '$schema',
  'maxItems',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'pattern',
  'format',
])

function unsupportedKeywords(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(unsupportedKeywords)
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([key, child]) => [
    ...(UNSUPPORTED.has(key) ? [key] : []),
    ...unsupportedKeywords(child),
  ])
}

describe('Anthropic structured-output schema transform', () => {
  it('turns the review-analysis v3 bounds into deterministic descriptions', () => {
    const transformed = anthropicWireSchemaOf(
      AI_ROUTE_OUTPUT_JSON_SCHEMAS['review-analysis-v3'],
    )
    const mentions = (transformed.properties as Record<string, unknown>)
      .mentions as Record<string, unknown>
    const mention = mentions.items as Record<string, unknown>
    const properties = mention.properties as Record<string, Record<string, unknown>>
    const thing = properties.thing?.anyOf as readonly Record<string, unknown>[]
    const sentences = properties.sentences

    expect(transformed).toEqual({
      type: 'object',
      properties: {
        sentiment: {
          type: 'string',
          enum: ['positive', 'neutral', 'negative', 'mixed'],
        },
        mentions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              topic: {
                type: 'string',
                enum: [
                  'staff_service',
                  'speed_waiting',
                  'booking_arrival',
                  'main_service',
                  'food_drink',
                  'cleanliness',
                  'facilities_equipment',
                  'price_billing',
                  'atmosphere_noise',
                  'location_access',
                  'safety',
                  'communication',
                ],
              },
              polarity: {
                type: 'string',
                enum: ['positive', 'neutral', 'negative'],
              },
              strength: { type: 'string', enum: ['mild', 'clear', 'strong'] },
              thing: {
                anyOf: [
                  { type: 'string', description: CAUSE_DESCRIPTION },
                  { type: 'null' },
                ],
              },
              issue: {
                anyOf: [
                  { type: 'string', description: CAUSE_DESCRIPTION },
                  { type: 'null' },
                ],
              },
              sentences: {
                minItems: 1,
                type: 'array',
                items: {
                  type: 'integer',
                  description: '{maximum: 10000, minimum: 1}',
                },
                description: '{maxItems: 16}',
              },
              names_person: {
                anyOf: [
                  { type: 'string', enum: ['team_member', 'other'] },
                  { type: 'null' },
                ],
              },
            },
            required: [
              'topic',
              'polarity',
              'strength',
              'thing',
              'issue',
              'sentences',
              'names_person',
            ],
            additionalProperties: false,
          },
          description: '{maxItems: 48}',
        },
        urgent: {
          anyOf: [
            {
              type: 'object',
              properties: {
                reason: {
                  type: 'string',
                  enum: ['safety', 'health', 'discrimination', 'legal_threat'],
                },
              },
              required: ['reason'],
              additionalProperties: false,
            },
            { type: 'null' },
          ],
        },
      },
      required: ['sentiment', 'mentions', 'urgent'],
      additionalProperties: false,
    })
    expect(mentions.description).toBe('{maxItems: 48}')
    expect(thing?.[0]?.description).toBe(CAUSE_DESCRIPTION)
    expect(sentences?.description).toBe('{maxItems: 16}')
    expect((sentences?.items as Record<string, unknown>).description).toBe(
      '{maximum: 10000, minimum: 1}',
    )
    expect(unsupportedKeywords(transformed)).toEqual([])
    expect(
      anthropicWireSchemaOf(AI_ROUTE_OUTPUT_JSON_SCHEMAS['review-analysis-v3']),
    ).toEqual(transformed)
    expect(Object.isFrozen(transformed)).toBe(true)
    expect(Object.isFrozen(transformed.properties)).toBe(true)
  })

  it.each(Object.entries(AI_ROUTE_OUTPUT_JSON_SCHEMAS))(
    'either transforms or names a documented unsupported feature for %s',
    (_name, schema) => {
      try {
        expect(anthropicWireSchemaOf(schema)).toBeTypeOf('object')
      } catch (error) {
        expect(error).toBeInstanceOf(TypeError)
        expect((error as Error).message).toMatch(
          /Unsupported Anthropic schema keyword|exceeds (?:16 union|24 optional)/u,
        )
      }
    },
  )

  it('fails closed on an unknown keyword and an open object', () => {
    expect(() =>
      anthropicWireSchemaOf({ type: 'string', examples: ['invented'] }),
    ).toThrow(new TypeError('Unsupported Anthropic schema keyword: examples'))
    expect(() =>
      anthropicWireSchemaOf({
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: true,
      }),
    ).toThrow(new TypeError('Anthropic object schema additionalProperties must be false'))
  })

  it.each([
    [
      'optional',
      {
        type: 'object',
        properties: Object.fromEntries(
          Array.from({ length: 25 }, (_value, index) => [
            `optional_${index}`,
            { type: 'string' },
          ]),
        ),
        required: [],
        additionalProperties: false,
      },
      'Anthropic schema exceeds 24 optional parameters',
    ],
    [
      'union',
      {
        type: 'object',
        properties: Object.fromEntries(
          Array.from({ length: 17 }, (_value, index) => [
            `union_${index}`,
            { anyOf: [{ type: 'string' }, { type: 'null' }] },
          ]),
        ),
        required: Array.from({ length: 17 }, (_value, index) => `union_${index}`),
        additionalProperties: false,
      },
      'Anthropic schema exceeds 16 union parameters',
    ],
  ] as const)(
    'rejects a schema over the %s complexity limit',
    (_name, schema, message) => {
      expect(() => anthropicWireSchemaOf(schema)).toThrow(new TypeError(message))
    },
  )
})
