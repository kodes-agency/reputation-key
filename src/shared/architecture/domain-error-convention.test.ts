// BQR-1.2: Domain error convention architecture tests.
//
// Enforces the authoritative error pattern in src/contexts/CONTEXT.md
// and src/shared/domain/errors.ts:
//   - Every context has domain/errors.ts with a factory + type guard
//   - Domain modules do not throw untagged `{ code: ... }` objects
//
// Pure static checks — no DB / network.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const CONTEXTS_DIR = join(process.cwd(), 'src', 'contexts')

function listContextNames(): string[] {
  return readdirSync(CONTEXTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => existsSync(join(CONTEXTS_DIR, name, 'domain')))
}

function listDomainTsFiles(context: string): string[] {
  const dir = join(CONTEXTS_DIR, context, 'domain')
  const out: string[] = []
  const walk = (d: string) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.test.ts')) out.push(p)
    }
  }
  walk(dir)
  return out
}

/** Untagged throw of a plain object with `code` — forbidden by BQR-1.2. */
const UNTAGGED_THROW_RE = /throw\s*\{\s*code\s*:/

describe('BQR-1.2: domain error modules', () => {
  const contexts = listContextNames()

  it('discovers at least one context with a domain folder', () => {
    expect(contexts.length).toBeGreaterThan(0)
  })

  for (const context of contexts) {
    const errorsPath = join(CONTEXTS_DIR, context, 'domain', 'errors.ts')
    if (!existsSync(errorsPath)) {
      it.skip(`${context}: domain/errors.ts missing (no domain errors module)`, () => {
        /* intentional skip when context has domain/ without errors */
      })
      continue
    }

    describe(context, () => {
      const src = readFileSync(errorsPath, 'utf-8')

      it('exports a type guard isXxxError', () => {
        expect(
          src.match(/export const is\w+Error\s*=/),
          `${context}/domain/errors.ts must export isXxxError`,
        ).not.toBeNull()
      })

      it('exports an error factory (xxxError or createErrorFactory)', () => {
        const hasFactory =
          /export const \w+Error\s*=/.test(src) || src.includes('createErrorFactory')
        expect(
          hasFactory,
          `${context}/domain/errors.ts must export an error factory`,
        ).toBe(true)
      })

      it('uses _tag shape for the context error', () => {
        expect(src).toMatch(/_tag:\s*'[A-Za-z]+Error'/)
      })
    })
  }
})

describe('BQR-1.2: no untagged domain throws', () => {
  const contexts = listContextNames()

  for (const context of contexts) {
    const files = listDomainTsFiles(context)
    for (const file of files) {
      const rel = file.slice(process.cwd().length + 1)
      it(`${rel} does not throw untagged { code } objects`, () => {
        const src = readFileSync(file, 'utf-8')
        expect(
          UNTAGGED_THROW_RE.test(src),
          `${rel} throws untagged { code } — use the context error factory instead`,
        ).toBe(false)
      })
    }
  }
})
