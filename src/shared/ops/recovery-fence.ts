import type { RecoveryFenceCounts } from '#/shared/db/schema/recovery.schema'
import type { DataCellId } from '#/shared/domain/data-cell-catalogue'

const SHA = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u

export type RecoveryFenceInventory = RecoveryFenceCounts

export type RecoveryFenceInput = Readonly<{
  dataCellId: DataCellId
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
  if (input.operatorId.trim() === '' || input.correlationId.trim() === '') {
    throw new Error('recovery operator and correlation identities are required')
  }
}
