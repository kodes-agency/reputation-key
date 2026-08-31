import { describe, expect, it, vi } from 'vitest'
import { DATA_CELL_CATALOGUE_POLICY_VERSION } from '#/shared/domain/data-cell-catalogue'
import { googleConnectionId, organizationId, userId } from '#/shared/domain/ids'
import { createGoogleCredentialHomeCapture } from './google-credential-home'
import type { OrganizationGoogleCredentialHomeAuthority } from './ports/organization-google-credential-home-authority.port'

const ORG = organizationId('org-canonical-google-home')
const CONNECTION = googleConnectionId('10000000-0000-4000-8000-000000000001')

describe('Google credential-home capture', () => {
  it('captures a new home only through the canonical Organization authority', async () => {
    const inspectForCredentialExchange = vi.fn(async () => ({
      authority: null,
      otherActiveGrantCount: 0,
    }))
    const reserveForCredentialExchange = vi.fn(async () => undefined)
    const capture = createGoogleCredentialHomeCapture({
      authority: { inspectForCredentialExchange, reserveForCredentialExchange },
      localCellId: 'us',
    })

    await expect(
      capture({
        organizationId: ORG,
        mode: 'new',
        targetConnectionId: null,
        changedBy: userId('user-home'),
        now: new Date('2026-08-28T00:00:00Z'),
      }),
    ).resolves.toEqual({
      homeCellId: 'us',
      cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
      authorityGeneration: 1,
    })
    expect(inspectForCredentialExchange).toHaveBeenCalledWith({
      organizationId: ORG,
      targetConnectionId: null,
    })
    expect(reserveForCredentialExchange).toHaveBeenCalledWith({
      organizationId: ORG,
      targetConnectionId: null,
      requested: {
        homeCellId: 'us',
        cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
        authorityGeneration: 1,
      },
      reason: 'new_grant',
      changedBy: userId('user-home'),
      now: new Date('2026-08-28T00:00:00Z'),
    })
  })

  it('fails closed when legacy active grants exist without canonical authority', async () => {
    const authority: OrganizationGoogleCredentialHomeAuthority = {
      inspectForCredentialExchange: async () => ({
        authority: null,
        otherActiveGrantCount: 2,
      }),
      reserveForCredentialExchange: async () => undefined,
    }
    const capture = createGoogleCredentialHomeCapture({ authority, localCellId: 'us' })

    await expect(
      capture({
        organizationId: ORG,
        mode: 'new',
        targetConnectionId: null,
        changedBy: userId('user-home'),
        now: new Date('2026-08-28T00:00:00Z'),
      }),
    ).rejects.toMatchObject({ code: 'oauth_failed' })
  })

  it('allows governed reconnect to establish a missing authority for its sole grant', async () => {
    const authority: OrganizationGoogleCredentialHomeAuthority = {
      inspectForCredentialExchange: async () => ({
        authority: null,
        otherActiveGrantCount: 0,
      }),
      reserveForCredentialExchange: async () => undefined,
    }
    const capture = createGoogleCredentialHomeCapture({ authority, localCellId: 'us' })

    await expect(
      capture({
        organizationId: ORG,
        mode: 'reconnect',
        targetConnectionId: CONNECTION,
        changedBy: userId('user-home'),
        now: new Date('2026-08-28T00:00:00Z'),
      }),
    ).resolves.toEqual({
      homeCellId: 'us',
      cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
      authorityGeneration: 1,
    })
  })

  it('denies a home mismatch for rotation and a split reconnect', async () => {
    const authority: OrganizationGoogleCredentialHomeAuthority = {
      inspectForCredentialExchange: async () => ({
        authority: {
          organizationId: ORG,
          homeCellId: 'europe',
          cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
          authorityGeneration: 3,
          createdAt: new Date('2026-08-27T01:00:00Z'),
          updatedAt: new Date('2026-08-27T01:00:00Z'),
        },
        otherActiveGrantCount: 1,
      }),
      reserveForCredentialExchange: async () => undefined,
    }
    const capture = createGoogleCredentialHomeCapture({ authority, localCellId: 'us' })

    await expect(
      capture({
        organizationId: ORG,
        mode: 'reauth',
        targetConnectionId: CONNECTION,
        changedBy: userId('user-home'),
        now: new Date('2026-08-28T00:00:00Z'),
      }),
    ).rejects.toMatchObject({ code: 'oauth_failed' })
    await expect(
      capture({
        organizationId: ORG,
        mode: 'reconnect',
        targetConnectionId: CONNECTION,
        changedBy: userId('user-home'),
        now: new Date('2026-08-28T00:00:00Z'),
      }),
    ).rejects.toMatchObject({ code: 'oauth_failed' })
  })
})
