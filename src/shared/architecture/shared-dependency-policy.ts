// ARC-03-T3: the permitted-dependency graph between `src/shared/` first-level
// areas.
//
// `src/shared/CONTEXT.md` names an owner and a placement rule for every area,
// but ownership without a dependency rule is advice: before this module the
// 28 shared element patterns in eslint.config.js collapsed into ONE
// `shared-other` type that was allowed to import itself, so "the browser query
// namespace must not reach the job runtime" and "governance may read auth" were
// the same rule — namely, no rule at all.
//
// This module is the single authority. Three artefacts are derived from it and
// asserted equal by the tests beside it:
//   1. the `Permitted dependencies` column of the ownership table in
//      src/shared/CONTEXT.md,
//   2. the `boundaries/dependencies` policies in eslint.config.js (rendered
//      byte-for-byte by `renderSharedBoundaryPolicies`),
//   3. the invariants below (browser-reachable areas, domain purity, the
//      test-only fence).
//
// An `allows` list is what the area imports TODAY, not a generous ceiling. A
// new edge is meant to fail the lint and be argued for in review — that is the
// whole point of writing the graph down.

export type SharedDependencyRow = Readonly<{
  /** First-level directory name under `src/shared/`. */
  area: string
  /** Areas this one may import. Always contains itself. */
  allows: readonly string[]
}>

/**
 * Areas whose modules are reachable from a browser bundle. They may never
 * depend on server-only runtimes, because a single import edge is enough to
 * pull a queue client or a database driver into the client graph.
 */
export const BROWSER_REACHABLE_AREAS = ['queries', 'hooks', 'http'] as const

/** Server-only runtimes that a browser-reachable area must never import. */
export const SERVER_ONLY_AREAS = ['jobs', 'db', 'outbox', 'provider-ephemeral'] as const

/** The test-only area. No production area may name it as a dependency. */
export const TEST_ONLY_AREA = 'testing'

export const SHARED_DEPENDENCY_POLICY: readonly SharedDependencyRow[] = [
  { area: 'architecture', allows: ['architecture'] },
  {
    area: 'auth',
    allows: [
      'auth',
      'cache',
      'config',
      'db',
      'domain',
      'email',
      'google-provider-control',
      'governance',
      'observability',
      'routing',
    ],
  },
  { area: 'bqc', allows: ['bqc'] },
  { area: 'cache', allows: ['cache', 'config', 'observability'] },
  { area: 'config', allows: ['auth', 'config', 'domain'] },
  {
    area: 'db',
    allows: [
      'auth',
      'config',
      'db',
      'domain',
      'governance',
      'observability',
      'ops',
      'outbox',
      'release',
    ],
  },
  { area: 'domain', allows: ['domain'] },
  { area: 'email', allows: ['email'] },
  { area: 'events', allows: ['events', 'observability'] },
  { area: 'generated', allows: ['generated'] },
  {
    area: 'google-provider-control',
    allows: ['domain', 'google-provider-control', 'security'],
  },
  { area: 'governance', allows: ['auth', 'db', 'domain', 'governance'] },
  {
    area: 'health',
    allows: [
      'auth',
      'cache',
      'config',
      'db',
      'domain',
      'health',
      'jobs',
      'observability',
      'outbox',
    ],
  },
  { area: 'hooks', allows: ['auth', 'domain', 'hooks'] },
  { area: 'http', allows: ['http'] },
  {
    area: 'jobs',
    allows: [
      'auth',
      'config',
      'db',
      'domain',
      'events',
      'governance',
      'health',
      'jobs',
      'observability',
      'outbox',
      'routing',
    ],
  },
  { area: 'lifecycle', allows: ['lifecycle'] },
  {
    area: 'observability',
    allows: [
      'auth',
      'config',
      'db',
      'domain',
      'health',
      'jobs',
      'observability',
      'outbox',
    ],
  },
  { area: 'ops', allows: ['auth', 'config', 'db', 'domain', 'ops', 'outbox'] },
  {
    area: 'outbox',
    allows: ['db', 'domain', 'events', 'governance', 'jobs', 'observability', 'outbox'],
  },
  {
    area: 'provider-ephemeral',
    allows: ['auth', 'domain', 'provider-ephemeral', 'security'],
  },
  { area: 'queries', allows: ['queries'] },
  { area: 'rate-limit', allows: ['observability', 'rate-limit'] },
  { area: 'release', allows: ['auth', 'db', 'domain', 'governance', 'release'] },
  { area: 'routing', allows: ['domain', 'routing', 'security'] },
  { area: 'security', allows: ['config', 'domain', 'observability', 'security'] },
  {
    area: 'testing',
    allows: [
      'auth',
      'bqc',
      'config',
      'db',
      'domain',
      'events',
      'health',
      'jobs',
      'observability',
      'testing',
    ],
  },
]

