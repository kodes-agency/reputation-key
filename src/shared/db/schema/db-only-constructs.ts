// Register of intentional DB-only constructs (BQC-5.4).
//
// The migration SQL track is the schema authority (see ../CONTEXT.md). Most
// constructs are ALSO declared in the Drizzle model so the semantic drift
// test (../schema-drift.ts) can verify them against pg_catalog. The objects
// listed here are the ones the Drizzle model deliberately does NOT own —
// either because drizzle-orm 0.45 has no DSL for them (CREATE FUNCTION /
// CREATE TRIGGER) or because they sit on Better Auth–owned tables where two
// migrators must not share DDL ownership.
//
// Rules (enforced both directions by the drift test):
//   - every entry here is verified to EXIST in pg_catalog;
//   - every trigger/function found in pg_catalog must appear here;
//   - entries here are exempt from model-vs-catalog comparison.
//
// To add one: append an entry with an explicit owner + reason, land it via a
// journaled migration (or a registered deploy sidecar applied after
// `pnpm db:migrate`), and keep the entry in sync if the object is dropped.

export type DbOnlyConstructKind =
  | 'trigger'
  | 'function'
  | 'index'
  | 'expression-index'
  | 'partial-index'
  | 'check'
  | 'enum'
  | 'index-direction'
  | 'other'

export type DbOnlyConstruct = Readonly<{
  /** Exact object name as it appears in pg_catalog. */
  name: string
  kind: DbOnlyConstructKind
  /** Owning context (or 'identity' / 'shared'). */
  owner: string
  /** Migration or sidecar path that creates the object. */
  source: string
  /** Why the Drizzle model does not own this construct. */
  reason: string
}>

const DAC_TRIGGERS_SIDECAR =
  'scripts/migrations/2026-07-06-permission-version-triggers.sql'
const NO_TRIGGER_DSL = 'drizzle-orm 0.45 has no CREATE FUNCTION/TRIGGER DSL'

