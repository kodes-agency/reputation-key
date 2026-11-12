// ops:restore-verify command core (BQC-7.8) — the restore drill's
// verification step, run INSIDE the isolated restored environment before
// cutover (runbook §8, docs/operations/backup-and-lifecycle.md).
//
// Restored environments must boot isolated, enforce current retention, and
// revoke any authority/effect intent resurrected by PITR. This command is the
// bounded reconciliation + durable recovery-generation proof:
//
//   1. Hard gates (all refuse BEFORE any work):
//      - RESTORE_MODE=isolated must be set in the command's own env — the
//        drill posture (web capabilities deny fail-closed; the worker refuses
//        to boot) must be active on the environment being verified;
//      - DATABASE_URL must be an attested local target or the exact private
//        hostname of a Railway PITR sibling — a recovery fence never runs
//        against the live source database or a public proxy;
//      - no Redis, queue or bucket setting may be carried: the verifier works
//        on the database alone, so a process started from the live
//        environment never reaches the live Redis, queues or bucket.
//   2. Dry-run (default): reports retention/import backlog and every restored
//      authentication/external-effect authority class.
//   3. --apply: after the operator types the environment name, runs
//      review purge, Google-import lifecycle, and the static
//      retention registry IN-PROCESS (never BullMQ), then atomically rotates
//      the recovery generation and fences restored authority/outbox work.
//      Normal composition is inspection-only and refuses before mutation.
//   4. Re-scans and proves every bounded backlog/authority count is zero.
//   5. Prints retention + recovery evidence and the controlled cutover rules.
//
// Erasure replay: the operator passes the local journal export
// (journal=<file>, docs/operations/erasure-journal.md). The file is decoded
// before any work, so an altered or malformed export refuses the run. Apply
// feeds its entries to applyRestoreResurrectionFence and fails unless every
// resurrected erasure is gone again; apply without a journal refuses.
//
// The module is purge-agnostic by injection (fallow boundary: the shared
// zone cannot import the review context) — scripts/ops/restore-verify.ts
// wires the real repositories; the integration test wires the same against
// the scratch database.

import { CLOSED_BETA_RAILWAY_ENVIRONMENT_NAME } from '#/shared/release/railway-deployment-profile'
import {
  isIsolatedRestoreTarget,
  isRestoreIsolated,
  RESTORE_ISOLATED_LOG_LINE,
  restoreSideServicesRefusal,
  type RestoreSideServicesEnv,
} from '#/shared/config/restore-mode'
import { decodeErasureJournalExport } from '#/shared/db/lifecycle/erasure-journal.server'
import {
  planBackupErasureReplay,
  type BackupErasureLedgerEntry,
  type RestoreResurrectionFenceResult,
} from '#/shared/db/lifecycle/backup-erasure-ledger'
import type { OperatorCommandSpec, OperatorContext, OperatorIO } from './operator-command'
import type {
  RecoveryFenceInput,
  RecoveryFenceInventory,
  RecoveryFenceResult,
} from './recovery-fence'

/** The retention_runs subject the source-policy purge evidence lands under. */
export const RESTORE_VERIFY_PURGE_SUBJECT = 'reviews.purge' as const

const RESTORE_VERIFY_USAGE =
  'pnpm ops restore-verify --operator <id> journal=<file> [--reason <text> --apply --yes closed-beta-v2]'

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
  confirmation: CLOSED_BETA_RAILWAY_ENVIRONMENT_NAME,
  isolatedRestore: true,
  usage: RESTORE_VERIFY_USAGE,
}

/** The preflight is read-only but boots the same operator runtime, so it is fenced alike. */
export const RESTORE_PREFLIGHT_SPEC: OperatorCommandSpec = {
  name: 'ops:restore-preflight',
  scope: 'global',
  isolatedRestore: true,
  usage: 'pnpm ops restore-preflight --operator <id>',
}

/** Printed when no journal export was given; apply refuses in that case. */
export const RESTORE_VERIFY_JOURNAL_REQUIRED =
  'journal=<file> is required: pass the local erasure journal export so the erasures made ' +
  'after the restore point can be re-applied.'

