// REL-01-T6 — normalize an operator's captured output into typed Gate F
// evidence.
//
// Usage:
//   pnpm release:import-live-evidence -- --gate=<gate id> --input=<raw.json> \
//     --output=<artifact.json>
//   pnpm release:import-live-evidence -- --list
//
// The command's ONE job is to refuse. It reads the operator's raw capture,
// canonicalizes it, and hands it to that gate's producer schema. It never
// supplies a field the raw input did not contain: there is no default, no
// coercion and no "assume zero". A capture missing `expiresAt` is rejected
// with the field named, not silently stamped with a plausible value — a
// fabricated field is worse than a missing one, because it looks like
// evidence.
//
// The artifact is written with flag 'wx'. Re-importing over an existing
// artifact is how a failed capture quietly becomes a passing one.

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalReleaseEvidence } from '../../src/shared/release/candidate-bound-evidence'
import {
  LIVE_EVIDENCE_GATE_IDS,
  LIVE_EVIDENCE_PARSERS,
  isLiveEvidenceGateId,
} from '../../src/shared/release/live-evidence'

export type ImportLiveEvidenceDependencies = Readonly<{
  readFile: (path: string) => string
  writeFileExclusive: (path: string, content: string) => void
  log: (line: string) => void
  error: (line: string) => void
}>

export function defaultImportLiveEvidenceDependencies(): ImportLiveEvidenceDependencies {
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

const USAGE =
  'Usage: pnpm release:import-live-evidence -- --gate=<gate id> --input=<raw.json> --output=<artifact.json>'

export function runImportLiveEvidenceCli(
  args: readonly string[],
  deps: ImportLiveEvidenceDependencies = defaultImportLiveEvidenceDependencies(),
): number {
  if (args.includes('--list')) {
    for (const gate of LIVE_EVIDENCE_GATE_IDS) deps.log(gate)
    return 0
  }

  const gate = argValue(args, '--gate')
  const input = argValue(args, '--input')
  const output = argValue(args, '--output')
  if (!gate || !input || !output) {
    deps.error(USAGE)
    return 2
  }
  if (!isLiveEvidenceGateId(gate)) {
    deps.error(
      `unknown live-evidence gate ${gate}; run --list for the gates this command imports`,
    )
    return 2
  }

  let raw: string
  try {
    raw = deps.readFile(input)
  } catch (error) {
    deps.error(
      `could not read ${input}: ${error instanceof Error ? error.message : String(error)}`,
    )
    return 1
  }

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    deps.error(`${input} is not valid JSON`)
    return 1
  }

  // Canonicalization is a pure re-encoding: key order and whitespace change,
  // no key is added and no value is altered. Whatever the operator captured is
  // exactly what the schema then judges.
  const canonical = canonicalReleaseEvidence(value)
  const parsed = LIVE_EVIDENCE_PARSERS[gate](canonical)
  if (!parsed.ok) {
    deps.error(`${gate}: captured evidence is not a valid ${gate} artifact:`)
    for (const failure of parsed.errors) deps.error(`  - ${failure}`)
    return 1
  }

  try {
    deps.writeFileExclusive(output, canonical)
  } catch (error) {
    deps.error(
      `could not write ${output}: ${error instanceof Error ? error.message : String(error)}`,
    )
    return 1
  }
  deps.log(`${gate}: imported ${input} -> ${output}`)
  return 0
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runImportLiveEvidenceCli(process.argv.slice(2))
}
