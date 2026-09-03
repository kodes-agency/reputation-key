import { CONTEXT_STANDARDS_AUTHORITY } from './context-standards-authority'

/**
 * Current-tree 17-context x 9-rule successor to the frozen standards audit. “Evidenced”
 * is deliberately narrow: it names a repository fact enforced by the focused
 * test, not blanket package or release closure. “Accepted exception” binds an
 * exact current-tree variance to the owned, expiring exception register;
 * “unresolved” remains reserved for a newly discovered rule gap that has neither
 * proof nor approved exception authority.
 */
export const CONTEXT_STANDARD_DIMENSIONS = Object.freeze([
  { id: 'tags', authority: 'docs/standards.md §1.1', claim: 'event tag shape' },
  {
    id: 'envelope',
    authority: 'docs/standards.md §1.5, §1.6, §1.9',
    claim: 'event envelope and fields',
  },
  {
    id: 'assert',
    authority: 'docs/standards.md §1.4',
    claim: 'event constructor validation',
  },
  {
    id: 'union',
    authority: 'docs/standards.md §1.7, §1.8',
    claim: 'context and master event unions',
  },
  {
    id: 'errors',
    authority: 'docs/standards.md §2.1; src/contexts/CONTEXT.md BQR-1.2',
    claim: 'layer-specific error flow',
  },
  {
    id: 'build',
    authority: 'docs/standards.md §3.1',
    claim: 'context build return shape',
  },
  {
    id: 'docs',
    authority: 'docs/standards.md §4.1',
    claim: 'required context documentation',
  },
  {
    id: 'repositories',
    authority: 'docs/standards.md §5.1, §5.2',
    claim: 'repository ports and tenant-scoped signatures',
  },
  {
    id: 'factories',
    authority: 'docs/standards.md §8.3',
    claim: 'infrastructure factory declarations',
  },
] as const)

export type ContextStandardDimension = (typeof CONTEXT_STANDARD_DIMENSIONS)[number]['id']
export type ContextStandardEvidence = Readonly<{
  path: string
  kind: 'file' | 'directory' | 'absent'
  contains?: readonly string[]
}>
export type ContextStandardCell =
  | Readonly<{
      applicability: 'applicable'
      resolution: 'evidenced' | 'unresolved'
      rationale: string
      evidence: readonly ContextStandardEvidence[]
    }>
  | Readonly<{
      applicability: 'applicable'
      resolution: 'accepted_exception'
      exceptionId: string
      rationale: string
      evidence: readonly ContextStandardEvidence[]
    }>
  | Readonly<{
      applicability: 'not_applicable'
      resolution: null
      rationale: string
      evidence: readonly ContextStandardEvidence[]
    }>
export type ContextStandardsMatrixRow = Readonly<{
  name: string
  directory: string
  standards: Readonly<Record<ContextStandardDimension, ContextStandardCell>>
}>

const EVENTLESS = new Set(['activity', 'dashboard', 'leaderboard', 'notification'])
const CONTRACTED_RUNTIME_CONTEXTS = new Set(['badge', 'leaderboard'])
const EVENTFUL = CONTEXT_STANDARDS_AUTHORITY.map(({ directory }) => directory).filter(
  (directory) => !EVENTLESS.has(directory),
)
const EVIDENCED = {
  tags: EVENTFUL.filter((directory) => directory !== 'portal'),
  envelope: [
    'ai',
    'badge',
    'goal',
    'guest',
    'identity',
    'inbox',
    'integration',
    'metric',
    'portal',
    'property',
    'review',
    'staff',
    'team',
  ],
  assert: EVENTFUL,
  union: EVENTFUL,
  errors: CONTEXT_STANDARDS_AUTHORITY.map(({ directory }) => directory)
    .filter((directory) => !CONTRACTED_RUNTIME_CONTEXTS.has(directory))
    .filter(
      (directory) =>
        ![
          'activity',
          'goal',
          'guest',
          'identity',
          'metric',
          'notification',
          'review',
        ].includes(directory),
    ),
  build: CONTEXT_STANDARDS_AUTHORITY.map(({ directory }) => directory),
  docs: CONTEXT_STANDARDS_AUTHORITY.map(({ directory }) => directory),
  repositories: [
    'dashboard',
    'goal',
    'guest',
    'inbox',
    'integration',
    'notification',
    'portal',
    'property',
    'staff',
    'team',
  ],
  factories: [
    'activity',
    'ai',
    'badge',
    'dashboard',
    'goal',
    'guest',
    'identity',
    'inbox',
    'integration',
    'leaderboard',
    'metric',
    'notification',
    'portal',
    'property',
    'review',
    'staff',
    'team',
  ],
} as const satisfies Record<ContextStandardDimension, readonly string[]>
const NOT_APPLICABLE = {
  tags: [...EVENTLESS],
  envelope: [...EVENTLESS],
  assert: [...EVENTLESS],
  union: [...EVENTLESS],
  errors: [...CONTRACTED_RUNTIME_CONTEXTS],
  build: [],
  docs: [],
  repositories: ['ai', 'identity', ...CONTRACTED_RUNTIME_CONTEXTS],
  factories: [],
} as const satisfies Record<ContextStandardDimension, readonly string[]>
const ACCEPTED_EXCEPTIONS: Partial<
  Record<ContextStandardDimension, Readonly<Record<string, string>>>