export const DB_ONLY_CONSTRUCTS: readonly DbOnlyConstruct[] = [
  {
    name: 'organization_role_org_role_lower_unique',
    kind: 'expression-index',
    owner: 'identity',
    source: DAC_TRIGGERS_SIDECAR,
    reason:
      'Unique index on Better Auth–owned "organizationRole" (organizationId, lower(role)); ' +
      'two migrators cannot share DDL ownership and drizzle-kit must not manage BA tables.',
  },
  {
    name: 'bump_permission_version',
    kind: 'function',
    owner: 'identity',
    source: DAC_TRIGGERS_SIDECAR,
    reason: `${NO_TRIGGER_DSL}; upsert helper for the permission_version counter.`,
  },
  {
    name: 'tgr_bump_perm_ba',
    kind: 'function',
    owner: 'identity',
    source: DAC_TRIGGERS_SIDECAR,
    reason: `${NO_TRIGGER_DSL}; AFTER-row trigger fn for BA-owned tables (camelCase "organizationId").`,
  },
  {
    name: 'tgr_bump_perm_app',
    kind: 'function',
    owner: 'identity',
    source: DAC_TRIGGERS_SIDECAR,
    reason: `${NO_TRIGGER_DSL}; AFTER-row trigger fn for app-owned tables (snake_case organization_id).`,
  },
  {
    name: 'guard_last_owner',
    kind: 'function',
    owner: 'identity',
    source: DAC_TRIGGERS_SIDECAR,
    reason: `${NO_TRIGGER_DSL}; last-owner backstop for direct-DB writes to member.`,
  },
  {
    name: 'member_perm_ver_ins',
    kind: 'trigger',
    owner: 'identity',
    source: DAC_TRIGGERS_SIDECAR,
    reason: NO_TRIGGER_DSL,
  },
  {
    name: 'member_perm_ver_del',
    kind: 'trigger',
    owner: 'identity',
    source: DAC_TRIGGERS_SIDECAR,
    reason: NO_TRIGGER_DSL,
  },
  {
    name: 'member_perm_ver_upd',
    kind: 'trigger',
    owner: 'identity',
    source: DAC_TRIGGERS_SIDECAR,
    reason: NO_TRIGGER_DSL,
  },
  {
    name: 'organization_role_perm_ver_iud',
    kind: 'trigger',
    owner: 'identity',
    source: DAC_TRIGGERS_SIDECAR,
    reason: NO_TRIGGER_DSL,
  },
  {
    name: 'organization_role_policy_perm_ver_iud',
    kind: 'trigger',
    owner: 'identity',
    source: DAC_TRIGGERS_SIDECAR,
    reason: NO_TRIGGER_DSL,
  },
  {
    name: 'staff_assignments_perm_ver_iud',
    kind: 'trigger',
    owner: 'identity',
    source: DAC_TRIGGERS_SIDECAR,
    reason: NO_TRIGGER_DSL,
  },
  {
    name: 'member_last_owner_del',
    kind: 'trigger',
    owner: 'identity',
    source: DAC_TRIGGERS_SIDECAR,
    reason: NO_TRIGGER_DSL,
  },
  {
    name: 'member_last_owner_upd',
    kind: 'trigger',
    owner: 'identity',
    source: DAC_TRIGGERS_SIDECAR,
    reason: NO_TRIGGER_DSL,
  },
  {
    name: 'tm_no_overlapping_participation_intervals',
    kind: 'index',
    owner: 'team',
    source: 'drizzle/0020_people-team-expansion.sql',
    reason:
      'Backing index for an EXCLUDE USING gist constraint; Drizzle has no exclusion-constraint DSL.',
  },
  {
    name: 'pr_no_overlapping_responsibility_intervals',
    kind: 'index',
    owner: 'staff',
    source: 'drizzle/0020_people-team-expansion.sql',
    reason:
      'Backing index for an EXCLUDE USING gist constraint; Drizzle has no exclusion-constraint DSL.',
  },
  {
    name: 'tpgs_no_overlapping_scope_intervals',
    kind: 'index',
    owner: 'team',
    source: 'drizzle/0020_people-team-expansion.sql',
    reason:
      'Backing index for an EXCLUDE USING gist constraint; Drizzle has no exclusion-constraint DSL.',
  },
  {
    name: 'pgm_no_overlapping_portal_intervals',
    kind: 'index',
    owner: 'portal',
    source: 'drizzle/0020_people-team-expansion.sql',
    reason:
      'Backing index for an EXCLUDE USING gist constraint; Drizzle has no exclusion-constraint DSL.',
  },
  {
    name: 'reject_goal_immutable_update',
    kind: 'function',
    owner: 'goal',
    source: 'drizzle/0024_goal-versioning.sql',
    reason: `${NO_TRIGGER_DSL}; rejects updates and deletes on governed goal facts.`,
  },
  {
    name: 'goal_definition_versions_immutable',
    kind: 'trigger',
    owner: 'goal',
    source: 'drizzle/0024_goal-versioning.sql',
    reason: NO_TRIGGER_DSL,
  },
  {
    name: 'goal_evaluations_immutable',
    kind: 'trigger',
    owner: 'goal',
    source: 'drizzle/0024_goal-versioning.sql',
    reason: NO_TRIGGER_DSL,
  },
  {
    name: 'reject_recognition_immutable_mutation',
    kind: 'function',
    owner: 'recognition',
    source: 'drizzle/0025_recognition-governance.sql',
    reason: `${NO_TRIGGER_DSL}; rejects updates and deletes on governed recognition facts.`,
  },
  {
    name: 'recognition_board_snapshots_append_only',
    kind: 'trigger',
    owner: 'recognition',
    source: 'drizzle/0025_recognition-governance.sql',
    reason: NO_TRIGGER_DSL,
  },
  {
    name: 'recognition_board_entries_append_only',
    kind: 'trigger',
    owner: 'recognition',
    source: 'drizzle/0025_recognition-governance.sql',
    reason: NO_TRIGGER_DSL,
  },
  {
    name: 'recognition_reconciliation_events_append_only',
    kind: 'trigger',
    owner: 'recognition',
    source: 'drizzle/0025_recognition-governance.sql',
    reason: NO_TRIGGER_DSL,
  },
  {
    name: 'badge_definition_versions_append_only',
    kind: 'trigger',
    owner: 'recognition',
    source: 'drizzle/0025_recognition-governance.sql',
    reason: NO_TRIGGER_DSL,
  },
  {
    name: 'recognition_awards_append_only',
    kind: 'trigger',
    owner: 'recognition',
    source: 'drizzle/0025_recognition-governance.sql',
    reason: NO_TRIGGER_DSL,
  },
  {
    name: 'recognition_award_status_facts_append_only',
    kind: 'trigger',
    owner: 'recognition',
    source: 'drizzle/0025_recognition-governance.sql',
    reason: NO_TRIGGER_DSL,
  },
  {
    name: 'reject_capability_compliance_approval_mutation',
    kind: 'function',
    owner: 'identity',
    source: 'drizzle/0029_google-content-control.sql',
    reason: `${NO_TRIGGER_DSL}; rejects in-place mutation of signed approval bindings.`,
  },
  {
    name: 'capability_compliance_approvals_append_only',
    kind: 'trigger',
    owner: 'identity',
    source: 'drizzle/0029_google-content-control.sql',
    reason: NO_TRIGGER_DSL,
  },
]
