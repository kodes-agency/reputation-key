/**
 * A consumer's input has not arrived yet: another consumer or job is still
 * producing the fact this one needs, and the order of durable consumers is not
 * guaranteed. The dispatcher retries it soon, keeps its receipts and attempt
 * budget, and does not report it as a failure. Throw it only for an expected
 * ordering wait, never for a real error.
 */
export class PrerequisiteNotReadyError extends Error {
  readonly code: string

  constructor(message: string, code = 'prerequisite_not_ready') {
    super(message)
    this.name = 'PrerequisiteNotReadyError'
    this.code = code
  }
}
