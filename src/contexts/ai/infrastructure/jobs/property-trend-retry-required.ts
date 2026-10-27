import type { PropertyTrendRetryCode } from '../../application/use-cases/generate-property-trend'

/**
 * A scheduled trend run that asks to be tried again. The message is the one the
 * job has always thrown, so a quarantine reason and a runbook that quote it still
 * match. The code is also a field of its own: error monitoring replaces every
 * message but reads `failureCode` into a tag (shared/observability/error-facts.ts),
 * so the issue says which of the closed set of codes the run stopped with instead
 * of reading "Error: [REDACTED]".
 */
export class PropertyTrendRetryRequired extends Error {
  override readonly name = 'PropertyTrendRetryRequired'
  readonly failureCode: PropertyTrendRetryCode

  constructor(failureCode: PropertyTrendRetryCode) {
    super(`AI property trend retry required: ${failureCode}`)
    this.failureCode = failureCode
  }
}
