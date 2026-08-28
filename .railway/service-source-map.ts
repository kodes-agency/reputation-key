/**
 * Environment-scoped Railway service sources.
 *
 * The graph is evaluated in two deliberate stages:
 *
 * - `foundation` provisions services without attaching runnable bytes.
 * - `promotion` declares the exact immutable sources already approved for this
 *   environment. A promotion map may be partial while the release controller
 *   advances services one at a time; omitted services remain source-less.
 *
 * The input is canonical JSON so retained evidence can hash the exact graph
 * input. There is no implicit empty/default mode: callers must explicitly
 * authorize either a source-less foundation or a digest-pinned promotion map.
 */

export const RAILWAY_SERVICE_SOURCE_MAP_ENV =
  'REPKEY_RAILWAY_SERVICE_SOURCE_MAP_JSON' as const

export const RAILWAY_SERVICE_SOURCE_MAP_VERSION =
  'repkey-railway-service-source-map-1' as const

export const RAILWAY_SOURCE_MANAGED_SERVICES = Object.freeze([
  'schema-migrator',
  'google-provider-redis',
  'web',
  'worker',
  'google-execution-admission',
  'google-egress-gateway',
  'ai-execution-admission',
  'ai-egress-gateway',
] as const)

export type RailwaySourceManagedService = (typeof RAILWAY_SOURCE_MANAGED_SERVICES)[number]

export type RailwayServiceSourceMap = Readonly<
  Partial<Record<RailwaySourceManagedService, string>>
>

export type RailwayServiceSourceInput = Readonly<{
  version: typeof RAILWAY_SERVICE_SOURCE_MAP_VERSION
  stage: 'foundation' | 'promotion'
  sources: RailwayServiceSourceMap
}>

const IMMUTABLE_IMAGE_REFERENCE =
  /^(?:ghcr\.io|registry\.gitlab\.com|quay\.io|[a-z0-9.-]+\.docker\.io)\/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$/u

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizedSources(
  sources: Readonly<Record<string, unknown>>,
): RailwayServiceSourceMap {
  const known = new Set<string>(RAILWAY_SOURCE_MANAGED_SERVICES)
  const unexpected = Object.keys(sources).filter((name) => !known.has(name))
  if (unexpected.length > 0) {
    throw new Error('Railway service source map contains an unsupported service')
  }

  const normalized: Partial<Record<RailwaySourceManagedService, string>> = {}
  for (const serviceName of RAILWAY_SOURCE_MANAGED_SERVICES) {
    const reference = sources[serviceName]
    if (reference === undefined) continue
    if (
      typeof reference !== 'string' ||
      reference.length > 512 ||
      !IMMUTABLE_IMAGE_REFERENCE.test(reference)
    ) {
      throw new Error(
        `Railway source for ${serviceName} must be an approved registry image pinned by lowercase sha256 digest`,
      )
    }
    normalized[serviceName] = reference
  }
  return Object.freeze(normalized)
}

/** Serialize in the only accepted field and service order. */
export function canonicalRailwayServiceSourceInput(
  input: RailwayServiceSourceInput,
): string {
  const sources = Object.fromEntries(
    RAILWAY_SOURCE_MANAGED_SERVICES.flatMap((serviceName) => {
      const reference = input.sources[serviceName]
      return reference === undefined ? [] : [[serviceName, reference]]
    }),
  )
  return JSON.stringify({
    version: RAILWAY_SERVICE_SOURCE_MAP_VERSION,
    stage: input.stage,
    sources,
  })
}

export const RAILWAY_FOUNDATION_SOURCE_INPUT = Object.freeze({
  version: RAILWAY_SERVICE_SOURCE_MAP_VERSION,
  stage: 'foundation',
  sources: Object.freeze({}),
} as const satisfies RailwayServiceSourceInput)

export const CANONICAL_RAILWAY_FOUNDATION_SOURCE_INPUT =
  canonicalRailwayServiceSourceInput(RAILWAY_FOUNDATION_SOURCE_INPUT)

/** Parse and validate one explicit, canonical graph source stage. */
export function parseRailwayServiceSourceInput(
  value: string | undefined,
): RailwayServiceSourceInput {
  if (value === undefined || value === '') {
    throw new Error(
      `${RAILWAY_SERVICE_SOURCE_MAP_ENV} is required; use the canonical foundation document or a canonical digest-pinned promotion map`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(`${RAILWAY_SERVICE_SOURCE_MAP_ENV} must be valid canonical JSON`)
  }
  if (!isRecord(parsed)) {
    throw new Error(`${RAILWAY_SERVICE_SOURCE_MAP_ENV} must be a JSON object`)
  }
  const keys = Object.keys(parsed)
  if (
    keys.length !== 3 ||
    keys[0] !== 'version' ||
    keys[1] !== 'stage' ||
    keys[2] !== 'sources'
  ) {
    throw new Error(`${RAILWAY_SERVICE_SOURCE_MAP_ENV} has non-canonical fields or order`)
  }
  if (parsed.version !== RAILWAY_SERVICE_SOURCE_MAP_VERSION) {
    throw new Error(`${RAILWAY_SERVICE_SOURCE_MAP_ENV} has an unsupported version`)
  }
  if (parsed.stage !== 'foundation' && parsed.stage !== 'promotion') {
    throw new Error(`${RAILWAY_SERVICE_SOURCE_MAP_ENV} has an unsupported stage`)
  }
  if (!isRecord(parsed.sources)) {
    throw new Error(`${RAILWAY_SERVICE_SOURCE_MAP_ENV}.sources must be a JSON object`)
  }

  const sources = normalizedSources(parsed.sources)
  if (parsed.stage === 'foundation' && Object.keys(sources).length !== 0) {
    throw new Error('Railway foundation source input must not contain service sources')
  }
  if (parsed.stage === 'promotion' && Object.keys(sources).length === 0) {
    throw new Error(
      'Railway promotion source input must contain at least one service source',
    )
  }
  if (parsed.stage === 'promotion') {
    const populatedServices = Object.keys(sources)
    const expectedPrefix = RAILWAY_SOURCE_MANAGED_SERVICES.slice(
      0,
      populatedServices.length,
    )
    if (
      populatedServices.length !== expectedPrefix.length ||
      populatedServices.some(
        (serviceName, index) => serviceName !== expectedPrefix[index],
      )
    ) {
      throw new Error(
        'Railway promotion sources must be a canonical prefix of the staged deployment order',
      )
    }
  }

  const input = Object.freeze({
    version: RAILWAY_SERVICE_SOURCE_MAP_VERSION,
    stage: parsed.stage,
    sources,
  }) satisfies RailwayServiceSourceInput
  if (canonicalRailwayServiceSourceInput(input) !== value) {
    throw new Error(`${RAILWAY_SERVICE_SOURCE_MAP_ENV} must use canonical encoding`)
  }
  return input
}
