// BQC-6.9 — quarantine-register guard test.
//
// Validates every entry in the flaky-test quarantine register against the
// policy (see the register header):
//   1. every entry carries ALL required fields (owner, reproduction, expiry,
//      releaseBlocking: false);
//   2. expiry is a valid ISO 8601 date in the FUTURE (no permanent quarantine);
//   3. releaseBlocking is literally false;
//   4. no entry's testName matches a spec in the Playwright CRITICAL project
//      (e2e/critical/** — the required-workflow hard gate): no required
//      workflow may remain quarantined.
//
// The register is empty today; the scans below are non-vacuity guards so an
// empty register cannot silently mask a broken matcher.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { QUARANTINE_REGISTER } from './quarantine-register'

const ROOT = join(__dirname, '..', '..', '..')
const CRITICAL_DIR = join(ROOT, 'e2e', 'critical')

/** All spec sources in the critical (required-workflow) Playwright project. */
function criticalSpecSources(): ReadonlyArray<{ file: string; source: string }> {
  const out: Array<{ file: string; source: string }> = []
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (ent.name.endsWith('.spec.ts')) {
        out.push({ file: p.slice(ROOT.length + 1), source: readFileSync(p, 'utf-8') })
      }
    }
  }
  walk(CRITICAL_DIR)
  return out
}

const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/

describe('quarantine register (BQC-6.9 policy)', () => {
  it('discovers critical-project specs (non-vacuity guard)', () => {
    expect(criticalSpecSources().length).toBeGreaterThan(0)
  })

  it('every entry carries all required fields', () => {
    for (const entry of QUARANTINE_REGISTER) {
      expect(entry.testName.trim().length, 'testName').toBeGreaterThan(0)
      expect(entry.owner.trim().length, `owner for "${entry.testName}"`).toBeGreaterThan(
        0,
      )
      expect(
        entry.reproduction.trim().length,
        `reproduction for "${entry.testName}"`,
      ).toBeGreaterThan(0)
      expect(
        entry.expiry.trim().length,
        `expiry for "${entry.testName}"`,
      ).toBeGreaterThan(0)
    }
  })

  it('every entry expiry is a future ISO 8601 date', () => {
    const now = Date.now()
    for (const entry of QUARANTINE_REGISTER) {
      expect(
        ISO_DATE_RE.test(entry.expiry),
        `expiry "${entry.expiry}" for "${entry.testName}" is not ISO 8601`,
      ).toBe(true)
      const ms = Date.parse(entry.expiry)
      expect(Number.isNaN(ms), `expiry "${entry.expiry}" is unparseable`).toBe(false)
      expect(
        ms > now,
        `expiry "${entry.expiry}" for "${entry.testName}" is not in the future — resolve or delete the entry`,
      ).toBe(true)
    }
  })

  it('every entry is explicitly non-release (releaseBlocking: false)', () => {
    for (const entry of QUARANTINE_REGISTER) {
      expect(
        entry.releaseBlocking,
        `"${entry.testName}" must be releaseBlocking: false`,
      ).toBe(false)
    }
  })

  it('no quarantined test belongs to the critical (required-workflow) project', () => {
    const criticalSpecs = criticalSpecSources()
    for (const entry of QUARANTINE_REGISTER) {
      const hits = criticalSpecs.filter((s) => s.source.includes(entry.testName))
      expect(
        hits.map((h) => h.file),
        `"${entry.testName}" matches critical-project spec(s) ${hits
          .map((h) => h.file)
          .join(', ')} — a required workflow may not be quarantined`,
      ).toEqual([])
    }
  })
})
