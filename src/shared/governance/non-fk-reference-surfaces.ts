/**
 * CNV-01 non-foreign-key reference authority.
 *
 * `docs/operations/legacy-goal-contraction.md` admits the gap this module
 * closes: "The inventory deliberately does not claim a complete
 * non-foreign-key dependency graph." A foreign key is the only reference
 * PostgreSQL will defend. Everything else — a uuid column declared without
 * `.references()`, a `(resource_type, resource_id)` pair, an aggregate id in
 * `outbox_events`, an identifier embedded in a jsonb document — survives the
 * row it names and turns into a dangling reference the moment a contraction
 * slice runs.
 *
 * The surfaces below were found by schema inspection, not by guessing:
 *
 * - `team_memberships.team_id` and `team_portal_group_scopes.team_id` are
 *   `uuid(...).notNull()` with no `.references()` to `teams.id`
 *   (people-access.schema.ts:227 and :331);
 * - `recent_activity_entries.resource_type` / `.resource_id` are varchar with
 *   no constraint, and the `ACTIVITY_RESOURCE_TYPES` vocabulary still contains
 *   `team`, `staff_assignment` and `goal` — exactly the resource kinds whose
 *   rows are contraction candidates;
 * - `recent_activity_replay_facts` repeats that pair and adds a textual
 *   `source_aggregate_id`;
 * - `outbox_events` carries `source_context`, `source_aggregate_id` and
 *   `event_type` as free text plus a jsonb `payload`;
 * - `notifications.payload` is jsonb.
 *
 * Coverage is exhaustive in both directions: every table classified
 * `bounded_contraction` or `compatibility_read` must either be reachable by a
 * declared probe or be recorded here as having no non-FK referent, with a
 * reason. A new contraction candidate therefore cannot be added without a
 * non-FK disposition.
 */

import { createHash } from 'node:crypto'

export type NonFkProbeKind =
  'uuid_column' | 'text_column' | 'resource_type_pair' | 'json_document'

/**
 * Which candidate tables a surface can reference.
 *
 * - `declared` names them explicitly;
 * - `activity_vocabulary` resolves through the Recent Activity resource-type
 *   tokens;
 * - `surrogate_identified_candidates` covers every candidate whose rows have a
 *   surrogate `id`, because any of those ids can appear as text inside an
 *   aggregate identifier or a jsonb document.
 */
export type NonFkReferentScope =
  'declared' | 'activity_vocabulary' | 'surrogate_identified_candidates'

export type NonFkReferenceSurface = Readonly<{
  id: string
  schema: 'public'
  table: string
  columns: readonly string[]
  kind: NonFkProbeKind
  /** Column whose value can name a candidate row. */
  identifierColumn: string
  /** Column carrying the resource-kind token; null unless a pair probe. */
  discriminatorColumn: string | null
  referentScope: NonFkReferentScope
  /** Used only when `referentScope` is `declared`. */
  declaredReferents: readonly string[]
  reason: string
}>

const nonFkSurface = <const Definition extends NonFkReferenceSurface>(
  definition: Definition,
) => Object.freeze(definition)

/** Recent Activity resource tokens whose rows are contraction candidates. */
export const ACTIVITY_RESOURCE_REFERENTS = Object.freeze([
  Object.freeze({ token: 'team', tableName: 'teams' }),
  Object.freeze({ token: 'staff_assignment', tableName: 'staff_assignments' }),
  Object.freeze({ token: 'goal', tableName: 'goals' }),
] as const)

/**
 * Declaration order is the probe order an operator sees, so it runs from the
 * cheapest, most specific column probe to the broadest document scan.
 */
