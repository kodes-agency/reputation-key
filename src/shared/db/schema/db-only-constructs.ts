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
]
