#!/usr/bin/env node
// Phase 2: Restructure Identity into domain-concept folders.
// Moves files, creates barrel exports, updates all imports.

import {
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs'
import { join, dirname, basename, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const root = join(__dirname, '..')
const identityDir = join(root, 'src', 'components', 'features', 'identity')

// ── Define moves ─────────────────────────────────────────────────────
const moves = [
  // login/
  { file: 'login-form.tsx', dest: 'login/login-form.tsx' },
  // registration/
  { file: 'register-form.tsx', dest: 'registration/register-form.tsx' },
  { file: 'accept-invitation-page.tsx', dest: 'registration/accept-invitation-page.tsx' },
  // member-directory/
  { file: 'member-table.tsx', dest: 'member-directory/member-table.tsx' },
  { file: 'invite-member-form.tsx', dest: 'member-directory/invite-member-form.tsx' },
  { file: 'invitation-table.tsx', dest: 'member-directory/invitation-table.tsx' },
  // reset-password/
  { file: 'reset-password-form.tsx', dest: 'reset-password/reset-password-form.tsx' },
  // shared/
  { file: 'role-badge.tsx', dest: 'shared/role-badge.tsx' },
]

// ── Phase 1: Move files ──────────────────────────────────────────────
console.log('\nPhase 2: Restructuring Identity...\n')

for (const { file, dest } of moves) {
  const src = join(identityDir, file)
  const dst = join(identityDir, dest)

  // Ensure destination directory exists
  mkdirSync(dirname(dst), { recursive: true })

  renameSync(src, dst)
  console.log(`  ✓ ${file} → ${dest}`)
}

// ── Phase 2: Create barrel export ────────────────────────────────────
const barrelContent = `// Identity feature — public API.
// Re-exports page-level components from each concept folder.
// Internal sub-components are not exported.

export { LoginForm } from './login/login-form'
export { RegisterForm } from './registration/register-form'
export { AcceptInvitationPage } from './registration/accept-invitation-page'
export { MemberTable } from './member-directory/member-table'
export type { MemberRow } from './member-directory/member-table'
export { InviteMemberForm } from './member-directory/invite-member-form'
export { InvitationTable } from './member-directory/invitation-table'
export type { InvitationRow } from './member-directory/invitation-table'
export { ResetPasswordForm } from './reset-password/reset-password-form'
export { RoleBadge } from './shared/role-badge'
`

writeFileSync(join(identityDir, 'index.ts'), barrelContent)
console.log('\n  ✓ Created index.ts barrel')

// ── Phase 3: Update imports ──────────────────────────────────────────
console.log('\nPhase 3: Updating imports...\n')

// Build rename map for import updates
const importRenames = [
  // Old relative imports within identity → new paths
  { from: './role-badge', to: '../shared/role-badge' },
  { from: './RoleBadge', to: '../shared/role-badge' },
  {
    from: '#/components/features/identity/role-badge',
    to: '#/components/features/identity/shared/role-badge',
  },
  {
    from: '#/components/features/identity/RoleBadge',
    to: '#/components/features/identity/shared/role-badge',
  },
]

// Files that need internal import path updates (within identity feature)
const internalFiles = [
  'member-directory/member-table.tsx',
  'member-directory/invitation-table.tsx',
]

for (const relPath of internalFiles) {
  const filePath = join(identityDir, relPath)
  let content = readFileSync(filePath, 'utf-8')

  for (const { from, to } of importRenames) {
    content = content.replace(
      new RegExp(`from ['"]${escapeRegex(from)}['"]`, 'g'),
      `from '${to}'`,
    )
  }

  writeFileSync(filePath, content, 'utf-8')
  console.log(`  Updated imports in ${relPath}`)
}

// Update imports across the entire codebase
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

// Map of old identity imports → new barrel imports
const barrelImports = [
  {
    from: '#/components/features/identity/login-form',
    to: '#/components/features/identity',
  },
  {
    from: '#/components/features/identity/register-form',
    to: '#/components/features/identity',
  },
  {
    from: '#/components/features/identity/accept-invitation-page',
    to: '#/components/features/identity',
  },
  {
    from: '#/components/features/identity/member-table',
    to: '#/components/features/identity',
  },
  {
    from: '#/components/features/identity/invite-member-form',
    to: '#/components/features/identity',
  },
  {
    from: '#/components/features/identity/invitation-table',
    to: '#/components/features/identity',
  },
  {
    from: '#/components/features/identity/reset-password-form',
    to: '#/components/features/identity',
  },
  {
    from: '#/components/features/identity/role-badge',
    to: '#/components/features/identity',
  },
]

let filesModified = 0

for (const filePath of allFiles) {
  let content = readFileSync(filePath, 'utf-8')
  let changed = false

  for (const { from, to } of barrelImports) {
    const pattern = new RegExp(`(from\\s+['"])${escapeRegex(from)}(\\.tsx?)?(['"])`, 'g')
    if (pattern.test(content)) {
      content = content.replace(pattern, `$1${to}$3`)
      changed = true
    }
  }

  if (changed) {
    writeFileSync(filePath, content, 'utf-8')
    console.log(`  Updated: ${relative(srcDir, filePath)}`)
    filesModified++
  }
}

console.log(
  `\n✅ Done: ${moves.length} files moved, ${filesModified} files with updated imports.`,
)
console.log('Run `pnpm lint && pnpm typecheck` to verify.\n')

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
