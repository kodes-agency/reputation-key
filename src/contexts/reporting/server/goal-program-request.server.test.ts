import { describe, expect, it } from 'vitest'
import { requestPolicy } from './goal-program-request.server'

const ctx = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  userId: 'manager-1',
  role: 'AccountAdmin',
} as unknown as Parameters<typeof requestPolicy>[0]

// The request policy lets the caller act only as themselves in their own
// Organization; it refuses anything else before asking the execution policy.
describe('requestPolicy', () => {
  it.each([
    ['another user', { actor: { ...ctx, userId: 'another-user' } }],
    ['another Organization', { organizationId: '00000000-0000-4000-8000-000000000009' }],
    ['the system', { actor: 'system' as const }],
  ])('refuses acting as %s', async (_, override) => {
    await expect(
      requestPolicy(ctx).authorize({
        actor: ctx,
        organizationId: ctx.organizationId,
        propertyId: '00000000-0000-4000-8000-000000000002',
        action: 'goal.read',
        ...override,
      }),
    ).rejects.toMatchObject({ name: 'GoalProgramError', code: 'forbidden' })
  })
})
