import { CONTEXT_STANDARDS_AUTHORITY } from './context-standards-authority'

/**
 * Current-tree successor to the frozen 17-context x 11-rule audit. “Evidenced”
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
    id: 'triple',
    authority: 'docs/standards.md §2.1',
    claim: 'use-case Input, Deps, and return types',
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
    id: 'files',
    authority: 'docs/standards.md §8.1, §8.2',
    claim: 'context-layer file names',
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
  triple: [],
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
  files: [],
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
  triple: [...CONTRACTED_RUNTIME_CONTEXTS],
  errors: [...CONTRACTED_RUNTIME_CONTEXTS],
  build: [],
  docs: [],
  repositories: ['ai', 'identity', ...CONTRACTED_RUNTIME_CONTEXTS],
  files: [],
  factories: [],
} as const satisfies Record<ContextStandardDimension, readonly string[]>
const ACCEPTED_EXCEPTIONS: Partial<
  Record<ContextStandardDimension, Readonly<Record<string, string>>>
> = {
  tags: { portal: 'STD-MAINT-001' },
  triple: {
    activity: 'STD-MAINT-004',
    ai: 'STD-MAINT-005',
    dashboard: 'STD-MAINT-006',
    goal: 'STD-MAINT-007',
    guest: 'STD-MAINT-008',
    identity: 'STD-MAINT-009',
    inbox: 'STD-MAINT-010',
    integration: 'STD-MAINT-011',
    metric: 'STD-MAINT-012',
    notification: 'STD-MAINT-013',
    portal: 'STD-MAINT-014',
    property: 'STD-MAINT-015',
    review: 'STD-MAINT-016',
    staff: 'STD-MAINT-017',
    team: 'STD-MAINT-018',
  },
  errors: {
    activity: 'STD-INV-037',
    goal: 'STD-INV-002',
    guest: 'STD-INV-038',
    identity: 'STD-INV-039',
    metric: 'STD-INV-040',
    notification: 'STD-INV-041',
    review: 'STD-INV-003',
  },
  files: {
    activity: 'STD-MAINT-019',
    ai: 'STD-MAINT-020',
    dashboard: 'STD-MAINT-021',
    goal: 'STD-MAINT-022',
    guest: 'STD-MAINT-023',
    identity: 'STD-MAINT-024',
    inbox: 'STD-MAINT-025',
    integration: 'STD-MAINT-026',
    metric: 'STD-MAINT-027',
    notification: 'STD-MAINT-028',
    portal: 'STD-MAINT-029',
    property: 'STD-MAINT-030',
    review: 'STD-MAINT-031',
    staff: 'STD-MAINT-032',
    team: 'STD-MAINT-033',
    badge: 'STD-MAINT-037',
    leaderboard: 'STD-MAINT-038',
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
  triple:
    'Use-case type triples still have broad historical variance and no complete gate.',
  errors:
    'Mixed legacy error flows remain; narrow tagged-error gates do not prove all paths.',
  build:
    'The build return shape differs from the publicApi/internal/repositories/useCases contract.',
  docs: 'The Events produced section is not exhaustively tabulated or explicitly absent.',
  repositories:
    'Repository names and tenant-scoped signatures lack an exhaustive context gate.',
  files:
    'The filename gate does not cover context layers, so current conformity is unresolved.',
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

function evidenceFor(
  directory: string,
  dimension: ContextStandardDimension,
): readonly ContextStandardEvidence[] {
  const context = `src/contexts/${directory}`
  if (['tags', 'envelope', 'assert', 'union'].includes(dimension)) {
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
  if (dimension === 'triple')
    return CONTRACTED_RUNTIME_CONTEXTS.has(directory)
      ? [{ path: `${context}/build.ts`, kind: 'file', contains: ['useCases: {}'] }]
      : [{ path: `${context}/application/use-cases`, kind: 'directory' }]
  if (dimension === 'errors')
    return CONTRACTED_RUNTIME_CONTEXTS.has(directory)
      ? [{ path: `${context}/build.ts`, kind: 'file', contains: ['publicApi: {}'] }]
      : [{ path: `${context}/domain/errors.ts`, kind: 'file' }]
  if (dimension === 'build') return [{ path: `${context}/build.ts`, kind: 'file' }]
  if (dimension === 'docs')
    return [
      { path: `${context}/CONTEXT.md`, kind: 'file', contains: ['## Events produced'] },
    ]
  if (dimension === 'repositories') {
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
  if (dimension === 'files') return [{ path: context, kind: 'directory' }]
  if (dimension === 'factories' && directory === 'badge') {
    return [{ path: `${context}/build.ts`, kind: 'file', contains: ['repos: {}'] }]
  }
  return [{ path: `${context}/infrastructure`, kind: 'directory' }]
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
      rationale: CONTRACTED_RUNTIME_CONTEXTS.has(directory)
        ? 'REC-01 retains no product use case, error flow, or entity repository in this context; its inert build and content-free compatibility boundary are governed separately.'
        : dimension === 'repositories'
          ? directory === 'ai'
            ? 'AI owns store and adapter ports rather than entity repository ports.'
            : 'Identity owns authorization, command-store, and lifecycle-authority ports rather than an entity repository contract.'
          : 'This context produces no domain events.',
      evidence,
    }
  }
  const exceptionId = ACCEPTED_EXCEPTIONS[dimension]?.[directory]
  if (exceptionId !== undefined) {
    const rationale =
      dimension === 'tags'
        ? 'Portal retains its published legacy tag vocabulary until every durable consumer can migrate through a versioned compatibility window.'
        : dimension === 'triple'
          ? 'The exact legacy use-case export variance is pinned by the exhaustive checker and migrates only when each public caller is changed with it.'
          : dimension === 'files'
            ? 'The exact legacy layer filename and mirrored-test variance is pinned by the exhaustive checker; renames occur only with bounded ownership-aware changes.'
            : dimension === 'repositories'
              ? 'The exact legacy repository-port placement is pinned while its imports and implementing adapters await an owner-scoped rename.'
              : 'The exact legacy application Result or native domain-error variance is pinned; changing its caller-visible failure contract requires a bounded behavioral migration.'
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

export function validateContextStandardsMatrixStructure(
  rows: readonly StructuralRow[],
  expectedDirectories: readonly string[],
): readonly string[] {
  const issues: string[] = []
  const actualDirectories = rows.map(({ directory }) => directory)
  if (actualDirectories.join('|') !== expectedDirectories.join('|')) {
    issues.push('context rows do not match authority order')
  }
  for (const row of rows) {
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
      const cell = row.standards[id]
      if (!cell || typeof cell !== 'object') {
        issues.push(`${row.directory}/${id}: invalid cell`)
        continue
      }
      const value = cell as Partial<ContextStandardCell>
      if (value.applicability === 'not_applicable' && value.resolution !== null) {
        issues.push(`${row.directory}/${id}: not-applicable cell has a resolution`)
      } else if (
        value.applicability === 'applicable' &&
        value.resolution === 'accepted_exception'
      ) {
        const exceptionId = 'exceptionId' in value ? value.exceptionId : undefined
        if (
          typeof exceptionId !== 'string' ||
          !/^STD-(?:INV|MAINT)-\d{3}$/u.test(exceptionId)
        ) {
          issues.push(`${row.directory}/${id}: accepted exception lacks an id`)
        }
      } else if (
        value.applicability === 'applicable' &&
        value.resolution !== 'evidenced' &&
        value.resolution !== 'unresolved' &&
        value.resolution !== 'accepted_exception'
      ) {
        issues.push(`${row.directory}/${id}: applicable cell lacks a resolution`)
      } else if (
        value.applicability !== 'applicable' &&
        value.applicability !== 'not_applicable'
      ) {
        issues.push(`${row.directory}/${id}: invalid applicability`)
      }
      if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
        issues.push(`${row.directory}/${id}: evidence is empty`)
      }
    }
  }
  return issues
}
