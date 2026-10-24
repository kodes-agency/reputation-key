// What is reported about print codes carries no content (ADR 0069, invariant 9):
// a stable code in the log, and an error of a class named for the problem whose
// message is the same stable code.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrintCodeProblem } from '../application/ports/print-code-reporter.port'

const mocks = vi.hoisted(() => ({ capture: vi.fn() }))

vi.mock('#/shared/observability/telemetry', () => ({
  captureObservabilityException: mocks.capture,
}))

import { createPrintCodeReporter } from './print-code-reporter'

const EXPECTED = [
  ['derive_mismatch', 'PrintCodeDeriveMismatch', 'portal.print_code.derive_mismatch'],
  ['fill_failed', 'PrintCodeFillFailed', 'portal.print_code.fill_failed'],
  ['collision', 'PrintCodeCollision', 'portal.print_code.collision'],
] as const satisfies readonly (readonly [PrintCodeProblem, string, string])[]

describe('createPrintCodeReporter', () => {
  const logger = { error: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(EXPECTED)(
    'reports %s as a %s with only its stable code',
    (problem, className, code) => {
      createPrintCodeReporter(logger)(problem)

      expect(logger.error).toHaveBeenCalledWith(
        { errorCode: code },
        'Portal print code problem',
      )
      const [error, context] = mocks.capture.mock.calls[0] ?? []
      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe(className)
      expect(error.message).toBe(code)
      expect(context).toEqual({ source: 'nitro' })
    },
  )

  it('hands the log and the error monitor nothing but the stable code', () => {
    const report = createPrintCodeReporter(logger)
    for (const [problem] of EXPECTED) report(problem)

    const everything = JSON.stringify([
      logger.error.mock.calls,
      mocks.capture.mock.calls.map(([error]) => [error.name, error.message, error.cause]),
    ])
    expect(everything).not.toMatch(/[0-9A-HJKMNP-TV-Z]{20}|[0-9a-f]{64}|pt_|https?:/u)
  })
})
