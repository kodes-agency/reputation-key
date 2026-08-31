// Exact FND-03 mutation dispositions for operator-command catalogue rows.
//
// This module intentionally does not import entry-point-catalogue.ts. The
// catalogue consumes this classifier, while its guard test compares the exact
// reviewed names with the mechanically assembled operator rows. Unknown names
// return undefined so the catalogue's debt fallback remains fail-closed.

export type OperatorCommandMutationClassification =
  | Readonly<{ kind: 'read_only' }>
  | Readonly<{
      kind: 'mutation'
      stateOwner: 'operations'
      disposition:
        'atomic_state_and_fact' | 'local_only_with_reason' | 'non_atomic_defect'
      reason: string
    }>

type MutatingOperatorCommandDisposition = Extract<
  OperatorCommandMutationClassification,
  { kind: 'mutation' }
>['disposition']

const READ_ONLY = Object.freeze({ kind: 'read_only' as const })

function mutation(
  disposition: MutatingOperatorCommandDisposition,
  reason: string,
): OperatorCommandMutationClassification {
  return Object.freeze({
    kind: 'mutation' as const,
    stateOwner: 'operations' as const,
    disposition,
    reason,
  })
}

const PURE_DIAGNOSTIC_COMMANDS = [
  'scripts/audit-member-roles.ts',
  'scripts/audit-user-organization-bindings.ts',
  'scripts/check-db.ts',
  'scripts/check-schema-drift.ts',
  'scripts/check-component-boundaries.mjs',
  'scripts/check-architecture-boundary-controls.mjs',
  'scripts/check-bundle-budget.mjs',
  'scripts/check-google-import-artifacts.mjs',
  'scripts/check-production-artifacts.mjs',
  'scripts/check-ai-contract-attestations.ts',
  'scripts/verify-ai-egress-gateway-bundle.mjs',
  'scripts/verify-ai-execution-admission-bundle.mjs',
  'scripts/verify-ai-gateway-runtime-assets.ts',
  'scripts/verify-ai-runtime-image.mjs',
  'scripts/verify-google-runtime-bundle.mjs',
  'scripts/check-google-provider-identifiers.mjs',
  'scripts/ai-language-attestation.ts',
  'scripts/check-changed-code.mjs',
  'scripts/local-doctor.mjs',
  'scripts/check-filenames.mjs',
  'scripts/check-security-headers.mjs',
  'scripts/check-runtime-language-verifier.mjs',
  'scripts/check-test-quality.mjs',
  'scripts/check-dependency-audit.mjs',
  'scripts/check-licenses.mjs',
  'scripts/check-action-pins.mjs',
  'scripts/ci/check-container-image-policy.ts',
  'scripts/ci/check-technology-stack.ts',
  'scripts/ci/check-typescript-project-coverage.ts',
  'scripts/ci/check-product-state-consistency.ts',
  // `pnpm gate <id>` mutates nothing of its own: it reads the gate policy
  // registry and either skips, or spawns the gate's own declared command and
  // returns its exit code. Read-only is accurate as long as every registered
  // gate is itself a check — which is true today and is the registry's whole
  // purpose. A registry entry whose command mutates state would need
  // reclassifying here, not silently inheriting this one.
  'scripts/ci/gate.ts',
  'scripts/review/baseline-inventory.ts',
  'scripts/review/tracked-artifact.ts',
  'scripts/review/comprehensive-program-status.ts',
  'scripts/review/finding-revalidation.ts',
  'scripts/review/finding-revalidation-fragment.ts',
  'scripts/review/legal-document-registry.ts',
  'scripts/review/reachability-proof.ts',
  'scripts/ops/report-inbox-handling-cutover.ts',
  'scripts/ops/report-legacy-custom-roles.ts',
  'scripts/ops/report-legacy-multi-org.ts',
  'scripts/ops/report-legacy-guest-compatibility.ts',
  'scripts/ops/report-legacy-rollups.ts',
  'scripts/ops/report-legacy-import-control.ts',
  'scripts/ops/report-compatibility-read-surfaces.ts',
  'scripts/ops/report-non-fk-references.ts',
  'scripts/release/observe-canary-window.ts',
  'scripts/release/run-deployed-critical-journeys.ts',
  'scripts/release/rehearse-recovery.ts',
  'scripts/release/create-legal-revision-set.ts',
  'scripts/release/freeze-release-candidate.ts',
  'scripts/release/capture-promotion-readback.ts',
  'scripts/release/import-live-evidence.ts',
  'scripts/release/prepare-gate-f-approval.ts',
  'scripts/review/pre-fix-oracles.ts',
  'scripts/review/zod-v4-conformance.ts',
  'scripts/simulation-invocation.ts',
  'scripts/google-import-final-schema-probe.ts',
  'scripts/verify-auth-schema.mjs',
  'scripts/release/validate-bundle.ts',
  'scripts/release/iac-digest.ts',
  'scripts/release/release-authority-digest.ts',
  'scripts/release/staged-railway-sources.ts',
  'scripts/release/railway-data-cell-plan.ts',
  'scripts/beta/verify-gate-evidence.ts',
] as const

