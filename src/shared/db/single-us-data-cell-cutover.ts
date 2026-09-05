import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Tx } from '#/shared/outbox/commit'
import { SINGLE_US_BETA_CUTOVER_KEY } from './data-cell-topology-fence'
import {
  assertDataCellCutoverTargetBindingMatches,
  exactDataCellCutoverTargetId,
  normalizeDataCellCutoverTargetBinding,
  parseDataCellCutoverTargetBindingControl,
  type DataCellCutoverState,
  type DataCellCutoverTargetBinding,
} from './single-us-data-cell-target-binding'

export type { DataCellCutoverState } from './single-us-data-cell-target-binding'
export type DataCellCutoverPhase =
  'properties' | 'credential_homes' | 'verify' | 'completed'

export type DataCellCutoverBlockers = Readonly<{
  regionMoves: number
  importRequests: number
  importRequestItems: number
  executionPermits: number
  credentialSourceOperations: number
  credentialRevokePermits: number
  subjectAuthorityGuards: number
  brokerGrants: number
  cleanupConnections: number
  routingConflicts: number
  newerRoutingPolicies: number
  partialCredentialHomes: number
  credentialAuthorityConflicts: number
  futureCredentialAuthorities: number
  exhaustedConnectionVersions: number
  exhaustedAuthorityGenerations: number
}>

export type DataCellCutoverReport = Readonly<{
  capturedAt: string
  cutoverKey: typeof SINGLE_US_BETA_CUTOVER_KEY
  state: DataCellCutoverState
  phase: DataCellCutoverPhase
  target: Readonly<{
    cell: 'us'
    policyVersion: 3
    projectId: string | null
    environmentId: string | null
  }>
  checkpoints: Readonly<{
    propertyId: string | null
    organizationId: string | null
    activeCredentialOrganizationId: string | null
    credentialConnectionId: string | null
  }>
  progress: Readonly<{
    propertiesProcessed: number
    credentialHomesProcessed: number
    credentialConnectionsProcessed: number
    errorCount: number
    lastErrorCode: string | null
  }>
  remaining: Readonly<{
    properties: number
    resolvableProperties: number
    credentialHomes: number
    unresolvedProperties: number
  }>
  blockers: DataCellCutoverBlockers
  activeWorkflowBlockers: number
  totalBlockers: number
  digestSha256: string
}>

type Control = Readonly<{
  state: DataCellCutoverState
  phase: DataCellCutoverPhase
  propertyCheckpoint: string | null
  organizationCheckpoint: string | null
  credentialActiveOrganizationId: string | null
  credentialConnectionCheckpoint: string | null
  targetProjectId: string | null
  targetEnvironmentId: string | null
  propertiesProcessed: number
  credentialHomesProcessed: number
  credentialConnectionsProcessed: number
  errorCount: number
  lastErrorCode: string | null
}>

export type DataCellCutoverApplyInput = Readonly<{
  expectedReportDigestSha256: string
  batchSize: number
  operatorId: string
  changeTicket: string
  correlationId: string
  targetProjectId: string
  targetEnvironmentId: string
  now: Date
}>

export type DataCellCutoverApplyResult = Readonly<{
  outcome:
    | 'fence_activated'
    | 'blocked'
    | 'properties_processed'
    | 'credential_homes_processed'
    | 'phase_advanced'
    | 'completed'
    | 'already_completed'
  processed: number
  report: DataCellCutoverReport
}>

export type CompletedDataCellCutover = Readonly<{
  verifiedAt: Date
  completedAt: Date
  reportDigestSha256: string
  completionDigestSha256: string
  propertiesProcessed: number
  credentialHomesProcessed: number
  credentialConnectionsProcessed: number
  errorCount: number
  verification: Readonly<{
    remainingProperties: number
    resolvablePropertiesRemaining: number
    remainingCredentialHomes: number
    activeWorkflowBlockers: number
    routingConflicts: number
  }>
  targetProjectId: string
  targetEnvironmentId: string
  operatorId: string
  changeTicket: string
  correlationId: string
}>

export type DataCellCredentialCutoverErrorCode =
  | 'credential_authority_ambiguous'
  | 'credential_authority_generation_exhausted'
  | 'credential_authority_unavailable'
  | 'credential_batch_changed_concurrently'
  | 'credential_batch_mutation_failed'
  | 'credential_connection_checkpoint_regressed'
  | 'credential_connection_version_exhausted'
  | 'credential_organization_checkpoint_regressed'
  | 'credential_transition_clock_unavailable'

/** A thrown credential error always aborts and rolls back the whole invocation. */
export class DataCellCredentialCutoverError extends Error {
  constructor(
    readonly code: DataCellCredentialCutoverErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options)
    this.name = 'DataCellCredentialCutoverError'
  }
}

function exactCount(value: unknown): number {
  const count = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(count) || (count as number) < 0) {
    throw new Error('Data Cell cutover count is invalid')
  }
  return count as number
}

function exactDate(value: unknown): Date {
  const date =
    value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null
  if (date === null || Number.isNaN(date.getTime())) {
    throw new Error('Data Cell cutover timestamp is invalid')
  }
  return date
}

function exactPhase(value: unknown): DataCellCutoverPhase {
  if (
    value === 'properties' ||
    value === 'credential_homes' ||
    value === 'verify' ||
    value === 'completed'
  ) {
    return value
  }
  throw new Error('Data Cell topology cutover authority is unavailable')
}

