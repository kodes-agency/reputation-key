export const RAILWAY_SERVICE_REGIONS = [
  'us-west2',
  'europe-west4-drams3a',
  'asia-southeast1-eqsg3a',
] as const

export const RAILWAY_BUCKET_REGIONS = ['sjc', 'ams', 'sin'] as const

export type DataCellId = 'us' | 'europe' | 'global'
export type RailwayCellEnvironment = `cell-${DataCellId}`

export type CellTopology = Readonly<{
  cellId: DataCellId
  environment: RailwayCellEnvironment
  serviceRegion: (typeof RAILWAY_SERVICE_REGIONS)[number]
  bucketRegion: (typeof RAILWAY_BUCKET_REGIONS)[number]
  publicDomain: string
  providerProfile: 'gbp-production-fixed'
}>

/**
 * One signed-off logical-to-physical placement table for both the production
 * project and its separate non-production mirror. The two projects use the
 * same environment names and graph so a mirror is not a special topology.
 *
 * Bucket placement codes are Railway's storage-specific identifiers; service
 * and database placement use Railway deployment region identifiers. They are
 * intentionally separate types so a valid code from one API cannot leak into
 * the other.
 */
export const CELL_TOPOLOGIES = Object.freeze({
  'cell-us': Object.freeze({
    cellId: 'us',
    environment: 'cell-us',
    serviceRegion: 'us-west2',
    bucketRegion: 'sjc',
    publicDomain: 'us.reputationkey.app',
    providerProfile: 'gbp-production-fixed',
  }),
  'cell-europe': Object.freeze({
    cellId: 'europe',
    environment: 'cell-europe',
    serviceRegion: 'europe-west4-drams3a',
    bucketRegion: 'ams',
    publicDomain: 'eu.reputationkey.app',
    providerProfile: 'gbp-production-fixed',
  }),
  'cell-global': Object.freeze({
    cellId: 'global',
    environment: 'cell-global',
    serviceRegion: 'asia-southeast1-eqsg3a',
    bucketRegion: 'sin',
    publicDomain: 'global.reputationkey.app',
    providerProfile: 'gbp-production-fixed',
  }),
} as const satisfies Record<RailwayCellEnvironment, CellTopology>)

export const RAILWAY_CELL_ENVIRONMENTS = Object.freeze(
  Object.keys(CELL_TOPOLOGIES) as RailwayCellEnvironment[],
)

export function resolveCellTopology(environment: string | undefined): CellTopology {
  if (!environment || !(environment in CELL_TOPOLOGIES)) {
    throw new Error(
      `unsupported Railway Data Cell environment: ${environment ?? '<unset>'}`,
    )
  }
  return CELL_TOPOLOGIES[environment as RailwayCellEnvironment]
}
