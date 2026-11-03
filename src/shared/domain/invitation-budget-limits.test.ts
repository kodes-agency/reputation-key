import { expect, it } from 'vitest'
import {
  INVITATION_ACTOR_LIMIT,
  INVITATION_ORGANIZATION_LIMIT,
  INVITATION_BUDGET_MESSAGE,
} from './invitation-budget-limits'
it('words the refusal from the actual send budget', () => {
  expect(INVITATION_BUDGET_MESSAGE).toContain(
    `${INVITATION_ACTOR_LIMIT.maxRequests} invitations an hour and ${INVITATION_ORGANIZATION_LIMIT.maxRequests} a day`,
  )
  expect(INVITATION_ACTOR_LIMIT.windowSeconds).toBe(3600)
  expect(INVITATION_ORGANIZATION_LIMIT.windowSeconds).toBe(86400)
})