export const NON_FK_REFERENCE_SURFACES = Object.freeze([
  nonFkSurface({
    id: 'team_memberships.team_id',
    schema: 'public',
    table: 'team_memberships',
    columns: ['team_id'],
    kind: 'uuid_column',
    identifierColumn: 'team_id',
    discriminatorColumn: null,
    referentScope: 'declared',
    declaredReferents: ['teams'],
    reason:
      'people-access.schema.ts:227 declares uuid(team_id).notNull() with no .references() to teams.id, so PostgreSQL will not refuse a membership row whose team has been contracted away.',
  }),
  nonFkSurface({
    id: 'team_portal_group_scopes.team_id',
    schema: 'public',
    table: 'team_portal_group_scopes',
    columns: ['team_id'],
    kind: 'uuid_column',
    identifierColumn: 'team_id',
    discriminatorColumn: null,
    referentScope: 'declared',
    declaredReferents: ['teams'],
    reason:
      'people-access.schema.ts:331 declares uuid(team_id).notNull() with no .references() to teams.id; the scope row outlives the team it scopes.',
  }),
  nonFkSurface({
    id: 'recent_activity_entries.resource',
    schema: 'public',
    table: 'recent_activity_entries',
    columns: ['resource_type', 'resource_id'],
    kind: 'resource_type_pair',
    identifierColumn: 'resource_id',
    discriminatorColumn: 'resource_type',
    referentScope: 'activity_vocabulary',
    declaredReferents: [],
    reason:
      'Both columns are varchar with no constraint, and the ACTIVITY_RESOURCE_TYPES vocabulary still contains team, staff_assignment and goal, so the projection can name a contracted row forever.',
  }),
  nonFkSurface({
    id: 'recent_activity_replay_facts.resource',
    schema: 'public',
    table: 'recent_activity_replay_facts',
    columns: ['resource_type', 'resource_id'],
    kind: 'resource_type_pair',
    identifierColumn: 'resource_id',
    discriminatorColumn: 'resource_type',
    referentScope: 'activity_vocabulary',
    declaredReferents: [],
    reason:
      'The replay fact repeats the projection pair as nullable varchar so a replay can be reconstructed; the same dangling-reference exposure applies.',
  }),
  nonFkSurface({
    id: 'recent_activity_replay_facts.source_aggregate_id',
    schema: 'public',
    table: 'recent_activity_replay_facts',
    columns: ['source_aggregate_id'],
    kind: 'text_column',
    identifierColumn: 'source_aggregate_id',
    discriminatorColumn: null,
    referentScope: 'surrogate_identified_candidates',
    declaredReferents: [],
    reason:
      'The aggregate identifier is free text copied from the source event, so it can hold the surrogate id of any contraction candidate that ever emitted an event.',
  }),
  nonFkSurface({
    id: 'outbox_events.source_aggregate_id',
    schema: 'public',
    table: 'outbox_events',
    columns: ['source_context', 'source_aggregate_id', 'event_type'],
    kind: 'text_column',
    identifierColumn: 'source_aggregate_id',
    discriminatorColumn: null,
    referentScope: 'surrogate_identified_candidates',
    declaredReferents: [],
    reason:
      'source_context, source_aggregate_id and event_type are text with no constraint; published rows expire on their own schedule, not with the aggregate they name.',
  }),
  nonFkSurface({
    id: 'recent_activity_entries.payload',
    schema: 'public',
    table: 'recent_activity_entries',
    columns: ['payload'],
    kind: 'json_document',
    identifierColumn: 'payload',
    discriminatorColumn: null,
    referentScope: 'surrogate_identified_candidates',
    declaredReferents: [],
    reason:
      'The jsonb payload is unconstrained and routinely embeds the identifiers of the resources an entry describes.',
  }),
  nonFkSurface({
    id: 'recent_activity_replay_facts.transition_payload',
    schema: 'public',
    table: 'recent_activity_replay_facts',
    columns: ['transition_payload'],
    kind: 'json_document',
    identifierColumn: 'transition_payload',
    discriminatorColumn: null,
    referentScope: 'surrogate_identified_candidates',
    declaredReferents: [],
    reason:
      'The retained transition document is unconstrained jsonb and can embed the identifier of any aggregate involved in the transition.',
  }),
  nonFkSurface({
    id: 'outbox_events.payload',
    schema: 'public',
    table: 'outbox_events',
    columns: ['payload'],
    kind: 'json_document',
    identifierColumn: 'payload',
    discriminatorColumn: null,
    referentScope: 'surrogate_identified_candidates',
    declaredReferents: [],
    reason:
      'Event payloads are unconstrained jsonb; an identifier embedded there is invisible to every foreign-key check.',
  }),
  nonFkSurface({
    id: 'notifications.payload',
    schema: 'public',
    table: 'notifications',
    columns: ['payload'],
    kind: 'json_document',
    identifierColumn: 'payload',
    discriminatorColumn: null,
    referentScope: 'surrogate_identified_candidates',
    declaredReferents: [],
    reason:
      'notification.schema.ts:58 declares a nullable jsonb payload holding a rendered snapshot; it can embed the identifier of the resource that triggered the notification.',
  }),
] satisfies ReadonlyArray<NonFkReferenceSurface>)

