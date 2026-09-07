// ops:restore-verify command core (BQC-7.8) — the restore drill's
// verification step, run INSIDE the isolated restored environment before
// cutover (runbook §8, docs/operations/backup-and-lifecycle.md).
//
// Restored environments must boot isolated, enforce current retention, and
// revoke any authority/effect intent resurrected by PITR. This command is the
// bounded reconciliation + durable recovery-generation proof:
//
//   1. Hard gates (both refuse BEFORE any work):
//      - RESTORE_MODE=isolated must be set in the command's own env — the
//        drill posture (web capabilities deny fail-closed; the worker refuses
//        to boot) must be active on the environment being verified;
//      - DATABASE_URL must be an attested local target or the exact private
//        hostname of a Railway PITR sibling — a recovery fence never runs
//        against the live source database or a public proxy.
//   2. Dry-run (default): reports retention/import backlog and every restored
//      authentication/external-effect authority class.
//   3. --apply: only when a separately reviewed Review cutover executor is
//      injected, runs review purge, Google-import lifecycle, and the static
//      retention registry IN-PROCESS (never BullMQ), then atomically rotates
//      the recovery generation and fences restored authority/outbox work.
//      Normal composition is inspection-only and refuses before mutation.
//   4. Re-scans and proves every bounded backlog/authority count is zero.
//   5. Prints retention + recovery evidence and the controlled cutover rules.
//
// The module is purge-agnostic by injection (fallow boundary: the shared
// zone cannot import the review context) — scripts/ops/restore-verify.ts
// wires the real repositories; the integration test wires the same against
// the scratch database.

import {
  isIsolatedRestoreTarget,
  isRestoreIsolated,
  RESTORE_ISOLATED_LOG_LINE,
} from '#/shared/config/restore-mode'
import type { OperatorCommandSpec, OperatorContext, OperatorIO } from './operator-command'
import type {
  RecoveryFenceInput,
  RecoveryFenceInventory,
  RecoveryFenceResult,
} from './recovery-fence'

/** The retention_runs subject the source-policy purge evidence lands under. */
export const RESTORE_VERIFY_PURGE_SUBJECT = 'reviews.purge' as const

const RESTORE_VERIFY_USAGE =
  'pnpm ops:restore-verify --operator <id> [--reason <text> --apply --yes ops:restore-verify]'

/**
 * The harness spec. Deliberately declares NO capability: in restore-isolated
 * mode every capability denies fail-closed, and this containment/verification
 * command must still run (same rationale as the retention target of
 * ops:purge — lifecycle safety is not a product capability).
 */
export const RESTORE_VERIFY_SPEC: OperatorCommandSpec = {
  name: 'ops:restore-verify',
  scope: 'global',
  mutation: true,
  destructive: true,
  usage: RESTORE_VERIFY_USAGE,
}

export type RestoreVerifyEvidenceRow = Readonly<{
  subject: string
  rowsDeleted: number
  outcome: string
  startedAt: string
}>

export type RestoreReviewLifecycleAuthority =
  | Readonly<{
      kind: 'inspection_only'
      reason: 'reviewed_cutover_authority_required'
      /** Produce the immutable aggregate-only request for independent review. */
      prepare: (target: RestoreReviewLifecycleRuntimeTarget) => Promise<
        Readonly<{
          requestContent: string
          requestSha256: string
          reportContent: string
          reportSha256: string
          expired: number
        }>
      >
    }>
  | Readonly<{
      kind: 'reviewed_apply'
      /** Authenticate, re-report, and reserve the immutable one-shot authority. */
      admit: (target: RestoreReviewLifecycleRuntimeTarget) => Promise<
        Readonly<{
          recoveryInput: RecoveryFenceInput
          expired: number
          approvalId: string
          approvalBundleSha256: string
          reportSha256: string
          applyReviewLifecycle: () => Promise<void>
          complete: (result: RecoveryFenceResult) => Promise<void>
        }>
      >
    }>

export type RestoreReviewLifecycleRuntimeTarget = Readonly<{
  releaseSha: string
  releaseManifestSha256: string
  restorePointAt: Date
  restoreDatabaseServiceName: string
  railwayProjectId: string | null
  railwayEnvironmentId: string | null
  operatorId: string
  correlationId: string
}>

