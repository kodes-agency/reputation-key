// BQC-5.3 — browser-reachability guard.
//
// Walks the import graph from what the browser loads first — src/client.tsx,
// src/start.ts and src/router.tsx — and from every browser route (excluding
// src/routes/api/**) and component, then fails when a Node-only module is
// reachable. The deny list is not a copy: it is read from
// `importProtection.client` in vite.config.ts, so the build and this test
// cannot disagree about what is denied.
//
// A module the Start compiler rewrites (`createServerFn`, `createMiddleware`,
// `createIsomorphicFn`, `createServerOnlyFn`) is not invisible to the browser.
// The client build drops its server halves and keeps the rest, so the walk
// follows what remains: its plain exports, its top-level statements, its
// re-exports and the imports those reach (start-client-residue.ts). A `server/`
// barrel or helper with none of those constructs is an ordinary module and is
// walked whole.
//
// A reached file is Node-only when:
//   (a) its src-relative path matches the build's deny list, or
//   (b) what the browser keeps of it imports a Node builtin (`node:crypto` or
//       bare `crypto`) or a server-only package, or
//   (c) what the browser keeps of it reads process.env — except
//       process.env.NODE_ENV, which Vite statically replaces in the client
//       bundle.
//
// Type-only imports (`import type` / `export type`, or named specifiers that
// are all inline-`type`) are erased at compile time — verbatimModuleSyntax
// makes that marking explicit — so they create no browser-reachable edge.
//
// src/routeTree.gen.ts is not followed: it only lists the routes. The browser
// routes are entry points here; the API routes stay outside this walk, as
// before, and the build's own import protection has them on its deny list.
//
// Regression net for STD-P2-01-class hydration crashes (e.g. the /register
// beforeLoad that imported beta-capabilities' process.env-reading store —
// fixed in BQC-5.3 by moving the capability gate behind a server fn).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, it, expect } from 'vitest'
import { START_COMPILED, clientResidue } from './start-client-residue'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const VITE_CONFIG = 'vite.config.ts'

// ── Deny list — read from vite.config.ts importProtection.client ────────

function propertyNamed(root: ts.Node, name: string): ts.Expression {
  let found: ts.Expression | undefined
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      found = node.initializer
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(root)
  if (found === undefined) {
    throw new Error(
      `${VITE_CONFIG} has no '${name}' under importProtection: this canary cannot read the build's deny list`,
    )
  }
  return found
}

function globList(client: ts.Expression, name: string): readonly string[] {
  const list = propertyNamed(client, name)
  if (!ts.isArrayLiteralExpression(list) || !list.elements.every(ts.isStringLiteral)) {
    throw new Error(
      `${VITE_CONFIG} importProtection.client.${name} must be a list of string literals for this canary to read it`,
    )
  }
  return list.elements.map((element) => (element as ts.StringLiteral).text)
}

