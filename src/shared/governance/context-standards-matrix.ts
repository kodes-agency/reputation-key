import { CONTEXT_STANDARDS_AUTHORITY } from './context-standards-authority'

/**
 * Current-tree successor to the frozen 17-context x 11-rule audit. “Evidenced”
 * is deliberately narrow: it names a repository fact enforced by the focused
 * test, not blanket package or release closure. “Unresolved” means the broad
 * standard still needs a complete checker or package-by-package remediation.
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
const EVENTFUL = CONTEXT_STANDARDS_AUTHORITY.map(({ directory }) => directory).filter(
  (directory) => !EVENTLESS.has(directory),
)
const EVIDENCED = {
  tags: EVENTFUL.filter((directory) => directory !== 'portal'),
  envelope: [],
  assert: [],
  union: EVENTFUL,
  triple: [],
  errors: [],
  build: CONTEXT_STANDARDS_AUTHORITY.map(({ directory }) => directory).filter(
    (directory) => !['activity', 'ai', 'property'].includes(directory),
  ),
  docs: [
    'activity',
    'ai',
    'dashboard',
    'goal',
    'identity',
    'inbox',
    'leaderboard',
    'notification',
    'staff',
    'team',
  ],
  repositories: [],
  files: [],
  factories: ['activity', 'badge', 'dashboard', 'team'],
} as const satisfies Record<ContextStandardDimension, readonly string[]>
const NOT_APPLICABLE = {
  tags: [...EVENTLESS],
  envelope: [...EVENTLESS],
  assert: [...EVENTLESS],
  union: [...EVENTLESS],
  triple: [],
  errors: [],
  build: [],
  docs: [],
  repositories: ['ai'],
  files: [],
  factories: [],
} as const satisfies Record<ContextStandardDimension, readonly string[]>

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
  docs: 'The eventful Events produced section uses bullets rather than the required table.',
  repositories:
    'Repository names and tenant-scoped signatures lack an exhaustive context gate.',
  files:
    'The filename gate does not cover context layers, so current conformity is unresolved.',
  factories:
    'A legacy export-function infrastructure factory remains for touch-triggered migration.',
}
const evidencedRationale: Partial<Record<ContextStandardDimension, string>> = {
  tags: 'Every literal event tag has the context prefix and two or three snake-case segments.',
  union:
    'The context event union exists and is a member of the shared master event union.',
  build: 'The build source exposes publicApi and internal repositories/useCases groups.',
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
    return [{ path: `${context}/application/use-cases`, kind: 'directory' }]
  if (dimension === 'errors')
    return [{ path: `${context}/domain/errors.ts`, kind: 'file' }]
  if (dimension === 'build') return [{ path: `${context}/build.ts`, kind: 'file' }]
  if (dimension === 'docs')
    return [
      { path: `${context}/CONTEXT.md`, kind: 'file', contains: ['## Events produced'] },
    ]
  if (dimension === 'repositories') {
    return [
      {
        path: `${context}/infrastructure/repositories`,
        kind: directory === 'ai' ? 'absent' : 'directory',
      },
    ]
  }
  if (dimension === 'files') return [{ path: context, kind: 'directory' }]
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
      rationale:
        dimension === 'repositories'
          ? 'AI owns store and adapter ports rather than entity repository ports.'
          : 'This context produces no domain events.',
      evidence,
    }
  }
  const resolution = (EVIDENCED[dimension] as readonly string[]).includes(directory)
    ? 'evidenced'
    : 'unresolved'
  const buildVariance = {
    activity: 'Activity internal lacks the required useCases group.',
    ai: 'AI internal exposes individual capabilities without repos/useCases groups.',
    property: 'Property exposes bindingApi beside publicApi and internal.',
  }[directory]
  return {
    applicability: 'applicable',
    resolution,
    rationale:
      resolution === 'evidenced'
        ? evidencedRationale[dimension]!
        : dimension === 'build' && buildVariance
          ? buildVariance
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
  const summary = { evidenced: 0, notApplicable: 0, unresolved: 0, total: 0 }
  for (const row of rows) {
    for (const { id } of CONTEXT_STANDARD_DIMENSIONS) {
      const cell = row.standards[id]
      summary.total += 1
      if (cell.applicability === 'not_applicable') summary.notApplicable += 1
      else summary[cell.resolution] += 1
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
        value.resolution !== 'evidenced' &&
        value.resolution !== 'unresolved'
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
