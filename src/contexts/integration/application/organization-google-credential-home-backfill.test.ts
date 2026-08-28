import { describe, expect, it, vi } from 'vitest'
import { DATA_CELL_CATALOGUE_POLICY_VERSION } from '#/shared/domain/data-cell-catalogue'
import { googleConnectionId, organizationId, userId } from '#/shared/domain/ids'
import {
  buildOrganizationGoogleCredentialHomeBackfillReport,
  createOrganizationGoogleCredentialHomeBackfill,
  googleCredentialHomeBackfillConfirmation,
  type OrganizationGoogleCredentialHomeBackfillStore,
} from './organization-google-credential-home-backfill'

const ORG = organizationId('org-google-home-backfill')
const OPERATOR = userId('operator-google-home-backfill')

function report() {
  return buildOrganizationGoogleCredentialHomeBackfillReport({
    organizationId: ORG,
    authority: null,
    connections: [
      {
        connectionId: googleConnectionId('20000000-0000-4000-8000-000000000002'),
        credentialUseState: 'none',
        credentialHomeCellId: null,
        credentialHomePolicyVersion: null,
        credentialHomeAuthorityGeneration: null,
      },
      {
        connectionId: googleConnectionId('20000000-0000-4000-8000-000000000001'),
        credentialUseState: 'active',
        credentialHomeCellId: null,
        credentialHomePolicyVersion: null,
        credentialHomeAuthorityGeneration: null,
      },
    ],
  })
}

describe('Organization Google credential-home legacy backfill', () => {
  it('reports content-free counts with an order-independent exact-state digest', () => {
    const first = report()
    const reversed = buildOrganizationGoogleCredentialHomeBackfillReport({
      organizationId: ORG,
      authority: null,
      connections: [
        {
          connectionId: googleConnectionId('20000000-0000-4000-8000-000000000001'),
          credentialUseState: 'active',
          credentialHomeCellId: null,
          credentialHomePolicyVersion: null,
          credentialHomeAuthorityGeneration: null,
        },
        {
          connectionId: googleConnectionId('20000000-0000-4000-8000-000000000002'),
          credentialUseState: 'none',
          credentialHomeCellId: null,
          credentialHomePolicyVersion: null,
          credentialHomeAuthorityGeneration: null,
        },
      ],
    })

    expect(first).toEqual({
      organizationId: ORG,
      authorityPresent: false,
      activeGrantCount: 1,
      activeMissingHomeCount: 1,
      malformedHomePairCount: 0,
      persistedHomeCounts: [],
      reportDigestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    })
    expect(reversed.reportDigestSha256).toBe(first.reportDigestSha256)
    expect(JSON.stringify(first)).not.toContain('20000000-0000')
  })

  it('changes the digest for connection-level drift even when summary counts match', () => {
    const changed = buildOrganizationGoogleCredentialHomeBackfillReport({
      organizationId: ORG,
      authority: null,
      connections: [
        {
          connectionId: googleConnectionId('20000000-0000-4000-8000-000000000099'),
          credentialUseState: 'active',
          credentialHomeCellId: null,
          credentialHomePolicyVersion: null,
          credentialHomeAuthorityGeneration: null,
        },
        {
          connectionId: googleConnectionId('20000000-0000-4000-8000-000000000002'),
          credentialUseState: 'none',
          credentialHomeCellId: null,
          credentialHomePolicyVersion: null,
          credentialHomeAuthorityGeneration: null,
        },
      ],
    })
    expect(changed.activeGrantCount).toBe(report().activeGrantCount)
    expect(changed.reportDigestSha256).not.toBe(report().reportDigestSha256)
  })

  it('recognizes a complete pre-generation pair as explicit legacy placement evidence', () => {
    const legacy = buildOrganizationGoogleCredentialHomeBackfillReport({
      organizationId: ORG,
      authority: null,
      connections: [
        {
          connectionId: googleConnectionId('20000000-0000-4000-8000-000000000003'),
          credentialUseState: 'active',
          credentialHomeCellId: 'us',
          credentialHomePolicyVersion: 2,
          credentialHomeAuthorityGeneration: null,
        },
      ],
    })
    expect(legacy.malformedHomePairCount).toBe(0)
    expect(legacy.activeMissingHomeCount).toBe(0)
    expect(legacy.persistedHomeCounts).toEqual([
      { homeCellId: 'us', cataloguePolicyVersion: 2, count: 1 },
    ])
  })

  it('requires an explicit cell, exact digest, ticket, and target-bound confirmation', async () => {
    const current = report()
    const apply = vi.fn(async () => ({ kind: 'applied' as const, updatedCount: 1 }))
    const store: OrganizationGoogleCredentialHomeBackfillStore = {
      report: async () => current,
      apply,
    }
    const backfill = createOrganizationGoogleCredentialHomeBackfill({ store })
    const base = {
      organizationId: ORG,
      selectedHome: {
        homeCellId: 'us' as const,
        cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
      },
      expectedReportDigestSha256: current.reportDigestSha256,
      operatorId: OPERATOR,
      ticket: 'REG-credential-home-42',
    }

    await expect(
      backfill.apply({ ...base, confirmation: 'apply-google-credential-home' }),
    ).rejects.toThrow(/confirmation/u)
    expect(apply).not.toHaveBeenCalled()

    await expect(
      backfill.apply({
        ...base,
        confirmation: googleCredentialHomeBackfillConfirmation(base),
      }),
    ).resolves.toEqual({ kind: 'applied', updatedCount: 1 })
    expect(apply).toHaveBeenCalledWith(base)
  })

  it('surfaces atomic report drift and never chooses a cell itself', async () => {
    const current = report()
    const store: OrganizationGoogleCredentialHomeBackfillStore = {
      report: async () => current,
      apply: async () => ({ kind: 'stale_report' }),
    }
    const backfill = createOrganizationGoogleCredentialHomeBackfill({ store })
    const input = {
      organizationId: ORG,
      selectedHome: {
        homeCellId: 'us' as const,
        cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
      },
      expectedReportDigestSha256: current.reportDigestSha256,
      operatorId: OPERATOR,
      ticket: 'REG-credential-home-42',
    }
    await expect(
      backfill.apply({
        ...input,
        confirmation: googleCredentialHomeBackfillConfirmation(input),
      }),
    ).resolves.toEqual({ kind: 'stale_report' })
  })
})