/** The build's own `importProtection.client` lists, read from the config source. */
function buildImportProtection(): Readonly<{
  files: readonly string[]
  excludeFiles: readonly string[]
}> {
  const config = ts.createSourceFile(
    VITE_CONFIG,
    readFileSync(join(ROOT, VITE_CONFIG), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  const client = propertyNamed(propertyNamed(config, 'importProtection'), 'client')
  return {
    files: globList(client, 'files'),
    excludeFiles: globList(client, 'excludeFiles'),
  }
}

// A double star with a slash is any number of leading directories, a double
// star alone is anything, a single star is one path segment. Each is swapped
// for a marker first: the expansions contain a star themselves, and expanding
// in place rewrote them into single-segment matches, so a file two directories
// deep was not denied.
function globToRegExp(glob: string): RegExp {
  const pattern = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0001')
    .replace(/\*\*/g, '\u0002')
    .replace(/\*/g, '[^/]*')
    .replaceAll('\u0001', '(?:.*/)?')
    .replaceAll('\u0002', '.*')
  return new RegExp(`^${pattern}$`)
}

const BUILD_IMPORT_PROTECTION = buildImportProtection()
const DENIED = BUILD_IMPORT_PROTECTION.files.map(
  (glob) => [glob, globToRegExp(glob)] as const,
)
const EXCLUDED = BUILD_IMPORT_PROTECTION.excludeFiles.map(globToRegExp)

function denyReason(rel: string): string | null {
  if (EXCLUDED.some((excluded) => excluded.test(rel))) return null
  for (const [glob, denied] of DENIED) {
    if (denied.test(rel)) return `matches importProtection deny pattern '${glob}'`
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
  return [
    join(SRC, 'client.tsx'),
    join(SRC, 'start.ts'),
    join(SRC, 'router.tsx'),
    ...routes,
    ...components,
  ]
}

/** The generated route tree only lists routes, which are entry points on their own. */
const GENERATED_ROUTE_TREE = join(SRC, 'routeTree.gen.ts')

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
  return [...out, ...dynamicSpecifiers(code)]
}

function dynamicSpecifiers(code: string): string[] {
  return [...code.matchAll(DYNAMIC_RE)].flatMap(([, specifier]) =>
    specifier === undefined ? [] : [specifier],
  )
}

// ── Resolution ─────────────────────────────────────────────────────────

const ASSET_EXT_RE =
  /\.(css|scss|svg|png|jpe?g|gif|webp|json|md|woff2?|ttf|ico|mp4|webm)$/i

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

const NODE_ONLY_PACKAGES = [
  'pg',
  'ioredis',
  'bullmq',
  'drizzle-orm',
  'resend',
  'pino',
  'sharp',
  'pdfkit',
  'openai',
  'undici',
  'dotenv',
  'cld3-asm',
  '@aws-sdk',
  '@sentry/node',
] as const

function nodeOnlyImport(spec: string): string | null {
  // `crypto` and `node:crypto` are the same module: Vite externalizes both.
  if (isBuiltin(spec)) return `imports Node builtin '${spec}'`
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

/** What a reached, non-denied module contributes: its own finding and the imports to follow. */
function reachedModule(
  rel: string,
  source: string,
  chain: string[],
): { violation: Violation | null; specs: string[] } {
  const kept = browserKept(rel, source)
  // (b) server-only imports / (c) ambient process.env reads.
  return {
    violation: firstViolation(rel, kept.code, kept.specs, chain),
    specs: kept.specs,
  }
}

/**
 * What the browser keeps of a module: all of it, or, for a module the Start
 * compiler rewrites, what is left once its server halves are dropped.
 */
function browserKept(rel: string, source: string): { code: string; specs: string[] } {
  const code = stripComments(source)
  if (!START_COMPILED.some((factory) => code.includes(factory))) {
    return { code, specs: runtimeSpecifiers(code) }
  }

  const residue = clientResidue(rel, source)
  const keptCode = stripComments(residue.code)
  return {
    code: keptCode,
    specs: [...residue.specifiers, ...dynamicSpecifiers(keptCode)],
  }
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
    if (resolved === GENERATED_ROUTE_TREE) continue
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

    const { violation, specs } = reachedModule(rel, readFileSync(file, 'utf8'), chain)
    if (violation) violations.push(violation)

    pushChildren(specs, file, chain, seen, stack, walkErrors)
  }

  return { violations, walkErrors }
}

describe('browser reachability (BQC-5.3)', () => {
  // R1A-04: the deny list is the build's, not a copy that can drift from it.
  it('denies what the build denies', () => {
    expect(BUILD_IMPORT_PROTECTION.files.length).toBeGreaterThan(0)
    expect(denyReason('shared/email/templates/welcome.tsx')).toBe(
      "matches importProtection deny pattern '**/shared/email/**'",
    )
    expect(denyReason('contexts/review/infrastructure/repositories/x.ts')).toBe(
      "matches importProtection deny pattern '**/infrastructure/**'",
    )
    for (const glob of BUILD_IMPORT_PROTECTION.files) {
      const sample = glob.replaceAll('**/', '').replaceAll('*', 'x')
      expect(denyReason(sample), `${glob} must deny ${sample}`).toBe(
        `matches importProtection deny pattern '${glob}'`,
      )
    }
  })

  it('lets through what the build excludes', () => {
    expect(denyReason('shared/observability/logger.ts')).toBe(
      "matches importProtection deny pattern '**/shared/observability/**'",
    )
    expect(denyReason('shared/observability/sentry-event-scrub.ts')).toBeNull()
  })

  // R1A-04: a bare builtin is the import the hydration crash names.
  it.each(['crypto', 'node:crypto', 'fs/promises', 'pino', '@aws-sdk/client-s3'])(
    'treats %s as Node-only',
    (specifier) => {
      expect(nodeOnlyImport(specifier)).toContain(`'${specifier}'`)
    },
  )

  it('does not mistake a browser package for a Node-only one', () => {
    expect(nodeOnlyImport('react')).toBeNull()
    expect(nodeOnlyImport('@sentry/react')).toBeNull()
  })

  const CHAIN = ['components/guest/scan.tsx', 'contexts/guest/server/guest-scans.ts']

  // R1A-04: the RPC transform stubs handler bodies; a plain export keeps its imports.
  it('flags a server-function module whose plain export keeps a Node builtin', () => {
    const { violation } = reachedModule(
      'contexts/guest/server/guest-scans.ts',
      `import { createHash } from 'node:crypto'
      import { createServerFn } from '@tanstack/react-start'
      export const hashIp = (ip: string) => createHash('sha256').update(ip).digest('hex')
      export const recordScan = createServerFn({ method: 'POST' }).handler(async () => {
        return hashIp('127.0.0.1')
      })`,
      CHAIN,
    )

    expect(violation).toMatchObject({
      file: 'contexts/guest/server/guest-scans.ts',
      reason: "imports Node builtin 'node:crypto'",
    })
  })

  it('follows what a server-function module keeps, and nothing its handlers alone use', () => {
    const { violation, specs } = reachedModule(
      'contexts/guest/server/guest-scans.ts',
      `import { createHash } from 'node:crypto'
      import { createServerFn } from '@tanstack/react-start'
      import { getContainer } from '#/composition'
      import { scanInputSchema } from '../application/dto/scan.dto'
      import { scanErrorStatus } from './scan-errors'
      export { guestSessionFn } from './guest-session'
      const digest = (ip: string) => createHash('sha256').update(ip).digest('hex')
      async function record(ip: string) {
        return getContainer().guestApi.record(digest(ip), process.env.SCAN_SALT)
      }
      export const statusOf = (code: string) => scanErrorStatus(code)
      export const recordScan = createServerFn({ method: 'POST' })
        .validator(scanInputSchema)
        .handler(async ({ data }) => record(data.ip))`,
      CHAIN,
    )

    expect(violation).toBeNull()
    expect([...specs].sort()).toEqual([
      './guest-session',
      './scan-errors',
      '@tanstack/react-start',
    ])
  })

  it('drops the server halves of middleware, isomorphic and server-only functions', () => {
    const { violation, specs } = reachedModule(
      'start.ts',
      `import {
        createIsomorphicFn,
        createMiddleware,
        createServerOnlyFn,
      } from '@tanstack/react-start'
      import { getSecurityHeaders } from '#/shared/security/security-headers'
      import { serverLog } from '#/shared/observability/logger'
      import { getContainer } from '#/composition'
      import { browserLog } from './browser-log'
      const csp = createMiddleware({ type: 'request' }).server(async ({ next }) => {
        getSecurityHeaders({ nonce: process.env.CSP_NONCE })
        return next()
      })
      const log = createIsomorphicFn()
        .server(() => serverLog)
        .client(() => browserLog)
      export const list = createServerOnlyFn(() => getContainer().list())
      export const start = { requestMiddleware: [csp], log }`,
      ['start.ts'],
    )

    expect(violation).toBeNull()
    expect([...specs].sort()).toEqual(['./browser-log', '@tanstack/react-start'])
  })

  it('flags a server-function module that reads process.env outside a handler', () => {
    const { violation } = reachedModule(
      'shared/auth/capability-set.ts',
      `import { createServerFn } from '@tanstack/react-start'
      export const capabilitiesOff = process.env.BETA_CAPABILITIES_OFF === 'all'
      export const readCapabilities = createServerFn({ method: 'GET' }).handler(
        async () => process.env.BETA_CAPABILITIES_OFF,
      )`,
      ['routes/register.tsx', 'shared/auth/capability-set.ts'],
    )

    expect(violation).toMatchObject({ reason: ENV_REASON })
  })

  it('walks a server-directory module with no server function as an ordinary module', () => {
    const { violation, specs } = reachedModule(
      'contexts/guest/server/index.ts',
      `export { recordScan } from './guest-scans'
      import { hashIp } from './hash-ip.server'
      export const hashed = hashIp('127.0.0.1')`,
      ['components/guest/scan.tsx', 'contexts/guest/server/index.ts'],
    )

    expect(violation).toBeNull()
    expect([...specs].sort()).toEqual(['./guest-scans', './hash-ip.server'])
    expect(denyReason('contexts/guest/server/hash-ip.server.ts')).toBe(
      "matches importProtection deny pattern '**/*.server.*'",
    )
  })

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
