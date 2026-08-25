// ops:restore-verify command core (BQC-7.8) — the restore drill's
// verification step, run INSIDE the isolated restored environment before
// cutover (runbook §8, docs/operations/backup-and-lifecycle.md).
//
// The phase requirement: "restored environments boot in isolated mode and
// run source-policy purge before serving". This command is the purge+proof:
//
//   1. Hard gates (both refuse BEFORE any work):
//      - RESTORE_MODE=isolated must be set in the command's own env — the
//        drill posture (web capabilities deny fail-closed; the worker refuses
//        to boot) must be active on the environment being verified;
//      - DATABASE_URL must be an isolated/local target (loopback only) — a
//        source-policy purge never runs against a live or shared database.
//   2. Dry-run (default): reports how many expired-content rows are
//      eligible for the source-policy purge.
//   3. --apply: runs the purge IN-PROCESS via the same execution path the
//      purge-expired-reviews job uses (the handler core over the real
//      repositories — NOT a BullMQ enqueue; the drill has no worker), with
//      the normal retention_runs evidence rows (subject 'reviews.purge').
//   4. Re-scans: asserts ZERO expired-content rows remain eligible — the
//      restored environment may not serve expired source content.
//   5. Prints the evidence rows and the cutover reminder: cutover requires
//      UNSETTING RESTORE_MODE (and redeploying).
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
  }>
  /** Count of expired-content rows currently eligible for the purge. */
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
}>

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
  if (!isIsolatedRestoreTarget(deps.env.DATABASE_URL)) {
    io.err(
      'REFUSED: DATABASE_URL is not an isolated/local target — never run the ' +
        'source-policy purge against a live or shared database. Point ' +
        'DATABASE_URL at the isolated restore instance and re-run.',
    )
    return 1
  }

  io.out(`✓ ${RESTORE_ISOLATED_LOG_LINE} — restore mode active, target isolated`)

  const eligible = await deps.countExpired()
  const importLifecycleBefore = await deps.inspectGoogleImportLifecycle()
  if (ctx.dryRun) {
    io.out(
      `dry-run: ${eligible} expired-content row(s) eligible for the source-policy ` +
        `purge; Google import lifecycle backlog=${JSON.stringify(importLifecycleBefore)} ` +
        '— re-run with --apply --yes ops:restore-verify',
    )
    return 0
  }

  // The in-process purge — the same execution path as the scheduled
  // purge-expired-reviews job (bounded, evidence in retention_runs).
  await deps.purgeExpired()
  await deps.sweepGoogleImportLifecycle()

  const remaining = await deps.countExpired()
  const importLifecycleAfter = await deps.inspectGoogleImportLifecycle()

  const evidence = await deps.purgeEvidence()
  io.out('purge evidence (retention_runs, newest first):')
  for (const row of evidence) {
    io.out(
      `  ${row.subject} — rows_deleted=${row.rowsDeleted} outcome=${row.outcome} started_at=${row.startedAt}`,
    )
  }

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

  io.out('✓ zero expired-content row(s) remain eligible — source policy verified')
  io.out('✓ zero Google import lifecycle backlog remains — import retention verified')
  io.out('\ncutover checklist:')
  io.out('  1. Verify reads against the restored instance (boot smoke, spot-checks)')
  io.out('  2. UNSET RESTORE_MODE and redeploy web + worker to resume normal service')
  io.out('  3. Confirm the worker boots and schedules resume (runbooks §8)')
  return 0
}
