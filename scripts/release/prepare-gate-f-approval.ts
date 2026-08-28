// REL-01-T7 — print the exact bytes a Gate F approver must sign.
//
// Usage:
//   pnpm release:prepare-approval -- --gate-f-index=<path> --role=<role> \
//     --approver=<identity> --approved-at=<ISO> [--output=<payload.bin>]
//
// This command DOES NOT SIGN. It cannot: there is no code path in this
// repository that reads, writes, derives, or generates a private key, and this
// file deliberately imports nothing that could.
//
// The approver takes the printed payload to wherever their key actually lives
// — a hardware token, a password manager, an HSM — signs it there, and returns
// the base64 signature. The operator assembles the envelope; the verifier in
// `src/shared/release/gate-f-approval-envelope.ts` then checks it against the
// PUBLIC key enrolled for that role in `security/gate-f-approval-roles.json`.
//
// The payload is derived from the Gate F index the approver is being asked to
// approve, so an approver cannot be handed a payload for one decision and
// shown another.

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GATE_F_APPROVAL_ROLES,
  gateFApprovalPayloadSha256,
  gateFApprovalSignaturePayload,
  type GateFApprovalRole,
} from '../../src/shared/release/gate-f-approval-envelope'
import {
  gateFDecisionSha256,
  parseGateFEvidence,
} from '../../src/shared/release/gate-f-evidence'

export type PrepareApprovalDependencies = Readonly<{
  readFile: (path: string) => string
  writeFileExclusive: (path: string, content: string) => void
  log: (line: string) => void
  error: (line: string) => void
}>

export function defaultPrepareApprovalDependencies(): PrepareApprovalDependencies {
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
  'Usage: pnpm release:prepare-approval -- --gate-f-index=<path> --role=<role> --approver=<identity> --approved-at=<ISO> [--output=<payload.bin>]'

function isRole(value: string): value is GateFApprovalRole {
  return (GATE_F_APPROVAL_ROLES as readonly string[]).includes(value)
}

export function runPrepareGateFApprovalCli(
  args: readonly string[],
  deps: PrepareApprovalDependencies = defaultPrepareApprovalDependencies(),
): number {
  const indexPath = argValue(args, '--gate-f-index')
  const role = argValue(args, '--role')
  const approverIdentity = argValue(args, '--approver')
  const approvedAt = argValue(args, '--approved-at')
  if (!indexPath || !role || !approverIdentity || !approvedAt) {
    deps.error(USAGE)
    return 2
  }
  if (!isRole(role)) {
    deps.error(`unknown Gate F approval role ${role}`)
    return 2
  }
  if (Number.isNaN(Date.parse(approvedAt))) {
    deps.error('--approved-at must be an ISO-8601 instant')
    return 2
  }

  let content: string
  try {
    content = deps.readFile(indexPath)
  } catch (error) {
    deps.error(
      `could not read ${indexPath}: ${error instanceof Error ? error.message : String(error)}`,
    )
    return 1
  }
  const parsed = parseGateFEvidence(content)
  if (!parsed.ok) {
    deps.error(`Gate F index ${indexPath} is invalid:`)
    for (const failure of parsed.errors) deps.error(`  - ${failure}`)
    return 1
  }

  const payload = gateFApprovalSignaturePayload({
    role,
    approverIdentity,
    approvedAt,
    releaseManifestSha256: parsed.evidence.release.manifest.sha256,
    legalRevisionSetSha256: parsed.evidence.release.legalRevisionSet.sha256,
    gateFDecisionSha256: gateFDecisionSha256(parsed.evidence),
  })
  const encoded = payload.toString('utf8')

  deps.log(`role:                   ${role}`)
  deps.log(`approver:               ${approverIdentity}`)
  deps.log(`gate F decision sha256: ${gateFDecisionSha256(parsed.evidence)}`)
  deps.log(
    `payload sha256:         ${gateFApprovalPayloadSha256({
      role,
      approverIdentity,
      approvedAt,
      releaseManifestSha256: parsed.evidence.release.manifest.sha256,
      legalRevisionSetSha256: parsed.evidence.release.legalRevisionSet.sha256,
      gateFDecisionSha256: gateFDecisionSha256(parsed.evidence),
    })}`,
  )
  deps.log('')
  deps.log('sign EXACTLY these bytes with the Ed25519 key enrolled for this role:')
  deps.log(encoded)
  deps.log('')
  deps.log(
    'This command holds no key material. Sign where your key lives and return the base64 signature.',
  )

  const output = argValue(args, '--output')
  if (output !== undefined) {
    try {
      deps.writeFileExclusive(output, encoded)
    } catch (error) {
      deps.error(
        `could not write ${output}: ${error instanceof Error ? error.message : String(error)}`,
      )
      return 1
    }
    deps.log(`wrote the signing payload to ${output}`)
  }
  return 0
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runPrepareGateFApprovalCli(process.argv.slice(2))
}
