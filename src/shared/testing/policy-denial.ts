// What a server function sees when the execution policy refuses: the tagged
// 403 `requireExecutionAllowed` throws, carrying the policy's reason as its
// code (src/shared/auth/execution-policy.ts). The default is the refusal of a
// manager with no grant on the Property; the reason is typed, so a test cannot
// name one the policy does not have.
//
// Handler tests used to stand a refusal in with `new Error('refused')`. The
// policy never throws that, a handler answers it as a sanitised 500, and the
// tests then asserted only that something was rejected, which an unconfigured
// mock's TypeError satisfied just as well.

import { ServerFunctionError } from '#/shared/auth/server-function-error'
import type { PolicyDenyReason } from '#/shared/auth/execution-policy'

export const policyDenial = (
  reason: PolicyDenyReason = 'scope_denied',
): ServerFunctionError =>
  new ServerFunctionError('AuthError', `Authorization denied: ${reason}`, reason, 403)
