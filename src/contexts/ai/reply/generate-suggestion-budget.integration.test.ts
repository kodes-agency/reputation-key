import {
  createHarness,
  INPUT,
  NOW,
  ORGANIZATION_ID,
} from '#/contexts/ai/infrastructure/testing/reply-handler.test-fixtures'
import { aiOrganizationCostWindows } from '#/shared/db/schema'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { eq } from 'drizzle-orm'
import { expect, it, vi } from 'vitest'

// Historical v1 remains readable; these contract regressions deliberately pin its old execution.
vi.mock('#/shared/ai-runtime-capability-contract', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('#/shared/ai-runtime-capability-contract')>()
  const { historicalReplyRuntime } =
    await import('#/shared/testing/historical-reply-runtime')
  return historicalReplyRuntime(actual)
})
import type { AiOperationId } from '../domain/types'
import { createAiOrganizationSpendAdapter } from '../infrastructure/adapters/ai-organization-spend.adapter'

it('admits and settles drafts against each tenant budget independently in the same month', async () => {
  const first = await createHarness()
  const otherIdentity = {
    organizationId: organizationId('ai-reply-other-budget-org'),
    propertyId: propertyId('73000000-0000-4000-8000-000000000101'),
    reviewId: reviewId('73000000-0000-4000-8000-000000000102'),
    operationId: '73000000-0000-4000-8000-000000000104' as AiOperationId,
    permitId: '73000000-0000-4000-8000-000000000105',
    lineageId: '73000000-0000-4000-8000-000000000106',
  }
  const other = await createHarness({ identity: otherIdentity })
  const otherInput = {
    ...INPUT,
    organizationId: otherIdentity.organizationId,
    propertyId: otherIdentity.propertyId,
    reviewId: otherIdentity.reviewId,
  }
  const spend = createAiOrganizationSpendAdapter(first.persistence.db)
  const read = (organizationId: typeof ORGANIZATION_ID) =>
    spend.readCurrentMonth({ organizationId, nowEpochMillis: NOW })

  const results = await Promise.all([first.generate(INPUT), other.generate(otherInput)])
  expect(results.map((result) => result.status)).toEqual(['ready', 'ready'])
  await expect(read(ORGANIZATION_ID)).resolves.toMatchObject({
    settledMicros: 42,
    reservedMicros: 0,
  })
  await expect(read(otherIdentity.organizationId)).resolves.toMatchObject({
    settledMicros: 42,
    reservedMicros: 0,
  })
  for (const handler of [first, other]) {
    expect(await handler.persistence.storedOperations()).toMatchObject([
      {
        state: 'succeeded',
        executionAttempt: 1,
        actualMicros: 42,
        budgetSettledAt: new Date(NOW),
        deliveredAt: new Date(NOW),
      },
    ])
  }

  await first.persistence.db
    .update(aiOrganizationCostWindows)
    .set({ settledMicros: 50_000_000 })
    .where(eq(aiOrganizationCostWindows.organizationId, ORGANIZATION_ID))
  const exhausted = await read(ORGANIZATION_ID)
  expect(
    await first.generate({ ...INPUT, idempotencyKey: 'over-budget-request' }),
  ).toMatchObject({ status: 'unavailable' })
  await expect(read(ORGANIZATION_ID)).resolves.toEqual(exhausted)
  expect(
    await other.generate({ ...otherInput, idempotencyKey: 'next-request' }),
  ).toMatchObject({ status: 'ready' })
  await expect(read(otherIdentity.organizationId)).resolves.toMatchObject({
    settledMicros: 84,
    reservedMicros: 0,
  })
  await expect(read(ORGANIZATION_ID)).resolves.toEqual(exhausted)
})

it('does not borrow another tenant consent for the requested Property', async () => {
  const handler = await createHarness()
  await expect(
    handler.generate({
      ...INPUT,
      organizationId: organizationId('other-drafting-tenant'),
    }),
  ).resolves.toMatchObject({
    status: 'unavailable',
    code: 'not_authorized',
  })
  expect(await handler.persistence.storedOperations()).toEqual([])
  expect(handler.mocks.acquire).not.toHaveBeenCalled()
  expect(handler.mocks.generateReply).not.toHaveBeenCalled()
})