function assertTargetBindingEstablished(
  control: Control,
  target: DataCellCutoverTargetBinding,
): void {
  assertDataCellCutoverTargetBindingMatches(control, target)
  if (
    control.targetProjectId !== target.projectId ||
    control.targetEnvironmentId !== target.environmentId
  ) {
    throw new Error(
      'Data Cell cutover Railway target must be bound by the deploy migration before apply',
    )
  }
}

async function readControl(
  tx: Pick<Tx, 'execute'>,
  forUpdate: boolean,
): Promise<Control> {
  const result = await tx.execute(
    sql.raw(`
    SELECT state, phase, target_project_id, target_environment_id,
           property_checkpoint, organization_checkpoint,
           credential_active_organization_id,
           credential_connection_checkpoint, properties_processed,
           credential_homes_processed, credential_connections_processed,
           error_count, last_error_code
    FROM data_cell_topology_cutovers
    WHERE singleton = TRUE AND cutover_key = '${SINGLE_US_BETA_CUTOVER_KEY}'
    ${forUpdate ? 'FOR UPDATE' : ''}
  `),
  )
  if (result.rows.length !== 1) {
    throw new Error('Data Cell topology cutover authority is unavailable')
  }
  const row = result.rows[0]!
  const targetBinding = parseDataCellCutoverTargetBindingControl(row)
  return {
    state: targetBinding.state,
    phase: exactPhase(row.phase),
    targetProjectId: targetBinding.targetProjectId,
    targetEnvironmentId: targetBinding.targetEnvironmentId,
    propertyCheckpoint:
      typeof row.property_checkpoint === 'string' ? row.property_checkpoint : null,
    organizationCheckpoint:
      typeof row.organization_checkpoint === 'string'
        ? row.organization_checkpoint
        : null,
    credentialActiveOrganizationId:
      typeof row.credential_active_organization_id === 'string'
        ? row.credential_active_organization_id
        : null,
    credentialConnectionCheckpoint:
      typeof row.credential_connection_checkpoint === 'string'
        ? row.credential_connection_checkpoint
        : null,
    propertiesProcessed: exactCount(row.properties_processed),
    credentialHomesProcessed: exactCount(row.credential_homes_processed),
    credentialConnectionsProcessed: exactCount(row.credential_connections_processed),
    errorCount: exactCount(row.error_count),
    lastErrorCode: typeof row.last_error_code === 'string' ? row.last_error_code : null,
  }
}

const WORKFLOW_BLOCKER_KEYS = [
  'regionMoves',
  'importRequests',
  'importRequestItems',
  'executionPermits',
  'credentialSourceOperations',
  'credentialRevokePermits',
  'subjectAuthorityGuards',
  'brokerGrants',
  'cleanupConnections',
] as const satisfies readonly (keyof DataCellCutoverBlockers)[]

function reportDigest(
  report: Omit<DataCellCutoverReport, 'capturedAt' | 'digestSha256'>,
): string {
  return createHash('sha256').update(JSON.stringify(report)).digest('hex')
}

