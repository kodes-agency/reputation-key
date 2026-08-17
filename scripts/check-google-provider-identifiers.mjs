import { readFile, readdir } from 'node:fs/promises'
import { extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const CATALOGUE_PATH = 'test-fixtures/google-provider-identifiers-v1.json'
const GENERATED_IMPORT_MARKERS = Object.freeze([
  'test-fixtures/generated/google-provider-identifiers-v1',
  'e2e/fixtures/generated/google-provider-identifiers-v1',
  'test-fixtures/generated/review-provider-subject-v1.fixture.json',
])
const TEXT_EXTENSIONS = Object.freeze({
  '.cjs': true,
  '.har': true,
  '.html': true,
  '.js': true,
  '.json': true,
  '.jsonl': true,
  '.jsx': true,
  '.log': true,
  '.md': true,
  '.mdx': true,
  '.mjs': true,
  '.sql': true,
  '.text': true,
  '.ts': true,
  '.tsx': true,
  '.txt': true,
  '.yaml': true,
  '.yml': true,
})
const IGNORED_DIRECTORY_NAMES = Object.freeze({
  '.git': true,
  '.pnpm': true,
  node_modules: true,
})
const RESOURCE_SEGMENT = '[A-Za-z0-9][A-Za-z0-9._~-]{0,254}'
const PROVIDER_RESOURCE = new RegExp(
  `^accounts/${RESOURCE_SEGMENT}(?:/locations/${RESOURCE_SEGMENT}(?:/reviews/${RESOURCE_SEGMENT})?)?$`,
  'u',
)
const CANDIDATE = /accounts\/[^\s'"`<>()\\]+/gu
const SOURCE_IMPORT = /(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/gu

function toRepoPath(root, path) {
  return relative(root, path).split(sep).join('/')
}

function isTestOnlyConsumer(path) {
  return (
    path.startsWith('e2e/') ||
    path.startsWith('scripts/') ||
    path.startsWith('src/test-fixtures/') ||
    path.startsWith('test-fixtures/') ||
    /(?:^|\/)__tests__\//u.test(path) ||
    /\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(path)
  )
}

function parseCatalogue(source) {
  const catalogue = JSON.parse(source)
  if (
    catalogue === null ||
    typeof catalogue !== 'object' ||
    catalogue.catalogueVersion !== 'google-provider-identifiers-v1' ||
    !Array.isArray(catalogue.entries)
  ) {
    throw new Error('Google provider fixture catalogue has an invalid top-level shape')
  }
  const permissions = new Map()
  for (const entry of catalogue.entries) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      typeof entry.literal !== 'string' ||
      !Array.isArray(entry.allowedGeneratedTargets)
    ) {
      throw new Error('Google provider fixture catalogue has an invalid entry')
    }
    if (permissions.has(entry.literal))
      throw new Error(`duplicate catalogue literal: ${entry.literal}`)
    permissions.set(entry.literal, new Set(entry.allowedGeneratedTargets))
  }
  return permissions
}

async function collectTextFiles(directory, files) {
  const entries = await readdir(directory, { withFileTypes: true })
  entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRECTORY_NAMES[entry.name] === true) continue
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      await collectTextFiles(path, files)
    } else if (
      entry.isFile() &&
      TEXT_EXTENSIONS[extname(entry.name).toLowerCase()] === true
    ) {
      files.push(path)
    }
  }
}

function tokenizedFragments(content, repoPath) {
  if (repoPath.endsWith('.md') || repoPath.endsWith('.mdx')) {
    const fragments = []
    const code = /```[^\\n]*\\n([\\s\\S]*?)```|`([^`\\n]+)`/gu
    for (const match of content.matchAll(code)) {
      const text = match[1] ?? match[2] ?? ''
      const relativeOffset = match[0].indexOf(text)
      fragments.push({ text, offset: (match.index ?? 0) + relativeOffset })
    }
    return fragments
  }
  return [{ text: content, offset: 0 }]
}

function scanResourceCandidates(content, repoPath, permissions, failures) {
  for (const fragment of tokenizedFragments(content, repoPath)) {
    CANDIDATE.lastIndex = 0
    for (const match of fragment.text.matchAll(CANDIDATE)) {
      const candidate = match[0]
      const prior = fragment.text[(match.index ?? 0) - 1]
      if (prior && /[A-Za-z0-9._~/-]/u.test(prior)) continue
      const allowedTargets = permissions.get(candidate)
      if (repoPath === CATALOGUE_PATH && allowedTargets) continue
      if (allowedTargets?.has(repoPath)) continue
      if (allowedTargets || PROVIDER_RESOURCE.test(candidate)) {
        const absoluteOffset = fragment.offset + (match.index ?? 0)
        const line = content.slice(0, absoluteOffset).split('\\n').length
        failures.push(
          `${repoPath}:${line}: provider resource literal is not allowed in this path`,
        )
      }
    }
  }
}

function scanProductionImports(content, repoPath, failures) {
  if (isTestOnlyConsumer(repoPath)) return
  SOURCE_IMPORT.lastIndex = 0
  for (const match of content.matchAll(SOURCE_IMPORT)) {
    const importedPath = match[1]
    if (GENERATED_IMPORT_MARKERS.some((marker) => importedPath.includes(marker))) {
      const line = content.slice(0, match.index).split('\n').length
      failures.push(
        `${repoPath}:${line}: production code must not import Google provider fixtures`,
      )
    }
  }
}

export async function checkGoogleProviderIdentifiers(root = ROOT) {
  const catalogueSource = await readFile(resolve(root, CATALOGUE_PATH), 'utf8')
  const permissions = parseCatalogue(catalogueSource)
  const files = []
  await collectTextFiles(root, files)
  const failures = []
  for (const path of files) {
    const repoPath = toRepoPath(root, path)
    const content = await readFile(path, 'utf8')
    scanResourceCandidates(content, repoPath, permissions, failures)
    scanProductionImports(content, repoPath, failures)
  }
  if (failures.length > 0) {
    throw new Error(`Google provider identifier scan failed:\n${failures.join('\n')}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkGoogleProviderIdentifiers().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
