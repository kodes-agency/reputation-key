import { deepFreezeProviderContract } from '#/shared/ai-provider-attestations'
import { ANTHROPIC_STRUCTURED_OUTPUT_LIMITS } from './request-profile'

export const ANTHROPIC_SCHEMA_TRANSFORM_VERSION =
  'anthropic-structured-output-schema-transform-v1' as const

const KEPT_KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'anyOf',
  'allOf',
  'enum',
  'const',
  'description',
  'title',
  'default',
  '$ref',
  '$defs',
  'definitions',
  'minItems',
])

const DESCRIPTION_KEYWORDS = new Set([
  'maxItems',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'uniqueItems',
  'minProperties',
  'maxProperties',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function transformSchemaMap(value: unknown, keyword: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`Invalid Anthropic schema ${keyword}`)
  return Object.fromEntries(
    Object.entries(value).map(([name, child]) => [name, transformNode(child)]),
  )
}

function transformSchemaArray(value: unknown, keyword: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`Invalid Anthropic schema ${keyword}`)
  return value.map((child) => transformNode(child))
}

function transformKeptKeyword(keyword: string, value: unknown): unknown {
  if (keyword === 'properties' || keyword === '$defs' || keyword === 'definitions') {
    return transformSchemaMap(value, keyword)
  }
  if (keyword === 'items') return transformNode(value)
  if (keyword === 'anyOf' || keyword === 'allOf') {
    return transformSchemaArray(value, keyword)
  }
  if (keyword === 'additionalProperties' && value !== false) {
    throw new TypeError('Anthropic object schema additionalProperties must be false')
  }
  if (keyword === 'minItems' && value !== 0 && value !== 1) {
    return undefined
  }
  return value
}

function descriptionWithConstraints(
  description: unknown,
  constraints: Readonly<Record<string, unknown>>,
): string | undefined {
  if (description !== undefined && typeof description !== 'string') {
    throw new TypeError('Invalid Anthropic schema description')
  }
  const entries = Object.entries(constraints).sort(([left], [right]) =>
    left.localeCompare(right),
  )
  if (entries.length === 0) return description
  const suffix = `{${entries
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(', ')}}`
  return description === undefined || description.length === 0
    ? suffix
    : `${description}\n\n${suffix}`
}

function transformNode(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError('Anthropic schema node must be an object')
  const transformed: Record<string, unknown> = {}
  const constraints: Record<string, unknown> = {}
  for (const [keyword, child] of Object.entries(value)) {
    if (keyword === '$schema') continue
    if (DESCRIPTION_KEYWORDS.has(keyword)) {
      constraints[keyword] = child
      continue
    }
    if (!KEPT_KEYWORDS.has(keyword)) {
      throw new TypeError(`Unsupported Anthropic schema keyword: ${keyword}`)
    }
    const kept = transformKeptKeyword(keyword, child)
    if (kept === undefined) constraints[keyword] = child
    else transformed[keyword] = kept
  }
  const description = descriptionWithConstraints(transformed.description, constraints)
  if (description === undefined) delete transformed.description
  else transformed.description = description
  return transformed
}

function countComplexity(value: unknown): Readonly<{
  optionalParameters: number
  unionParameters: number
}> {
  let optionalParameters = 0
  let unionParameters = 0
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      for (const child of candidate) visit(child)
      return
    }
    if (!isRecord(candidate)) return
    if (Array.isArray(candidate.anyOf) || Array.isArray(candidate.type)) {
      unionParameters += 1
    }
    if (isRecord(candidate.properties)) {
      const required = new Set(
        Array.isArray(candidate.required)
          ? candidate.required.filter((item): item is string => typeof item === 'string')
          : [],
      )
      optionalParameters += Object.keys(candidate.properties).filter(
        (name) => !required.has(name),
      ).length
    }
    for (const child of Object.values(candidate)) visit(child)
  }
  visit(value)
  return Object.freeze({ optionalParameters, unionParameters })
}

export function anthropicWireSchemaOf(
  schema: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const transformed = transformNode(schema)
  const complexity = countComplexity(transformed)
  if (
    complexity.optionalParameters > ANTHROPIC_STRUCTURED_OUTPUT_LIMITS.optionalParameters
  ) {
    throw new TypeError('Anthropic schema exceeds 24 optional parameters')
  }
  if (complexity.unionParameters > ANTHROPIC_STRUCTURED_OUTPUT_LIMITS.unionParameters) {
    throw new TypeError('Anthropic schema exceeds 16 union parameters')
  }
  return deepFreezeProviderContract(transformed)
}