export async function createSingleUsDataCellCutoverReport(
  tx: Pick<Tx, 'execute'>,
  capturedAt = new Date(),
): Promise<DataCellCutoverReport> {
  const control = await readControl(tx, false)
  const result = await tx.execute(sql`
    WITH current_credential_homes AS (
      SELECT organization_id, authority_generation, home_cell_id,
             catalogue_policy_version
      FROM google_organization_credential_homes
      WHERE superseded_at IS NULL
    ), credential_home_candidates AS (
      SELECT organization_id FROM current_credential_homes
      WHERE home_cell_id <> 'us' OR catalogue_policy_version <> 3
      UNION
      SELECT connection.organization_id
      FROM google_connections connection
      LEFT JOIN current_credential_homes authority
        ON authority.organization_id = connection.organization_id
      WHERE connection.credential_use_state = 'active'
        AND (authority.organization_id IS NULL
          OR authority.home_cell_id <> 'us'
          OR authority.catalogue_policy_version <> 3
          OR connection.credential_home_cell_id IS DISTINCT FROM 'us'
          OR connection.credential_home_policy_version IS DISTINCT FROM 3
          OR connection.credential_home_authority_generation IS DISTINCT FROM
             authority.authority_generation)
    )
    SELECT
      (SELECT count(*) FROM properties
       WHERE (
         (((data_cell_id IN ('us', 'europe', 'global')
             AND processing_region = data_cell_id)
            OR (data_cell_id IS NULL
             AND processing_region IN ('us', 'europe', 'global')))
          AND (data_cell_id IS DISTINCT FROM 'us'
            OR processing_region IS DISTINCT FROM 'us'
            OR routing_policy_version IS DISTINCT FROM 3))
         OR (data_cell_id IS NULL
           AND processing_region = 'unresolved'
           AND single_us_beta_supported_country_v3(country_code))
       )) AS remaining_properties,
      (SELECT count(*) FROM credential_home_candidates) AS remaining_credential_homes,
      (SELECT count(*) FROM properties
       WHERE data_cell_id IS NULL AND processing_region = 'unresolved'
         AND single_us_beta_supported_country_v3(country_code))
        AS resolvable_properties,
      (SELECT count(*) FROM properties
       WHERE data_cell_id IS NULL AND processing_region = 'unresolved'
         AND (country_code IS NULL
           OR NOT single_us_beta_supported_country_v3(country_code)))
        AS unresolved_properties,
      (SELECT count(*) FROM region_moves
       WHERE state NOT IN ('completed', 'rolled_back')) AS region_moves,
      (SELECT count(*) FROM gbp_import_requests
       WHERE status IN ('queued', 'processing')) AS import_requests,
      (SELECT count(*) FROM gbp_import_request_items
       WHERE status IN ('pending', 'processing')
          OR outcome_code = 'temporarily_unavailable') AS import_request_items,
      (SELECT count(*) FROM authorization_execution_permits
       WHERE state IN ('admitted', 'started')) AS execution_permits,
      (SELECT count(*) FROM google_credential_source_operations
       WHERE state IN ('registered', 'provider_started',
         'provider_outcome_ambiguous')) AS credential_source_operations,
      (SELECT count(*) FROM credential_revoke_permits
       WHERE state IN ('dormant', 'active', 'dispatching',
         'cleanup_ambiguous')) AS credential_revoke_permits,
      (SELECT count(*) FROM google_subject_authority_guards
       WHERE active_source_operation_id IS NOT NULL
          OR state IN ('source_active', 'cleanup_pending',
            'provider_reset_required', 'ambiguous')) AS subject_authority_guards,
      (SELECT count(*) FROM google_credential_broker_replay
       WHERE state = 'issued' AND expires_at > clock_timestamp()) AS broker_grants,
      (SELECT count(*) FROM google_connections
       WHERE credential_use_state = 'cleanup_only') AS cleanup_connections,
      (SELECT count(*) FROM properties
       WHERE data_cell_id IS NOT NULL
         AND processing_region IS DISTINCT FROM data_cell_id) AS routing_conflicts,
      (SELECT count(*) FROM properties
       WHERE (data_cell_id IN ('us', 'europe', 'global')
          OR processing_region IN ('us', 'europe', 'global'))
         AND routing_policy_version > 3) AS newer_routing_policies,
      (SELECT count(*) FROM google_connections
       WHERE credential_use_state = 'active'
         AND ((credential_home_cell_id IS NULL)::int
           + (credential_home_policy_version IS NULL)::int
           + (credential_home_authority_generation IS NULL)::int) NOT IN (0, 3)
      ) AS partial_credential_homes,
      (SELECT count(*) FROM google_connections connection
       WHERE connection.credential_use_state = 'active'
         AND connection.credential_home_cell_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM current_credential_homes authority
           WHERE authority.organization_id = connection.organization_id
             AND authority.authority_generation =
               connection.credential_home_authority_generation
             AND authority.home_cell_id = connection.credential_home_cell_id
             AND authority.catalogue_policy_version =
               connection.credential_home_policy_version
         )) AS credential_authority_conflicts,
      (SELECT count(*) FROM current_credential_homes
       WHERE EXISTS (
         SELECT 1 FROM google_organization_credential_homes authority
         WHERE authority.organization_id = current_credential_homes.organization_id
           AND authority.authority_generation =
             current_credential_homes.authority_generation
           AND authority.effective_from > clock_timestamp()
       )) AS future_credential_authorities,
      (SELECT count(*) FROM google_connections connection
       LEFT JOIN current_credential_homes authority
         ON authority.organization_id = connection.organization_id
       WHERE connection.credential_use_state = 'active'
         AND (authority.organization_id IS NULL
           OR authority.home_cell_id <> 'us'
           OR authority.catalogue_policy_version <> 3
           OR connection.credential_home_cell_id IS DISTINCT FROM 'us'
           OR connection.credential_home_policy_version IS DISTINCT FROM 3
           OR connection.credential_home_authority_generation IS DISTINCT FROM
              authority.authority_generation)
         AND (connection.access_version >= 2147483647
           OR connection.credential_generation >= 2147483647)
      ) AS exhausted_connection_versions,
      (SELECT count(*) FROM (
         SELECT organization_id, max(authority_generation) maximum_generation
         FROM google_organization_credential_homes
         GROUP BY organization_id
       ) generations
       WHERE maximum_generation >= 2147483647
         AND organization_id IN (SELECT organization_id FROM credential_home_candidates)
      ) AS exhausted_authority_generations
  `)
  const row = result.rows[0]
  if (!row) throw new Error('Data Cell cutover report is unavailable')
  const blockers: DataCellCutoverBlockers = {
    regionMoves: exactCount(row.region_moves),
    importRequests: exactCount(row.import_requests),
    importRequestItems: exactCount(row.import_request_items),
    executionPermits: exactCount(row.execution_permits),
    credentialSourceOperations: exactCount(row.credential_source_operations),
    credentialRevokePermits: exactCount(row.credential_revoke_permits),
    subjectAuthorityGuards: exactCount(row.subject_authority_guards),
    brokerGrants: exactCount(row.broker_grants),
    cleanupConnections: exactCount(row.cleanup_connections),
    routingConflicts: exactCount(row.routing_conflicts),
    newerRoutingPolicies: exactCount(row.newer_routing_policies),
    partialCredentialHomes: exactCount(row.partial_credential_homes),
    credentialAuthorityConflicts: exactCount(row.credential_authority_conflicts),
    futureCredentialAuthorities: exactCount(row.future_credential_authorities),
    exhaustedConnectionVersions: exactCount(row.exhausted_connection_versions),
    exhaustedAuthorityGenerations: exactCount(row.exhausted_authority_generations),
  }
  const activeWorkflowBlockers = WORKFLOW_BLOCKER_KEYS.reduce(
    (sum, key) => sum + blockers[key],
    0,
  )
  const totalBlockers = Object.values(blockers).reduce((sum, count) => sum + count, 0)
  const material = {
    cutoverKey: SINGLE_US_BETA_CUTOVER_KEY as typeof SINGLE_US_BETA_CUTOVER_KEY,
    state: control.state,
    phase: control.phase,
    target: {
      cell: 'us' as const,
      policyVersion: 3 as const,
      projectId: control.targetProjectId,
      environmentId: control.targetEnvironmentId,
    },
    checkpoints: {
      propertyId: control.propertyCheckpoint,
      organizationId: control.organizationCheckpoint,
      activeCredentialOrganizationId: control.credentialActiveOrganizationId,
      credentialConnectionId: control.credentialConnectionCheckpoint,
    },
    progress: {
      propertiesProcessed: control.propertiesProcessed,
      credentialHomesProcessed: control.credentialHomesProcessed,
      credentialConnectionsProcessed: control.credentialConnectionsProcessed,
      errorCount: control.errorCount,
      lastErrorCode: control.lastErrorCode,
    },
    remaining: {
      properties: exactCount(row.remaining_properties),
      resolvableProperties: exactCount(row.resolvable_properties),
      credentialHomes: exactCount(row.remaining_credential_homes),
      unresolvedProperties: exactCount(row.unresolved_properties),
    },
    blockers,
    activeWorkflowBlockers,
    totalBlockers,
  }
  return Object.freeze({
    capturedAt: capturedAt.toISOString(),
    ...material,
    digestSha256: reportDigest(material),
  })
}