> = {
  tags: { portal: 'STD-MAINT-001' },
  errors: {
    activity: 'STD-INV-037',
    goal: 'STD-INV-002',
    guest: 'STD-INV-038',
    identity: 'STD-INV-039',
    metric: 'STD-INV-040',
    notification: 'STD-INV-041',
    review: 'STD-INV-003',
  },
  repositories: {
    activity: 'STD-MAINT-034',
    metric: 'STD-MAINT-035',
    review: 'STD-MAINT-036',
  },
}

const unresolvedRationale: Record<ContextStandardDimension, string> = {
  tags: 'Portal retains tags without the portal context prefix.',
  envelope:
    'No exhaustive check proves every event envelope, flat payload, and field name.',
  assert: 'No exhaustive check proves every constructor assertion and identifier owner.',
  union: 'Context or master-union membership is not mechanically evidenced.',
  errors:
    'Mixed legacy error flows remain; narrow tagged-error gates do not prove all paths.',
  build:
    'The build return shape differs from the publicApi/internal/repositories/useCases contract.',
  docs: 'The Events produced section is not exhaustively tabulated or explicitly absent.',
  repositories:
    'Repository names and tenant-scoped signatures lack an exhaustive context gate.',
  factories:
    'A legacy export-function infrastructure factory remains for touch-triggered migration.',
}
const evidencedRationale: Partial<Record<ContextStandardDimension, string>> = {
  tags: 'Every literal event tag has the context prefix and two or three snake-case segments.',
  envelope:
    'Every exported event-union member and constructor passes the exhaustive envelope, flat-payload, field-vocabulary, ordering, and source-semantics proof.',
  assert:
    'Every exported event constructor reaches an explicit assertion or validation helper before constructing its fact.',
  union:
    'The context event union exists and is a member of the shared master event union.',
  build:
    'The build source exposes publicApi, internal repositories, and an explicitly owned request or worker execution surface.',
  docs: 'Required headings are ordered and events are tabulated or explicitly absent.',
  factories:
    'No legacy export-function create factory exists in production infrastructure.',
}

function eventDimensionEvidence(
  context: string,
  directory: string,
  dimension: ContextStandardDimension,
): readonly ContextStandardEvidence[] {
  if (EVENTLESS.has(directory)) {
    return [{ path: `${context}/domain/events.ts`, kind: 'absent' }]
  }
  const evidence: ContextStandardEvidence[] = [
    { path: `${context}/domain/events.ts`, kind: 'file' },
  ]
  if (dimension === 'union') {
    evidence.push({ path: 'src/shared/events/events.ts', kind: 'file' })
  }
  return evidence
}

