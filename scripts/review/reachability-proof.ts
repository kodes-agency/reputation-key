/**
 * `pnpm review:reachability-proof` — machine-generated deletion evidence.
 *
 * The CNV-01 done clause says it plainly: "deletion report attached. Zero
 * imports alone is never sufficient." Until now the reachability argument for
 * each removal was assembled by hand in a review comment, which means it could
 * not be re-run, could not be attached to the section-16 completion record, and
 * could quietly omit the one dimension that would have said "stop".
 *
 * This harness collects the five protocol-1 dimensions for one `file:export`
 * and fails closed if any of them is missing or the analyser could not compute
 * it:
 *
 *   1. `fallow dead-code --trace` verdict;
 *   2. `fallow dead-code --type-aware --symbol-impact` consumer list;
 *   3. a repo-wide word-boundary literal search outside the defining file;
 *   4. presence in `.fallowrc.json` `entry` / `ignoreExports`;
 *   5. presence in the runtime job/schedule/route/operator catalogues
 *      (`src/shared/governance/entry-point-catalogue.ts` and
 *      `event-job-catalogue.ts`).
 *
 * It never fabricates a dimension. If `fallow` or `rg` cannot be reached, or
 * the type-aware backend reports `unavailable`, the command exits non-zero and
 * emits no artifact — a plausible-looking proof is worse than none, because
 * someone would delete against it.
 *
 * Two verdicts are deliberately different: a symbol with no reference anywhere
 * is `fully-dead` (delete it), while a symbol referenced only inside its own
 * file is `over-public` (delete the `export` keyword, keep the implementation).
 * Neither verdict can authorize deleting a database schema symbol or anything
 * catalogued in the persisted-model authority: those stay blocked until one
 * verified release plus a restore proof.
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_FATE_AUTHORITY } from '../../src/shared/governance/data-fate-authority'

export const REACHABILITY_DIMENSIONS = Object.freeze([
  'fallow_trace',
  'fallow_symbol_impact',
  'literal_search',
  'fallow_configuration',
  'runtime_catalogue',
] as const)

export type ReachabilityDimension = (typeof REACHABILITY_DIMENSIONS)[number]

export type SymbolRef = Readonly<{ file: string; exportName: string }>

export type FallowTraceEvidence = Readonly<{
  command: string
  isUsed: boolean
  isEntryPoint: boolean
  fileReachable: boolean
  directReferenceFiles: readonly string[]
  reason: string
}>

export type SymbolImpactEvidence = Readonly<{
  command: string
  /** `unavailable` means the semantic backend could not answer; not "clean". */
  status: 'available' | 'unavailable'
  consumers: readonly string[]
  totalDirectConsumerCount: number
}>

export type LiteralSearchEvidence = Readonly<{
  command: string
  /** Occurrences inside the defining file, excluding the declaration itself. */
  ownFileMatches: number
  externalMatches: number
  externalFiles: readonly string[]
}>

export type FallowConfigurationEvidence = Readonly<{
  source: '.fallowrc.json'
  isEntry: boolean
  isIgnoredExport: boolean
}>

export type RuntimeCatalogueEvidence = Readonly<{
  sources: readonly string[]
  entryPointCatalogue: boolean
  eventJobCatalogue: boolean
}>

export type ReachabilityEvidence = Readonly<{
  symbol: SymbolRef
  fallowTrace: FallowTraceEvidence | null
  symbolImpact: SymbolImpactEvidence | null
  literalSearch: LiteralSearchEvidence | null
  fallowConfiguration: FallowConfigurationEvidence | null
  runtimeCatalogue: RuntimeCatalogueEvidence | null
}>

export type ReachabilityClassification = 'fully-dead' | 'over-public' | 'reachable'

export type ReachabilityRecommendation = 'delete' | 'unexport' | 'keep' | 'blocked'

export type ReachabilityProof = Readonly<{
  version: 'reachability-proof-v1'
  symbol: SymbolRef
  dimensions: ReadonlyArray<ReachabilityDimension>
  evidence: ReachabilityEvidence
  classification: ReachabilityClassification
  recommendation: ReachabilityRecommendation
  safeToDelete: boolean
  blockedReason: string | null
  fingerprint: string
}>

const DIMENSION_KEYS: ReadonlyArray<
  readonly [keyof ReachabilityEvidence, ReachabilityDimension]
> = Object.freeze([
  ['fallowTrace', 'fallow_trace'],
  ['symbolImpact', 'fallow_symbol_impact'],
  ['literalSearch', 'literal_search'],
  ['fallowConfiguration', 'fallow_configuration'],
  ['runtimeCatalogue', 'runtime_catalogue'],
] as const)

export function missingReachabilityDimensions(
  evidence: ReachabilityEvidence,
): ReadonlyArray<ReachabilityDimension> {
  return DIMENSION_KEYS.filter(([key]) => evidence[key] === null).map(
    ([, dimension]) => dimension,
  )
}