export type RestoreVerifyEvidenceRow = Readonly<{
  subject: string
  rowsDeleted: number
  outcome: string
  startedAt: string
}>

export type RestoreReviewLifecycleAuthority =
  | Readonly<{
      kind: 'inspection_only'
      reason: 'environment_confirmation_required'
      /** Produce the immutable aggregate-only recovery report and target request. */
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
      kind: 'confirmed_apply'
      /** Collect evidence and reserve or resume the durable recovery receipt. */
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

export type RestoreErasureReplay = Readonly<{
  /** Local path of the erasure journal export, or null when none was given. */
  journalFile: string | null
  readFile: (path: string) => Promise<string>
  /** Re-apply the entries inside one transaction of the restored database. */
  apply: (
    input: Readonly<{
      entries: readonly BackupErasureLedgerEntry[]
      restorePointAt: Date
    }>,
  ) => Promise<RestoreResurrectionFenceResult>
}>

export type RestoreVerifyDeps = Readonly<{
  confirmation?: string
  clock: () => Date
  /** The command's own env (RESTORE_MODE + DATABASE_URL are gate-checked). */
  env: RestoreSideServicesEnv &
    Readonly<{
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
  erasureReplay: RestoreErasureReplay
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
    return 'REFUSED: RELEASE_MANIFEST_SHA256 must identify the source release manifest.'
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
 * Gate 1 — the drill posture must be active on THIS environment —, gate 2 —
 * never purge against a live or shared database — and gate 3 — no Redis, queue
 * or bucket setting is carried. `true` means refused.
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

  const sideServices = restoreSideServicesRefusal(deps.env)
  if (sideServices !== null) {
    io.err(`REFUSED: ${sideServices}`)
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
      (deps.reviewLifecycle.kind === 'confirmed_apply'
        ? '— re-run with --apply --yes closed-beta-v2'
        : '— Review apply remains unavailable until the environment is confirmed with --yes closed-beta-v2'),
  )
  if (approvalPlan != null) {
    io.out(
      `Review lifecycle recovery report SHA-256=${approvalPlan.reportSha256}: ${approvalPlan.reportContent.trimEnd()}`,
    )
    io.out(
      `Review lifecycle recovery request SHA-256=${approvalPlan.requestSha256}: ${approvalPlan.requestContent.trimEnd()}`,
    )
    io.out(
      'Confirm the environment with --apply --yes closed-beta-v2 to reserve a durable recovery receipt.',
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
  confirmedApply: Awaited<
    ReturnType<
      Extract<RestoreReviewLifecycleAuthority, { kind: 'confirmed_apply' }>['admit']
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
    `✓ Review lifecycle recovery ${confirmedApply.approvalId} recorded — confirmation=${confirmedApply.approvalBundleSha256} report=${confirmedApply.reportSha256}`,
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
  io.out('  7. Delete the local erasure journal export under the recovery procedure')
}

type LoadedJournal = Readonly<{ entries: readonly BackupErasureLedgerEntry[] }>

/** Decode the local export; a string is the refusal. */
async function loadJournal(
  replay: RestoreErasureReplay,
  restorePointAt: Date,
): Promise<LoadedJournal | string> {
  if (replay.journalFile === null) return `REFUSED: ${RESTORE_VERIFY_JOURNAL_REQUIRED}`
  let journal: ReturnType<typeof decodeErasureJournalExport>
  try {
    journal = decodeErasureJournalExport(await replay.readFile(replay.journalFile))
  } catch {
    return 'REFUSED: the erasure journal export is unreadable, malformed or was altered.'
  }
  if (journal.exportedAt.getTime() < restorePointAt.getTime()) {
    return 'REFUSED: the erasure journal export predates the restore point, so it cannot cover the erasures made after it.'
  }
  return { entries: journal.entries }
}

function reportReplayPlan(
  io: OperatorIO,
  journal: LoadedJournal,
  restorePointAt: Date,
): void {
  const plan = planBackupErasureReplay(journal.entries, restorePointAt)
  const count = (disposition: string) =>
    plan.filter((item) => item.disposition === disposition).length
  io.out(
    `erasure replay plan: entries=${plan.length} replay_required=${count('replay_required')} held=${count('held')} already_erased=${count('already_erased')}`,
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
  if (!ctx.dryRun && deps.confirmation !== CLOSED_BETA_RAILWAY_ENVIRONMENT_NAME) {
    io.err('REFUSED: confirm the restore environment with --yes closed-beta-v2')
    return 1
  }

  const recoveryTarget = recoveryInput(ctx, deps.env)
  if (typeof recoveryTarget === 'string') {
    io.err(recoveryTarget)
    return 1
  }

  io.out(`✓ ${RESTORE_ISOLATED_LOG_LINE} — restore mode active, target admitted`)

  const journal = await loadJournal(deps.erasureReplay, recoveryTarget.restorePointAt)
  if (typeof journal === 'string') {
    if (ctx.dryRun && deps.erasureReplay.journalFile === null) {
      io.out(journal.replace('REFUSED', 'apply will refuse'))
    } else {
      io.err(journal)
      return 1
    }
  } else {
    reportReplayPlan(io, journal, recoveryTarget.restorePointAt)
  }

  if (!ctx.dryRun && deps.reviewLifecycle.kind !== 'confirmed_apply') {
    io.err(
      'REFUSED: Review source-content apply has no environment confirmation. ' +
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

  return applyConfirmedRestore(ctx, deps, io, recoveryTarget, journal)
}

/** Apply the admitted lifecycles and complete the receipt only after replay verifies. */
async function applyConfirmedRestore(
  ctx: OperatorContext,
  deps: RestoreVerifyDeps,
  io: OperatorIO,
  recoveryTarget: RestoreReviewLifecycleRuntimeTarget,
  journal: LoadedJournal | string,
): Promise<number> {
  if (deps.reviewLifecycle.kind !== 'confirmed_apply') {
    io.err('REFUSED: confirmed Review lifecycle apply authority is unavailable.')
    return 1
  }
  if (typeof journal === 'string') {
    io.err(journal)
    return 1
  }
  io.out(
    `restore confirmation — environment=${CLOSED_BETA_RAILWAY_ENVIRONMENT_NAME} operator=${ctx.operatorId} at=${deps.clock().toISOString()} correlation=${ctx.correlationId}`,
  )
  // Reserve or resume the durable receipt before any lifecycle mutation.
  const confirmedApply = await deps.reviewLifecycle.admit(recoveryTarget)
  await confirmedApply.applyReviewLifecycle()
  await deps.sweepGoogleImportLifecycle()
  await deps.sweepRetentionBacklog()

  const remaining = await deps.countExpired()
  const importLifecycleAfter = await deps.inspectGoogleImportLifecycle()
  const retentionAfter = await deps.inspectRetentionBacklog()

  if (purgeBacklogFailed(io, remaining, importLifecycleAfter, retentionAfter)) return 1

  const recoveryResult = await deps.applyRecoveryFence(confirmedApply.recoveryInput)
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
  const replayed = await deps.erasureReplay.apply({
    entries: journal.entries,
    restorePointAt: recoveryTarget.restorePointAt,
  })
  if (!replayed.verified) {
    io.err(
      `FAILED: ${replayed.counts.ledgerEntriesUnreplayed} journal entr(ies) could not be re-applied: ${replayed.unreplayedEntryIds.join(', ')} — the restored database is not verified.`,
    )
    return 1
  }
  io.out(
    `✓ erasure replay verified — counts=${JSON.stringify(replayed.counts)} held=${replayed.heldEntryIds.length}`,
  )
  // Fencing can take long enough for another Review to expire. Leave the
  // receipt resumable so the next invocation drains that content as well.
  if (
    purgeBacklogFailed(
      io,
      await deps.countExpired(),
      importLifecycleAfter,
      retentionAfter,
    )
  )
    return 1
  await confirmedApply.complete(recoveryResult)

  reportCutoverChecklist(io, await deps.purgeEvidence(), recoveryResult, confirmedApply)
  return 0
}