function repositoryEvidence(
  context: string,
  directory: string,
): readonly ContextStandardEvidence[] {
  if (CONTRACTED_RUNTIME_CONTEXTS.has(directory)) {
    return [{ path: `${context}/build.ts`, kind: 'file', contains: ['repos: {}'] }]
  }
  if (directory === 'activity') {
    return [
      {
        path: `${context}/ports/recent-activity-repository.port.ts`,
        kind: 'file',
      },
      { path: `${context}/infrastructure/repositories`, kind: 'directory' },
    ]
  }
  if (directory === 'identity') {
    return [{ path: `${context}/application/ports`, kind: 'directory' }]
  }
  return [
    { path: `${context}/application/ports`, kind: 'directory' },
    {
      path: `${context}/infrastructure/repositories`,
      kind: directory === 'ai' ? 'absent' : 'directory',
    },
  ]
}

function evidenceFor(
  directory: string,
  dimension: ContextStandardDimension,
): readonly ContextStandardEvidence[] {
  const context = `src/contexts/${directory}`
  if (['tags', 'envelope', 'assert', 'union'].includes(dimension)) {
    return eventDimensionEvidence(context, directory, dimension)
  }
  if (dimension === 'errors')
    return CONTRACTED_RUNTIME_CONTEXTS.has(directory)
      ? [{ path: `${context}/build.ts`, kind: 'file', contains: ['publicApi: {}'] }]
      : [{ path: `${context}/domain/errors.ts`, kind: 'file' }]
  if (dimension === 'build') return [{ path: `${context}/build.ts`, kind: 'file' }]
  if (dimension === 'docs')
    return [
      { path: `${context}/CONTEXT.md`, kind: 'file', contains: ['## Events produced'] },
    ]
  if (dimension === 'repositories') return repositoryEvidence(context, directory)
  if (dimension === 'factories' && directory === 'badge') {
    return [{ path: `${context}/build.ts`, kind: 'file', contains: ['repos: {}'] }]
  }
  return [{ path: `${context}/infrastructure`, kind: 'directory' }]
}

function notApplicableRationale(
  directory: string,
  dimension: ContextStandardDimension,
): string {
  if (CONTRACTED_RUNTIME_CONTEXTS.has(directory)) {
    return 'REC-01 retains no product use case, error flow, or entity repository in this context; its inert build and content-free compatibility boundary are governed separately.'
  }
  if (dimension !== 'repositories') return 'This context produces no domain events.'
  if (directory === 'ai') {
    return 'AI owns store and adapter ports rather than entity repository ports.'
  }
  return 'Identity owns authorization, command-store, and lifecycle-authority ports rather than an entity repository contract.'
}

function acceptedExceptionRationale(dimension: ContextStandardDimension): string {
  if (dimension === 'tags') {
    return 'Portal retains its published legacy tag vocabulary until every durable consumer can migrate through a versioned compatibility window.'
  }
  if (dimension === 'repositories') {
    return 'The exact legacy repository-port placement is pinned while its imports and implementing adapters await an owner-scoped rename.'
  }
  return 'The exact legacy application Result or native domain-error variance is pinned; changing its caller-visible failure contract requires a bounded behavioral migration.'
}

function cellFor(
  directory: string,
  dimension: ContextStandardDimension,
): ContextStandardCell {
  const evidence = evidenceFor(directory, dimension)
  if ((NOT_APPLICABLE[dimension] as readonly string[]).includes(directory)) {
    return {
      applicability: 'not_applicable',
      resolution: null,
      rationale: notApplicableRationale(directory, dimension),
      evidence,
    }
  }
  const exceptionId = ACCEPTED_EXCEPTIONS[dimension]?.[directory]
  if (exceptionId !== undefined) {
    const rationale = acceptedExceptionRationale(dimension)
    return {
      applicability: 'applicable',
      resolution: 'accepted_exception',
      exceptionId,
      rationale,
      evidence: [
        ...evidence,
        {
          path: 'docs/governance/standards-exceptions.json',
          kind: 'file',
        },
        {
          path:
            dimension === 'tags'
              ? 'src/shared/governance/context-standards-matrix.test.ts'
              : 'src/shared/governance/context-standards-matrix.application.test.ts',
          kind: 'file',
        },
      ],
    }
  }
  const resolution = (EVIDENCED[dimension] as readonly string[]).includes(directory)
    ? 'evidenced'
    : 'unresolved'
  return {
    applicability: 'applicable',
    resolution,
    rationale:
      resolution === 'evidenced'
        ? evidencedRationale[dimension]!
        : unresolvedRationale[dimension],
    evidence,
  }
}

