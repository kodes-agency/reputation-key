// REG-02 — legacy Config-as-Code ownership reconciliation.
//
// `docs/operations/railway-data-cells.md` § Controlled migration requires the
// root `railway*.json` files to be removed in the same cutover change that
// stops Railway reporting a Config File owner: "There must be no steady-state
// dual ownership." Nothing enumerated the two ownership sets, so the cutover
// step could not be checked — which is the "legacy-service ownership
// diagnostic" REG-02 names as a blocker.
//
// Every root `railway*.json` must be declared here exactly once. An undeclared
// file fails closed rather than being assumed safe to leave behind.

import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** `railway.json` owns the default (web) service; `railway.<service>.json` names its own. */
const LEGACY_CONFIG_FILE_PATTERN = /^railway(?:\.([a-z0-9-]+))?\.json$/u

const DEFAULT_SERVICE = 'web'

export type LegacyConfigOwnership = 'migrated' | 'out-of-graph'

export type LegacyConfigDeclaration = Readonly<{
  file: string
  service: string
  ownership: LegacyConfigOwnership
  /** Required for `out-of-graph`: why this service is not a Data Cell resource. */
  reason?: string
}>

/**
 * `migrated` files describe a service the cell graph now owns; they are the
 * dual-ownership set and must be deleted in the cutover change. `out-of-graph`
 * files describe workloads that are deliberately not cell resources, so they
 * survive the cutover and must never be added to the graph to silence this.
 */
export const LEGACY_CONFIG_DECLARATIONS: readonly LegacyConfigDeclaration[] =
  Object.freeze([
    { file: 'railway.json', service: 'web', ownership: 'migrated' },
    { file: 'railway.worker.json', service: 'worker', ownership: 'migrated' },
    {
      file: 'railway.google-egress-gateway.json',
      service: 'google-egress-gateway',
      ownership: 'migrated',
    },
    {
      file: 'railway.google-execution-admission.json',
      service: 'google-execution-admission',
      ownership: 'migrated',
    },
    {
      file: 'railway.ai-egress-gateway.json',
      service: 'ai-egress-gateway',
      ownership: 'migrated',
    },
    {
      file: 'railway.ai-execution-admission.json',
      service: 'ai-execution-admission',
      ownership: 'migrated',
    },
    {
      file: 'railway.ai-egress-canary.json',
      service: 'ai-egress-canary',
      ownership: 'out-of-graph',
      reason:
        'one-shot provider canary (restartPolicyType NEVER) run on demand; not a cell serving resource',
    },
    {
      file: 'railway.ai-egress-probe.json',
      service: 'ai-egress-probe',
      ownership: 'out-of-graph',
      reason:
        'one-shot runtime egress probe (restartPolicyType NEVER); not a cell serving resource',
    },
    {
      file: 'railway.perf-runner.json',
      service: 'perf-runner',
      ownership: 'out-of-graph',
      reason: 'scale-harness runner; never deployed into a Data Cell',
    },
    {
      file: 'railway.sandbox.json',
      service: 'sandbox',
      ownership: 'out-of-graph',
      reason: 'sandbox control surface; never deployed into a Data Cell',
    },
  ])

/**
 * Services the cell graph owns that never had Config-as-Code, so their absence
 * from the declarations above is expected rather than a missing declaration.
 */
export const IAC_ONLY_SERVICES: readonly string[] = Object.freeze([
  'google-provider-redis',
  'schema-migrator',
])

/** Derive the service a legacy config file claims from its filename alone. */
export function legacyConfigServiceName(file: string): string {
  const match = LEGACY_CONFIG_FILE_PATTERN.exec(file)
  if (!match) throw new Error(`not a legacy Railway config filename: ${file}`)
  return match[1] ?? DEFAULT_SERVICE
}

export function readLegacyConfigFiles(root: string): readonly string[] {
  return readdirSync(root)
    .filter((name) => LEGACY_CONFIG_FILE_PATTERN.test(name))
    .sort()
}

export const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url))

export type LegacyConfigOwnershipReport = Readonly<{
  /** Declared files whose service the graph now owns — remove these at cutover. */
  dualOwnership: readonly string[]
  /** Declared files that legitimately survive the cutover. */
  outOfGraph: readonly string[]
  violations: readonly string[]
}>

/**
 * Prove the declarations, the files on disk, and the rendered graph agree. Any
 * disagreement is a violation: a stale declaration, an undeclared file, a
 * renamed file, an out-of-graph service that quietly became a cell resource, or
 * a graph service nobody accounted for.
 */
export function reconcileLegacyConfigOwnership(
  input: Readonly<{
    presentFiles: readonly string[]
    graphServices: readonly string[]
    declarations?: readonly LegacyConfigDeclaration[]
    iacOnlyServices?: readonly string[]
  }>,
): LegacyConfigOwnershipReport {
  const declarations = input.declarations ?? LEGACY_CONFIG_DECLARATIONS
  const iacOnly = new Set(input.iacOnlyServices ?? IAC_ONLY_SERVICES)
  const graph = new Set(input.graphServices)
  const present = new Set(input.presentFiles)
  const violations: string[] = []

  const declaredFiles = new Set<string>()
  for (const declaration of declarations) {
    if (declaredFiles.has(declaration.file)) {
      violations.push(`${declaration.file}: declared more than once`)
      continue
    }
    declaredFiles.add(declaration.file)

    if (!present.has(declaration.file)) {
      violations.push(`${declaration.file}: declared but absent from the repository root`)
      continue
    }
    // A rename must not silently re-point a declaration at another service.
    const derived = legacyConfigServiceName(declaration.file)
    if (derived !== declaration.service) {
      violations.push(
        `${declaration.file}: declares service ${declaration.service} but names ${derived}`,
      )
      continue
    }
    if (declaration.ownership === 'migrated' && !graph.has(declaration.service)) {
      violations.push(
        `${declaration.file}: declared migrated but ${declaration.service} is not in the cell graph`,
      )
    }
    if (declaration.ownership === 'out-of-graph') {
      if (graph.has(declaration.service)) {
        violations.push(
          `${declaration.file}: declared out-of-graph but ${declaration.service} is in the cell graph`,
        )
      }
      if (!declaration.reason?.trim()) {
        violations.push(`${declaration.file}: out-of-graph requires a recorded reason`)
      }
    }
  }

  for (const file of input.presentFiles) {
    if (!declaredFiles.has(file)) {
      violations.push(`${file}: present but undeclared — classify it before cutover`)
    }
  }

  const migratedServices = new Set(
    declarations
      .filter((declaration) => declaration.ownership === 'migrated')
      .map((declaration) => declaration.service),
  )
  for (const service of input.graphServices) {
    if (!migratedServices.has(service) && !iacOnly.has(service)) {
      violations.push(
        `${service}: in the cell graph with no migrated declaration and not listed as IaC-only`,
      )
    }
  }

  const declaredAndPresent = declarations.filter(
    (declaration) =>
      present.has(declaration.file) &&
      legacyConfigServiceName(declaration.file) === declaration.service,
  )
  return Object.freeze({
    dualOwnership: Object.freeze(
      declaredAndPresent
        .filter((declaration) => declaration.ownership === 'migrated')
        .map((declaration) => declaration.file)
        .sort(),
    ),
    outOfGraph: Object.freeze(
      declaredAndPresent
        .filter((declaration) => declaration.ownership === 'out-of-graph')
        .map((declaration) => declaration.file)
        .sort(),
    ),
    violations: Object.freeze(violations.sort()),
  })
}
