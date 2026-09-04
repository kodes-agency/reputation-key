// ADR 0050 §10 — the live Google Performance path must stay free of write
// repositories, queues/jobs, server caches, and Metric dependencies, so a
// Performance value can never become durable.
//
// The validator alone is not a control: asserting it over hand-written
// descriptor arrays only proves the validator works. This suite binds it to
// production code two ways, either of which fails when a forbidden dependency
// is introduced:
//
//   (A) DECLARED INJECTION — `GOOGLE_PERFORMANCE_LIVE_DEPENDENCY_DESCRIPTORS`
//       is exported from the real wiring module, and the call-site parse below
//       requires the properties actually injected into
//       `createGetPropertyGooglePerformance` to equal the descriptors'
//       `injectedAs` names exactly. Adding an injected dependency without a
//       descriptor fails; adding it WITH a descriptor faces the validator.
//
//   (B) TRANSITIVE MODULE GRAPH — the use case's runtime import closure is
//       walked and every reached module is checked against
//       FORBIDDEN_MODULE_PATHS. This catches a forbidden dependency reached
//       indirectly, with no descriptor to update at all.
//
// Type-only imports are excluded from (B): they are erased, so they cannot make
// a Performance value durable.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FORBIDDEN_MODULE_PATHS,
  validateGooglePerformanceLiveDependencies,
} from './google-performance-live-boundary'
import { GOOGLE_PERFORMANCE_LIVE_DEPENDENCY_DESCRIPTORS } from '#/contexts/integration/build'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const BUILD_FILE = join(SRC, 'contexts/integration/build.ts')
const USE_CASE_FILE = join(
  SRC,
  'contexts/integration/application/get-property-google-performance.ts',
)
const WIRING_CALL = 'createGetPropertyGooglePerformance({'

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/**
 * Top-level property names of the object literal passed to the wiring call.
 * Brace/paren/bracket depth is tracked, so only depth-0 text contributes: the
 * commas and keys of nested literals (the `fetchReport` / `issueLease` argument
 * objects and arrow parameter lists) are skipped. Each depth-0 comma-separated
 * segment yields its key — the identifier before `:`, or the whole identifier
 * for a shorthand property.
 */
function injectedPropertyNames(source: string): string[] {
  const start = source.indexOf(WIRING_CALL)
  if (start === -1) throw new Error(`wiring call '${WIRING_CALL}' not found in build.ts`)
  let depth = 0
  const segments: string[] = []
  let segment = ''
  for (let index = start + WIRING_CALL.length; index < source.length; index++) {
    const char = source[index]!
    if (char === '{' || char === '(' || char === '[') {
      depth++
      continue
    }
    if (char === '}' || char === ')' || char === ']') {
      if (depth === 0) break // closes the wiring argument object
      depth--
      continue
    }
    if (depth > 0) continue
    if (char === ',') {
      segments.push(segment)
      segment = ''
      continue
    }
    segment += char
  }
  segments.push(segment)
  return segments
    .map((entry) => /^[\s]*([A-Za-z0-9_$]+)/.exec(entry.split(':')[0]!)?.[1] ?? '')
    .filter(Boolean)
}

const FROM_RE =
  /\b(?:import|export)\s+(type\s+)?((?:(?!\b(?:import|export)\b)[^;'"])*)\s*from\s*['"]([^'"]+)['"]/g
const SIDE_EFFECT_RE = /\bimport\s+['"]([^'"]+)['"]/g
const DYNAMIC_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g

function isTypeOnlyClause(clause: string): boolean {
  const brace = /\{([^}]*)\}/.exec(clause)
  if (!brace) return false
  const specifiers = brace[1]!
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  return specifiers.length > 0 && specifiers.every((part) => /^type\b/.test(part))
}

/** Non-erased import specifiers of a module. */
function runtimeSpecifiers(code: string): string[] {
  const out: string[] = []
  let match: RegExpExecArray | null
  FROM_RE.lastIndex = 0
  while ((match = FROM_RE.exec(code)) !== null) {
    if (match[1]) continue // `import type` / `export type`
    if (isTypeOnlyClause(match[2]!)) continue // every specifier inline-`type`
    out.push(match[3]!)
  }
  SIDE_EFFECT_RE.lastIndex = 0
  while ((match = SIDE_EFFECT_RE.exec(code)) !== null) out.push(match[1]!)
  DYNAMIC_RE.lastIndex = 0
  while ((match = DYNAMIC_RE.exec(code)) !== null) out.push(match[1]!)
  return out
}

/** Absolute path for a repo-local specifier, or null for bare packages. */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  const clean = specifier.replace(/\?.*$/, '')
  let base: string
  if (clean.startsWith('#/')) base = join(SRC, clean.slice(2))
  else if (clean.startsWith('.')) base = resolve(dirname(fromFile), clean)
  else return null
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (
      /\.tsx?$/.test(candidate) &&
      existsSync(candidate) &&
      statSync(candidate).isFile()
    ) {
      return candidate
    }
  }
  throw new Error(
    `cannot resolve '${specifier}' imported from ${relative(ROOT, fromFile)}`,
  )
}

