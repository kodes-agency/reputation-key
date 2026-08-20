import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const FINAL_FORBIDDEN = Object.freeze([
  'google-import-compatibility-adapter',
  'google-import-compatibility-lifecycle',
  'legacy_import_control',
  'gbp_import_jobs',
  '\"import-property\"',
  "'import-property'",
  'signed-v1',
  'google_account_id',
  'google_email',
  'googleAccountId',
  'googleEmail',
  'gbpPlaceId',
  'gbp_place_id',
  'https://www.googleapis.com/oauth2/v2/userinfo',
  'https://openidconnect.googleapis.com/v1/userinfo',
])
const COMPATIBILITY_REQUIRED = Object.freeze([
  'google-import-compatibility-adapter',
  'google-import-compatibility-lifecycle',
  'legacy_import_control',
  '\"import-property\"',
  'gbp_import_jobs',
  'signed-v1',
  'opaque-v2',
])
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.map', '.json'])

function extension(path) {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot)
}

async function filesBelow(root) {
  const rootPath = resolve(root)
  const found = []
  const visit = async (path) => {
    const entries = await readdir(path, { withFileTypes: true })
    for (const entry of entries) {
      const child = resolve(path, entry.name)
      if (entry.isDirectory()) await visit(child)
      else if (entry.isFile()) found.push(child)
    }
  }
  if (!(await stat(rootPath)).isDirectory()) {
    throw new Error(`Artifact root is not a directory: ${root}`)
  }
  await visit(rootPath)
  return found.sort()
}

async function inspectRoots(roots) {
  const files = []
  const digest = createHash('sha256')
  for (const root of roots) {
    for (const path of await filesBelow(root)) {
      const bytes = await readFile(path)
      const name = relative(process.cwd(), path)
      digest.update(`${name}\0`)
      digest.update(bytes)
      files.push({ path, name, bytes })
    }
  }
  if (files.length === 0) throw new Error('Artifact roots contain no files')
  return Object.freeze({ files, digest: digest.digest('hex') })
}

function searchableText(files) {
  return files
    .filter((file) => TEXT_EXTENSIONS.has(extension(file.path)))
    .map((file) => file.bytes.toString('utf8'))
    .join('\n')
}

function assertFinalArtifact(inspection) {
  const text = searchableText(inspection.files)
  const violations = FINAL_FORBIDDEN.filter((token) => text.includes(token))
  const namedViolations = inspection.files
    .map((file) => file.name)
    .filter((name) => name.includes('compatibility'))
  if (violations.length > 0 || namedViolations.length > 0) {
    throw new Error(
      `Final artifact contains Google import compatibility paths: ${[
        ...violations,
        ...namedViolations,
      ].join(', ')}`,
    )
  }
}

function assertCompatibilityArtifact(inspection) {
  const text = searchableText(inspection.files)
  const missing = COMPATIBILITY_REQUIRED.filter((token) => !text.includes(token))
  if (missing.length > 0) {
    throw new Error(
      `Compatibility artifact is missing frozen rollout contracts: ${missing.join(', ')}`,
    )
  }
  const executableNames = inspection.files
    .map((file) => file.name)
    .filter((name) => name.endsWith('.js') && !name.endsWith('.js.map'))
  if (
    executableNames.length !== 1 ||
    !executableNames[0]?.endsWith('/google-import-lifecycle.js')
  ) {
    throw new Error(
      `Compatibility artifact must contain only google-import-lifecycle.js; found ${executableNames.join(', ')}`,
    )
  }
}

async function main() {
  const [mode, ...roots] = process.argv.slice(2)
  if ((mode !== 'final' && mode !== 'compatibility') || roots.length === 0) {
    throw new Error(
      'Usage: node scripts/check-google-import-artifacts.mjs <final|compatibility> <artifact-root> [...]',
    )
  }
  const inspection = await inspectRoots(roots)
  if (mode === 'final') assertFinalArtifact(inspection)
  else assertCompatibilityArtifact(inspection)
  console.log(
    `[google-import-artifact] ${mode} OK sha256:${inspection.digest} files=${inspection.files.length}`,
  )
}

await main()
