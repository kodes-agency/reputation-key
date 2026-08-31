import {
  BETA_DEPLOYMENT_DATA_CELL_IDS,
  DATA_CELL_CATALOGUE,
  type BetaDeploymentDataCellId,
  type DataCellDefinition,
} from '../src/shared/domain/data-cell-catalogue.ts'

export type RailwayCellEnvironment = `cell-${BetaDeploymentDataCellId}`

export type CellTopology = Readonly<{
  cellId: BetaDeploymentDataCellId
  environment: RailwayCellEnvironment
  serviceRegion: NonNullable<DataCellDefinition['railway']>['serviceRegion']
  bucketRegion: NonNullable<DataCellDefinition['railway']>['bucketRegion']
  publicDomain: string
  providerProfile: DataCellDefinition['providerProfile']
}>

/**
 * Railway consumes the domain catalogue rather than maintaining a second
 * logical-to-physical map. Production and its separately permissioned
 * rehearsal render this same Data Cell topology; deployment-profile policy
 * decides whether the graph owns the production public domain.
 */
export const CELL_TOPOLOGIES = Object.freeze(
  Object.fromEntries(
    BETA_DEPLOYMENT_DATA_CELL_IDS.map((cellId) => {
      const cell = DATA_CELL_CATALOGUE[cellId]
      return [
        cell.railway.environment,
        Object.freeze({
          cellId,
          environment: cell.railway.environment,
          serviceRegion: cell.railway.serviceRegion,
          bucketRegion: cell.railway.bucketRegion,
          publicDomain: cell.domain,
          providerProfile: cell.providerProfile,
        }),
      ]
    }),
  ) as Record<RailwayCellEnvironment, CellTopology>,
)

export const RAILWAY_CELL_ENVIRONMENTS = Object.freeze(
  BETA_DEPLOYMENT_DATA_CELL_IDS.map(
    (cellId) => DATA_CELL_CATALOGUE[cellId].railway.environment,
  ),
)

export function resolveCellTopology(environment: string | undefined): CellTopology {
  if (!environment || !Object.hasOwn(CELL_TOPOLOGIES, environment)) {
    throw new Error(
      `unsupported Railway Data Cell environment: ${environment ?? '<unset>'}`,
    )
  }
  return CELL_TOPOLOGIES[environment as RailwayCellEnvironment]
}