export function classifyReachability(
  evidence: ReachabilityEvidence,
): ReachabilityClassification {
  const trace = evidence.fallowTrace
  const impact = evidence.symbolImpact
  const literal = evidence.literalSearch
  const configuration = evidence.fallowConfiguration
  const catalogue = evidence.runtimeCatalogue
  if (!trace || !impact || !literal || !configuration || !catalogue) {
    throw new Error('reachability_proof_incomplete')
  }

  const reachable =
    trace.isUsed ||
    trace.isEntryPoint ||
    trace.directReferenceFiles.length > 0 ||
    impact.consumers.length > 0 ||
    impact.totalDirectConsumerCount > 0 ||
    literal.externalMatches > 0 ||
    configuration.isEntry ||
    configuration.isIgnoredExport ||
    catalogue.entryPointCatalogue ||
    catalogue.eventJobCatalogue
  if (reachable) return 'reachable'
  return literal.ownFileMatches > 0 ? 'over-public' : 'fully-dead'
}

const SCHEMA_DIRECTORY = 'src/shared/db/schema/'

const CATALOGUED_SCHEMA_FILES = new Set(
  DATA_FATE_AUTHORITY.map(({ schemaFile }) => schemaFile),
)
const CATALOGUED_EXPORTS = new Set(
  DATA_FATE_AUTHORITY.map(({ exportName }) => exportName),
)

/**
 * Why a symbol may never be reported as safe to delete, or null when nothing
 * protects it. Persisted models and compatibility mirrors are blocked until one
 * verified release plus a restore proof — a reachability argument about source
 * code says nothing about the rows already in PostgreSQL.
 */
export function contractionProtection(file: string, exportName: string): string | null {
  const normalized = file.replace(/\\/g, '/')
  if (normalized.startsWith(SCHEMA_DIRECTORY)) {
    return 'Database schema symbol: contraction is blocked until one verified release plus a restore proof.'
  }
  if (CATALOGUED_SCHEMA_FILES.has(basename(normalized))) {
    return 'File is catalogued in DATA_FATE_AUTHORITY: contraction is blocked until one verified release plus a restore proof.'
  }
  if (CATALOGUED_EXPORTS.has(exportName)) {
    return 'Symbol is catalogued in DATA_FATE_AUTHORITY: contraction is blocked until one verified release plus a restore proof.'
  }
  return null
}

export function buildReachabilityProof(
  evidence: ReachabilityEvidence,
): ReachabilityProof {
  const missing = missingReachabilityDimensions(evidence)
  if (missing.length > 0) {
    throw new Error(`reachability_proof_dimension_missing:${missing[0]}`)
  }
  if (evidence.symbolImpact?.status !== 'available') {
    throw new Error('reachability_proof_dimension_unavailable:fallow_symbol_impact')
  }

  const classification = classifyReachability(evidence)
  const blockedReason = contractionProtection(
    evidence.symbol.file,
    evidence.symbol.exportName,
  )
  const recommendation: ReachabilityRecommendation = blockedReason
    ? 'blocked'
    : classification === 'fully-dead'
      ? 'delete'
      : classification === 'over-public'
        ? 'unexport'
        : 'keep'

  const body = {
    version: 'reachability-proof-v1' as const,
    symbol: evidence.symbol,
    dimensions: [...REACHABILITY_DIMENSIONS],
    evidence,
    classification,
    recommendation,
    safeToDelete: recommendation === 'delete',
    blockedReason,
  }
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(body), 'utf8')
    .digest('hex')
  return Object.freeze({ ...body, fingerprint })
}

export type ReachabilitySummary = Readonly<{
  total: number
  fullyDead: number
  overPublic: number
  reachable: number
  blocked: number
  safeToDelete: number
}>

export function summarizeReachability(
  proofs: ReadonlyArray<ReachabilityProof>,
): ReachabilitySummary {
  return Object.freeze({
    total: proofs.length,
    fullyDead: proofs.filter(({ classification }) => classification === 'fully-dead')
      .length,
    overPublic: proofs.filter(({ classification }) => classification === 'over-public')
      .length,
    reachable: proofs.filter(({ classification }) => classification === 'reachable')
      .length,
    blocked: proofs.filter(({ recommendation }) => recommendation === 'blocked').length,
    safeToDelete: proofs.filter(({ safeToDelete }) => safeToDelete).length,
  })
}

// ── collection ──────────────────────────────────────────────────────

export type CommandResult = Readonly<{
  status: number
  stdout: string
  stderr: string
}>

export type ReachabilityDependencies = Readonly<{
  io: Readonly<{ out: (line: string) => void; err: (line: string) => void }>
  runCommand: (command: string, args: readonly string[]) => CommandResult
  readFile: (path: string) => string
  exists?: (path: string) => boolean
}>