export type NonFkUnreferenceableCandidate = Readonly<{
  tableName: string
  reason: string
}>

/**
 * Contraction candidates that no non-FK surface can name, each with the schema
 * fact that makes that true. This is the explicit "no non-FK referent" record
 * the coverage rule accepts in place of a probe.
 */
// `legacy_import_control` was the only entry; it was deleted with the Google
// import compatibility surface and its five tables.
export const NON_FK_UNREFERENCEABLE_CANDIDATES = Object.freeze(
  [] satisfies ReadonlyArray<NonFkUnreferenceableCandidate>,
)

/**
 * Contraction candidates whose rows carry a surrogate `id`. Any of those ids
 * can appear as text in an aggregate identifier or inside a jsonb document, so
 * these are the referents of the blanket probes.
 *
 * The list is explicit rather than derived as "every candidate that is not
 * exempt". A derived list would silently absorb a new contraction candidate and
 * report it as covered without anyone deciding anything; an explicit list forces
 * the decision.
 */
export const NON_FK_SURROGATE_IDENTIFIED_CANDIDATES = Object.freeze([
  'badge_awards',
  'badge_definition_versions',
  'badge_definitions',
  'feedback',
  'goal_progress',
  'goals',
  'leaderboard_entries',
  'leaderboard_snapshots',
  'organization_badge_enablements',
  'portal_group_members',
  'property_access_grants',
  'ratings',
  'recognition_activation_groups',
  'recognition_activations',
  'recognition_award_status_facts',
  'recognition_awards',
  'recognition_board_entries',
  'recognition_board_snapshots',
  'recognition_reconciliation_events',
  'scan_events',
  'staff_assignments',
  'team_memberships',
  'team_portal_group_scopes',
  'teams',
] as const)

export type NonFkProbe = Readonly<{
  surface: NonFkReferenceSurface
  referentTable: string
  /** Identifier column of the referenced candidate table. */
  referentIdentifierColumn: 'id'
  /** Resource-type token for pair probes; null otherwise. */
  discriminator: string | null
}>

const EXEMPT_TABLES = new Set<string>(
  NON_FK_UNREFERENCEABLE_CANDIDATES.map(({ tableName }) => tableName),
)

const SURROGATE_TABLES = new Set<string>(NON_FK_SURROGATE_IDENTIFIED_CANDIDATES)

/**
 * The probes that must run before a given candidate table can be contracted.
 * An exempt candidate resolves to none — deliberately, and only because the
 * exemption above states why nothing can reference it.
 */
export function resolveNonFkProbes(
  referentTable: string,
  candidateTables: readonly string[],
): readonly NonFkProbe[] {
  if (EXEMPT_TABLES.has(referentTable)) return []
  if (!candidateTables.includes(referentTable)) return []

  const token = ACTIVITY_RESOURCE_REFERENTS.find(
    (referent) => referent.tableName === referentTable,
  )?.token

  return NON_FK_REFERENCE_SURFACES.flatMap((surface) => {
    const probe = (discriminator: string | null): NonFkProbe =>
      Object.freeze({
        surface,
        referentTable,
        referentIdentifierColumn: 'id' as const,
        discriminator,
      })
    if (surface.referentScope === 'declared') {
      const declared: readonly string[] = surface.declaredReferents
      return declared.includes(referentTable) ? [probe(null)] : []
    }
    if (surface.referentScope === 'activity_vocabulary') {
      return token ? [probe(token)] : []
    }
    return SURROGATE_TABLES.has(referentTable) ? [probe(null)] : []
  })
}

export type NonFkReferenceCoverage = Readonly<{
  probed: readonly string[]
  exempted: readonly string[]
  uncovered: readonly string[]
  exemptedAndProbed: readonly string[]
  unknownExemptions: readonly string[]
  /** Declared surrogate referents that are not contraction candidates. */
  unknownSurrogateCandidates: readonly string[]
  complete: boolean
}>

const sorted = (values: Iterable<string>): readonly string[] => [...values].sort()

