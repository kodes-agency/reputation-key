// BQC-3.5: every identity/staff/property/integration/metric fact must commit
// atomically via its context command store. Static-source checks —
// emitAndRecord is forbidden across ALL FIVE contexts (use cases, build
// wiring, adapters): state + outbox fact commit in ONE transaction via the
// context's atomic command store, with the bus emit after commit.
// Sibling guards: atomic-review-outbox.test.ts (BQC-3.3), atomic-inbox-outbox.test.ts (BQC-3.4).

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const FAMILIES = [
  {
    context: 'identity',
    storeFile: 'src/contexts/identity/infrastructure/identity-command-store.ts',
    storeFactory: 'createAtomicIdentityCommandStore',
    buildFile: 'src/contexts/identity/build.ts',
  },
  {
    context: 'staff',
    storeFile: 'src/contexts/staff/infrastructure/staff-command-store.ts',
    storeFactory: 'createAtomicStaffCommandStore',
    buildFile: 'src/contexts/staff/build.ts',
  },
  {
    context: 'property',
    storeFile: 'src/contexts/property/infrastructure/property-command-store.ts',
    storeFactory: 'createAtomicPropertyCommandStore',
    buildFile: 'src/contexts/property/build.ts',
  },
  {
    context: 'integration',
    storeFile: 'src/contexts/integration/infrastructure/integration-command-store.ts',
    storeFactory: 'createAtomicIntegrationCommandStore',
    buildFile: 'src/contexts/integration/build.ts',
  },
  {
    context: 'metric',
    storeFile: 'src/contexts/metric/infrastructure/metric-command-store.ts',
    storeFactory: 'createAtomicMetricCommandStore',
    buildFile: 'src/contexts/metric/build.ts',
  },
] as const

describe('BQC-3.5: atomic family outbox producers', () => {
  for (const family of FAMILIES) {
    describe(family.context, () => {
      it(`no ${family.context}-context source file uses emitAndRecord (all facts via the command store)`, () => {
        const files = walk(join(ROOT, 'src/contexts', family.context)).filter(
          (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
        )
        expect(files.length).toBeGreaterThan(5)
        const offenders = files.filter((f) =>
          readFileSync(f, 'utf-8').includes('emitAndRecord'),
        )
        expect(
          offenders,
          `emitAndRecord is forbidden in the ${family.context} context (BQC-3.5) — use the atomic command store:\n  ${offenders.join('\n  ')}`,
        ).toEqual([])
      })

      it(`build wires ${family.storeFactory} into the ${family.context} use cases`, () => {
        const src = readFileSync(join(ROOT, family.buildFile), 'utf-8')
        expect(src).toContain(family.storeFactory)
        expect(src).toContain('commandStore')
      })

      it(`${family.context} command store commits outbox inside db.transaction`, () => {
        const src = readFileSync(join(ROOT, family.storeFile), 'utf-8')
        expect(src).toContain('db.transaction')
        expect(src).toContain('outboxEvents')
        expect(src).toContain('toOutboxEvent')
        // Post-commit bus emit is best-effort via emitAfterCommit
        expect(src).toContain('emitAfterCommit')
        const txIdx = src.indexOf('db.transaction')
        // Call site after the transaction closes (not the helper definition)
        const afterCommitCall = src.indexOf(
          'await emitAfterCommit(events, command.event)',
        )
        expect(txIdx).toBeGreaterThan(-1)
        expect(afterCommitCall).toBeGreaterThan(txIdx)
      })
    })
  }
})
