// Invariant types — the contract for cross-context consistency checks.
// Each checker returns violations; the runner aggregates them into a report.

export type InvariantSeverity = 'error' | 'warning'

export type InvariantViolation = Readonly<{
  /** The invariant checker that produced this violation. */
  checker: string
  /** Error = a real consistency bug. Warning = suspicious but maybe intentional. */
  severity: InvariantSeverity
  /** Human-readable description of the violation. */
  message: string
  /** Machine-readable evidence for debugging. */
  evidence?: Readonly<Record<string, unknown>>
}>

export type InvariantContext = Readonly<{
  /** Organization to scope the check to. */
  organizationId: string
  /** Properties to check (optional — omit for all). */
  propertyIds?: ReadonlyArray<string>
  /** Response SLA in hours (for SLA consistency checks). Default: 48. */
  slaHours?: number
}>

export type InvariantCheckerResult = ReadonlyArray<InvariantViolation>

export type InvariantChecker = Readonly<{
  /** Unique identifier for this checker. */
  id: string
  /** Human-readable description of what this checker verifies. */
  description: string
  /**
   * Run the check against the simulation state.
   * Returns an empty array when the invariant holds.
   */
  check: (ctx: InvariantContext) => Promise<InvariantCheckerResult>
}>

export type InvariantReport = Readonly<{
  violations: ReadonlyArray<InvariantViolation>
  totalCheckers: number
  passed: number
  failed: number
  ok: boolean
}>