const FALLOW = 'node_modules/.bin/fallow'
const RIPGREP = 'rg'

const SEARCH_ROOTS = Object.freeze([
  'src',
  'e2e',
  'scripts',
  'services',
  'server',
  'test-fixtures',
  'docs',
  '.railway',
  'drizzle',
  'vendor',
  'eslint-rules',
])

const CATALOGUE_SOURCES = Object.freeze([
  'src/shared/governance/entry-point-catalogue.ts',
  'src/shared/governance/event-job-catalogue.ts',
])

class ReachabilityCollectionError extends Error {}

function parseJson(stdout: string, dimension: ReachabilityDimension): unknown {
  try {
    return JSON.parse(stdout.trim().split('\n').at(-1) ?? '')
  } catch {
    throw new ReachabilityCollectionError(
      `${dimension}: could not parse the analyser output as JSON`,
    )
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) {
    throw new ReachabilityCollectionError('analyser output was not an object')
  }
  return value as Readonly<Record<string, unknown>>
}

function collectTrace(
  dependencies: ReachabilityDependencies,
  symbol: SymbolRef,
): FallowTraceEvidence {
  const args = [
    'dead-code',
    '--trace',
    `${symbol.file}:${symbol.exportName}`,
    '--format',
    'json',
    '--no-cache',
  ]
  const result = dependencies.runCommand(FALLOW, args)
  if (result.status !== 0) {
    throw new ReachabilityCollectionError(
      `fallow_trace: \`fallow ${args.join(' ')}\` failed (${result.status}) ${result.stderr}`,
    )
  }
  const parsed = record(parseJson(result.stdout, 'fallow_trace'))
  const references = Array.isArray(parsed.direct_references)
    ? parsed.direct_references
    : []
  return {
    command: `${FALLOW} ${args.join(' ')}`,
    isUsed: parsed.is_used === true,
    isEntryPoint: parsed.is_entry_point === true,
    fileReachable: parsed.file_reachable === true,
    directReferenceFiles: references.map((reference) =>
      String(record(reference).from_file ?? ''),
    ),
    reason: String(parsed.reason ?? ''),
  }
}

function collectSymbolImpact(
  dependencies: ReachabilityDependencies,
  symbol: SymbolRef,
): SymbolImpactEvidence {
  const args = [
    'dead-code',
    '--type-aware',
    '--symbol-impact',
    `${symbol.file}:${symbol.exportName}`,
    '--format',
    'json',
    '--no-cache',
  ]
  const result = dependencies.runCommand(FALLOW, args)
  if (result.status !== 0) {
    throw new ReachabilityCollectionError(
      `fallow_symbol_impact: \`fallow ${args.join(' ')}\` failed (${result.status}) ${result.stderr}`,
    )
  }
  const parsed = record(parseJson(result.stdout, 'fallow_symbol_impact'))
  const consumers = Array.isArray(parsed.direct_consumers) ? parsed.direct_consumers : []
  return {
    command: `${FALLOW} ${args.join(' ')}`,
    status: parsed.status === 'available' ? 'available' : 'unavailable',
    consumers: consumers.map((consumer) =>
      typeof consumer === 'string' ? consumer : String(record(consumer).path ?? ''),
    ),
    totalDirectConsumerCount: Number(parsed.total_direct_consumer_count ?? 0),
  }
}

function collectLiteralSearch(
  dependencies: ReachabilityDependencies,
  symbol: SymbolRef,
): LiteralSearchEvidence {
  const exists = dependencies.exists ?? existsSync
  const roots = SEARCH_ROOTS.filter((root) => exists(root))
  const args = [
    '--word-regexp',
    '--fixed-strings',
    '--count-matches',
    '--with-filename',
    '--no-heading',
    symbol.exportName,
    ...roots,
  ]
  const result = dependencies.runCommand(RIPGREP, args)
  // ripgrep exits 1 for "no matches" — that is an answer. Anything above 1 is
  // a failure, and a failure may never be reported as "no references".
  if (result.status > 1) {
    throw new ReachabilityCollectionError(
      `literal_search: \`rg ${args.join(' ')}\` failed (${result.status}) ${result.stderr}`,
    )
  }

  let ownFileMatches = 0
  let externalMatches = 0
  const externalFiles: string[] = []
  for (const line of result.stdout.split('\n')) {
    if (line.trim() === '') continue
    const separator = line.lastIndexOf(':')
    const path = line.slice(0, separator).replace(/\\/g, '/')
    const count = Number(line.slice(separator + 1))
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new ReachabilityCollectionError('literal_search: unparsable match count')
    }
    if (path === symbol.file) {
      // Subtract the declaration itself: what matters is whether anything
      // *else* in the file uses the symbol.
      ownFileMatches += Math.max(0, count - 1)
      continue
    }
    externalMatches += count
    externalFiles.push(path)
  }

  return {
    command: `${RIPGREP} ${args.join(' ')}`,
    ownFileMatches,
    externalMatches,
    externalFiles,
  }
}

