import { describe, expect, it, vi } from 'vitest'
import {
  assertRecoveryCutoverAttestation,
  type RecoveryCutoverRunReader,
} from './recovery-cutover-attestation'

const PITR_URL =
  'postgresql://u:p@postgres-restored-20260825-1015.railway.internal:5432/railway'
const RUN_ID = '10000000-0000-4000-8000-000000000001'

function reader(rows: readonly unknown[] = []): RecoveryCutoverRunReader {
  return {
    findLatest: vi.fn(async () => rows[0] as never),
  }
}

const attested = {
  DATABASE_URL: PITR_URL,
  RECOVERY_CUTOVER_RUN_ID: RUN_ID,
  RECOVERY_CUTOVER_GENERATION: 3,
} as const

describe('assertRecoveryCutoverAttestation (REG-04)', () => {
  it('does not query fresh databases or isolated verifier boots', async () => {
    const runs = reader()
    await expect(
      assertRecoveryCutoverAttestation(runs, {
        DATABASE_URL: 'postgresql://u:p@postgres.railway.internal:5432/railway',
      }),
    ).resolves.toBeUndefined()
    await expect(
      assertRecoveryCutoverAttestation(runs, {
        ...attested,
        RESTORE_MODE: 'isolated',
      }),
    ).resolves.toBeUndefined()
    expect(runs.findLatest).not.toHaveBeenCalled()
  })

  it('accepts only the latest exact run and generation', async () => {
    const runs = reader([{ id: RUN_ID, generation: 3 }])
    await expect(
      assertRecoveryCutoverAttestation(runs, attested),
    ).resolves.toBeUndefined()
    expect(runs.findLatest).toHaveBeenCalledTimes(1)
  })

  it('refuses a missing, stale, or mismatched attestation', async () => {
    await expect(
      assertRecoveryCutoverAttestation(reader(), {
        DATABASE_URL: PITR_URL,
      }),
    ).rejects.toThrow(/boot refused/)
    await expect(
      assertRecoveryCutoverAttestation(reader([{ id: RUN_ID, generation: 4 }]), attested),
    ).rejects.toThrow(/absent or stale/)
    await expect(
      assertRecoveryCutoverAttestation(
        reader([{ id: '20000000-0000-4000-8000-000000000002', generation: 3 }]),
        attested,
      ),
    ).rejects.toThrow(/absent or stale/)
  })
})
