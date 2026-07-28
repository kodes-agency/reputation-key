// BQC-5.3 — browser-reachability guard.
//
// Walks the import graph from the browser entry points — all of src/routes/**
// EXCEPT src/routes/api/** (server-only), plus src/components/** — and fails
// when a Node-only module is reachable from browser code. This is the test
// mirror of the BUILD-time gate: vite.config.ts `importProtection.client.files`
// (same deny patterns as DENY_PATTERNS below — keep them in sync).
//
// Traversal STOPS at modules TanStack Start RPC-stubs for the client (their
// imports never reach the browser):
//   - src/contexts/*/server/** (per the vite.config.ts importProtection comment)
//   - any module defining createServerFn (e.g. shared/auth/auth.functions.ts,
//     routes/-notification-fns.ts — the same stub transform, outside server/)
//   - src/composition.ts (the composition root is server-side wiring)
//   - bare packages (node_modules)
//
// A reached file is Node-only when:
//   (a) its src-relative path matches the importProtection deny list, or
//   (b) its source imports node:* builtins or pg/ioredis/bullmq/drizzle-orm/resend, or
//   (c) its source reads process.env — except process.env.NODE_ENV, which Vite
//       statically replaces in the client bundle.
//
// Type-only imports (`import type` / `export type`, or named specifiers that
// are all inline-`type`) are erased at compile time — verbatimModuleSyntax
// makes that marking explicit — so they create no browser-reachable edge.
//
// Regression net for STD-P2-01-class hydration crashes (e.g. the /register
// beforeLoad that imported beta-capabilities' process.env-reading store —
// fixed in BQC-5.3 by moving the capability gate behind a server fn).

import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const SRC = join(process.cwd(), 'src')

// ── Deny list — MUST mirror vite.config.ts importProtection.client.files ──
const DENY_PATTERNS = [
  '**/*.server.*',
  '**/routes/api/**',
  '**/composition.ts',
  '**/infrastructure/**',
  '**/build.ts',
  '**/shared/db/**',
  '**/shared/cache/**',
  '**/shared/jobs/**',
  '**/shared/observability/**',
  '**/shared/auth/auth.ts',
  '**/shared/auth/middleware.ts',
  '**/shared/auth/server-errors.ts',
  '**/shared/auth/headers.ts',
] as const

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const pattern = escaped
    .replace(/\*\*\//g, '(?:.*/)?')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
  return new RegExp(`^${pattern}$`)
}

const DENY_RES = DENY_PATTERNS.map(globToRegExp)

function denyReason(rel: string): string | null {
  for (let i = 0; i < DENY_RES.length; i++) {
    if (DENY_RES[i].test(rel))
      return `matches importProtection deny pattern '${DENY_PATTERNS[i]}'`
  }
  return null
}

// ── File walking ───────────────────────────────────────────────────────

function walk(dir: string): string[] {
  let out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      out = out.concat(walk(p))
    } else if (
      /\.tsx?$/.test(name) &&
      !/\.test\.tsx?$/.test(name) &&
      // Stories are Storybook fixtures, not app-bundle code — the preview has
      // its own vite config with Node-module aliases (.storybook/main.ts
      // stubs), and the importProtection build gate does not cover it.
      !/\.stories\.tsx?$/.test(name)
    ) {
      out.push(p)
    }
  }
  return out
}

function entryPoints(): string[] {
  const routes = walk(join(SRC, 'routes')).filter(
    (f) => !relOf(f).startsWith('routes/api/'),
  )
  const components = walk(join(SRC, 'components'))
  return [...routes, ...components]
}

function relOf(abs: string): string {
  return relative(SRC, abs).split('\\').join('/')
}

// ── Import extraction (comment-stripped source) ────────────────────────

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

