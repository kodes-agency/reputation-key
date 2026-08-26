import type { ExecutionPolicy } from '#/shared/auth/execution-policy'
import type { ContactRequestExecutionPolicyPort } from '../../application/ports/contact-request-execution-policy.port'

export const createContactRequestExecutionPolicyAdapter = (
  policy: Pick<ExecutionPolicy, 'decide'>,
): ContactRequestExecutionPolicyPort => ({
  decide: async (request) => {
    const decision = await policy.decide(request)
    return { allowed: decision.allowed, reason: decision.reason }
  },
})
