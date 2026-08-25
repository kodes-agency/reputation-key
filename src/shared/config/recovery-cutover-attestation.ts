// REG-04 — serving/worker boot fence for Railway PITR cutovers.
//
// RESTORE_MODE contains the isolated verifier, but merely unsetting it must
// not authorize a restored database. Railway's generated PITR private DNS is
// stable evidence that the runtime is connected to a sibling. Such a runtime
// must carry the exact recovery run ID/generation printed by restore-verify,
// and that tuple must still be the latest durable run in this Data Cell.

import { isRailwayPitrDatabaseUrl, isRestoreIsolated } from './restore-mode'

export type RecoveryCutoverEnv = Readonly<{
  RESTORE_MODE?: string
  DATABASE_URL?: string
  PROCESSING_CELL?: string
  RECOVERY_CUTOVER_RUN_ID?: string
  RECOVERY_CUTOVER_GENERATION?: number
}>

export type RecoveryCutoverRun = Readonly<{
  id: string
  generation: number | string
}>

export interface RecoveryCutoverRunReader {
  findLatest(dataCellId: string): Promise<RecoveryCutoverRun | undefined>
}

/**
 * Refuse normal web/worker boot on a PITR sibling unless the configured tuple
 * names the latest completed recovery run in the process's exact Data Cell.
 */
export async function assertRecoveryCutoverAttestation(
  runs: RecoveryCutoverRunReader,
  env: RecoveryCutoverEnv,
): Promise<void> {
  if (isRestoreIsolated(env) || !isRailwayPitrDatabaseUrl(env.DATABASE_URL)) return

  if (
    !env.PROCESSING_CELL ||
    !env.RECOVERY_CUTOVER_RUN_ID ||
    !Number.isSafeInteger(env.RECOVERY_CUTOVER_GENERATION) ||
    (env.RECOVERY_CUTOVER_GENERATION ?? 0) < 1
  ) {
    throw new Error(
      '[RECOVERY CUTOVER] PITR sibling requires an exact recovery run ID and generation — boot refused',
    )
  }

  const latest = await runs.findLatest(env.PROCESSING_CELL)
  if (
    !latest ||
    latest.id !== env.RECOVERY_CUTOVER_RUN_ID ||
    Number(latest.generation) !== env.RECOVERY_CUTOVER_GENERATION
  ) {
    throw new Error(
      '[RECOVERY CUTOVER] configured attestation is absent, stale, or belongs to another Data Cell — boot refused',
    )
  }
}
