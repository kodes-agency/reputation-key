// The typed outcome of a refused read. Server side only: the release check's
// server half is the one place that throws it, and keeping the class out of
// release-skew.ts keeps first paint free of an import it never calls.

import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { STALE_CLIENT_CODE } from './release-skew'

/**
 * A 4xx, so the message reaches a person as written (`actionErrorMessage`) and
 * monitoring treats it as an expected refusal (`isExpectedRefusal`).
 */
export function staleClientRefusal(): ServerFunctionError {
  return new ServerFunctionError(
    'StaleClient',
    'Reputation Key was updated while this page was open. Reload to continue.',
    STALE_CLIENT_CODE,
    409,
  )
}