async function processPropertyBatch(
  tx: Pick<Tx, 'execute'>,
  control: Control,
  batchSize: number,
  now: Date,
): Promise<number> {
  const candidates = await tx.execute(sql`
    SELECT id
    FROM properties
    WHERE (${control.propertyCheckpoint}::uuid IS NULL
        OR id > ${control.propertyCheckpoint}::uuid)
      AND (
        (((data_cell_id IN ('us', 'europe', 'global')
            AND processing_region = data_cell_id)
           OR (data_cell_id IS NULL
            AND processing_region IN ('us', 'europe', 'global')))
         AND (data_cell_id IS DISTINCT FROM 'us'
           OR processing_region IS DISTINCT FROM 'us'
           OR routing_policy_version IS DISTINCT FROM 3))
        OR (data_cell_id IS NULL
          AND processing_region = 'unresolved'
          AND single_us_beta_supported_country_v3(country_code))
      )
    ORDER BY id
    LIMIT ${batchSize}
    FOR UPDATE
  `)
  const ids = candidates.rows
    .map((row) => row.id)
    .filter((id): id is string => typeof id === 'string')
  if (ids.length === 0) return 0
  await tx.execute(sql`
    SELECT set_config(
      'repkey.data_cell_topology_cutover',
      ${SINGLE_US_BETA_CUTOVER_KEY},
      TRUE
    )
  `)
  const updated = await tx.execute(sql`
    UPDATE properties
    SET processing_region = 'us', data_cell_id = 'us',
        routing_policy_version = 3,
        processing_region_resolved_at = ${now}, updated_at = ${now}
    WHERE id IN (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
    RETURNING id
  `)
  if (updated.rows.length !== ids.length) {
    throw new Error('Data Cell Property batch changed concurrently')
  }
  await tx.execute(sql`
    UPDATE data_cell_topology_cutovers
    SET property_checkpoint = ${ids.at(-1)}::uuid,
        properties_processed = properties_processed + ${ids.length},
        error_count = 0, last_error_code = NULL, updated_at = ${now}
    WHERE singleton = TRUE
  `)
  return ids.length
}

/**
 * The Organization this batch works on: the one already checkpointed, or the
 * next one past the checkpoint whose credential home is not yet the single US
 * cell. `null` once every Organization is settled.
 */
async function selectCredentialOrganization(
  tx: Pick<Tx, 'execute'>,
  control: Control,
): Promise<string | null> {
  if (control.credentialActiveOrganizationId !== null) {
    return control.credentialActiveOrganizationId
  }
  const candidate = await tx.execute(sql`
    WITH current_authority AS (
      SELECT organization_id, authority_generation, home_cell_id,
             catalogue_policy_version
      FROM google_organization_credential_homes
      WHERE superseded_at IS NULL
    ), candidate AS (
      SELECT organization_id FROM current_authority
      WHERE home_cell_id <> 'us' OR catalogue_policy_version <> 3
      UNION
      SELECT connection.organization_id
      FROM google_connections connection
      LEFT JOIN current_authority authority
        ON authority.organization_id = connection.organization_id
      WHERE connection.credential_use_state = 'active'
        AND (authority.organization_id IS NULL
          OR authority.home_cell_id <> 'us'
          OR authority.catalogue_policy_version <> 3
          OR connection.credential_home_cell_id IS DISTINCT FROM 'us'
          OR connection.credential_home_policy_version IS DISTINCT FROM 3
          OR connection.credential_home_authority_generation IS DISTINCT FROM
             authority.authority_generation)
    )
    SELECT organization_id
    FROM candidate
    WHERE ${control.organizationCheckpoint}::text IS NULL
       OR organization_id > ${control.organizationCheckpoint}
    ORDER BY organization_id
    LIMIT 1
  `)
  const rawOrganizationId = candidate.rows[0]?.organization_id
  return typeof rawOrganizationId === 'string' ? rawOrganizationId : null
}

