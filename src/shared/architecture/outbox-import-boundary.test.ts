// BQR-1.3: Outbox import-direction architecture test.
//
// Application and domain layers must depend only on the public outbox surface
// (`#/shared/outbox`). They must not reach into:
//   - infrastructure/ (Drizzle repository implementation)
//   - relay / dispatcher / envelope (worker runtime contract)
//   - event-adapter (internal payload mapping)
//
// Composition root and worker may import infrastructure to wire adapters.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const CONTEXTS = join(ROOT, 'src', 'contexts')

const FORBIDDEN_PATH_SNIPPETS = [
  'shared/outbox/infrastructure',
  'shared/outbox/relay',
  'shared/outbox/dispatcher',
  'shared/outbox/event-adapter',
  'shared/outbox/envelope',
] as const

function walkTsFiles(dir: string, pred: (rel: string) => boolean): string[] {
  const out: string[] = []
  if (!existsSync(dir)) return out
  const walk = (d: string) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (
        (ent.name.endsWith('.ts') || ent.name.endsWith('.tsx')) &&
        !ent.name.endsWith('.test.ts') &&
        !ent.name.endsWith('.test.tsx') &&
        !ent.name.endsWith('.d.ts')
      ) {
        const rel = relative(ROOT, p)
        if (pred(rel)) out.push(rel)
      }
    }
  }
  walk(dir)
  return out
}

function forbiddenHits(source: string): string[] {
  return FORBIDDEN_PATH_SNIPPETS.filter((s) => source.includes(s))
}

describe('BQR-1.3: outbox import boundary', () => {
  const applicationFiles = walkTsFiles(CONTEXTS, (rel) => rel.includes('/application/'))
  const domainFiles = walkTsFiles(CONTEXTS, (rel) => rel.includes('/domain/'))

  it('discovers application and domain files', () => {
    expect(applicationFiles.length).toBeGreaterThan(10)
    expect(domainFiles.length).toBeGreaterThan(10)
  })

  for (const file of applicationFiles) {
    it(`${file} does not import outbox internals`, () => {
      const src = readFileSync(join(ROOT, file), 'utf-8')
      const hits = forbiddenHits(src)
      expect(hits, `${file} imports forbidden outbox paths: ${hits.join(', ')}`).toEqual(
        [],
      )
    })
  }

  for (const file of domainFiles) {
    it(`${file} does not import outbox at all`, () => {
      const src = readFileSync(join(ROOT, file), 'utf-8')
      expect(
        src.includes('shared/outbox'),
        `${file} must not depend on the outbox (domain stays pure)`,
      ).toBe(false)
    })
  }

  it('public barrel exists and re-exports emitAndRecord + OutboxRepository', () => {
    const barrel = readFileSync(join(ROOT, 'src/shared/outbox/index.ts'), 'utf-8')
    expect(barrel).toContain('emitAndRecord')
    expect(barrel).toContain('OutboxRepository')
    expect(barrel).toMatch(/export\s+\{[^}]*emitAndRecord/)
    expect(barrel).toMatch(/export\s+type\s+\{[^}]*OutboxRepository/)
  })
})
