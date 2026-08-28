// REL-01-T5 — turn a promotion read-back into four canonical Gate F artifacts.
//
// Usage:
//   pnpm release:capture-readback -- --input=<observations.json> --output-dir=<dir>
//
// `release:beta --verify-only --readback-output=<dir>` calls the same builder
// in-process, so the operator path and the deployer path produce byte-identical
// artifacts.
//
// The rule that shapes this module: EVERY invocation writes all four artifacts,
// including when a check failed. A failing read-back that wrote nothing would
// let an operator re-run until the environment happened to look right and file
// only the passing capture — which is the same fail-open as pasting console
// output into a file. A failed artifact is written with `outcome: 'failed'` and
// its failures named; Gate F then refuses it, loudly, with the gate id.

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ReleaseCandidateBinding } from '../../src/shared/release/candidate-bound-evidence'
import {
  PROMOTION_READBACK_EVIDENCE_VERSION,
  PROMOTION_READBACK_GATES,
  canonicalPromotionReadbackEvidence,
  parsePromotionReadbackEvidence,
  promotionReadbackFileName,
  type PromotionReadbackEvidence,
  type PromotionReadbackGate,
} from '../../src/shared/release/promotion-readback-evidence'

type GateBody<Gate extends PromotionReadbackGate> = Omit<
  Extract<PromotionReadbackEvidence, { gate: Gate }>,
  | 'version'
  | 'evidenceKind'
  | 'gate'
  | 'candidate'
  | 'capturedAt'
  | 'observedBy'
  | 'readbackMode'
  | 'outcome'
  | 'failures'
>

/**
 * What a read-back run observed. Each gate carries its own failure list so a
 * single bad service cannot silently mark the other three gates failed, and a
 * green graph cannot launder a red health check.
 */
export type PromotionReadbackObservations = Readonly<{
  candidate: ReleaseCandidateBinding
  capturedAt: string
  observedBy: string
  readbackMode: 'verify_only' | 'post_deploy'
  railwayNoDrift: GateBody<'railway_no_drift'> & Readonly<{ failures: readonly string[] }>
  releaseIdentityHealthControls: GateBody<'release_identity_health_controls'> &
    Readonly<{ failures: readonly string[] }>
  migrationIntegrity: GateBody<'migration_integrity'> &
    Readonly<{ failures: readonly string[] }>
  dormantCellDenial: GateBody<'dormant_cell_denial'> &
    Readonly<{ failures: readonly string[] }>
}>

export type PromotionReadbackArtifact = Readonly<{
  gate: PromotionReadbackGate
  fileName: string
  content: string
  outcome: 'passed' | 'failed'
  errors: readonly string[]
}>

const GATE_BODY_KEYS = {
  railway_no_drift: 'railwayNoDrift',
  release_identity_health_controls: 'releaseIdentityHealthControls',
  migration_integrity: 'migrationIntegrity',
  dormant_cell_denial: 'dormantCellDenial',
} as const satisfies Readonly<
  Record<PromotionReadbackGate, keyof PromotionReadbackObservations>
>

/**
 * Build all four artifacts. Never throws and never omits a gate: an artifact
 * the schema refuses still comes back, carrying the reasons, so the caller can
 * write the honest record and fail afterwards.
 */
export function promotionReadbackArtifacts(
  observations: PromotionReadbackObservations,
): readonly PromotionReadbackArtifact[] {
  return PROMOTION_READBACK_GATES.map((gate) => {
    const body = observations[GATE_BODY_KEYS[gate]] as Readonly<
      Record<string, unknown>
    > & { failures: readonly string[] }
    const { failures, ...rest } = body
    const outcome = failures.length === 0 ? ('passed' as const) : ('failed' as const)
    const evidence = {
      version: PROMOTION_READBACK_EVIDENCE_VERSION,
      evidenceKind: 'promotion-readback',
      gate,
      candidate: observations.candidate,
      capturedAt: observations.capturedAt,
      observedBy: observations.observedBy,
      readbackMode: observations.readbackMode,
      ...rest,
      outcome,
      failures: [...failures],
    } as PromotionReadbackEvidence
    const content = canonicalPromotionReadbackEvidence(evidence)
    const parsed = parsePromotionReadbackEvidence(content, gate)
    return {
      gate,
      fileName: promotionReadbackFileName(gate),
      content,
      outcome,
      errors: parsed.ok ? [] : parsed.errors,
    }
  })
}

export type PromotionReadbackWriter = (path: string, content: string) => void

/** Writes each artifact exactly once and returns the paths written. */
export function writePromotionReadbackArtifacts(
  directory: string,
  artifacts: readonly PromotionReadbackArtifact[],
  write: PromotionReadbackWriter,
): readonly string[] {
  return artifacts.map((artifact) => {
    const path = `${directory.replace(/\/$/u, '')}/${artifact.fileName}`
    write(path, artifact.content)
    return path
  })
}

export type CaptureReadbackDependencies = Readonly<{
  readFile: (path: string) => string
  writeFileExclusive: PromotionReadbackWriter
  log: (line: string) => void
  error: (line: string) => void
}>

export function defaultCaptureReadbackDependencies(): CaptureReadbackDependencies {
  return {
    readFile: (path) => readFileSync(resolve(process.cwd(), path), 'utf8'),
    writeFileExclusive: (path, content) => {
      writeFileSync(resolve(process.cwd(), path), content, { flag: 'wx' })
    },
    log: (line) => process.stdout.write(`${line}\n`),
    error: (line) => process.stderr.write(`${line}\n`),
  }
}

function argValue(args: readonly string[], flag: string): string | undefined {
  const arg = args.find((value) => value.startsWith(`${flag}=`))
  return arg?.slice(flag.length + 1)
}

export function runCapturePromotionReadbackCli(
  args: readonly string[],
  deps: CaptureReadbackDependencies = defaultCaptureReadbackDependencies(),
): number {
  const input = argValue(args, '--input')
  const outputDirectory = argValue(args, '--output-dir')
  if (!input || !outputDirectory) {
    deps.error(
      'Usage: pnpm release:capture-readback -- --input=<observations.json> --output-dir=<dir>',
    )
    return 2
  }

  let observations: PromotionReadbackObservations
  try {
    observations = JSON.parse(deps.readFile(input)) as PromotionReadbackObservations
  } catch (error) {
    deps.error(
      `could not read ${input}: ${error instanceof Error ? error.message : String(error)}`,
    )
    return 1
  }

  const artifacts = promotionReadbackArtifacts(observations)
  let written: readonly string[]
  try {
    written = writePromotionReadbackArtifacts(
      outputDirectory,
      artifacts,
      deps.writeFileExclusive,
    )
  } catch (error) {
    deps.error(
      `could not write promotion read-back artifacts: ${error instanceof Error ? error.message : String(error)}`,
    )
    return 1
  }
  for (const path of written) deps.log(`wrote ${path}`)

  const rejected = artifacts.filter((artifact) => artifact.errors.length > 0)
  for (const artifact of rejected) {
    deps.error(`${artifact.gate}: read-back artifact is not valid Gate F evidence:`)
    for (const failure of artifact.errors) deps.error(`  - ${failure}`)
  }
  const failed = artifacts.filter((artifact) => artifact.outcome === 'failed')
  for (const artifact of failed) {
    deps.error(`${artifact.gate}: read-back FAILED`)
  }
  return rejected.length > 0 || failed.length > 0 ? 1 : 0
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runCapturePromotionReadbackCli(process.argv.slice(2))
}