export type RestoreVerifyDeps = Readonly<{
  /** The command's own env (RESTORE_MODE + DATABASE_URL are gate-checked). */
  env: Readonly<{
    RESTORE_MODE?: string
    DATABASE_URL: string
    RESTORE_POINT_AT?: string
    RELEASE_SHA?: string
    RELEASE_MANIFEST_SHA256?: string
    RESTORE_DATABASE_SERVICE_NAME?: string
    RAILWAY_PROJECT_ID?: string
    RAILWAY_ENVIRONMENT_ID?: string
    RAILWAY_ENVIRONMENT_NAME?: string
  }>
  /** Normal composition injects inspection_only; it can never masquerade as apply. */
  reviewLifecycle: RestoreReviewLifecycleAuthority
  /** Review-owned report count of active source-content rows due for expiry. */
  countExpired: () => Promise<number>
  /** The latest purge evidence rows (retention_runs, newest first). */
  purgeEvidence: () => Promise<ReadonlyArray<RestoreVerifyEvidenceRow>>
  /** Bounded Google import lifecycle backlog in the restored database. */
  inspectGoogleImportLifecycle: () => Promise<
    Readonly<{
      expiredItems: number
      purgeCandidates: number
      unreleasedExpiredReceipts: number
    }>
  >
  /** Receipt-first expiry/purge/release lifecycle, with retention evidence. */
  sweepGoogleImportLifecycle: () => Promise<void>
  /** Content-free counts for every static retention-registry rule. */
  inspectRetentionBacklog: () => Promise<Readonly<Record<string, number>>>
  /** Run one bounded, evidence-writing pass over the static retention registry. */
  sweepRetentionBacklog: () => Promise<void>
  /** Content-free inventory of restored auth and external-effect authority. */
  inspectRecoveryFence: () => Promise<RecoveryFenceInventory>
  /** Atomically rotate and apply the recovery generation. */
  applyRecoveryFence: (input: RecoveryFenceInput) => Promise<RecoveryFenceResult>
}>

function recoveryInput(
  ctx: OperatorContext,
  env: RestoreVerifyDeps['env'],
): RestoreReviewLifecycleRuntimeTarget | string {
  if (!/^[0-9a-f]{40}$/u.test(env.RELEASE_SHA ?? '')) {
    return 'REFUSED: RELEASE_SHA must identify the 40-character source revision restored.'
  }
  if (!/^[0-9a-f]{64}$/u.test(env.RELEASE_MANIFEST_SHA256 ?? '')) {
    return 'REFUSED: RELEASE_MANIFEST_SHA256 must identify the signed source release.'
  }
  if (!env.RESTORE_POINT_AT) {
    return 'REFUSED: RESTORE_POINT_AT is required and must be the exact provider restore point.'
  }
  const restorePointAt = new Date(env.RESTORE_POINT_AT)
  if (Number.isNaN(restorePointAt.getTime())) {
    return 'REFUSED: RESTORE_POINT_AT must be a valid ISO-8601 instant.'
  }
  if (!env.RESTORE_DATABASE_SERVICE_NAME) {
    return 'REFUSED: RESTORE_DATABASE_SERVICE_NAME must identify the exact PITR sibling.'
  }
  return {
    releaseSha: env.RELEASE_SHA as string,
    releaseManifestSha256: env.RELEASE_MANIFEST_SHA256 as string,
    restorePointAt,
    restoreDatabaseServiceName: env.RESTORE_DATABASE_SERVICE_NAME,
    railwayProjectId: env.RAILWAY_PROJECT_ID ?? null,
    railwayEnvironmentId: env.RAILWAY_ENVIRONMENT_ID ?? null,
    operatorId: ctx.operatorId,
    correlationId: ctx.correlationId,
  }
}

/**
 * Gate 1 — the drill posture must be active on THIS environment — and gate 2 —
 * never purge against a live or shared database. `true` means refused.
 */
function restoreDrillRefused(deps: RestoreVerifyDeps, io: OperatorIO): boolean {
  if (!isRestoreIsolated(deps.env)) {
    io.err(
      'REFUSED: RESTORE_MODE=isolated is required — restore-verify runs only ' +
        'inside the isolated restore drill. Set RESTORE_MODE=isolated on the ' +
        'restored environment (worker stays down; web capabilities deny) and re-run.',
    )
    return true
  }

  if (!isIsolatedRestoreTarget(deps.env.DATABASE_URL, deps.env)) {
    io.err(
      'REFUSED: DATABASE_URL is not an admitted restore target — use exact ' +
        'loopback for a local drill or the named Railway PITR sibling private ' +
        'hostname in the beta deployment environment.',
    )
    return true
  }
  return false
}