export function nonFkReferenceCoverage(
  candidateTables: readonly string[],
): NonFkReferenceCoverage {
  const probed = candidateTables.filter(
    (tableName) => resolveNonFkProbes(tableName, candidateTables).length > 0,
  )
  const exempted = candidateTables.filter((tableName) => EXEMPT_TABLES.has(tableName))
  const uncovered = candidateTables.filter(
    (tableName) => !EXEMPT_TABLES.has(tableName) && !probed.includes(tableName),
  )
  const unknownExemptions = [...EXEMPT_TABLES].filter(
    (tableName) => !candidateTables.includes(tableName),
  )
  const exemptedAndProbed = probed.filter((tableName) => EXEMPT_TABLES.has(tableName))
  const unknownSurrogateCandidates = [...SURROGATE_TABLES].filter(
    (tableName) => !candidateTables.includes(tableName),
  )

  return Object.freeze({
    probed: sorted(probed),
    exempted: sorted(exempted),
    uncovered: sorted(uncovered),
    exemptedAndProbed: sorted(exemptedAndProbed),
    unknownExemptions: sorted(unknownExemptions),
    unknownSurrogateCandidates: sorted(unknownSurrogateCandidates),
    complete:
      uncovered.length === 0 &&
      exemptedAndProbed.length === 0 &&
      unknownExemptions.length === 0 &&
      unknownSurrogateCandidates.length === 0,
  })
}

export type NonFkProbeResult = Readonly<{
  surfaceId: string
  referenceCount: number
}>

export type NonFkReferenceScanInput = Readonly<{
  /** The operator's explicit `--as-of` observation time. */
  evaluatedAt: Date
  tables: ReadonlyArray<
    Readonly<{ tableName: string; probes: ReadonlyArray<NonFkProbeResult> }>
  >
}>

export type NonFkReferenceScanReport = Readonly<{
  version: 'non-fk-reference-scan-v1'
  evaluatedAt: string
  tableCount: number
  totalReferences: number
  tables: ReadonlyArray<
    Readonly<{
      tableName: string
      totalReferences: number
      probes: ReadonlyArray<
        Readonly<{
          surfaceId: string
          surfaceTable: string
          columns: readonly string[]
          kind: NonFkProbeKind
          referenceCount: number
        }>
      >
    }>
  >
  blockers: ReadonlyArray<'non_fk_references_require_disposition'>
  fingerprint: string
}>

const SURFACES_BY_ID = new Map<string, NonFkReferenceSurface>(
  NON_FK_REFERENCE_SURFACES.map((surface) => [surface.id, surface]),
)

/**
 * Builds the scan evidence. Counts and column identifiers only: the referenced
 * identifier values are never carried, so the artifact says how much still
 * points at a candidate without naming a single row.
 */
export function buildNonFkReferenceScanReport(
  input: NonFkReferenceScanInput,
): NonFkReferenceScanReport {
  if (!Number.isSafeInteger(input.evaluatedAt.getTime())) {
    throw new Error('non_fk_reference_time_invalid')
  }

  const tables = input.tables.map(({ tableName, probes }) => {
    const seen = new Set<string>()
    const resolved = probes.map(({ surfaceId, referenceCount }) => {
      const surface = SURFACES_BY_ID.get(surfaceId)
      if (!surface) throw new Error('non_fk_reference_surface_unknown')
      if (seen.has(surfaceId)) throw new Error('non_fk_reference_surface_duplicated')
      seen.add(surfaceId)
      if (!Number.isSafeInteger(referenceCount) || referenceCount < 0) {
        throw new Error('non_fk_reference_count_invalid')
      }
      return {
        surfaceId,
        surfaceTable: surface.table,
        columns: surface.columns,
        kind: surface.kind,
        referenceCount,
      }
    })
    return {
      tableName,
      totalReferences: resolved.reduce(
        (total, { referenceCount }) => total + referenceCount,
        0,
      ),
      probes: resolved,
    }
  })

  const totalReferences = tables.reduce(
    (total, { totalReferences: subtotal }) => total + subtotal,
    0,
  )
  if (!Number.isSafeInteger(totalReferences)) {
    throw new Error('non_fk_reference_count_invalid')
  }

  const evidence = {
    version: 'non-fk-reference-scan-v1' as const,
    evaluatedAt: input.evaluatedAt.toISOString(),
    tableCount: tables.length,
    totalReferences,
    tables,
    blockers:
      totalReferences > 0
        ? (['non_fk_references_require_disposition'] as const)
        : ([] as const),
  }
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(evidence), 'utf8')
    .digest('hex')
  return Object.freeze({ ...evidence, fingerprint })
}

export function canonicalNonFkReferenceScanReport(
  report: NonFkReferenceScanReport,
): string {
  return JSON.stringify(report, null, 2)
}
