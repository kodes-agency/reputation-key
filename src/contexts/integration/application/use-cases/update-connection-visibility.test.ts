// Integration context — update connection visibility use case tests

import { describe, it, expect } from 'vitest'
import { updateConnectionVisibility } from './update-connection-visibility'
import { createInMemoryGoogleConnectionRepo } from '#/shared/testing/in-memory-google-connection-repo'
import { createSequentialIntegrationCommandStore } from '#/shared/testing/sequential-integration-command-store'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import {
  buildTestAuthContext,
  buildTestGoogleConnection,
} from '#/shared/testing/fixtures'
import { isIntegrationError } from '../../domain/errors'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const setup = () => {
  const connectionRepo = createInMemoryGoogleConnectionRepo()
  const outbox = createRecordedOutbox()
  const deps = {
    connectionRepo,
    commandStore: createSequentialIntegrationCommandStore({ connectionRepo, outbox }),
    clock: () => FIXED_TIME,
  }
  const useCase = updateConnectionVisibility(deps)
  return { useCase, connectionRepo, outbox }
}

describe('updateConnectionVisibility', () => {
  it('updates visibility and records a fact with the correct visibility', async () => {
    const { useCase, connectionRepo, outbox } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const connection = buildTestGoogleConnection({ visibility: 'private' })
    connectionRepo.seed([connection])

    const result = await useCase(
      { connectionId: connection.id as string, visibility: 'organization' },
      ctx,
    )

    expect(result.visibility).toBe('organization')

    const facts = outbox.byTag('integration.google_connection.visibility_changed')
    expect(facts).toHaveLength(1)
    expect(facts[0].connectionId).toBe(connection.id)
    expect(facts[0].visibility).toBe('organization')
    expect(facts[0].organizationId).toBe(ctx.organizationId)
    expect(facts[0].occurredAt).toBe(FIXED_TIME)
  })

  it('rejects users without integration.manage permission', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(
      useCase({ connectionId: 'any-id', visibility: 'organization' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isIntegrationError(e) && (e as { code: string }).code === 'forbidden',
    )
  })

  it('throws when connection not found', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(
      useCase(
        {
          connectionId: 'nonexistent-0000-0000-0000-000000000001',
          visibility: 'organization',
        },
        ctx,
      ),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isIntegrationError(e) && (e as { code: string }).code === 'connection_not_found',
    )
  })
})
