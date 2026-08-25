import { getCountries, type CountryCode } from 'libphonenumber-js'

export const DATA_CELL_CATALOGUE_POLICY_VERSION = 2

export const DATA_CELL_IDS = ['us', 'europe', 'global'] as const
export type DataCellId = (typeof DATA_CELL_IDS)[number]
export type DataCellState = 'provisioning' | 'accepting' | 'draining' | 'denied'
export type DataCellWorkload = 'review.sync' | 'reply.publish' | 'property.import'

export type DataCellDefinition = Readonly<{
  id: DataCellId
  residencyClass: 'united_states' | 'europe' | 'rest_of_world'
  state: DataCellState
  policyVersion: number
  allowedCountryCodes: readonly CountryCode[]
  allowedWorkloads: readonly DataCellWorkload[]
  providerProfile: 'gbp-production-fixed'
  providerRef: 'gbp-default'
  domain: string
  railway: Readonly<{
    environment: `cell-${DataCellId}`
    serviceRegion: 'us-west2' | 'europe-west4-drams3a' | 'asia-southeast1-eqsg3a'
    bucketRegion: 'sjc' | 'ams' | 'sin'
  }>
  resources: Readonly<{
    web: 'web'
    worker: 'worker'
    postgres: 'Postgres'
    queueRedis: 'Redis'
    providerRedis: 'google-provider-redis'
    objectStore: 'object-store'
    googleGateway: 'google-egress-gateway'
    googleAdmission: 'google-execution-admission'
    aiGateway: 'ai-egress-gateway'
    aiAdmission: 'ai-execution-admission'
  }>
}>

const EUROPEAN_COUNTRY_CODES = Object.freeze([
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IS',
  'IE',
  'IT',
  'LV',
  'LI',
  'LT',
  'LU',
  'MT',
  'NL',
  'NO',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
  // Separately approved from the EEA list.
  'GB',
  'CH',
] as const satisfies readonly CountryCode[])

const US_COUNTRY_CODES = Object.freeze([
  'US',
  'PR',
  'GU',
  'VI',
  'MP',
  'AS',
] as const satisfies readonly CountryCode[])

const knownUs = new Set<CountryCode>(US_COUNTRY_CODES)
const knownEurope = new Set<CountryCode>(EUROPEAN_COUNTRY_CODES)
const SUPPORTED_COUNTRY_CODES = Object.freeze([...getCountries()].sort())
const GLOBAL_COUNTRY_CODES = Object.freeze(
  SUPPORTED_COUNTRY_CODES.filter(
    (country) => !knownUs.has(country) && !knownEurope.has(country),
  ),
)

const ALL_WORKLOADS = Object.freeze([
  'review.sync',
  'reply.publish',
  'property.import',
] as const satisfies readonly DataCellWorkload[])

const RESOURCE_REFS = Object.freeze({
  web: 'web',
  worker: 'worker',
  postgres: 'Postgres',
  queueRedis: 'Redis',
  providerRedis: 'google-provider-redis',
  objectStore: 'object-store',
  googleGateway: 'google-egress-gateway',
  googleAdmission: 'google-execution-admission',
  aiGateway: 'ai-egress-gateway',
  aiAdmission: 'ai-execution-admission',
} as const)

/**
 * The one routing/placement interface used by domain routing and Railway IaC.
 * US is the existing accepting cell. Europe and Global remain provisioning
 * until their empty-cell, restore, provider, and wrong-cell drills pass; this
 * prevents a source merge from pretending an unprovisioned region is live.
 */
