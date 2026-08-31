import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { googleConnectionId, organizationId, userId } from '#/shared/domain/ids'
import { buildOrganizationGoogleCredentialHomeBackfillReport } from '../application/organization-google-credential-home-backfill'
import { createOrganizationGoogleCredentialHomeBackfillStore } from './organization-google-credential-home-backfill.store'

const NOW = new Date('2099-01-01T12:34:56.789Z')
const ORG = organizationId('org-credential-home-clock')
const CONNECTION = googleConnectionId('92000000-0000-4000-8000-000000000001')
const OPERATOR = userId('user-credential-home-clock')

function backfillDatabase(executed: unknown[]): Database {
  const responses = [
    { rows: [] },
    { rows: [] },
    { rows: [] },
    {
      rows: [
        {
          id: CONNECTION,
          credential_use_state: 'active',
          credential_home_cell_id: null,
          credential_home_policy_version: null,
          credential_home_authority_generation: null,
        },
      ],
    },
    { rows: [] },
    { rows: [{ id: CONNECTION }] },
  ]
  return {
    transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => {
      let call = 0
      const tx = {
        execute: vi.fn(async (query: unknown) => {
          executed.push(query)
          return responses[call++] ?? { rows: [] }
        }),
      }
      return run(tx)
    }),
  } as unknown as Database
}

describe('Organization Google credential-home backfill time authority', () => {
  it('uses the injected instant for the authority and connection writes', async () => {
    const executed: unknown[] = []
    const expectedReport = buildOrganizationGoogleCredentialHomeBackfillReport({
      organizationId: ORG,
      authority: null,
      connections: [
        {
          connectionId: CONNECTION,
          credentialUseState: 'active',
          credentialHomeCellId: null,
          credentialHomePolicyVersion: null,
          credentialHomeAuthorityGeneration: null,
        },
      ],
    })
    const clock = vi.fn(() => NOW)
    const store = createOrganizationGoogleCredentialHomeBackfillStore(
      backfillDatabase(executed),
      clock,
    )

    await expect(
      store.apply({
        organizationId: ORG,
        selectedHome: { homeCellId: 'us', cataloguePolicyVersion: 2 },
        expectedReportDigestSha256: expectedReport.reportDigestSha256,
        operatorId: OPERATOR,
        ticket: 'REG-clock-authority',
      }),
    ).resolves.toEqual({ kind: 'applied', updatedCount: 1 })

    const dateParameters = executed.flatMap((query) => {
      const chunks = (query as { queryChunks?: ReadonlyArray<unknown> }).queryChunks ?? []
      return chunks.filter((chunk): chunk is Date => chunk instanceof Date)
    })
    expect(clock).toHaveBeenCalledTimes(1)
    expect(dateParameters).toEqual([NOW, NOW, NOW, NOW])
  })
})