const AUDIT_ONLY_OPERATOR_COMMANDS = [
  'scripts/ops/operator-command.ts',
  'scripts/ops/report-guest-response-readiness.ts',
  'scripts/ops/report-organization-lifecycle.ts',
  'scripts/ops/report-legacy-goals.ts',
  'scripts/ops/report-legacy-people-team.ts',
  'scripts/ops/report-legacy-recognition.ts',
  'scripts/ops/report-people-authority.ts',
  'scripts/ops/report-portal-access-artifacts.ts',
  'scripts/ops/report-portal-beta-readiness.ts',
  'scripts/ops/inspect-decision.ts',
  'scripts/ops/restore-preflight.ts',
] as const

const QUEUE_AND_PROJECTION_OPERATOR_COMMANDS = [
  'scripts/ops/queue-quarantine.ts',
  'scripts/ops/quarantine-redrive.ts',
  'scripts/ops/rebuild-projection.ts',
  'scripts/ops/rebuild-metric-projection.ts',
  'scripts/ops/enqueue-refresh.ts',
  'scripts/ops/enqueue-purge.ts',
] as const

const MIGRATION_AND_REPAIR_OPERATOR_COMMANDS = [
  'scripts/ops/manage-dormant-billing-data.ts',
  'scripts/ops/reconcile-staff-grants.ts',
  'scripts/ops/reconcile-regions.ts',
  'scripts/ops/cutover-single-us-data-cell.ts',
  'scripts/ops/reconcile-people-team.ts',
  'scripts/ops/property-erase.ts',
  'scripts/ops/privacy-request.ts',
  'scripts/ops/repair-partial-offboarding.ts',
  'scripts/ops/property-capabilities.ts',
  'scripts/ops/reparse-review-translations.ts',
  'scripts/ops/restore-verify.ts',
  'scripts/ops/identity-invitation-fact-contract.ts',
  'scripts/ops/permit-start-deadline-backfill.ts',
  'scripts/ops/recover-recent-activity.ts',
  'scripts/ops/reconcile-recent-activity-vocabulary.ts',
] as const

const PROVIDER_AND_ROLE_CONFIGURATION_COMMANDS = [
  'scripts/ops/gbp-subscribe.ts',
  'scripts/ops/provision-google-admission-role.ts',
  'scripts/local-stack/provision-ai-admission-role.ts',
] as const

