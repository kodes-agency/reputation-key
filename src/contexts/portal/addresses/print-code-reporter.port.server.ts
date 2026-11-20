// Portal context — what is reported about print codes (ADR 0069).
//
// Each problem is a stable name and nothing else: a print code, its hash and the
// long address are credentials (invariant 9), so the report cannot carry them.
// The adapter turns a problem into a log line and a content-free error class.

/**
 * `derive_mismatch`: a reveal found a stored hash that differs from the one it
 * derived, or could not derive at all, and printed the long address instead.
 * `fill_failed`: a missing hash could not be stored, for any reason.
 * `collision`: a unique index refused a hash (a new code's, or a fill).
 */
export type PrintCodeProblem = 'derive_mismatch' | 'fill_failed' | 'collision'

export type PrintCodeReporter = (problem: PrintCodeProblem) => void
