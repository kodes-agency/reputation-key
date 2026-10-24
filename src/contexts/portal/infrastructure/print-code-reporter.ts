// Portal context — reports what goes wrong with print codes (ADR 0069).
//
// A problem leaves two traces and no content: a log line carrying only its stable
// code, and an error of a class named for it, so error monitoring titles the issue
// by what happened. The error's message is the same stable code. A print code,
// its hash and the address are credentials (invariant 9), and the stack of an
// error built here has no frame that held one.

import type { LoggerPort } from '#/shared/domain/logger.port'
import { captureObservabilityException } from '#/shared/observability/telemetry'
import type {
  PrintCodeProblem,
  PrintCodeReporter,
} from '../application/ports/print-code-reporter.port'

class PrintCodeDeriveMismatch extends Error {
  override readonly name = 'PrintCodeDeriveMismatch'
  constructor() {
    super('portal.print_code.derive_mismatch')
  }
}

class PrintCodeFillFailed extends Error {
  override readonly name = 'PrintCodeFillFailed'
  constructor() {
    super('portal.print_code.fill_failed')
  }
}

class PrintCodeCollision extends Error {
  override readonly name = 'PrintCodeCollision'
  constructor() {
    super('portal.print_code.collision')
  }
}

const REPORTS: Readonly<Record<PrintCodeProblem, () => Error>> = {
  derive_mismatch: () => new PrintCodeDeriveMismatch(),
  fill_failed: () => new PrintCodeFillFailed(),
  collision: () => new PrintCodeCollision(),
}

export const createPrintCodeReporter =
  (logger: Pick<LoggerPort, 'error'>): PrintCodeReporter =>
  (problem) => {
    const error = REPORTS[problem]()
    logger.error({ errorCode: error.message }, 'Portal print code problem')
    // A reveal and a replace run in a web request; the click route reports its
    // content-free errors the same way.
    captureObservabilityException(error, { source: 'nitro' })
  }
