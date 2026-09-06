import { getCountries, type CountryCode } from 'libphonenumber-js'

export const DATA_CELL_CATALOGUE_POLICY_VERSION = 3
/**
 * Review anchor for the exact ISO calling-country set approved by policy v3.
 * CI hashes libphonenumber's sorted set against this value, so upgrading the
 * dependency cannot silently change Property placement. Any intentional set
 * change must update this digest and the catalogue policy version together.
 */
export const DATA_CELL_SUPPORTED_COUNTRY_COUNT = 245
export const DATA_CELL_SUPPORTED_COUNTRY_POLICY_SHA256 =
  'f760bd6add5b111943f2983a4d5c50a1bf8d17f3e34cb347bdb06a2ac3ca21b7'

export const DATA_CELL_IDS = ['us', 'europe', 'global'] as const
export type DataCellId = (typeof DATA_CELL_IDS)[number]
/** Railway environments that are intentionally deployable during beta. */
export const BETA_DEPLOYMENT_DATA_CELL_IDS = [
  'us',
] as const satisfies readonly DataCellId[]
export type BetaDeploymentDataCellId = (typeof BETA_DEPLOYMENT_DATA_CELL_IDS)[number]
export type DataCellState = 'provisioning' | 'accepting' | 'draining' | 'denied'
export type DataCellWorkload =
  'review.sync' | 'reply.publish' | 'property.import' | 'portal.media'

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
  /** Null means the logical identifier has no Railway deployment contract. */
  railway: Readonly<{
    environment: 'cell-us'
    serviceRegion: 'us-west2'
    bucketRegion: 'sjc'
  }> | null
  resources: Readonly<{
    web: 'web'
    worker: 'worker'
    postgres: 'Postgres'
    cacheRedis: 'Cache Redis'
    queueRedis: 'Queue Redis'
    providerRedis: 'google-provider-redis'
    objectStore: 'object-store'
    aiGateway: 'ai-egress-gateway'
    aiAdmission: 'ai-execution-admission'
  }>
}>

export const DATA_CELL_SUPPORTED_COUNTRY_CODES = Object.freeze([...getCountries()].sort())
const NO_COUNTRY_CODES = Object.freeze([] as CountryCode[])

const ALL_WORKLOADS = Object.freeze([
  'review.sync',
  'reply.publish',
  'property.import',
  'portal.media',
] as const satisfies readonly DataCellWorkload[])
const NO_WORKLOADS = Object.freeze([] as DataCellWorkload[])

const RESOURCE_REFS = Object.freeze({
  web: 'web',
  worker: 'worker',
  postgres: 'Postgres',
  cacheRedis: 'Cache Redis',
  queueRedis: 'Queue Redis',
  providerRedis: 'google-provider-redis',
  objectStore: 'object-store',
  aiGateway: 'ai-egress-gateway',
  aiAdmission: 'ai-execution-admission',
} as const)

/**
 * The one routing/placement interface used by domain routing and Railway IaC.
 * Beta has one accepting deployment in Railway US West. Every supported
 * Property country is allocated there. Europe and Global remain stable,
 * readable identifiers for future expansion, but are denied and receive no
 * country or workload allocation until a later policy explicitly activates
 * them.
 */
export const DATA_CELL_CATALOGUE = Object.freeze({
  us: Object.freeze({
    id: 'us',
    residencyClass: 'united_states',
    state: 'accepting',
    policyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
    allowedCountryCodes: DATA_CELL_SUPPORTED_COUNTRY_CODES,
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
    state: 'denied',
    policyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
    allowedCountryCodes: NO_COUNTRY_CODES,
    allowedWorkloads: NO_WORKLOADS,
    providerProfile: 'gbp-production-fixed',
    providerRef: 'gbp-default',
    domain: 'eu.reputationkey.app',
    railway: null,
    resources: RESOURCE_REFS,
  }),
  global: Object.freeze({
    id: 'global',
    residencyClass: 'rest_of_world',
    state: 'denied',
    policyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
    allowedCountryCodes: NO_COUNTRY_CODES,
    allowedWorkloads: NO_WORKLOADS,
    providerProfile: 'gbp-production-fixed',
    providerRef: 'gbp-default',
    domain: 'global.reputationkey.app',
    railway: null,
    resources: RESOURCE_REFS,
  }),
} as const satisfies Record<DataCellId, DataCellDefinition>)

/** Cell ids eligible for new execution/move targets in the current policy. */
export const ACCEPTING_DATA_CELL_IDS = Object.freeze(
  DATA_CELL_IDS.filter((cellId) => DATA_CELL_CATALOGUE[cellId].state === 'accepting'),
)

export function isBetaDeploymentDataCellId(
  value: string,
): value is BetaDeploymentDataCellId {
  return (BETA_DEPLOYMENT_DATA_CELL_IDS as readonly string[]).includes(value)
}

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
  return Object.hasOwn(DATA_CELL_CATALOGUE, value)
    ? DATA_CELL_CATALOGUE[value as DataCellId]
    : null
}

/**
 * Expand-phase read compatibility for Property routing rows. The canonical
 * assignment wins only when it is valid and does not disagree with a valid
 * legacy region. Until every deployment dual-writes `data_cell_id`, a null
 * canonical value may be read from a valid legacy region. Invalid or
 * conflicting persisted facts fail closed instead of selecting a fallback.
 */
export function resolvePersistedDataCellId(
  dataCellId: string | null | undefined,
  legacyProcessingRegion: string | null | undefined,
): DataCellId | null {
  const canonical = dataCellId ? dataCellById(dataCellId)?.id : undefined
  const legacy = legacyProcessingRegion
    ? dataCellById(legacyProcessingRegion)?.id
    : undefined
  if (dataCellId && !canonical) return null
  if (canonical && legacy && canonical !== legacy) return null
  return canonical ?? legacy ?? null
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
