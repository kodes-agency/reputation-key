import { describe, expect, it, vi } from 'vitest'
import type { Tx } from '#/shared/outbox/commit'
import { googleConnectionId, organizationId, userId } from '#/shared/domain/ids'
import { applyOrganizationGoogleCredentialHome } from './organization-google-credential-home-command'

const ORG = organizationId('org-home-command')
const CONNECTION = googleConnectionId('30000000-0000-4000-8000-000000000001')
const ACTOR = userId('user-home-command')
const NOW = new Date('2026-08-27T12:00:00Z')

function txWithRows(rows: readonly (readonly Record<string, unknown>[])[]) {
  const queue = [...rows]
  const execute = vi.fn(async () => ({ rows: queue.shift() ?? [] }))
  return { tx: { execute } as unknown as Tx, execute }
}

describe('atomic Organization Google credential-home command authority', () => {
  it('refuses before taking the Organization lock while topology is fenced', async () => {
    const { tx, execute } = txWithRows([[{ state: 'fenced' }]])
    await expect(
      applyOrganizationGoogleCredentialHome(tx, {
        organizationId: ORG,
        targetConnectionId: null,
        requested: {
          homeCellId: 'us',
          cataloguePolicyVersion: 3,
          authorityGeneration: 1,
        },
        reason: 'new_grant',
        changedBy: ACTOR,
        changeTicket: null,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'data_cell_topology_cutover_fenced' })
    expect(execute).toHaveBeenCalledOnce()
  })

  it('establishes authority under lock before a first connection write', async () => {
    const { tx, execute } = txWithRows([
      [{ state: 'open' }],
      [],
      [],
      [{ active_count: 0 }],
      [],
    ])
    await applyOrganizationGoogleCredentialHome(tx, {
      organizationId: ORG,
      targetConnectionId: null,
      requested: {
        homeCellId: 'us',
        cataloguePolicyVersion: 3,
        authorityGeneration: 1,
      },
      reason: 'new_grant',
      changedBy: ACTOR,
      changeTicket: null,
      now: NOW,
    })
    expect(execute).toHaveBeenCalledTimes(5)
  })

  it('preserves an exact authority without a write', async () => {
    const { tx, execute } = txWithRows([
      [{ state: 'open' }],
      [],
      [
        {
          organization_id: ORG,
          home_cell_id: 'us',
          catalogue_policy_version: 3,
          authority_generation: 4,
          created_at: NOW,
          updated_at: NOW,
        },
      ],
      [{ active_count: 3 }],
    ])
    await applyOrganizationGoogleCredentialHome(tx, {
      organizationId: ORG,
      targetConnectionId: CONNECTION,
      requested: {
        homeCellId: 'us',
        cataloguePolicyVersion: 3,
        authorityGeneration: 4,
      },
      reason: 'credential_rotation',
      changedBy: ACTOR,
      changeTicket: null,
      now: NOW,
    })
    expect(execute).toHaveBeenCalledTimes(4)
  })

  it('denies a new split grant before any authority mutation', async () => {
    const { tx, execute } = txWithRows([
      [{ state: 'open' }],
      [],
      [
        {
          organization_id: ORG,
          home_cell_id: 'europe',
          catalogue_policy_version: 2,
          authority_generation: 4,
          created_at: NOW,
          updated_at: NOW,
        },
      ],
      [{ active_count: 1 }],
    ])
    await expect(
      applyOrganizationGoogleCredentialHome(tx, {
        organizationId: ORG,
        targetConnectionId: null,
        requested: {
          homeCellId: 'us',
          cataloguePolicyVersion: 3,
          authorityGeneration: 5,
        },
        reason: 'new_grant',
        changedBy: ACTOR,
        changeTicket: null,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'oauth_failed' })
    expect(execute).toHaveBeenCalledTimes(4)
  })

  it('replaces append-only authority only for a reconnect with no other active grant', async () => {
    const { tx, execute } = txWithRows([
      [{ state: 'open' }],
      [],
      [
        {
          organization_id: ORG,
          home_cell_id: 'europe',
          catalogue_policy_version: 2,
          authority_generation: 4,
          created_at: NOW,
          updated_at: NOW,
        },
      ],
      [{ active_count: 0 }],
      [{ organization_id: ORG }],
      [],
    ])
    await applyOrganizationGoogleCredentialHome(tx, {
      organizationId: ORG,
      targetConnectionId: CONNECTION,
      requested: {
        homeCellId: 'us',
        cataloguePolicyVersion: 3,
        authorityGeneration: 5,
      },
      reason: 'governed_reconnect',
      changedBy: ACTOR,
      changeTicket: 'REG-home-move-1',
      now: NOW,
    })
    expect(execute).toHaveBeenCalledTimes(6)
  })

  it('rejects a stale pre-exchange authority generation under the transaction lock', async () => {
    const { tx, execute } = txWithRows([
      [{ state: 'open' }],
      [],
      [
        {
          organization_id: ORG,
          home_cell_id: 'us',
          catalogue_policy_version: 3,
          authority_generation: 4,
          created_at: NOW,
          updated_at: NOW,
        },
      ],
      [{ active_count: 0 }],
    ])
    await expect(
      applyOrganizationGoogleCredentialHome(tx, {
        organizationId: ORG,
        targetConnectionId: CONNECTION,
        requested: {
          homeCellId: 'us',
          cataloguePolicyVersion: 3,
          authorityGeneration: 3,
        },
        reason: 'credential_rotation',
        changedBy: ACTOR,
        changeTicket: null,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'oauth_failed' })
    expect(execute).toHaveBeenCalledTimes(4)
  })
})
