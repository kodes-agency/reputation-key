// BQC-5.6: src/shared/events/events.ts is a pure TYPE registry.
//
// The master DomainEvent union may reference context event types (the
// sanctioned "cross-context type imports are allowed for events" exception),
// but it must never pull runtime VALUES out of a context — no value imports,
// no value re-exports, no domain rules. Everything context-sourced is
// `import type` / `export type`, erased at compile time, so the shared
// events registry cannot drag a context implementation into a bundle.
//
// The scan is textual (comments stripped first) — a guardrail, not a proof.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const EVENTS_FILE = 'src/shared/events/events.ts'

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

// `import … from '<path>'` / `export … from '<path>'` statements, possibly
// multi-line (the re-export blocks span one line per symbol).
const IMPORT_OR_REEXPORT = /\b(import|export)\s+[\s\S]*?\sfrom\s*'([^']+)'/g

describe('architecture: shared events registry is type-only (BQC-5.6)', () => {
  const source = stripComments(readFileSync(EVENTS_FILE, 'utf-8'))

  it('every context import/re-export in events.ts is type-only', () => {
    const violations: string[] = []
    for (const match of source.matchAll(IMPORT_OR_REEXPORT)) {
      const [statement, keyword, modulePath] = match
      if (!modulePath.includes('/contexts/')) continue
      const isTypeOnly = new RegExp(`^${keyword}\\s+type\\b`).test(statement.trimStart())
      if (!isTypeOnly) {
        violations.push(statement.replace(/\s+/g, ' ').trim().slice(0, 120))
      }
    }
    expect(
      violations,
      `events.ts must not value-import/re-export context modules:\n${violations.join('\n')}`,
    ).toEqual([])
  })

  it('events.ts never imports context domain rules (runtime values)', () => {
    expect(source).not.toMatch(/from\s+'[^']*\/contexts\/[^']*\/domain\/rules'/)
  })
})