type RestoreBacklogSnapshot = Readonly<{
  importLifecycle: Awaited<ReturnType<RestoreVerifyDeps['inspectGoogleImportLifecycle']>>
  retention: Awaited<ReturnType<RestoreVerifyDeps['inspectRetentionBacklog']>>
  recovery: Awaited<ReturnType<RestoreVerifyDeps['inspectRecoveryFence']>>
}>

type RestoreApprovalPlan = Awaited<
  ReturnType<
    Extract<RestoreReviewLifecycleAuthority, { kind: 'inspection_only' }>['prepare']
  >
>

/** Report what an apply would do, and the artifacts an approver must be given. */
function reportRestoreDryRun(
  io: OperatorIO,
  deps: RestoreVerifyDeps,
  eligible: number,
  before: RestoreBacklogSnapshot,
  approvalPlan: RestoreApprovalPlan | null,
): void {
  io.out(
    `dry-run: ${eligible} expired-content row(s) eligible for the source-policy ` +
      `purge; Google import lifecycle backlog=${JSON.stringify(before.importLifecycle)} ` +
      `retention backlog=${JSON.stringify(before.retention)} ` +
      `recovery authority=${JSON.stringify(before.recovery)} ` +
      (deps.reviewLifecycle.kind === 'reviewed_apply'
        ? '— re-run with --apply --yes ops:restore-verify'
        : '— Review apply remains unavailable until a reviewed cutover authority is injected'),
  )
  if (approvalPlan != null) {
    io.out(
      `Review lifecycle recovery report SHA-256=${approvalPlan.reportSha256}: ${approvalPlan.reportContent.trimEnd()}`,
    )
    io.out(
      `Review lifecycle recovery request SHA-256=${approvalPlan.requestSha256}: ${approvalPlan.requestContent.trimEnd()}`,
    )
    io.out(
      'Give those exact aggregate-only artifacts to the independent approver; do not infer or self-approve an apply decision.',
    )
  }
}

/** Everything the purge and the bounded sweeps must have driven to zero. */
function purgeBacklogFailed(
  io: OperatorIO,
  remaining: number,
  importLifecycleAfter: RestoreBacklogSnapshot['importLifecycle'],
  retentionAfter: RestoreBacklogSnapshot['retention'],
): boolean {
  if (remaining > 0) {
    io.err(
      `FAILED: ${remaining} expired-content row(s) remain eligible after the purge — ` +
        'investigate (see the purge evidence above) before any cutover.',
    )
    return true
  }
  if (
    importLifecycleAfter.expiredItems > 0 ||
    importLifecycleAfter.purgeCandidates > 0 ||
    importLifecycleAfter.unreleasedExpiredReceipts > 0
  ) {
    io.err(
      `FAILED: Google import lifecycle backlog remains after reconciliation: ${JSON.stringify(importLifecycleAfter)}`,
    )
    return true
  }
  const retentionTotal = Object.values(retentionAfter).reduce(
    (total, count) => total + count,
    0,
  )
  if (retentionTotal > 0) {
    io.err(
      `FAILED: overdue retention backlog remains after the bounded sweep: ${JSON.stringify(retentionAfter)} — re-run while isolated until it reaches zero.`,
    )
    return true
  }
  return false
}

/** The evidence, the recovery receipt, and the manual steps that follow. */
function reportCutoverChecklist(
  io: OperatorIO,
  evidence: ReadonlyArray<RestoreVerifyEvidenceRow>,
  recoveryResult: RecoveryFenceResult,
  reviewedApply: Awaited<
    ReturnType<
      Extract<RestoreReviewLifecycleAuthority, { kind: 'reviewed_apply' }>['admit']
    >
  >,
): void {
  io.out('purge evidence (retention_runs, newest first):')
  for (const row of evidence) {
    io.out(
      `  ${row.subject} — rows_deleted=${row.rowsDeleted} outcome=${row.outcome} started_at=${row.startedAt}`,
    )
  }
  io.out(
    `✓ recovery generation ${String(recoveryResult.generation)} ${recoveryResult.replayed ? 'replayed' : 'completed'} — run=${recoveryResult.id} counts=${JSON.stringify(recoveryResult.counts)}`,
  )
  io.out(
    `✓ Review lifecycle approval ${reviewedApply.approvalId} consumed — bundle=${reviewedApply.approvalBundleSha256} report=${reviewedApply.reportSha256}`,
  )

  io.out('✓ zero expired-content row(s) remain eligible — source policy verified')
  io.out('✓ zero Google import lifecycle backlog remains — import retention verified')
  io.out('✓ zero overdue retention-registry rows remain — lifecycle policy verified')
  io.out('✓ zero unfenced restored authority remains — recovery fence verified')
  io.out('\ncutover checklist:')
  io.out('  1. Verify reads against the restored instance (boot smoke, spot-checks)')
  io.out('  2. Reauthorize every fenced Google connection before provider work')
  io.out('  3. Use a fresh Redis; never restore or reuse the pre-incident job queues')
  io.out(
    `  4. Set RECOVERY_CUTOVER_RUN_ID=${recoveryResult.id} and RECOVERY_CUTOVER_GENERATION=${String(recoveryResult.generation)} on every restored-database consumer`,
  )
  io.out(
    '  5. UNSET RESTORE_MODE and redeploy; web + worker refuse boot unless that tuple is the latest recovery run',
  )
  io.out(
    '  6. Rebuild projections/reconcile external state; do not redrive fenced outbox rows',
  )
}