function collectFallowConfiguration(
  dependencies: ReachabilityDependencies,
  symbol: SymbolRef,
): FallowConfigurationEvidence {
  let parsed: Readonly<Record<string, unknown>>
  try {
    parsed = record(JSON.parse(dependencies.readFile('.fallowrc.json')))
  } catch (error) {
    throw new ReachabilityCollectionError(
      `fallow_configuration: could not read .fallowrc.json (${String(error)})`,
    )
  }
  const entry = Array.isArray(parsed.entry) ? parsed.entry.map(String) : []
  const ignoreExports = Array.isArray(parsed.ignoreExports) ? parsed.ignoreExports : []
  const isIgnoredExport = ignoreExports.some((group) => {
    const groupRecord = record(group)
    const pattern = String(groupRecord.file ?? '')
    const exports = Array.isArray(groupRecord.exports)
      ? groupRecord.exports.map(String)
      : []
    return matchesGlob(pattern, symbol.file) && exports.includes(symbol.exportName)
  })

  return {
    source: '.fallowrc.json',
    isEntry: entry.includes(symbol.file),
    isIgnoredExport,
  }
}

function matchesGlob(pattern: string, path: string): boolean {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*')
  return new RegExp(`^${escaped}$`, 'u').test(path)
}

function collectRuntimeCatalogue(
  dependencies: ReachabilityDependencies,
  symbol: SymbolRef,
): RuntimeCatalogueEvidence {
  const word = new RegExp(
    `\\b${symbol.exportName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
    'u',
  )
  const present = CATALOGUE_SOURCES.map((path) => {
    try {
      return word.test(dependencies.readFile(path))
    } catch (error) {
      throw new ReachabilityCollectionError(
        `runtime_catalogue: could not read ${path} (${String(error)})`,
      )
    }
  })
  return {
    sources: CATALOGUE_SOURCES,
    entryPointCatalogue: present[0] === true,
    eventJobCatalogue: present[1] === true,
  }
}

export function collectReachabilityEvidence(
  dependencies: ReachabilityDependencies,
  symbol: SymbolRef,
): ReachabilityEvidence {
  return {
    symbol,
    fallowTrace: collectTrace(dependencies, symbol),
    symbolImpact: collectSymbolImpact(dependencies, symbol),
    literalSearch: collectLiteralSearch(dependencies, symbol),
    fallowConfiguration: collectFallowConfiguration(dependencies, symbol),
    runtimeCatalogue: collectRuntimeCatalogue(dependencies, symbol),
  }
}

const USAGE = 'pnpm review:reachability-proof --symbol <file>:<exportName>'

function realDependencies(): ReachabilityDependencies {
  return {
    io: {
      out: (line) => process.stdout.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
    },
    runCommand: (command, args) => {
      try {
        const stdout = execFileSync(command, [...args], {
          encoding: 'utf8',
          maxBuffer: 32 * 1024 * 1024,
        })
        return { status: 0, stdout, stderr: '' }
      } catch (error) {
        const failure = error as {
          status?: number
          stdout?: string | Buffer
          stderr?: string | Buffer
        }
        return {
          status: typeof failure.status === 'number' ? failure.status : 127,
          stdout: String(failure.stdout ?? ''),
          stderr: String(failure.stderr ?? String(error)),
        }
      }
    },
    readFile: (path) => readFileSync(path, 'utf8'),
    exists: (path) => existsSync(path),
  }
}

export function runReachabilityProofCli(
  argv: readonly string[],
  dependencies: ReachabilityDependencies = realDependencies(),
): number {
  const index = argv.indexOf('--symbol')
  const raw = index < 0 ? undefined : argv[index + 1]
  const separator = raw?.lastIndexOf(':') ?? -1
  if (!raw || separator <= 0) {
    dependencies.io.err(`--symbol is required\nusage: ${USAGE}`)
    return 2
  }
  const symbol: SymbolRef = {
    file: raw.slice(0, separator),
    exportName: raw.slice(separator + 1),
  }

  try {
    const proof = buildReachabilityProof(
      collectReachabilityEvidence(dependencies, symbol),
    )
    dependencies.io.out(JSON.stringify(proof, null, 2))
    return 0
  } catch (error) {
    // No artifact on failure: a proof that could not observe a real source is
    // exactly the kind of plausible evidence this harness exists to prevent.
    dependencies.io.err(
      `reachability proof failed for ${symbol.file}:${symbol.exportName}\n${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return 1
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runReachabilityProofCli(process.argv.slice(2))
}
