// The bridge between the gate policy registry and everything that cannot
// import TypeScript — which is to say, every step in a GitHub Actions YAML file
// and every husky hook.
//
// A workflow step becomes:
//
//   - name: Typecheck
//     run: pnpm gate ci.check/typecheck
//
// and the registry decides whether that runs or is skipped at the current
// posture. The alternative — `if:` conditions scattered through the YAML — puts
// the policy in two places and lets a new step forget it exists.
//
// THE ONE THING THIS MUST NEVER DO is treat an unknown gate id as a skip. A
// typo would then leave CI green with the gate silently never running, which is
// strictly worse than having no gate at all: it produces false confidence. So
// unknown ids exit non-zero and say so, and only a gate the registry knows to
// be dormant is allowed to pass without running.

import { spawnSync } from 'node:child_process'
import {
  GATE_POLICY,
  dormantGates,
  gateById,
  isGateArmed,
  keptArmedByChoice,
  validateGatePolicy,
  armedGates,
  type GateRecord,
  type GatePolicyViolation,
} from '../../src/shared/release/gate-policy'
import {
  CURRENT_RELEASE_POSTURE,
  type ReleasePosture,
} from '../../src/shared/release/release-posture'

export type GateAction =
  | Readonly<{ action: 'run'; argv: readonly string[] }>
  | Readonly<{ action: 'skip'; reason: string }>
  | Readonly<{ action: 'fail'; reason: string }>

/**
 * What `pnpm gate <id>` should do, as data.
 *
 * Pure so the decision can be tested without spawning anything; `main` is the
 * only part that touches a process.
 */
export function resolveGateAction(
  id: string,
  posture: ReleasePosture = CURRENT_RELEASE_POSTURE,
  gates: readonly GateRecord[] = GATE_POLICY,
): GateAction {
  const gate = gateById(id, gates)
  if (gate === undefined) {
    return { action: 'fail', reason: `unknown gate id: ${id}` }
  }

  if (!isGateArmed(gate, posture)) {
    return {
      action: 'skip',
      reason: `dormant at ${posture}; arms at ${gate.armedFrom}`,
    }
  }

  if (gate.command === undefined) {
    return {
      action: 'fail',
      reason: `gate ${gate.id} is armed but declares no command to run`,
    }
  }

  return { action: 'run', argv: Object.freeze(gate.command.split(/\s+/u)) }
}

export type GatePolicySummary = Readonly<{
  posture: ReleasePosture
  armed: readonly GateRecord[]
  dormant: readonly GateRecord[]
  keptArmedByChoice: readonly string[]
  violations: readonly GatePolicyViolation[]
}>

/** The whole policy at a posture, for `pnpm gate --list`. */
export function describeGatePolicy(
  posture: ReleasePosture = CURRENT_RELEASE_POSTURE,
  gates: readonly GateRecord[] = GATE_POLICY,
): GatePolicySummary {
  return Object.freeze({
    posture,
    armed: armedGates(posture, gates),
    dormant: dormantGates(posture, gates),
    keptArmedByChoice: keptArmedByChoice(posture, gates).map((gate) => gate.id),
    violations: validateGatePolicy(gates),
  })
}

function printPolicy(summary: GatePolicySummary): void {
  const lines = [
    `posture: ${summary.posture}`,
    `armed:   ${String(summary.armed.length)}`,
    `dormant: ${String(summary.dormant.length)}`,
    '',
    ...summary.dormant.map((gate) => `  dormant  ${gate.id} — arms at ${gate.armedFrom}`),
    ...summary.keptArmedByChoice.map(
      (id) => `  kept on  ${id} — audience-dependent, armed by choice`,
    ),
  ]
  process.stdout.write(`${lines.join('\n')}\n`)
}

function main(argv: readonly string[]): number {
  const summary = describeGatePolicy()

  if (summary.violations.length > 0) {
    process.stderr.write(
      '[gate] the gate policy registry is invalid — refusing to run any gate:\n' +
        `${summary.violations.map((v) => `  ${v.gateId}: ${v.reason}`).join('\n')}\n`,
    )
    return 1
  }

  if (argv.includes('--list') || argv.length === 0) {
    printPolicy(summary)
    return argv.length === 0 ? 1 : 0
  }

  const id = argv[0] ?? ''
  const resolved = resolveGateAction(id)

  if (resolved.action === 'fail') {
    process.stderr.write(
      `[gate] ${resolved.reason}\n` +
        'Run `pnpm gate --list` to see every gate the registry knows.\n',
    )
    return 1
  }

  if (resolved.action === 'skip') {
    process.stdout.write(`[gate] ${id} skipped — ${resolved.reason}\n`)
    return 0
  }

  const [command, ...args] = resolved.argv
  if (command === undefined) {
    process.stderr.write(`[gate] ${id} declares an empty command\n`)
    return 1
  }

  process.stdout.write(`[gate] ${id} armed at ${summary.posture} — running\n`)
  // No shell: argv comes from a literal in the registry and is split on
  // whitespace, so there is nothing for a shell to reinterpret.
  const result = spawnSync(command, args, { stdio: 'inherit' })
  return result.status ?? 1
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  process.exit(main(process.argv.slice(2)))
}