/** Repo-relative paths in the runtime import closure of `entry`, excluding it. */
function runtimeModuleClosure(entry: string): string[] {
  const seen = new Set<string>([entry])
  const queue = [entry]
  const reached: string[] = []
  while (queue.length > 0) {
    const file = queue.pop()!
    for (const specifier of runtimeSpecifiers(
      stripComments(readFileSync(file, 'utf8')),
    )) {
      const resolved = resolveSpecifier(specifier, file)
      if (!resolved || seen.has(resolved)) continue
      seen.add(resolved)
      reached.push(relative(ROOT, resolved).split('\\').join('/'))
      queue.push(resolved)
    }
  }
  return reached
}

describe('architecture: live Google Performance has no persistence dependency', () => {
  it('accepts the real wiring descriptors exported from the Performance build site', () => {
    expect(GOOGLE_PERFORMANCE_LIVE_DEPENDENCY_DESCRIPTORS.length).toBeGreaterThan(0)
    expect(
      validateGooglePerformanceLiveDependencies(
        GOOGLE_PERFORMANCE_LIVE_DEPENDENCY_DESCRIPTORS,
      ),
    ).toEqual({ ok: true })
  })

  it('declares exactly the dependencies the real call site injects', () => {
    // Binds the descriptor array to production wiring: an injected dependency
    // with no descriptor (or a stale descriptor) fails here, so the validator
    // can no longer be bypassed by simply not declaring the new dependency.
    const injected = injectedPropertyNames(
      stripComments(readFileSync(BUILD_FILE, 'utf8')),
    )
    expect(injected.length).toBeGreaterThan(0)
    expect([...injected].sort()).toEqual(
      GOOGLE_PERFORMANCE_LIVE_DEPENDENCY_DESCRIPTORS.map(
        (descriptor) => descriptor.injectedAs,
      ).sort(),
    )
  })

  it('names a module specifier that resolves for every declared dependency', () => {
    for (const descriptor of GOOGLE_PERFORMANCE_LIVE_DEPENDENCY_DESCRIPTORS) {
      expect(
        resolveSpecifier(descriptor.modulePath, BUILD_FILE),
        `${descriptor.injectedAs} names an unresolvable module`,
      ).not.toBeNull()
    }
  })

  it('reaches no forbidden module in the use case transitive runtime graph', () => {
    const reached = runtimeModuleClosure(USE_CASE_FILE)
    expect(reached.length).toBeGreaterThan(0)
    const violations = reached.filter((modulePath) =>
      FORBIDDEN_MODULE_PATHS.some((pattern) => pattern.test(`/${modulePath}`)),
    )
    expect(
      violations,
      'ADR 0050 §10: the live Performance path reached a write repository, queue/job, cache, or Metric module',
    ).toEqual([])
  })

  it.each(['write_repository', 'queue', 'server_cache', 'metric_key'] as const)(
    'rejects an injected %s dependency',
    (kind) => {
      // Mirrors what a real regression looks like once its descriptor is added.
      expect(
        validateGooglePerformanceLiveDependencies([
          ...GOOGLE_PERFORMANCE_LIVE_DEPENDENCY_DESCRIPTORS,
          { kind, modulePath: `#/injected/${kind}` },
        ]),
      ).toEqual({ ok: false, violations: [`${kind}:#/injected/${kind}`] })
    },
  )

  it.each([
    '#/contexts/integration/infrastructure/repositories/google-connection.repository',
    '#/contexts/integration/infrastructure/jobs/import-gbp-property-item-v2.job',
    '#/shared/cache/google-performance-cache',
  ] as const)(
    'rejects an allowed-kind dependency from forbidden module %s',
    (modulePath) => {
      // Kind alone is not enough: a write repository injected under an allowed
      // kind must still fail on its module path.
      expect(
        validateGooglePerformanceLiveDependencies([
          { kind: 'google_performance_source', modulePath },
        ]),
      ).toEqual({ ok: false, violations: [`google_performance_source:${modulePath}`] })
    },
  )

  it('rejects unknown dependency categories fail-closed', () => {
    expect(
      validateGooglePerformanceLiveDependencies([
        { kind: 'future_dependency', modulePath: '#/future/module' },
      ]),
    ).toEqual({ ok: false, violations: ['future_dependency:#/future/module'] })
  })
})