/**
 * The command action (runs after the harness's policy decision allows).
 * Returns the process exit code: 1 on any refusal/failure, 0 on a clean
 * verification (or a dry-run report).
 */
export async function runRestoreVerifyAction(
  ctx: OperatorContext,
  deps: RestoreVerifyDeps,
  io: OperatorIO,
): Promise<number> {
  if (restoreDrillRefused(deps, io)) return 1

  const recoveryTarget = recoveryInput(ctx, deps.env)
  if (typeof recoveryTarget === 'string') {
    io.err(recoveryTarget)
    return 1
  }

  io.out(`✓ ${RESTORE_ISOLATED_LOG_LINE} — restore mode active, target admitted`)

  if (!ctx.dryRun && deps.reviewLifecycle.kind !== 'reviewed_apply') {
    io.err(
      'REFUSED: Review source-content apply has no reviewed cutover authority. ' +
        'The ordinary restore composition is inspection-only; no Review purge, ' +
        'import lifecycle, retention sweep, or recovery fence was applied.',
    )
    return 1
  }

  const approvalPlan =
    ctx.dryRun && deps.reviewLifecycle.kind === 'inspection_only'
      ? await deps.reviewLifecycle.prepare(recoveryTarget)
      : null
  const eligible = approvalPlan == null ? await deps.countExpired() : approvalPlan.expired
  const importLifecycleBefore = await deps.inspectGoogleImportLifecycle()
  const retentionBefore = await deps.inspectRetentionBacklog()
  const recoveryBefore = await deps.inspectRecoveryFence()
  if (ctx.dryRun) {
    reportRestoreDryRun(
      io,
      deps,
      eligible,
      {
        importLifecycle: importLifecycleBefore,
        retention: retentionBefore,
        recovery: recoveryBefore,
      },
      approvalPlan,
    )
    return 0
  }
  if (deps.reviewLifecycle.kind !== 'reviewed_apply') {
    io.err('REFUSED: reviewed Review lifecycle apply authority is unavailable.')
    return 1
  }
  // Admission authenticates the signature, re-collects the exact frozen
  // report, and reserves the one-shot receipt before any destructive work.
  const reviewedApply = await deps.reviewLifecycle.admit(recoveryTarget)
  await reviewedApply.applyReviewLifecycle()
  await deps.sweepGoogleImportLifecycle()
  await deps.sweepRetentionBacklog()

  const remaining = await deps.countExpired()
  const importLifecycleAfter = await deps.inspectGoogleImportLifecycle()
  const retentionAfter = await deps.inspectRetentionBacklog()

  if (purgeBacklogFailed(io, remaining, importLifecycleAfter, retentionAfter)) return 1

  const recoveryResult = await deps.applyRecoveryFence(reviewedApply.recoveryInput)
  const unfencedAuthority = await deps.inspectRecoveryFence()
  const unfencedTotal = Object.values(unfencedAuthority).reduce(
    (total, count) => total + count,
    0,
  )
  if (unfencedTotal > 0) {
    io.err(
      `FAILED: restored authority remains after recovery generation ${String(recoveryResult.generation)}: ${JSON.stringify(unfencedAuthority)}`,
    )
    return 1
  }
  await reviewedApply.complete(recoveryResult)

  reportCutoverChecklist(io, await deps.purgeEvidence(), recoveryResult, reviewedApply)
  return 0
}