type CredentialAuthority = Readonly<{
  /** The live authority row, absent when the Organization has never had one. */
  current: Record<string, unknown> | undefined
  authorityNeedsTransition: boolean
  /** The generation this batch stamps onto its connections. */
  generation: number
}>

/**
 * Lock the Organization's credential-home authority and decide which generation
 * this batch writes: a fresh one when the authority must transition, otherwise
 * the settled one it already carries.
 */
async function resolveCredentialAuthority(
  tx: Pick<Tx, 'execute'>,
  organizationId: string,
): Promise<CredentialAuthority> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended('google-credential-home:' || ${organizationId}, 0)
    )
  `)
  const authorityRows = await tx.execute(sql`
    SELECT authority_generation, home_cell_id, catalogue_policy_version,
           effective_from
    FROM google_organization_credential_homes
    WHERE organization_id = ${organizationId}
      AND superseded_at IS NULL
    FOR UPDATE
  `)
  if (authorityRows.rows.length > 1) {
    throw new DataCellCredentialCutoverError('credential_authority_ambiguous')
  }
  const current = authorityRows.rows[0]
  const authorityNeedsTransition =
    !current || current.home_cell_id !== 'us' || current.catalogue_policy_version !== 3
  if (!authorityNeedsTransition) {
    const generation = exactCount(current.authority_generation)
    if (generation < 1) {
      throw new DataCellCredentialCutoverError('credential_authority_unavailable')
    }
    return { current, authorityNeedsTransition, generation }
  }
  const maximum = await tx.execute(sql`
    SELECT COALESCE(max(authority_generation), 0)::int AS value
    FROM google_organization_credential_homes
    WHERE organization_id = ${organizationId}
  `)
  const priorMaximum = exactCount(maximum.rows[0]?.value)
  if (priorMaximum >= 2_147_483_647) {
    throw new DataCellCredentialCutoverError('credential_authority_generation_exhausted')
  }
  return { current, authorityNeedsTransition, generation: priorMaximum + 1 }
}

/**
 * The next page of active connections whose credential home is still stale,
 * refusing a page that changed underneath us, that would exhaust a version
 * counter, or that leaves an unsettled connection behind the checkpoint.
 */
async function selectCredentialConnectionBatch(
  tx: Pick<Tx, 'execute'>,
  control: Control,
  organizationId: string,
  generation: number,
  batchSize: number,
): Promise<readonly string[]> {
  const connectionRows = await tx.execute(sql`
    SELECT id, access_version, credential_generation
    FROM google_connections
    WHERE organization_id = ${organizationId}
      AND credential_use_state = 'active'
      AND (${control.credentialConnectionCheckpoint}::uuid IS NULL
        OR id > ${control.credentialConnectionCheckpoint}::uuid)
      AND (credential_home_cell_id IS DISTINCT FROM 'us'
        OR credential_home_policy_version IS DISTINCT FROM 3
        OR credential_home_authority_generation IS DISTINCT FROM ${generation})
    ORDER BY id
    LIMIT ${batchSize}
    FOR UPDATE
  `)
  const connectionIds = connectionRows.rows
    .map((row) => row.id)
    .filter((id): id is string => typeof id === 'string')
  if (connectionIds.length !== connectionRows.rows.length) {
    throw new DataCellCredentialCutoverError('credential_batch_changed_concurrently')
  }
  if (
    connectionRows.rows.some(
      (row) =>
        exactCount(row.access_version) >= 2_147_483_647 ||
        exactCount(row.credential_generation) >= 2_147_483_647,
    )
  ) {
    throw new DataCellCredentialCutoverError('credential_connection_version_exhausted')
  }
  if (control.credentialConnectionCheckpoint !== null) {
    const regressed = await tx.execute(sql`
      SELECT EXISTS (
        SELECT 1
        FROM google_connections
        WHERE organization_id = ${organizationId}
          AND credential_use_state = 'active'
          AND id <= ${control.credentialConnectionCheckpoint}::uuid
          AND (credential_home_cell_id IS DISTINCT FROM 'us'
            OR credential_home_policy_version IS DISTINCT FROM 3
            OR credential_home_authority_generation IS DISTINCT FROM ${generation})
      ) AS value
    `)
    if (regressed.rows[0]?.value === true) {
      throw new DataCellCredentialCutoverError(
        'credential_connection_checkpoint_regressed',
      )
    }
  }
  return connectionIds
}

/**
 * Supersede the prior credential-home authority and insert the new generation,
 * both stamped with the database's own clock.
 */
async function writeCredentialAuthorityTransition(
  tx: Pick<Tx, 'execute'>,
  organizationId: string,
  generation: number,
  current: Record<string, unknown> | undefined,
  input: DataCellCutoverApplyInput,
): Promise<void> {
  const clock = await tx.execute(sql`SELECT clock_timestamp() AS occurred_at`)
  const rawTransitionAt = clock.rows[0]?.occurred_at
  const transitionAt =
    rawTransitionAt instanceof Date
      ? rawTransitionAt
      : typeof rawTransitionAt === 'string'
        ? new Date(rawTransitionAt)
        : null
  if (!transitionAt || !Number.isFinite(transitionAt.getTime())) {
    throw new DataCellCredentialCutoverError('credential_transition_clock_unavailable')
  }
  if (current) {
    const superseded = await tx.execute(sql`
      UPDATE google_organization_credential_homes
      SET superseded_at = ${transitionAt}, updated_at = ${transitionAt}
      WHERE organization_id = ${organizationId}
        AND authority_generation = ${exactCount(current.authority_generation)}
        AND superseded_at IS NULL
      RETURNING authority_generation
    `)
    if (superseded.rows.length !== 1) {
      throw new DataCellCredentialCutoverError('credential_batch_changed_concurrently')
    }
  }
  await tx.execute(sql`
    INSERT INTO google_organization_credential_homes (
      organization_id, authority_generation, home_cell_id,
      catalogue_policy_version, transition_reason, changed_by,
      change_ticket, effective_from, created_at, updated_at
    ) VALUES (
      ${organizationId}, ${generation}, 'us', 3, 'legacy_backfill',
      ${input.operatorId}, ${input.changeTicket}, ${transitionAt},
      ${transitionAt}, ${transitionAt}
    )
  `)
}

/** Stamp the settled credential home onto this page of connections. */
async function writeCredentialHomeToConnections(
  tx: Pick<Tx, 'execute'>,
  organizationId: string,
  generation: number,
  connectionIds: readonly string[],
  now: DataCellCutoverApplyInput['now'],
): Promise<void> {
  const updated = await tx.execute(sql`
    UPDATE google_connections
    SET credential_home_cell_id = 'us', credential_home_policy_version = 3,
        credential_home_authority_generation = ${generation},
        access_version = access_version + 1,
        credential_generation = credential_generation + 1,
        updated_at = ${now}
    WHERE organization_id = ${organizationId}
      AND credential_use_state = 'active'
      AND id IN (${sql.join(
        connectionIds.map((connectionId) => sql`${connectionId}::uuid`),
        sql`, `,
      )})
      AND (credential_home_cell_id IS DISTINCT FROM 'us'
        OR credential_home_policy_version IS DISTINCT FROM 3
        OR credential_home_authority_generation IS DISTINCT FROM ${generation})
    RETURNING id
  `)
  if (updated.rows.length !== connectionIds.length) {
    throw new DataCellCredentialCutoverError('credential_batch_changed_concurrently')
  }
}

/**
 * Stay on this Organization while stale connections remain; otherwise mark it
 * settled and move the Organization checkpoint on. Remaining connections with
 * an empty page means the checkpoint skipped work, which is a refusal.
 */
async function advanceCredentialCheckpoint(
  tx: Pick<Tx, 'execute'>,
  organizationId: string,
  generation: number,
  connectionIds: readonly string[],
  now: DataCellCutoverApplyInput['now'],
): Promise<void> {
  const remaining = await tx.execute(sql`
    SELECT EXISTS (
      SELECT 1
      FROM google_connections
      WHERE organization_id = ${organizationId}
        AND credential_use_state = 'active'
        AND (credential_home_cell_id IS DISTINCT FROM 'us'
          OR credential_home_policy_version IS DISTINCT FROM 3
          OR credential_home_authority_generation IS DISTINCT FROM ${generation})
    ) AS value
  `)
  const hasRemainingConnections = remaining.rows[0]?.value === true
  if (hasRemainingConnections && connectionIds.length === 0) {
    throw new DataCellCredentialCutoverError('credential_connection_checkpoint_regressed')
  }
  if (hasRemainingConnections) {
    await tx.execute(sql`
      UPDATE data_cell_topology_cutovers
      SET credential_active_organization_id = ${organizationId},
          credential_connection_checkpoint = ${connectionIds.at(-1)}::uuid,
          credential_connections_processed = credential_connections_processed +
            ${connectionIds.length},
          error_count = 0, last_error_code = NULL, updated_at = ${now}
      WHERE singleton = TRUE
    `)
    return
  }
  await tx.execute(sql`
    UPDATE data_cell_topology_cutovers
    SET organization_checkpoint = ${organizationId},
        credential_active_organization_id = NULL,
        credential_connection_checkpoint = NULL,
        credential_homes_processed = credential_homes_processed + 1,
        credential_connections_processed = credential_connections_processed +
          ${connectionIds.length},
        error_count = 0, last_error_code = NULL, updated_at = ${now}
    WHERE singleton = TRUE
  `)
}

async function processCredentialHomeBatch(
  tx: Pick<Tx, 'execute'>,
  control: Control,
  input: DataCellCutoverApplyInput,
): Promise<Readonly<{ connectionsProcessed: number; didWork: boolean }>> {
  const organizationId = await selectCredentialOrganization(tx, control)
  if (organizationId === null) {
    return { connectionsProcessed: 0, didWork: false }
  }

  const authority = await resolveCredentialAuthority(tx, organizationId)
  const connectionIds = await selectCredentialConnectionBatch(
    tx,
    control,
    organizationId,
    authority.generation,
    input.batchSize,
  )

  if (authority.authorityNeedsTransition) {
    await writeCredentialAuthorityTransition(
      tx,
      organizationId,
      authority.generation,
      authority.current,
      input,
    )
  }
  if (connectionIds.length > 0) {
    await writeCredentialHomeToConnections(
      tx,
      organizationId,
      authority.generation,
      connectionIds,
      input.now,
    )
  }
  await advanceCredentialCheckpoint(
    tx,
    organizationId,
    authority.generation,
    connectionIds,
    input.now,
  )
  return { connectionsProcessed: connectionIds.length, didWork: true }
}

type CutoverPhaseStep = Readonly<{
  processed: number
  outcome: DataCellCutoverApplyResult['outcome']
  /** Set when the phase refuses; returned directly instead of advancing. */
  blockedReport?: DataCellCutoverReport
}>

/** Take the cutover fence, refusing if the target binding moved underneath us. */
async function activateCutoverFence(
  tx: Pick<Tx, 'execute'>,
  input: DataCellCutoverApplyInput,
  target: DataCellCutoverTargetBinding,
  reportDigestSha256: string,
): Promise<void> {
  const fenced = await tx.execute(sql`
    UPDATE data_cell_topology_cutovers
    SET state = 'fenced', fenced_at = ${input.now},
        operator_id = ${input.operatorId}, change_ticket = ${input.changeTicket},
        correlation_id = ${input.correlationId},
        last_report_digest_sha256 = ${reportDigestSha256},
        updated_at = ${input.now}
    WHERE singleton = TRUE AND state = 'open'
      AND target_project_id = ${target.projectId}
      AND target_environment_id = ${target.environmentId}
    RETURNING singleton
  `)
  if (fenced.rows.length !== 1) {
    throw new Error('Data Cell cutover target binding changed before fencing')
  }
}

/** One Property page; an empty page either rewinds or advances the phase. */
async function runPropertiesPhase(
  tx: Pick<Tx, 'execute'>,
  control: Control,
  input: DataCellCutoverApplyInput,
  report: DataCellCutoverReport,
): Promise<CutoverPhaseStep> {
  const processed = await processPropertyBatch(tx, control, input.batchSize, input.now)
  if (processed > 0) return { processed, outcome: 'properties_processed' }
  if (report.remaining.properties > 0) {
    await tx.execute(sql`
      UPDATE data_cell_topology_cutovers
      SET property_checkpoint = NULL, updated_at = ${input.now}
      WHERE singleton = TRUE
    `)
  } else {
    await tx.execute(sql`
      UPDATE data_cell_topology_cutovers
      SET phase = 'credential_homes', organization_checkpoint = NULL,
          updated_at = ${input.now}
      WHERE singleton = TRUE
    `)
  }
  return { processed, outcome: 'phase_advanced' }
}

/** One credential-home page; work with rows still remaining is a refusal. */
async function runCredentialHomesPhase(
  tx: Pick<Tx, 'execute'>,
  control: Control,
  input: DataCellCutoverApplyInput,
  report: DataCellCutoverReport,
): Promise<CutoverPhaseStep> {
  let batch: Readonly<{ connectionsProcessed: number; didWork: boolean }>
  try {
    batch = await processCredentialHomeBatch(tx, control, input)
  } catch (error) {
    if (error instanceof DataCellCredentialCutoverError) throw error
    throw new DataCellCredentialCutoverError('credential_batch_mutation_failed', {
      cause: error,
    })
  }
  const processed = batch.connectionsProcessed
  if (batch.didWork) return { processed, outcome: 'credential_homes_processed' }
  if (report.remaining.credentialHomes > 0) {
    throw new DataCellCredentialCutoverError(
      'credential_organization_checkpoint_regressed',
    )
  }
  await tx.execute(sql`
    UPDATE data_cell_topology_cutovers
    SET phase = 'verify', credential_active_organization_id = NULL,
        credential_connection_checkpoint = NULL,
        error_count = 0, last_error_code = NULL,
        updated_at = ${input.now}
    WHERE singleton = TRUE
  `)
  return { processed, outcome: 'phase_advanced' }
}

/** Completion is only representable from a freshly re-read, blocker-free report. */
async function runVerifyPhase(
  tx: Pick<Tx, 'execute'>,
  input: DataCellCutoverApplyInput,
  target: DataCellCutoverTargetBinding,
): Promise<CutoverPhaseStep> {
  const report = await createSingleUsDataCellCutoverReport(tx, input.now)
  if (
    report.totalBlockers > 0 ||
    report.progress.errorCount > 0 ||
    report.remaining.properties > 0 ||
    report.remaining.credentialHomes > 0
  ) {
    return { processed: 0, outcome: 'blocked', blockedReport: report }
  }
  const completionDigest = createHash('sha256')
    .update(
      JSON.stringify({
        cutoverKey: SINGLE_US_BETA_CUTOVER_KEY,
        targetCell: 'us',
        targetPolicyVersion: 3,
        targetProjectId: target.projectId,
        targetEnvironmentId: target.environmentId,
        propertiesProcessed: report.progress.propertiesProcessed,
        credentialHomesProcessed: report.progress.credentialHomesProcessed,
        credentialConnectionsProcessed: report.progress.credentialConnectionsProcessed,
        verifiedReportDigestSha256: report.digestSha256,
        completedAt: input.now.toISOString(),
      }),
    )
    .digest('hex')
  await tx.execute(sql`
    UPDATE data_cell_topology_cutovers
    SET state = 'completed', phase = 'completed', completed_at = ${input.now},
        completion_digest_sha256 = ${completionDigest},
        last_report_digest_sha256 = ${report.digestSha256},
        updated_at = ${input.now}
    WHERE singleton = TRUE AND state = 'fenced' AND phase = 'verify'
  `)
  return { processed: 0, outcome: 'completed' }
}

async function runCutoverPhase(
  tx: Pick<Tx, 'execute'>,
  control: Control,
  input: DataCellCutoverApplyInput,
  target: DataCellCutoverTargetBinding,
  report: DataCellCutoverReport,
): Promise<CutoverPhaseStep> {
  if (control.phase === 'properties') {
    return runPropertiesPhase(tx, control, input, report)
  }
  if (control.phase === 'credential_homes') {
    return runCredentialHomesPhase(tx, control, input, report)
  }
  if (control.phase === 'verify') return runVerifyPhase(tx, input, target)
  return { processed: 0, outcome: 'phase_advanced' }
}

export async function applySingleUsDataCellCutoverBatch(
  db: Database,
  input: DataCellCutoverApplyInput,
): Promise<DataCellCutoverApplyResult> {
  if (!/^[a-f0-9]{64}$/u.test(input.expectedReportDigestSha256)) {
    throw new Error('Expected Data Cell cutover report digest is invalid')
  }
  if (
    !Number.isSafeInteger(input.batchSize) ||
    input.batchSize < 1 ||
    input.batchSize > 500
  ) {
    throw new Error('Data Cell cutover batch size must be between 1 and 500')
  }
  const target = normalizeDataCellCutoverTargetBinding({
    projectId: input.targetProjectId,
    environmentId: input.targetEnvironmentId,
  })
  return db.transaction(async (tx) => {
    const control = await readControl(tx, true)
    assertTargetBindingEstablished(control, target)
    const report = await createSingleUsDataCellCutoverReport(tx, input.now)
    if (report.digestSha256 !== input.expectedReportDigestSha256) {
      throw new Error('Data Cell cutover report changed; run report and review again')
    }
    if (control.state === 'completed') {
      return { outcome: 'already_completed', processed: 0, report }
    }
    if (report.totalBlockers > 0) {
      return { outcome: 'blocked', processed: 0, report }
    }
    if (control.state === 'open') {
      await activateCutoverFence(tx, input, target, report.digestSha256)
      return {
        outcome: 'fence_activated',
        processed: 0,
        report: await createSingleUsDataCellCutoverReport(tx, input.now),
      }
    }

    const step = await runCutoverPhase(tx, control, input, target, report)
    if (step.blockedReport) {
      return { outcome: 'blocked', processed: 0, report: step.blockedReport }
    }
    return {
      outcome: step.outcome,
      processed: step.processed,
      report: await createSingleUsDataCellCutoverReport(tx, input.now),
    }
  })
}

export async function readCompletedSingleUsDataCellCutover(
  db: Database,
): Promise<CompletedDataCellCutover | null> {
  return db.transaction(async (tx) => {
    const control = await readControl(tx, true)
    if (control.state !== 'completed' || control.phase !== 'completed') return null
    const verifiedAt = new Date()
    const live = await createSingleUsDataCellCutoverReport(tx, verifiedAt)
    if (
      live.totalBlockers - live.activeWorkflowBlockers > 0 ||
      live.progress.errorCount > 0 ||
      live.remaining.properties > 0 ||
      live.remaining.credentialHomes > 0
    ) {
      throw new Error('completed cutover no longer has zero-blocker live verification')
    }
    const result = await tx.execute(sql`
      SELECT completed_at, last_report_digest_sha256, completion_digest_sha256,
             properties_processed, credential_homes_processed,
             credential_connections_processed, error_count,
             target_project_id, target_environment_id, operator_id,
             change_ticket, correlation_id
      FROM data_cell_topology_cutovers
      WHERE singleton = TRUE AND cutover_key = ${SINGLE_US_BETA_CUTOVER_KEY}
        AND state = 'completed' AND phase = 'completed'
    `)
    const row = result.rows[0]
    if (!row) return null
    if (
      typeof row.last_report_digest_sha256 !== 'string' ||
      typeof row.completion_digest_sha256 !== 'string' ||
      typeof row.target_project_id !== 'string' ||
      typeof row.target_environment_id !== 'string' ||
      typeof row.operator_id !== 'string' ||
      typeof row.change_ticket !== 'string' ||
      typeof row.correlation_id !== 'string'
    ) {
      throw new Error('Completed Data Cell cutover authority is malformed')
    }
    const completedAt = exactDate(row.completed_at)
    return {
      verifiedAt,
      completedAt,
      reportDigestSha256: row.last_report_digest_sha256,
      completionDigestSha256: row.completion_digest_sha256,
      propertiesProcessed: exactCount(row.properties_processed),
      credentialHomesProcessed: exactCount(row.credential_homes_processed),
      credentialConnectionsProcessed: exactCount(row.credential_connections_processed),
      errorCount: exactCount(row.error_count),
      verification: Object.freeze({
        remainingProperties: live.remaining.properties,
        resolvablePropertiesRemaining: live.remaining.resolvableProperties,
        remainingCredentialHomes: live.remaining.credentialHomes,
        activeWorkflowBlockers: live.activeWorkflowBlockers,
        routingConflicts: live.blockers.routingConflicts,
      }),
      targetProjectId: exactDataCellCutoverTargetId(
        row.target_project_id,
        'Railway project ID',
      ),
      targetEnvironmentId: exactDataCellCutoverTargetId(
        row.target_environment_id,
        'Railway environment ID',
      ),
      operatorId: row.operator_id,
      changeTicket: row.change_ticket,
      correlationId: row.correlation_id,
    }
  })
}
