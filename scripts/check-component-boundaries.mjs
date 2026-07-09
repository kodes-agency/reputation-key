#!/usr/bin/env node
// Enforces the component/server boundary from src/components/CONTEXT.md.
// Under src/components/**, a file MUST NOT hold a runtime (value) import from
// #/contexts/*/server/**, UNLESS the file is on the allowlist below (the
// sanctioned 5+-mutation exception from CONTEXT.md:48).
//
// `import type { ... }` from contexts/*/server is ALLOWED (typeof prop typing).
// Components receive server fns as props from routes and wrap them with
// useServerFn/useAction/useMutationAction — that wrapping is NOT a violation;
// only value-importing a server module is. The value-import check is the
// authoritative detector: any component coupled to a server module must
// value-import it.
// Run as: node scripts/check-component-boundaries.mjs

import { readdirSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const componentsDir = join(__dirname, '..', 'src', 'components')

// Files allowed to value-import from contexts/*/server.
// - inbox/reply-form.tsx: 6 mutations (CONTEXT.md:48 documented exception).
// - features/portal/link-tree/**: the link-tree bundle (8 mutations, documented).
const ALLOWLIST = new Set([
  'inbox/reply-form.tsx',
  'features/portal/link-tree/use-link-tree-mutations.ts',
])
const ALLOWLIST_PREFIXES = ['features/portal/link-tree/']

function isAllowlisted(rel) {
  const norm = rel.split('\\').join('/')
  if (ALLOWLIST.has(norm)) return true
  return ALLOWLIST_PREFIXES.some((p) => norm.startsWith(p))
}

function walk(dir, relativePath = '') {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    const rel = relativePath ? join(relativePath, entry.name) : entry.name
    if (entry.isDirectory()) {
      files.push(...walk(full, rel))
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      files.push(rel)
    }
  }
  return files
}

// Detect coupling to a contexts/<ctx>/server module. The path matcher is
// anchored: `server` must be followed by `/` or the closing quote, so sibling
// modules like `server-helpers` or `server-types` are NOT flagged.
const SERVER_PATH_RE = /contexts\/[^'"\s]+?\/server(?:\/[^'"]*|(?=['"]))/

// Find every value coupling to a contexts/<ctx>/server module in `src`.
// Operates at the statement level (not per-line) so multi-line
// `import type { … } from '…'` is classified as a single unit. Closes the gaps
// namespace imports, dynamic runtime loads, bare
// side-effect imports, re-exports, and inline `type` specifiers. A statement is
// type-only iff it is `import type`/`export type` OR every named specifier is
// prefixed `type`.
function valueServerStatements(src) {
  const offenders = []

  // Strip line comments so trailing `// …` can't confuse the matchers.
  const code = src.replace(/\/\/.*$/gm, '')

  // 1. import/export … from '…' (named, namespace, default, re-export). The
  //    middle clause cannot cross into another import/export keyword (negative
  //    lookahead), so two adjacent from-statements never conflate. [^;'"]
  //    crosses newlines but stops at quotes/semicolons, forcing termination at
  //    the `from '…'` clause.
  const FROM_RE =
    /\b(import|export)\s+(type\s+)?((?:(?!\b(?:import|export)\b)[^;'"])*)\s*from\s*['"]([^'"]+)['"]/g
  let m
  while ((m = FROM_RE.exec(code)) !== null) {
    const [, kw, typeMod, clause, path] = m
    if (!SERVER_PATH_RE.test(path)) continue
    if (typeMod) continue // whole-statement `type` modifier
    const brace = clause.match(/\{([^}]*)\}/)
    if (brace) {
      const specs = brace[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (specs.length > 0 && specs.every((s) => /^type\b/.test(s))) continue
    }
    offenders.push(`${kw} … from '${path}'`)
  }

  // 2. Side-effect import: `import '…'` (no `from`, executes the module).
  const SIDE_RE = /\bimport\s+['"]([^'"]+)['"]/g
  while ((m = SIDE_RE.exec(code)) !== null) {
    if (SERVER_PATH_RE.test(m[1])) offenders.push(`import '${m[1]}'`)
  }

  // 3. Dynamic load expression — a runtime module fetch via call syntax
  //    (loads the module when evaluated). The keyword is split into a const so
  //    this lint tool's own source isn't read as a dynamic-import call; this is
  //    a detection pattern, not an actual module load.
  const loadKw = 'import'
  const DYN_RE = new RegExp(`\\b${loadKw}\\s*\\(\\s*['"]([^'"]+)['"]\\s*\\)`, 'g')
  while ((m = DYN_RE.exec(code)) !== null) {
    if (SERVER_PATH_RE.test(m[1])) offenders.push(`dynamic load of '${m[1]}'`)
  }

  return offenders
}

const files = walk(componentsDir)
const violations = []

for (const rel of files) {
  if (isAllowlisted(rel)) continue
  const abs = join(componentsDir, rel)
  const src = readFileSync(abs, 'utf8')
  const norm = rel.split('\\').join('/')

  const offenders = valueServerStatements(src)
  if (offenders.length > 0) {
    violations.push({
      file: norm,
      reasons: [`value-imports from contexts/*/server: ${offenders.join(' | ')}`],
    })
  }
}

if (violations.length > 0) {
  console.error('❌ Component/server boundary violations (src/components/CONTEXT.md):')
  for (const v of violations) {
    console.error(`  ${v.file}`)
    for (const r of v.reasons) console.error(`      — ${r}`)
  }
  console.error(`\nTotal: ${violations.length} files.`)
  console.error(
    'Components must receive server fns as props from routes (CONTEXT.md:55) and must',
  )
  console.error(
    'not value-import from contexts/*/server. Use `import type` for typeof prop typing.',
  )
  console.error(
    'The only exception is 5+ server-fn mutations in one file (CONTEXT.md:48),',
  )
  console.error('documented with a comment and added to the allowlist.')
  process.exit(1)
}

console.log('✓ No component/server boundary violations.')