const FILESYSTEM_ARTIFACT_COMMANDS = [
  'scripts/generate-ai-governance-artifacts.ts',
  'scripts/generate-ai-language-script-table.ts',
  'scripts/generate-ai-reply-language-profile.ts',
  'scripts/generate-ai-review-language-profile.ts',
  'scripts/generate-ai-review-language-regions.ts',
  'scripts/generate-ai-zh-orthography-table.ts',
  'scripts/generate-ai-unicode-case-folding.ts',
  'scripts/generate-google-provider-fixtures.ts',
  'scripts/generate-google-ai-policy-clarification.py',
  'scripts/check-coverage.mjs',
  'scripts/review/freeze-baseline.ts',
  'scripts/perf/write-scale-evidence.ts',
  'scripts/release/promote-local-evidence.ts',
  'scripts/release/create-promotion-manifest.ts',
  'scripts/ci/check-runtime-environment-contract.ts',
  'db:generate',
  'db:pull',
] as const

const FIXTURE_AND_ACCEPTANCE_COMMANDS = [
  'scripts/cleanup-all.ts',
  'scripts/cleanup-kodes.ts',
  'scripts/seed.ts',
  'scripts/seed-e2e-user.ts',
  'scripts/seed-demo-reviews.ts',
  'scripts/simulate.ts',
  'scripts/test-db-setup.ts',
  'scripts/bqc/run-baseline.ts',
  'scripts/local-stack/stack.ts',
  'scripts/local-stack/google-import-release-drill.ts',
  'scripts/local-stack/fault-operation.ts',
  'scripts/beta/smoke.ts',
  'scripts/beta/command-runner.ts',
  'scripts/beta/create-pre-cutover-dump.ts',
  'scripts/beta/run-product-journeys.ts',
  'scripts/perf/load-test.ts',
  'scripts/perf/seed-scale.ts',
  'scripts/perf/seed-fleet.ts',
  'scripts/perf/staging-cell.ts',
  'scripts/perf/cell-stub-server.ts',
] as const

const SCHEMA_AND_COMPATIBILITY_COMMANDS = [
  'scripts/migrate-drizzle.ts',
  'scripts/migrate-deploy.ts',
  'scripts/better-auth-schema.ts',
  'scripts/google-property-binding-index.ts',
  'scripts/migrations/null-inbox-source-copies.ts',
  'scripts/migrations/0000-auth-tables-bootstrap.sql',
  'scripts/migrations/2026-07-06-permission-version-triggers.sql',
  'scripts/migrations/add-materialized-views-and-gbp-index.sql',
  'scripts/migrations/google-import-contract.sql',
  'scripts/migrations/verify-existing-emails.sql',
  'scripts/migrations/add-org-id-to-goal-progress.sql',
  'scripts/migrations/fix-goal-progress-org-id-notnull.sql',
  'scripts/migrations/denormalize-inbox-reviewer-name.sql',
  'scripts/migrations/create-missing-tables.sql',
  'scripts/migrations/fix-portal-schema-sync.sql',
  'scripts/migrations/add-missing-indexes.sql',
  'scripts/migrations/add-goals-parent-period-uniq.sql',
  'scripts/migrations/add-reply-unique-index.sql',
  'scripts/migrations/add-invitation-property-ids.sql',
  'scripts/migrations/add-response-sla-hours.sql',
  'db:migrate',
  'db:push',
] as const

const RELEASE_ORCHESTRATION_COMMANDS = [
  'scripts/release/railway-data-cell-domain.ts',
  'scripts/release/railway-data-cell-foundation.ts',
  'scripts/release/railway-google-content-approval-activation.ts',
  'scripts/release/bootstrap-schema-migrator.ts',
  'scripts/release/deploy-beta.ts',
] as const

const ATOMIC_COMMAND_STORE_COMMANDS = [
  'scripts/ops/reconcile-publication.ts',
  'scripts/ops/disconnect-connection.ts',
  'scripts/ops/google-content-approval.ts',
  'scripts/ops/google-content-approval-sign.ts',
  'scripts/ops/google-import-lifecycle.ts',
  'scripts/ops/google-credential-home-backfill.ts',
  'scripts/ops/google-credential-routing-publish.ts',
  'scripts/ops/ai-canary-authorization.ts',
  'scripts/ops/ai-execution-control.ts',
  'scripts/ops/ai-approve-enrollment.ts',
  'scripts/ops/ai-reanalyze-reviews.ts',
  'scripts/ops/property-suspension.ts',
  'scripts/ops/triage-beta-feedback.ts',
] as const

