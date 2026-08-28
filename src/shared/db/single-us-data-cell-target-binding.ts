import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Tx } from '#/shared/outbox/commit'
import { SINGLE_US_BETA_CUTOVER_KEY } from './data-cell-topology-fence'

export type DataCellCutoverTargetBinding = Readonly<{
  projectId: string
  environmentId: string
}>

export type DataCellCutoverState = 'open' | 'fenced' | 'completed'

export type DataCellCutoverTargetBindingControl = Readonly<{
  state: DataCellCutoverState
  targetProjectId: string | null
  targetEnvironmentId: string | null
}>

export function exactDataCellCutoverTargetId(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 255) {
    throw new Error(`Data Cell cutover ${label} must be between 1 and 255 characters`)
  }
  return normalized
}

export function normalizeDataCellCutoverTargetBinding(
  target: DataCellCutoverTargetBinding,
): DataCellCutoverTargetBinding {
  return Object.freeze({
    projectId: exactDataCellCutoverTargetId(target.projectId, 'Railway project ID'),
    environmentId: exactDataCellCutoverTargetId(
      target.environmentId,
      'Railway environment ID',
    ),
  })
}

function exactState(value: unknown): DataCellCutoverState {
  if (value === 'open' || value === 'fenced' || value === 'completed') return value
  throw new Error('Data Cell topology cutover authority is unavailable')
}

export function parseDataCellCutoverTargetBindingControl(
  row: Readonly<Record<string, unknown>>,
): DataCellCutoverTargetBindingControl {
  const state = exactState(row.state)
  const targetProjectId =
    typeof row.target_project_id === 'string' && row.target_project_id.trim()
      ? row.target_project_id
      : null
  const targetEnvironmentId =
    typeof row.target_environment_id === 'string' && row.target_environment_id.trim()
      ? row.target_environment_id
      : null
  if (
    (targetProjectId === null) !== (targetEnvironmentId === null) ||
    (state !== 'open' && (targetProjectId === null || targetEnvironmentId === null))
  ) {
    throw new Error('Data Cell topology cutover target binding is invalid')
  }
  return { state, targetProjectId, targetEnvironmentId }
}

export function assertDataCellCutoverTargetBindingMatches(
  control: DataCellCutoverTargetBindingControl,
  target: DataCellCutoverTargetBinding,
): void {
  if (
    (control.targetProjectId !== null && control.targetProjectId !== target.projectId) ||
    (control.targetEnvironmentId !== null &&
      control.targetEnvironmentId !== target.environmentId)
  ) {
    throw new Error('Data Cell cutover Railway target does not match its binding')
  }
}

async function readTargetBindingControl(
  tx: Pick<Tx, 'execute'>,
  forUpdate: boolean,
): Promise<DataCellCutoverTargetBindingControl> {
  const result = await tx.execute(
    sql.raw(`
      SELECT state, target_project_id, target_environment_id
      FROM data_cell_topology_cutovers
      WHERE singleton = TRUE AND cutover_key = '${SINGLE_US_BETA_CUTOVER_KEY}'
      ${forUpdate ? 'FOR UPDATE' : ''}
    `),
  )
  if (result.rows.length !== 1) {
    throw new Error('Data Cell topology cutover authority is unavailable')
  }
  return parseDataCellCutoverTargetBindingControl(result.rows[0]!)
}

/**
 * Bind the open cutover authority to Railway's opaque target IDs immediately
 * after migration. This deliberately lives outside the operational cutover
 * module so the final schema-migrator artifact does not embed legacy import
 * inspection paths reserved for the separately built operator tool.
 */
export async function bindSingleUsDataCellCutoverTarget(
  db: Pick<Database, 'transaction'>,
  input: DataCellCutoverTargetBinding,
): Promise<DataCellCutoverTargetBinding> {
  const target = normalizeDataCellCutoverTargetBinding(input)
  return db.transaction(async (tx) => {
    let control = await readTargetBindingControl(tx, true)
    assertDataCellCutoverTargetBindingMatches(control, target)
    if (control.targetProjectId === null) {
      if (control.state !== 'open') {
        throw new Error('Data Cell cutover cannot bind a non-open authority')
      }
      const bound = await tx.execute(sql`
        UPDATE data_cell_topology_cutovers
        SET target_project_id = ${target.projectId},
            target_environment_id = ${target.environmentId},
            updated_at = clock_timestamp()
        WHERE singleton = TRUE AND state = 'open'
          AND target_project_id IS NULL AND target_environment_id IS NULL
        RETURNING singleton
      `)
      if (bound.rows.length !== 1) {
        throw new Error('Data Cell cutover target binding changed concurrently')
      }
      control = await readTargetBindingControl(tx, false)
    }
    assertDataCellCutoverTargetBindingMatches(control, target)
    if (
      control.targetProjectId !== target.projectId ||
      control.targetEnvironmentId !== target.environmentId
    ) {
      throw new Error('Data Cell cutover Railway target binding is unavailable')
    }
    return target
  })
}