const FROM_RE =
  /\b(?:import|export)\s+(type\s+)?((?:(?!\b(?:import|export)\b)[^;'"])*)\s*from\s*['"]([^'"]+)['"]/g
const SIDE_EFFECT_RE = /\bimport\s+['"]([^'"]+)['"]/g
const DYNAMIC_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g

function isTypeOnlyClause(clause: string): boolean {
  const brace = clause.match(/\{([^}]*)\}/)
  if (!brace) return false
  const specs = brace[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return specs.length > 0 && specs.every((s) => /^type\b/.test(s))
}

/** Runtime (non-erased) import specifiers of a module. */
function runtimeSpecifiers(code: string): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  FROM_RE.lastIndex = 0
  while ((m = FROM_RE.exec(code)) !== null) {
    const [, typeMod, clause, path] = m
    if (typeMod) continue // `import type` / `export type`
    if (isTypeOnlyClause(clause)) continue // all specifiers inline-`type`
    out.push(path)
  }
  SIDE_EFFECT_RE.lastIndex = 0
  while ((m = SIDE_EFFECT_RE.exec(code)) !== null) out.push(m[1])
  DYNAMIC_RE.lastIndex = 0
  while ((m = DYNAMIC_RE.exec(code)) !== null) out.push(m[1])
  return out
}

// ── Resolution ─────────────────────────────────────────────────────────

const ASSET_EXT_RE = /\.(css|scss|svg|png|jpe?g|gif|webp|json|woff2?|ttf|ico|mp4|webm)$/i

/** Returns the resolved absolute path, 'bare' for packages, or null for assets. */
function resolveSpecifier(spec: string, fromFile: string): string | 'bare' | null {
  // Vite query suffixes (`?url`, `?raw`) mark asset imports — strip before
  // extension checks; they never resolve to a TS module. (Only `?` — a
  // leading `#` is this repo's `#/` path alias, not a fragment.)
  const clean = spec.replace(/\?.*$/, '')
  if (ASSET_EXT_RE.test(clean)) return null
  let base: string
  if (clean.startsWith('#/')) {
    base = join(SRC, clean.slice(2))
  } else if (clean.startsWith('.')) {
    base = resolve(dirname(fromFile), clean)
  } else {
    return 'bare'
  }
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.d.ts`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]
  for (const c of candidates) {
    if (/\.tsx?$/.test(c) && existsSync(c) && statSync(c).isFile()) return c
  }
  // Unresolvable TS specifier — surfaced by the caller as a walk error.
  throw new Error(`cannot resolve '${spec}' imported from ${relOf(fromFile)}`)
}

// ── Node-only detection ────────────────────────────────────────────────

const NODE_ONLY_PACKAGES = ['pg', 'ioredis', 'bullmq', 'drizzle-orm', 'resend'] as const

function nodeOnlyImport(spec: string): string | null {
  if (spec.startsWith('node:')) return `imports Node builtin '${spec}'`
  for (const pkg of NODE_ONLY_PACKAGES) {
    if (spec === pkg || spec.startsWith(`${pkg}/`)) {
      return `imports server-only package '${spec}'`
    }
  }
  return null
}

const PROCESS_ENV_ALLOWED = [
  /process\s*\.\s*env\s*\.\s*NODE_ENV\b/g,
  /process\s*\.\s*env\s*\[\s*(['"])NODE_ENV\1\s*\]/g,
]
const PROCESS_ENV_RE = /process\s*\.\s*env\b/

function readsProcessEnv(code: string): boolean {
  let stripped = code
  for (const re of PROCESS_ENV_ALLOWED) stripped = stripped.replace(re, '')
  return PROCESS_ENV_RE.test(stripped)
}

// ── The walk ───────────────────────────────────────────────────────────

interface Violation {
  file: string
  reason: string
  chain: string[]
}

/** RPC-stubbed modules: TanStack replaces them in the client bundle, so their own imports never reach the browser. */
function isRpcStubbed(rel: string, code: string): boolean {
  // contexts/*/server/** per the vite.config.ts importProtection comment;
  // composition.ts is server-side wiring; any module defining createServerFn
  // gets the same stub transform outside server/ dirs (auth.functions.ts,
  // route fns).
  return (
    /^contexts\/[^/]+\/server(?:\/|$)/.test(rel) ||
    rel === 'composition.ts' ||
    code.includes('createServerFn')
  )
}

const ENV_REASON = 'reads process.env (undefined in the browser module graph)'

/** First node-only finding for a reached, non-denied module (imports win over env reads). */
function firstViolation(
  rel: string,
  code: string,
  specs: string[],
  chain: string[],
): Violation | null {
  for (const spec of specs) {
    const bad = nodeOnlyImport(spec)
    if (bad) return { file: rel, reason: bad, chain }
  }
  if (readsProcessEnv(code)) return { file: rel, reason: ENV_REASON, chain }
  return null
}

function pushChildren(
  specs: string[],
  file: string,
  chain: string[],
  seen: Set<string>,
  stack: Array<[string, string[]]>,
  walkErrors: string[],
): void {
  for (const spec of specs) {
    let resolved: string | 'bare' | null
    try {
      resolved = resolveSpecifier(spec, file)
    } catch (e) {
      walkErrors.push(`${(e as Error).message}\n    chain: ${chain.join(' → ')}`)
      continue
    }
    if (resolved === 'bare' || resolved === null) continue
    if (!seen.has(resolved)) stack.push([resolved, [...chain, relOf(resolved)]])
  }
}

function collectViolations(): { violations: Violation[]; walkErrors: string[] } {
  const violations: Violation[] = []
  const walkErrors: string[] = []
  const seen = new Set<string>()
  // Stack entries: [absolute file, chain of src-relative paths leading to it]
  const stack: Array<[string, string[]]> = entryPoints().map((f) => [f, [relOf(f)]])

  while (stack.length > 0) {
    const [file, chain] = stack.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    const rel = relOf(file)

    // (a) importProtection deny list — a client-reachable denied module is a
    // build-time hard error / hydration crash. Flag; no need to go deeper.
    const denied = denyReason(rel)
    if (denied) {
      violations.push({ file: rel, reason: denied, chain })
      continue
    }

    const code = stripComments(readFileSync(file, 'utf8'))
    if (isRpcStubbed(rel, code)) continue

    // (b) server-only imports / (c) ambient process.env reads.
    const specs = runtimeSpecifiers(code)
    const violation = firstViolation(rel, code, specs, chain)
    if (violation) violations.push(violation)

    pushChildren(specs, file, chain, seen, stack, walkErrors)
  }

  return { violations, walkErrors }
}

describe('browser reachability (BQC-5.3)', () => {
  it('no Node-only module is reachable from the browser entry points', () => {
    const { violations, walkErrors } = collectViolations()

    expect(
      walkErrors,
      `import graph walk errors (fix the resolver or the import):\n${walkErrors.join('\n')}`,
    ).toEqual([])

    const report = violations
      .map((v) => `${v.file} — ${v.reason}\n    chain: ${v.chain.join(' → ')}`)
      .join('\n')
    expect(
      violations,
      `Node-only modules reachable from browser code:\n${report}\n\n` +
        'Fix by moving the concern behind a server fn (RPC-stubbed), or by ' +
        'injecting the value from the runtime edge. See vite.config.ts ' +
        'importProtection + CONTEXT.md/ADR 0017.',
    ).toEqual([])
  })
})
