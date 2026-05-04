#!/usr/bin/env node
// Phase 1: Rename all component files from PascalCase to kebab-case.
// Reads scripts/component-rename-map.json, renames files, updates all imports.
// Run as: node scripts/rename-components.mjs

import { readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname, basename, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const root = join(__dirname, '..')

// ── Load rename map ─────────────────────────────────────────────────
const mapPath = join(root, 'scripts', 'component-rename-map.json')
const { renames } = JSON.parse(readFileSync(mapPath, 'utf-8'))

// ── Phase 1: Rename files ───────────────────────────────────────────
console.log(`\nPhase 1: Renaming ${renames.length} files...\n`)

for (const { old, new: newPath } of renames) {
  const oldPath = join(root, old)
  const destPath = join(root, newPath)

  // Ensure destination directory exists
  const destDir = dirname(destPath)
  // mkdir -p equivalent
  const parts = destDir.split('/').filter(Boolean)
  let current = parts[0].startsWith('.') ? parts.shift() : '/'
  for (const part of parts) {
    current = join(current, part)
    try {
      statSync(current)
    } catch {
      // Directory doesn't exist, will be created by renameSync's parent
    }
  }

  try {
    renameSync(oldPath, destPath)
    console.log(`  ✓ ${old} → ${newPath}`)
  } catch (err) {
    console.error(`  ✗ FAILED: ${old} → ${newPath}`)
    console.error(`    ${err.message}`)
  }
}

// ── Phase 2: Update imports ─────────────────────────────────────────
console.log(`\nPhase 2: Updating imports...\n`)

// Build a lookup: old basename → new full path (relative to src/)
const oldToNewRelative = {}
for (const { old, new: newPath } of renames) {
  const oldName = basename(old)
  const newName = basename(newPath)
  // Map: old filename (without extension) → new import path (without extension)
  const oldBase = oldName.replace(/\.(tsx?)$/, '')
  const newBase = newName.replace(/\.(tsx?)$/, '')
  oldToNewRelative[oldBase] = { oldName, newName, newPath }
}

// Find all .ts/.tsx files in src/
function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walk(full))
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      files.push(full)
    }
  }
  return files
}

const srcDir = join(root, 'src')
const allFiles = walk(srcDir)

let totalReplacements = 0
const filesModified = new Set()

for (const filePath of allFiles) {
  let content = readFileSync(filePath, 'utf-8')
  let changed = false

  // For each rename, check if this file imports it
  for (const { old, new: newPath } of renames) {
    const oldName = basename(old)
    const newName = basename(newPath)
    const oldBase = oldName.replace(/\.(tsx?)$/, '')
    const newBase = newName.replace(/\.(tsx?)$/, '')

    // Pattern 1: Absolute imports — '#/components/.../OldName'
    // Match: from '#/.../OldName' or from '#/.../OldName.tsx'
    const absPattern = new RegExp(
      `(from\\s+['"])([^'"]*[/])${oldBase}(\\.tsx?)?(['"])`,
      'g',
    )
    if (absPattern.test(content)) {
      content = content.replace(absPattern, `$1$2${newBase}$3$4`)
      changed = true
    }

    // Pattern 2: Relative imports — './OldName' or '../OldName'
    const relPattern = new RegExp(
      `(from\\s+['"])(\\.\\.?[/][^'"]*[/])?${oldBase}(\\.tsx?)?(['"])`,
      'g',
    )
    if (relPattern.test(content)) {
      content = content.replace(relPattern, `$1$2${newBase}$3$4`)
      changed = true
    }
  }

  if (changed) {
    writeFileSync(filePath, content, 'utf-8')
    filesModified.add(relative(srcDir, filePath))
    totalReplacements++
  }
}

if (filesModified.size > 0) {
  console.log(`  Updated imports in ${filesModified.size} files:`)
  for (const f of [...filesModified].sort()) {
    console.log(`    src/${f}`)
  }
} else {
  console.log('  No import updates needed.')
}

// ── Summary ─────────────────────────────────────────────────────────
console.log(
  `\n✅ Done: ${renames.length} files renamed, ${totalReplacements} files with updated imports.`,
)
console.log('Run `pnpm lint && pnpm typecheck` to verify.\n')
