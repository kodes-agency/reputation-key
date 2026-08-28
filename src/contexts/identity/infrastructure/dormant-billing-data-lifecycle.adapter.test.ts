import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { createDormantBillingDataLifecycleAdapter } from './dormant-billing-data-lifecycle.adapter'

const presenceRow = (
  organizationId: string,
  fields: Partial<Record<string, boolean>> = {},
) => ({
  organization_id: organizationId,
  billing_company_name_present: false,
  billing_address_present: false,
  billing_city_present: false,
  billing_postal_code_present: false,
  billing_country_present: false,
  ...fields,
})

const database = (snapshots: ReadonlyArray<ReadonlyArray<Record<string, unknown>>>) => {
  const execute = vi.fn()
  for (const rows of snapshots) execute.mockResolvedValueOnce({ rows })
  const transaction = vi.fn(
    async (callback: (tx: { execute: typeof execute }) => unknown) =>
      callback({ execute }),
  )
  return {
    db: { execute, transaction } as unknown as Database,
    execute,
    transaction,
  }
}

describe('dormant Billing data lifecycle adapter', () => {
  it('reads presence only in a repeatable-read, read-only snapshot', async () => {
    const fake = database([
      [
        presenceRow('org-a', { billing_company_name_present: true }),
        presenceRow('org-b'),
      ],
    ])
    const adapter = createDormantBillingDataLifecycleAdapter(fake.db)

    const report = await adapter.report(new Date('2026-08-28T00:00:00.000Z'))

    expect(report).toMatchObject({
      totalOrganizationCount: 2,
      organizationsWithDormantBillingData: 1,
      storedFieldValueCount: 1,
    })
    expect(fake.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    })
    expect(String(fake.execute.mock.calls[0]?.[0])).not.toContain('billing value')
  })

  it('refuses apply when the locked target fingerprint differs', async () => {
    const fake = database([
      [[presenceRow('org-a', { billing_country_present: true })][0]!],
    ])
    const adapter = createDormantBillingDataLifecycleAdapter(fake.db)

    const outcome = await adapter.erase({
      expectedTargetFingerprint: '0'.repeat(64),
      evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
    })

    expect(outcome.status).toBe('refused_fingerprint')
    expect(fake.execute).toHaveBeenCalledTimes(1)
    expect(fake.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'serializable',
    })
  })

  it('atomically nulls the exact locked target and verifies the empty result', async () => {
    const initial = database([
      [
        presenceRow('org-a', {
          billing_company_name_present: true,
          billing_country_present: true,
        }),
      ],
    ])
    const target = await createDormantBillingDataLifecycleAdapter(initial.db).report(
      new Date('2026-08-28T00:00:00.000Z'),
    )

    const fake = database([
      [
        presenceRow('org-a', {
          billing_company_name_present: true,
          billing_country_present: true,
        }),
      ],
      [{ organization_id: 'org-a' }],
      [presenceRow('org-a')],
    ])
    const outcome = await createDormantBillingDataLifecycleAdapter(fake.db).erase({
      expectedTargetFingerprint: target.targetFingerprint,
      evaluatedAt: new Date('2026-08-28T00:00:01.000Z'),
    })

    expect(outcome).toMatchObject({
      status: 'erased',
      erasedOrganizationCount: 1,
      erasedFieldValueCount: 2,
      after: {
        erasureRequired: false,
        schemaContractionCandidate: true,
      },
    })
    expect(fake.execute).toHaveBeenCalledTimes(3)
  })

  it('is an idempotent no-op when the reviewed target is already empty', async () => {
    const initial = database([[presenceRow('org-a')]])
    const target = await createDormantBillingDataLifecycleAdapter(initial.db).report(
      new Date('2026-08-28T00:00:00.000Z'),
    )
    const fake = database([[presenceRow('org-a')]])

    await expect(
      createDormantBillingDataLifecycleAdapter(fake.db).erase({
        expectedTargetFingerprint: target.targetFingerprint,
        evaluatedAt: new Date('2026-08-28T00:00:01.000Z'),
      }),
    ).resolves.toMatchObject({ status: 'no_data' })
    expect(fake.execute).toHaveBeenCalledTimes(1)
  })
})
