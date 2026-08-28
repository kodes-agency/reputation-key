import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { googleConnectionId, organizationId, userId } from '#/shared/domain/ids'
import type { PropertyFkCleanupPort } from '../application/ports/property-fk-cleanup.port'
import { createGoogleConnectionRepository } from './repositories/google-connection.repository'

vi.mock('#/shared/observability/trace', () => ({
  trace: async (_name: string, run: () => Promise<unknown>) => run(),
}))

const NOW = new Date('2099-01-01T12:34:56.789Z')
const ORG = organizationId('org-google-clock-authority')
const CONNECTION = googleConnectionId('91000000-0000-4000-8000-000000000001')
const ACTOR = userId('user-google-clock-authority')

function mutationDatabase(updateSets: Array<Record<string, unknown>>): Database {
  return {
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => {
        updateSets.push(values)
        const whereResult = Object.assign(Promise.resolve([]), {
          returning: async () => [{ id: CONNECTION }],
        })
        return { where: () => whereResult }
      },
    })),
  } as unknown as Database
}

describe('Google connection repository time authority', () => {
  it('uses exactly one injected timestamp for each retained mutation path', async () => {
    const updateSets: Array<Record<string, unknown>> = []
    const clock = vi.fn(() => NOW)
    const propertyFkCleanup: PropertyFkCleanupPort = {
      clearGoogleConnectionRef: async () => {},
    }
    const repository = createGoogleConnectionRepository(
      mutationDatabase(updateSets),
      propertyFkCleanup,
      clock,
    )
    const expiresAt = new Date('2099-01-01T13:00:00.000Z')

    await repository.updateTokens(
      ORG,
      CONNECTION,
      { lifecycleVersion: 1, credentialGeneration: 1 },
      'access-2',
      'refresh-2',
      expiresAt,
    )
    await repository.updateTokensAndStatus(
      ORG,
      CONNECTION,
      'access-3',
      'refresh-3',
      expiresAt,
      'active',
    )
    await repository.updateStatus(ORG, CONNECTION, 'degraded')
    await repository.redactForDisconnect(ORG, CONNECTION)
    await repository.updateVisibility(ORG, CONNECTION, 'organization')
    await repository.updateReconnection(
      ORG,
      CONNECTION,
      'subject-2',
      'access-4',
      'refresh-4',
      expiresAt,
      'organization',
      ['scope-a'],
      { homeCellId: 'us', cataloguePolicyVersion: 2, authorityGeneration: 3 },
      ACTOR,
      new Date('2099-01-01T12:30:00.000Z'),
    )

    expect(clock).toHaveBeenCalledTimes(6)
    expect(updateSets).toHaveLength(6)
    for (const values of updateSets) {
      expect(values.updatedAt).toBe(NOW)
    }
  })
})
