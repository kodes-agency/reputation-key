#!/usr/bin/env node
// Phase 4: Restructure Property, Team, Guest + rename Staff/Organization.

import { readdirSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, basename, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const root = join(__dirname, '..')
const src = join(root, 'src', 'components', 'features')

// ── Property ──────────────────────────────────────────────────────────
const propertyDir = join(src, 'property')
mkdirSync(join(propertyDir, 'property-form'), { recursive: true })
mkdirSync(join(propertyDir, 'property-detail'), { recursive: true })

const propertyMoves = [
  { file: 'create-property-form.tsx', dest: 'property-form/create-property-form.tsx' },
  { file: 'edit-property-form.tsx', dest: 'property-form/edit-property-form.tsx' },
  { file: 'timezone-combobox.tsx', dest: 'property-form/timezone-combobox.tsx' },
  { file: 'timezone-select.tsx', dest: 'property-form/timezone-select.tsx' },
  {
    file: 'property-detail-fields.tsx',
    dest: 'property-detail/property-detail-fields.tsx',
  },
]

console.log('\n=== Property ===\n')
for (const { file, dest } of propertyMoves) {
  renameSync(join(propertyDir, file), join(propertyDir, dest))
  console.log(`  ✓ ${file} → ${dest}`)
}

writeFileSync(
  join(propertyDir, 'index.ts'),
  `// Property feature — public API.
export { CreatePropertyForm } from './property-form/create-property-form'
export { EditPropertyForm } from './property-form/edit-property-form'
export { TimezoneCombobox } from './property-form/timezone-combobox'
export { TimezoneSelect } from './property-form/timezone-select'
export { PropertyDetailFields } from './property-detail/property-detail-fields'
`,
)
console.log('  ✓ Created index.ts')

// ── Team ──────────────────────────────────────────────────────────────
const teamDir = join(src, 'team')
mkdirSync(join(teamDir, 'team-form'), { recursive: true })
mkdirSync(join(teamDir, 'team-members'), { recursive: true })

const teamMoves = [
  { file: 'create-team-form.tsx', dest: 'team-form/create-team-form.tsx' },
  { file: 'edit-team-form.tsx', dest: 'team-form/edit-team-form.tsx' },
  { file: 'team-lead-select.tsx', dest: 'team-form/team-lead-select.tsx' },
  { file: 'team-member-list.tsx', dest: 'team-members/team-member-list.tsx' },
]

console.log('\n=== Team ===\n')
for (const { file, dest } of teamMoves) {
  renameSync(join(teamDir, file), join(teamDir, dest))
  console.log(`  ✓ ${file} → ${dest}`)
}

writeFileSync(
  join(teamDir, 'index.ts'),
  `// Team feature — public API.
export { CreateTeamForm } from './team-form/create-team-form'
export { EditTeamForm } from './team-form/edit-team-form'
export { TeamLeadSelect } from './team-form/team-lead-select'
export { TeamMemberList } from './team-members/team-member-list'
`,
)
console.log('  ✓ Created index.ts')

// ── Guest ─────────────────────────────────────────────────────────────
const guestDir = join(src, '..', 'guest')
mkdirSync(join(guestDir, 'public-portal'), { recursive: true })

const guestMoves = [
  { file: 'public-portal-content.tsx', dest: 'public-portal/public-portal-content.tsx' },
  { file: 'star-rating.tsx', dest: 'public-portal/star-rating.tsx' },
  { file: 'feedback-form.tsx', dest: 'public-portal/feedback-form.tsx' },
]

console.log('\n=== Guest ===\n')
for (const { file, dest } of guestMoves) {
  renameSync(join(guestDir, file), join(guestDir, dest))
  console.log(`  ✓ ${file} → ${dest}`)
}

writeFileSync(
  join(guestDir, 'index.ts'),
  `// Guest feature — public API.
export { PublicPortalContent } from './public-portal/public-portal-content'
export type { PortalCategory, PortalLinkItem } from './public-portal/public-portal-content'
export { PortalUnavailable } from './portal-unavailable'
export { CookieConsentBanner } from './cookie-consent-banner'
`,
)
console.log('  ✓ Created index.ts')

// ── Update internal imports ───────────────────────────────────────────
console.log('\n=== Updating internal imports ===\n')

// Property: create-property-form imports TimezoneCombobox
const cpf = join(propertyDir, 'property-form/create-property-form.tsx')
let content = readFileSync(cpf, 'utf-8')
content = content.replace("from './TimezoneCombobox'", "from './timezone-combobox'")
writeFileSync(cpf, content)
console.log('  ✓ create-property-form.tsx imports updated')

// Property: edit-property-form imports TimezoneSelect
const epf = join(propertyDir, 'property-form/edit-property-form.tsx')
content = readFileSync(epf, 'utf-8')
content = content.replace("from './TimezoneSelect'", "from './timezone-select'")
writeFileSync(epf, content)
console.log('  ✓ edit-property-form.tsx imports updated')

// Property: property-detail-fields imports EditPropertyForm
const pdf = join(propertyDir, 'property-detail/property-detail-fields.tsx')
content = readFileSync(pdf, 'utf-8')
content = content.replace(
  "from '#/components/features/property/EditPropertyForm'",
  "from '../property-form/edit-property-form'",
)
content = content.replace(
  "from '#/components/features/property/edit-property-form'",
  "from '../property-form/edit-property-form'",
)
writeFileSync(pdf, content)
console.log('  ✓ property-detail-fields.tsx imports updated')

// Team: create-team-form imports TeamLeadSelect
const ctf = join(teamDir, 'team-form/create-team-form.tsx')
content = readFileSync(ctf, 'utf-8')
content = content.replace(
  "from '#/components/features/team/TeamLeadSelect'",
  "from './team-lead-select'",
)
content = content.replace(
  "from '#/components/features/team/team-lead-select'",
  "from './team-lead-select'",
)
writeFileSync(ctf, content)
console.log('  ✓ create-team-form.tsx imports updated')

// Team: edit-team-form imports TeamLeadSelect
const etf = join(teamDir, 'team-form/edit-team-form.tsx')
content = readFileSync(etf, 'utf-8')
content = content.replace(
  "from '#/components/features/team/TeamLeadSelect'",
  "from './team-lead-select'",
)
content = content.replace(
  "from '#/components/features/team/team-lead-select'",
  "from './team-lead-select'",
)
writeFileSync(etf, content)
console.log('  ✓ edit-team-form.tsx imports updated')

// Guest: public-portal-content imports star-rating and feedback-form
const ppc = join(guestDir, 'public-portal/public-portal-content.tsx')
content = readFileSync(ppc, 'utf-8')
content = content.replace("from './star-rating'", "from './star-rating'")
content = content.replace("from './feedback-form'", "from './feedback-form'")
writeFileSync(ppc, content)
console.log('  ✓ public-portal-content.tsx imports updated')

// ── Update external imports ───────────────────────────────────────────
console.log('\n=== Updating external imports ===\n')

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

const barrelImports = [
  // Property
  {
    from: '#/components/features/property/create-property-form',
    to: '#/components/features/property',
  },
  {
    from: '#/components/features/property/edit-property-form',
    to: '#/components/features/property',
  },
  {
    from: '#/components/features/property/property-detail-fields',
    to: '#/components/features/property',
  },
  {
    from: '#/components/features/property/timezone-combobox',
    to: '#/components/features/property',
  },
  {
    from: '#/components/features/property/timezone-select',
    to: '#/components/features/property',
  },
  // Team
  {
    from: '#/components/features/team/create-team-form',
    to: '#/components/features/team',
  },
  { from: '#/components/features/team/edit-team-form', to: '#/components/features/team' },
  {
    from: '#/components/features/team/team-lead-select',
    to: '#/components/features/team',
  },
  {
    from: '#/components/features/team/team-member-list',
    to: '#/components/features/team',
  },
  // Guest
  { from: '#/components/guest/public-portal-content', to: '#/components/guest' },
  { from: '#/components/features/guest/public-portal-content', to: '#/components/guest' },
  { from: '#/components/guest/star-rating', to: '#/components/guest' },
  { from: '#/components/guest/feedback-form', to: '#/components/guest' },
  { from: '#/components/guest/cookie-consent-banner', to: '#/components/guest' },
  { from: '#/components/guest/portal-unavailable', to: '#/components/guest' },
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

console.log(`\n✅ Done: ${filesModified} files with updated imports.`)
console.log('Run `pnpm lint && pnpm typecheck` to verify.\n')

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
