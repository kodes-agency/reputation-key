#!/usr/bin/env node
// Enforces kebab-case naming for all component files.
// Hooks (use-*.ts) are exempt.
// Run as: node scripts/check-filenames.mjs

import { readdirSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const componentsDir = join(__dirname, '..', 'src', 'components')

const KEBAB_CASE = /^[a-z][a-z0-9-]*\.(ts|tsx)$/
const HOOK_PATTERN = /^use-[a-z][a-zA-Z0-9-]*\.ts$/

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

const files = walk(componentsDir)
const violations = []

for (const file of files) {
  const name = basename(file)

  // Skip index.ts barrel files
  if (name === 'index.ts') continue

  // Hooks are allowed to use camelCase with use- prefix
  if (file.includes('hooks') && HOOK_PATTERN.test(name)) continue

  if (!KEBAB_CASE.test(name)) {
    violations.push(file)
  }
}

if (violations.length > 0) {
  console.error('❌ Component files must use kebab-case naming:')
  violations.forEach((f) => console.error(`  ${f}`))
  console.error(`\nTotal: ${violations.length} files need renaming.`)
  console.error('See docs/conventions.md "Component Organization" for details.')
  process.exit(1)
}

console.log('✓ All component files use kebab-case naming.')