export const DATA_CELL_CATALOGUE = Object.freeze({
  us: Object.freeze({
    id: 'us',
    residencyClass: 'united_states',
    state: 'accepting',
    policyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
    allowedCountryCodes: US_COUNTRY_CODES,
    allowedWorkloads: ALL_WORKLOADS,
    providerProfile: 'gbp-production-fixed',
    providerRef: 'gbp-default',
    domain: 'us.reputationkey.app',
    railway: Object.freeze({
      environment: 'cell-us',
      serviceRegion: 'us-west2',
      bucketRegion: 'sjc',
    }),
    resources: RESOURCE_REFS,
  }),
  europe: Object.freeze({
    id: 'europe',
    residencyClass: 'europe',
    state: 'provisioning',
    policyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
    allowedCountryCodes: EUROPEAN_COUNTRY_CODES,
    allowedWorkloads: ALL_WORKLOADS,
    providerProfile: 'gbp-production-fixed',
    providerRef: 'gbp-default',
    domain: 'eu.reputationkey.app',
    railway: Object.freeze({
      environment: 'cell-europe',
      serviceRegion: 'europe-west4-drams3a',
      bucketRegion: 'ams',
    }),
    resources: RESOURCE_REFS,
  }),
  global: Object.freeze({
    id: 'global',
    residencyClass: 'rest_of_world',
    state: 'provisioning',
    policyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
    allowedCountryCodes: GLOBAL_COUNTRY_CODES,
    allowedWorkloads: ALL_WORKLOADS,
    providerProfile: 'gbp-production-fixed',
    providerRef: 'gbp-default',
    domain: 'global.reputationkey.app',
    railway: Object.freeze({
      environment: 'cell-global',
      serviceRegion: 'asia-southeast1-eqsg3a',
      bucketRegion: 'sin',
    }),
    resources: RESOURCE_REFS,
  }),
} as const satisfies Record<DataCellId, DataCellDefinition>)

const COUNTRY_TO_CELL = new Map<CountryCode, DataCellId>()
for (const cell of Object.values(DATA_CELL_CATALOGUE)) {
  for (const country of cell.allowedCountryCodes) {
    if (COUNTRY_TO_CELL.has(country)) {
      throw new Error(`Data Cell country policy is ambiguous: ${country}`)
    }
    COUNTRY_TO_CELL.set(country, cell.id)
  }
}

export type DataCellTarget = Readonly<{
  cellId: DataCellId
  queue: 'default'
  providerRef: 'gbp-default'
  policyVersion: number
}>

export type DataCellTargetResult =
  | Readonly<{ kind: 'target'; target: DataCellTarget }>
  | Readonly<{
      kind: 'blocked'
      reason: 'cell_unknown' | 'cell_not_accepting' | 'workload_denied'
    }>

/** Resolve a persisted cell identifier. No default/fallback is permitted. */
export function dataCellById(value: string): DataCellDefinition | null {
  return value in DATA_CELL_CATALOGUE ? DATA_CELL_CATALOGUE[value as DataCellId] : null
}

/** Country allocation for new/imported Properties; invalid codes stop for review. */
export function dataCellIdForCountry(countryCode: string): DataCellId | 'unresolved' {
  const normalized = countryCode.trim().toUpperCase()
  if (!/^[A-Z]{2}$/u.test(normalized)) return 'unresolved'
  return COUNTRY_TO_CELL.get(normalized as CountryCode) ?? 'unresolved'
}

/**
 * Resolve an executable target from an immutable Property cell. Cell state and
 * workload policy are hidden behind this interface so callers cannot invent a
 * provider/queue fallback.
 */
export function resolveDataCellTarget(
  cellId: string,
  workload: DataCellWorkload,
): DataCellTargetResult {
  const cell = dataCellById(cellId)
  if (!cell) return { kind: 'blocked', reason: 'cell_unknown' }
  if (cell.state !== 'accepting') {
    return { kind: 'blocked', reason: 'cell_not_accepting' }
  }
  if (!(cell.allowedWorkloads as readonly string[]).includes(workload)) {
    return { kind: 'blocked', reason: 'workload_denied' }
  }
  return {
    kind: 'target',
    target: {
      cellId: cell.id,
      queue: 'default',
      providerRef: cell.providerRef,
      policyVersion: cell.policyVersion,
    },
  }
}

export function isDataCellAccepting(cellId: string | null): cellId is DataCellId {
  return cellId !== null && dataCellById(cellId)?.state === 'accepting'
}
