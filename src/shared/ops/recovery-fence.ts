import type { RecoveryFenceCounts } from '#/shared/db/schema/recovery.schema'
import type { DataCellId } from '#/shared/domain/data-cell-catalogue'

const SHA = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u

export type RecoveryFenceInventory = RecoveryFenceCounts

export type RecoveryFenceInput = Readonly<{
  dataCellId: DataCellId
  /** Pre-reviewed identity; the database no longer allocates this after apply begins. */
  runId: string
  /** Pre-reviewed next cell generation; a concurrent/stale plan fails closed. */
  generation: number
  sourceReleaseSha: string
  sourceManifestSha256: string
  restorePointAt: Date
  operatorId: string
  correlationId: string
}>

export type RecoveryFenceResult = Readonly<{
  id: string
  generation: number
  replayed: boolean
  counts: RecoveryFenceCounts
  completedAt: Date
}>

/** Validate the content-free identity bound into a recovery generation. */
export function validateRecoveryFenceInput(input: RecoveryFenceInput): void {
  if (
    input.dataCellId !== 'us' &&
    input.dataCellId !== 'europe' &&
    input.dataCellId !== 'global'
  ) {
    throw new Error('recovery Data Cell must be known')
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      input.runId,
    )
  ) {
    throw new Error('recovery run ID must be a UUID')
  }
  if (
    !Number.isSafeInteger(input.generation) ||
    input.generation < 1 ||
    input.generation > 2_147_483_647
  ) {
    throw new Error('recovery generation must be a positive PostgreSQL integer')
  }
  if (!SHA.test(input.sourceReleaseSha)) {
    throw new Error('recovery source release SHA must be 40 lowercase hex characters')
  }
  if (!SHA256.test(input.sourceManifestSha256)) {
    throw new Error(
      'recovery source manifest SHA-256 must be 64 lowercase hex characters',
    )
  }
  if (Number.isNaN(input.restorePointAt.getTime())) {
    throw new Error('recovery restore point must be a valid instant')
  }
  if (input.restorePointAt.getTime() > Date.now() + 60_000) {
    throw new Error('recovery restore point cannot be in the future')
  }
  if (
    input.operatorId.trim() === '' ||
    input.operatorId.length > 255 ||
    input.correlationId.trim() === '' ||
    input.correlationId.length > 255
  ) {
    throw new Error('recovery operator and correlation identities are required')
  }
}
