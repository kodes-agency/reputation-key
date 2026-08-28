import { describe, expect, it } from 'vitest'
import { ORGANIZATION_LIFECYCLE_CONTEXTS } from '../domain/organization-lifecycle'
import {
  buildOrganizationExportBundle,
  ORGANIZATION_EXPORT_FORMAT_VERSION,
  type OrganizationExportContributor,
} from './organization-export-contract'

const AS_OF = new Date('2026-08-28T12:00:00.000Z')

function contributors(): readonly OrganizationExportContributor[] {
  return ORGANIZATION_LIFECYCLE_CONTEXTS.map((context) => ({
    context,
    contribute: async () =>
      context === 'identity'
        ? {
            context,
            coverage: 'complete' as const,
            omissionCodes: [],
            entries: [
              {
                path: 'identity/organization.csv',
                mediaType: 'text/csv' as const,
                classification: 'tenant_visible' as const,
                bytes: Buffer.from('id,name\norg-1,Example\n'),
              },
              {
                path: 'identity/organization.json',
                mediaType: 'application/json' as const,
                classification: 'tenant_visible' as const,
                bytes: Buffer.from('{"id":"org-1","name":"Example"}\n'),
              },
            ],
          }
        : {
            context,
            coverage: 'no_data' as const,
            omissionCodes: [],
            entries: [],
          },
  }))
}

describe('Organization Export contract', () => {
  it('builds deterministic coverage, schema, readme, and checksum manifest entries', async () => {
    const first = await buildOrganizationExportBundle({
      organizationId: 'org-1',
      requestId: '18deca2e-91a7-46e4-b92b-73163568ed84',
      asOf: AS_OF,
      contributors: contributors(),
    })
    const second = await buildOrganizationExportBundle({
      organizationId: 'org-1',
      requestId: '18deca2e-91a7-46e4-b92b-73163568ed84',
      asOf: AS_OF,
      contributors: contributors(),
    })

    expect(first.version).toBe(ORGANIZATION_EXPORT_FORMAT_VERSION)
    expect(first.manifestSha256).toBe(second.manifestSha256)
    expect(first.entries.map((entry) => entry.path)).toEqual([
      'README.md',
      'coverage.json',
      'schema.json',
      'identity/organization.csv',
      'identity/organization.json',
      'manifest.json',
    ])
    expect(first.manifest.entries).toHaveLength(5)
    expect(
      first.manifest.entries.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)),
    ).toBe(true)
  })

  it('requires one explicit contribution from every bounded context', async () => {
    await expect(
      buildOrganizationExportBundle({
        organizationId: 'org-1',
        requestId: 'request-1',
        asOf: AS_OF,
        contributors: contributors().slice(1),
      }),
    ).rejects.toThrow(/contributors are incomplete: activity/)
  })

  it('rejects paths associated with excluded secrets and operational internals', async () => {
    const invalid = contributors().map((contributor) =>
      contributor.context === 'integration'
        ? {
            ...contributor,
            contribute: async () => ({
              context: 'integration' as const,
              coverage: 'complete' as const,
              omissionCodes: [],
              entries: [
                {
                  path: 'integration/oauth-credentials.csv',
                  mediaType: 'text/csv' as const,
                  classification: 'content_free_lifecycle' as const,
                  bytes: Buffer.from('secret\n'),
                },
                {
                  path: 'integration/google-lifecycle.json',
                  mediaType: 'application/json' as const,
                  classification: 'content_free_lifecycle' as const,
                  bytes: Buffer.from('{}\n'),
                },
              ],
            }),
          }
        : contributor,
    )

    await expect(
      buildOrganizationExportBundle({
        organizationId: 'org-1',
        requestId: 'request-1',
        asOf: AS_OF,
        contributors: invalid,
      }),
    ).rejects.toThrow(/Unsafe Organization Export path/)
  })

  it('rejects plural excluded-material path components', async () => {
    const invalid = contributors().map((contributor) =>
      contributor.context === 'integration'
        ? {
            ...contributor,
            contribute: async () => ({
              context: 'integration' as const,
              coverage: 'complete' as const,
              omissionCodes: [],
              entries: [
                {
                  path: 'integration/credentials.csv',
                  mediaType: 'text/csv' as const,
                  classification: 'content_free_lifecycle' as const,
                  bytes: Buffer.from('state\nconnected\n'),
                },
                {
                  path: 'integration/credentials.json',
                  mediaType: 'application/json' as const,
                  classification: 'content_free_lifecycle' as const,
                  bytes: Buffer.from('{"state":"connected"}\n'),
                },
              ],
            }),
          }
        : contributor,
    )

    await expect(
      buildOrganizationExportBundle({
        organizationId: 'org-1',
        requestId: 'request-1',
        asOf: AS_OF,
        contributors: invalid,
      }),
    ).rejects.toThrow(/Unsafe Organization Export path/)
  })

  it('prevents raw Review and ordinary Integration content classifications', async () => {
    const invalid = contributors().map((contributor) =>
      contributor.context === 'review'
        ? {
            ...contributor,
            contribute: async () => ({
              context: 'review' as const,
              coverage: 'complete' as const,
              omissionCodes: [],
              entries: [
                {
                  path: 'review/google-reviews.csv',
                  mediaType: 'text/csv' as const,
                  classification: 'tenant_visible' as const,
                  bytes: Buffer.from('review\n'),
                },
                {
                  path: 'review/google-reviews.json',
                  mediaType: 'application/json' as const,
                  classification: 'tenant_visible' as const,
                  bytes: Buffer.from('{}\n'),
                },
              ],
            }),
          }
        : contributor,
    )

    await expect(
      buildOrganizationExportBundle({
        organizationId: 'org-1',
        requestId: 'request-1',
        asOf: AS_OF,
        contributors: invalid,
      }),
    ).rejects.toThrow(/classification is not permitted for review/)
  })

  it('rejects malformed lossless JSON before an archive is created', async () => {
    const invalid = contributors().map((contributor) =>
      contributor.context === 'identity'
        ? {
            ...contributor,
            contribute: async () => ({
              context: 'identity' as const,
              coverage: 'complete' as const,
              omissionCodes: [],
              entries: [
                {
                  path: 'identity/organization.csv',
                  mediaType: 'text/csv' as const,
                  classification: 'tenant_visible' as const,
                  bytes: Buffer.from('id\norg-1\n'),
                },
                {
                  path: 'identity/organization.json',
                  mediaType: 'application/json' as const,
                  classification: 'tenant_visible' as const,
                  bytes: Buffer.from('{not-json}\n'),
                },
              ],
            }),
          }
        : contributor,
    )

    await expect(
      buildOrganizationExportBundle({
        organizationId: 'org-1',
        requestId: 'request-1',
        asOf: AS_OF,
        contributors: invalid,
      }),
    ).rejects.toThrow(/invalid JSON/)
  })
})