export const CONTEXT_STANDARDS_MATRIX = Object.freeze(
  CONTEXT_STANDARDS_AUTHORITY.map(({ name, directory }) => ({
    name,
    directory,
    standards: Object.fromEntries(
      CONTEXT_STANDARD_DIMENSIONS.map(({ id }) => [id, cellFor(directory, id)]),
    ) as Record<ContextStandardDimension, ContextStandardCell>,
  })),
) satisfies readonly ContextStandardsMatrixRow[]

export function summarizeContextStandardsMatrix(
  rows: readonly ContextStandardsMatrixRow[],
) {
  const summary = {
    acceptedExceptions: 0,
    evidenced: 0,
    notApplicable: 0,
    unresolved: 0,
    total: 0,
  }
  for (const row of rows) {
    for (const { id } of CONTEXT_STANDARD_DIMENSIONS) {
      const cell = row.standards[id]
      summary.total += 1
      if (cell.applicability === 'not_applicable') summary.notApplicable += 1
      else if (cell.resolution === 'accepted_exception') {
        summary.acceptedExceptions += 1
      } else summary[cell.resolution] += 1
    }
  }
  return summary
}

type StructuralRow = Readonly<{
  directory: string
  standards: Readonly<Partial<Record<string, unknown>>>
}>

/**
 * The single applicability/resolution problem a cell has, if any. The rules are
 * mutually exclusive: the first one that matches is the cell's verdict.
 */
function cellApplicabilityIssue(
  label: string,
  value: Partial<ContextStandardCell>,
): string | null {
  if (value.applicability === 'not_applicable' && value.resolution !== null) {
    return `${label}: not-applicable cell has a resolution`
  }
  if (value.applicability === 'applicable' && value.resolution === 'accepted_exception') {
    const exceptionId = 'exceptionId' in value ? value.exceptionId : undefined
    const hasId =
      typeof exceptionId === 'string' && /^STD-(?:INV|MAINT)-\d{3}$/u.test(exceptionId)
    return hasId ? null : `${label}: accepted exception lacks an id`
  }
  if (
    value.applicability === 'applicable' &&
    value.resolution !== 'evidenced' &&
    value.resolution !== 'unresolved' &&
    value.resolution !== 'accepted_exception'
  ) {
    return `${label}: applicable cell lacks a resolution`
  }
  if (value.applicability !== 'applicable' && value.applicability !== 'not_applicable') {
    return `${label}: invalid applicability`
  }
  return null
}

function cellStructureIssues(label: string, cell: unknown): readonly string[] {
  if (!cell || typeof cell !== 'object') return [`${label}: invalid cell`]
  const value = cell as Partial<ContextStandardCell>
  const issues: string[] = []
  const applicabilityIssue = cellApplicabilityIssue(label, value)
  if (applicabilityIssue) issues.push(applicabilityIssue)
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
    issues.push(`${label}: evidence is empty`)
  }
  return issues
}

function rowStructureIssues(row: StructuralRow): readonly string[] {
  const issues: string[] = []
  const dimensions = new Set(CONTEXT_STANDARD_DIMENSIONS.map(({ id }) => id))
  for (const key of Object.keys(row.standards)) {
    if (!dimensions.has(key as ContextStandardDimension)) {
      issues.push(`${row.directory}: unexpected dimension ${key}`)
    }
  }
  for (const { id } of CONTEXT_STANDARD_DIMENSIONS) {
    if (!(id in row.standards)) {
      issues.push(`${row.directory}: missing dimension ${id}`)
      continue
    }
    issues.push(...cellStructureIssues(`${row.directory}/${id}`, row.standards[id]))
  }
  return issues
}

export function validateContextStandardsMatrixStructure(
  rows: readonly StructuralRow[],
  expectedDirectories: readonly string[],
): readonly string[] {
  const issues: string[] = []
  const actualDirectories = rows.map(({ directory }) => directory)
  if (actualDirectories.join('|') !== expectedDirectories.join('|')) {
    issues.push('context rows do not match authority order')
  }
  for (const row of rows) issues.push(...rowStructureIssues(row))
  return issues
}