/**
 * Areas that already owned a named element before the split keep that name, so
 * the existing policies (and the negative controls that guard them) do not
 * silently change meaning. `outbox` maps to two elements because the durable
 * adapter subtree is deliberately separated from the public outbox surface
 * (BQR-1.3).
 */
const NAMED_ELEMENTS: Readonly<Record<string, readonly string[]>> = {
  auth: ['shared-auth'],
  db: ['shared-db'],
  domain: ['shared-domain'],
  events: ['shared-events'],
  outbox: ['shared-outbox'],
  testing: ['test-helpers'],
}

/**
 * The outbox relay adapters, reachable ONLY from the outbox area itself.
 *
 * `outbox` used to expand to both the public element and this one, which
 * silently granted every row listing `outbox` — db, health, jobs,
 * observability, ops — an edge into the relay that the previous config
 * rejected. A differential lint caught it: the split is the point of BQR-1.3,
 * so the infrastructure subtree is named separately and handed to its own area
 * alone.
 */
const OUTBOX_INFRASTRUCTURE_ELEMENT = 'shared-outbox-infra'

export function sharedAreaElements(area: string, from?: string): readonly string[] {
  const named = NAMED_ELEMENTS[area] ?? [`shared-${area}`]
  return area === 'outbox' && from === 'outbox'
    ? [...named, OUTBOX_INFRASTRUCTURE_ELEMENT]
    : named
}

/**
 * Element types that replaced the former `shared-other` catch-all — every
 * shared area that did not already have a dedicated element, plus the
 * transitional root contract kernel. Outer layers (routes, application,
 * infrastructure, …) name this list where they used to name `shared-other`,
 * so the split changes what shared/ may import without silently changing what
 * the rest of the repository may import from it.
 */
export const SHARED_CATCH_ALL_REPLACEMENT_ELEMENTS: readonly string[] = [
  ...SHARED_DEPENDENCY_POLICY.map(({ area }) => area)
    .filter((area) => !(area in NAMED_ELEMENTS))
    .map((area) => `shared-${area}`),
  'shared-outbox',
  'shared-root-contracts',
].sort()

const START = '// shared-dependency-policy:start'
const END = '// shared-dependency-policy:end'

export const SHARED_BOUNDARY_POLICY_MARKERS = { start: START, end: END } as const

const PRINT_WIDTH = 90

function callExpression(helperForOne: string, values: readonly string[]): string {
  return values.length === 1
    ? `${helperForOne}('${values[0]!}')`
    : `elementTypes(${values.map((value) => `'${value}'`).join(', ')})`
}

/**
 * Renders the `to:` clause the way Prettier would at the given indent: inline
 * while it fits inside printWidth, then one argument per line.
 */
function renderAllow(elements: readonly string[], indent: number): string {
  const pad = ' '.repeat(indent)
  const inline = callExpression('elementType', elements)
  if (indent + 2 + `allow: { to: ${inline} },`.length <= PRINT_WIDTH) {
    return `${pad}  allow: { to: ${inline} },\n`
  }
  if (indent + 4 + `to: ${inline},`.length <= PRINT_WIDTH) {
    return `${pad}  allow: {\n${pad}    to: ${inline},\n${pad}  },\n`
  }
  const args = elements.map((element) => `${pad}      '${element}',\n`).join('')
  return `${pad}  allow: {\n${pad}    to: elementTypes(\n${args}${pad}    ),\n${pad}  },\n`
}

/**
 * The exact `boundaries/dependencies` policy source for the shared areas.
 * `shared-context-ownership.test.ts` asserts eslint.config.js contains this
 * text verbatim between the marker comments, so the linter cannot drift from
 * the table without a failing test.
 */
export function renderSharedBoundaryPolicies(indent = 12): string {
  const pad = ' '.repeat(indent)
  const body = SHARED_DEPENDENCY_POLICY.map(({ area, allows }) => {
    // The SOURCE side keeps both outbox elements: the relay adapters share the
    // outbox area's outgoing policy. Only the TARGET side narrows, so other
    // areas stop reaching the relay while the relay keeps its own edges.
    const from = callExpression('elementType', [...sharedAreaElements(area, area)])
    const to = [...allows]
      .flatMap((allowed) => sharedAreaElements(allowed, area))
      .sort((left, right) => left.localeCompare(right))
    return `${pad}{\n${pad}  from: ${from},\n${renderAllow(to, indent)}${pad}},\n`
  }).join('')
  return `${pad}${START}\n${body}${pad}${END}\n`
}
