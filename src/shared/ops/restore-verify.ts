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
//   3. --apply: runs review purge, Google-import lifecycle, and the static
//      retention registry IN-PROCESS (never BullMQ), then atomically rotates
//      the cell recovery generation and fences restored authority/outbox work.
//   4. Re-scans and proves every bounded backlog/authority count is zero.
//   5. Prints retention + recovery evidence and the controlled cutover rules.
//
// The module is purge-agnostic by injection (fallow boundary: the shared
// zone cannot import the review context) — scripts/ops/restore-verify.ts
// wires the real repositories; the integration test wires the same against
// the scratch database.

import {
  isIsolatedRestoreTarget,
  isRestoreCellCompatible,
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

export type RestoreVerifyDeps = Readonly<{
  /** The command's own env (RESTORE_MODE + DATABASE_URL are gate-checked). */
  env: Readonly<{
    RESTORE_MODE?: string
    DATABASE_URL: string
    PROCESSING_CELL?: string
    RESTORE_SOURCE_CELL?: string
    RESTORE_POINT_AT?: string
    RELEASE_SHA?: string
    RELEASE_MANIFEST_SHA256?: string
    RESTORE_DATABASE_SERVICE_NAME?: string
    RAILWAY_PROJECT_ID?: string
    RAILWAY_ENVIRONMENT_ID?: string
    RAILWAY_ENVIRONMENT_NAME?: string
  }>
  /** Count of expired-content rows currently eligible for review purge. */
  countExpired: () => Promise<number>
  /** Run the source-policy purge in-process (bounded, evidence-writing). */
  purgeExpired: () => Promise<void>
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
  /** Atomically rotate and apply the cell recovery generation. */
  applyRecoveryFence: (input: RecoveryFenceInput) => Promise<RecoveryFenceResult>
}>

function recoveryInput(
  ctx: OperatorContext,
  env: RestoreVerifyDeps['env'],
): RecoveryFenceInput | string {
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
  if (
    env.PROCESSING_CELL !== 'us' &&
    env.PROCESSING_CELL !== 'europe' &&
    env.PROCESSING_CELL !== 'global'
  ) {
    return 'REFUSED: PROCESSING_CELL must be a known Data Cell.'
  }
  return {
    dataCellId: env.PROCESSING_CELL,
    sourceReleaseSha: env.RELEASE_SHA as string,
    sourceManifestSha256: env.RELEASE_MANIFEST_SHA256 as string,
    restorePointAt,
    operatorId: ctx.operatorId,
    correlationId: ctx.correlationId,
  }
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
  // Gate 1 — the drill posture must be active on THIS environment.
  if (!isRestoreIsolated(deps.env)) {
    io.err(
      'REFUSED: RESTORE_MODE=isolated is required — restore-verify runs only ' +
        'inside the isolated restore drill. Set RESTORE_MODE=isolated on the ' +
        'restored environment (worker stays down; web capabilities deny) and re-run.',
    )
    return 1
  }

  if (!isRestoreCellCompatible(deps.env)) {
    io.err(
      'REFUSED: RESTORE_SOURCE_CELL must exactly match PROCESSING_CELL — ' +
        'a backup may never be verified or cut over in another Data Cell.',
    )
    return 1
  }

  // Gate 2 — never purge against a live or shared database.
  if (!isIsolatedRestoreTarget(deps.env.DATABASE_URL, deps.env)) {
    io.err(
      'REFUSED: DATABASE_URL is not an admitted restore target — use exact ' +
        'loopback for a local drill or the named Railway PITR sibling private ' +
        'hostname in its matching Data Cell environment.',
    )
    return 1
  }

  const recovery = recoveryInput(ctx, deps.env)
  if (typeof recovery === 'string') {
    io.err(recovery)
    return 1
  }

  io.out(`✓ ${RESTORE_ISOLATED_LOG_LINE} — restore mode active, target admitted`)

  const eligible = await deps.countExpired()
  const importLifecycleBefore = await deps.inspectGoogleImportLifecycle()
  const retentionBefore = await deps.inspectRetentionBacklog()
  const recoveryBefore = await deps.inspectRecoveryFence()
  if (ctx.dryRun) {
    io.out(
      `dry-run: ${eligible} expired-content row(s) eligible for the source-policy ` +
        `purge; Google import lifecycle backlog=${JSON.stringify(importLifecycleBefore)} ` +
        `retention backlog=${JSON.stringify(retentionBefore)} ` +
        `recovery authority=${JSON.stringify(recoveryBefore)} ` +
        '— re-run with --apply --yes ops:restore-verify',
    )
    return 0
  }
  if (recoveryBefore.regionMovesBlocking > 0) {
    io.err(
      `REFUSED: ${String(recoveryBefore.regionMovesBlocking)} active or unresolved Data Cell move(s) exist in the restored database — resolve the move authority before applying recovery.`,
    )
    return 1
  }

  // The in-process purge — the same execution path as the scheduled
  // purge-expired-reviews job (bounded, evidence in retention_runs).
  await deps.purgeExpired()
  await deps.sweepGoogleImportLifecycle()
  await deps.sweepRetentionBacklog()

  const remaining = await deps.countExpired()
  const importLifecycleAfter = await deps.inspectGoogleImportLifecycle()
  const retentionAfter = await deps.inspectRetentionBacklog()

  if (remaining > 0) {
    io.err(
      `FAILED: ${remaining} expired-content row(s) remain eligible after the purge — ` +
        'investigate (see the purge evidence above) before any cutover.',
    )
    return 1
  }
  if (
    importLifecycleAfter.expiredItems > 0 ||
    importLifecycleAfter.purgeCandidates > 0 ||
    importLifecycleAfter.unreleasedExpiredReceipts > 0
  ) {
    io.err(
      `FAILED: Google import lifecycle backlog remains after reconciliation: ${JSON.stringify(importLifecycleAfter)}`,
    )
    return 1
  }
  const retentionTotal = Object.values(retentionAfter).reduce(
    (total, count) => total + count,
    0,
  )
  if (retentionTotal > 0) {
    io.err(
      `FAILED: overdue retention backlog remains after the bounded sweep: ${JSON.stringify(retentionAfter)} — re-run while isolated until it reaches zero.`,
    )
    return 1
  }

  const recoveryResult = await deps.applyRecoveryFence(recovery)
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

  const evidence = await deps.purgeEvidence()
  io.out('purge evidence (retention_runs, newest first):')
  for (const row of evidence) {
    io.out(
      `  ${row.subject} — rows_deleted=${row.rowsDeleted} outcome=${row.outcome} started_at=${row.startedAt}`,
    )
  }
  io.out(
    `✓ recovery generation ${String(recoveryResult.generation)} ${recoveryResult.replayed ? 'replayed' : 'completed'} — run=${recoveryResult.id} counts=${JSON.stringify(recoveryResult.counts)}`,
  )

  io.out('✓ zero expired-content row(s) remain eligible — source policy verified')
  io.out('✓ zero Google import lifecycle backlog remains — import retention verified')
  io.out('✓ zero overdue retention-registry rows remain — lifecycle policy verified')
  io.out('✓ zero unfenced restored authority remains — recovery fence verified')
  io.out('\ncutover checklist:')
  io.out('  1. Verify reads against the restored instance (boot smoke, spot-checks)')
  io.out('  2. Reauthorize every fenced Google connection before provider work')
  io.out('  3. Use a fresh Redis; never restore or reuse the pre-incident job queues')
  io.out('  4. UNSET RESTORE_MODE and redeploy web + worker to resume normal service')
  io.out(
    '  5. Rebuild projections/reconcile external state; do not redrive fenced outbox rows',
  )
  return 0
}