const classifications = new Map<string, OperatorCommandMutationClassification>()

function registerExact(
  names: readonly string[],
  classification: OperatorCommandMutationClassification,
): void {
  for (const name of names) {
    if (classifications.has(name)) {
      throw new Error(`Duplicate operator-command mutation classification: ${name}`)
    }
    classifications.set(name, classification)
  }
}

registerExact(PURE_DIAGNOSTIC_COMMANDS, READ_ONLY)
registerExact(
  AUDIT_ONLY_OPERATOR_COMMANDS,
  mutation(
    'local_only_with_reason',
    'The report or harness only reads product authority, but every evaluated operator invocation persists a content-free policy-decision audit row; that audit is local operational evidence and requires no new cross-context domain fact.',
  ),
)
registerExact(
  QUEUE_AND_PROJECTION_OPERATOR_COMMANDS,
  mutation(
    'local_only_with_reason',
    'The command changes only BullMQ admission/quarantine metadata or an idempotent Inbox/anonymous Metric projection rebuilt from authoritative source facts; the queued job or source context owns any later product transition and fact.',
  ),
)
registerExact(
  MIGRATION_AND_REPAIR_OPERATOR_COMMANDS,
  mutation(
    'local_only_with_reason',
    'The command performs a bounded, idempotent compatibility, recovery, or authority-repair transition whose row provenance, version, or migration evidence is the complete local contract; it does not introduce a new cross-context business fact.',
  ),
)
registerExact(
  PROVIDER_AND_ROLE_CONFIGURATION_COMMANDS,
  mutation(
    'local_only_with_reason',
    'The command configures an idempotent provider subscription or a least-privilege database execution role; this is external or database operational configuration rather than product domain state and needs no domain fact.',
  ),
)
registerExact(
  FILESYSTEM_ARTIFACT_COMMANDS,
  mutation(
    'local_only_with_reason',
    'The command deterministically writes repository-local generated, coverage, review, or release-evidence artifacts; it does not change product authority and therefore requires no durable cross-context domain fact.',
  ),
)
registerExact(
  FIXTURE_AND_ACCEPTANCE_COMMANDS,
  mutation(
    'local_only_with_reason',
    'The command creates, changes, or removes disposable development, test, simulation, or performance-cell fixtures and evidence; those operational fixtures are not product transitions and have no production domain-fact contract.',
  ),
)
registerExact(
  SCHEMA_AND_COMPATIBILITY_COMMANDS,
  mutation(
    'local_only_with_reason',
    'The command owns schema, index, authentication-table, or compatibility-backfill convergence; migration history and the resulting catalog are its authority, and no cross-context product domain fact is required.',
  ),
)
registerExact(
  RELEASE_ORCHESTRATION_COMMANDS,
  mutation(
    'local_only_with_reason',
    'The command changes external Railway deployment state under signed release and settlement controls; it does not mutate product domain state, so no cross-context domain fact accompanies the operational rollout.',
  ),
)
registerExact(
  ATOMIC_COMMAND_STORE_COMMANDS,
  mutation(
    'atomic_state_and_fact',
    'Every product mutation path delegates to a fenced transactional command authority that co-commits its authoritative head/state and required append-only history or outbox fact; non-product artifact or compatibility branches remain local-only.',
  ),
)
export const REVIEWED_OPERATOR_COMMAND_NAMES: readonly string[] = Object.freeze(
  [...classifications.keys()].sort(),
)

export function classifyOperatorCommandMutation(
  name: string,
): OperatorCommandMutationClassification | undefined {
  return classifications.get(name)
}
