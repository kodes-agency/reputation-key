import {
  DATA_CELL_CATALOGUE,
  DATA_CELL_IDS,
  type DataCellDefinition,
  type DataCellId,
} from '../src/shared/domain/data-cell-catalogue'

export type { DataCellId }
export type RailwayCellEnvironment = `cell-${DataCellId}`

export type CellTopology = Readonly<{
  cellId: DataCellId
  environment: RailwayCellEnvironment
  serviceRegion: DataCellDefinition['railway']['serviceRegion']
  bucketRegion: DataCellDefinition['railway']['bucketRegion']
  publicDomain: string
  providerProfile: DataCellDefinition['providerProfile']
}>

/**
 * Railway consumes the domain catalogue rather than maintaining a second
 * logical-to-physical map. Both the production project and its separately
 * permissioned mirror render this same graph.
 */
export const CELL_TOPOLOGIES = Object.freeze(
  Object.fromEntries(
    DATA_CELL_IDS.map((cellId) => {
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
  DATA_CELL_IDS.map((cellId) => DATA_CELL_CATALOGUE[cellId].railway.environment),
)

export function resolveCellTopology(environment: string | undefined): CellTopology {
  if (!environment || !(environment in CELL_TOPOLOGIES)) {
    throw new Error(
      `unsupported Railway Data Cell environment: ${environment ?? '<unset>'}`,
    )
  }
  return CELL_TOPOLOGIES[environment as RailwayCellEnvironment]
}
