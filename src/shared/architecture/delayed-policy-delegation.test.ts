// BQC-3.2 — delayed policy delegation architecture test.
//
// The dispatch gate (src/shared/jobs/delayed-execution-gate.ts) is the SINGLE
// decision point for delayed execution (phase BQC-3: JobRuntime must not
// contain duplicate capability rules). Job handler files must therefore not
// re-check capabilities directly — the BQC-0.4 in-handler stop controls were
// superseded by the gate. Registration-time gates (bootstrap.ts
// registerCapabilityGatedJob, worker scheduling gates) are the allowed
// exception; this scan covers job handler files only.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

describe('BQC-3.2 delayed policy delegation', () => {
  it('no *.job.ts handler file imports or calls the capability gate directly', () => {
    const jobFiles = walk(join(ROOT, 'src/contexts')).filter(
      (f) => f.endsWith('.job.ts') && !f.endsWith('.test.ts'),
    )
    expect(jobFiles.length).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const abs of jobFiles) {
      const content = readFileSync(abs, 'utf8')
      const importsGate = content.includes('#/shared/auth/beta-capabilities')
      const callsGate =
        /(?:checkGlobalCapability|checkBetaCapability|isCapabilityJobEnabled)\s*\(/.test(
          content,
        )
      if (importsGate || callsGate) offenders.push(relative(ROOT, abs))
    }

    expect(
      offenders,
      `job handlers must delegate to the dispatch gate (BQC-3.2), not re-check capabilities:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
