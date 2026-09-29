import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.map', '.json'])

const FORBIDDEN_NAMES = Object.freeze([
  /(?:^|\/)seed-e2e-user(?:\.|$)/u,
  /(?:^|\/)provision-google-admission-role(?:\.|$)/u,
  /\.stories\.[cm]?[jt]sx?(?:\.|$)/u,
])

const FORBIDDEN_CONTENT = Object.freeze([
  { label: 'default E2E credential', pattern: /password123/u },
  {
    label: 'CommonJS pino-pretty resolution in an ESM artifact',
    pattern: /\brequire\s*\.\s*resolve\s*\(\s*['"]pino-pretty['"]\s*\)/u,
  },
])

// Source paths are inspected from the source-map graph, not by matching every
// string in executable output. The runtime capability catalogue intentionally
// documents operator paths as inert data; treating those labels as imports
// would produce a false positive. A matching source-map entry, by contrast,
// proves the source was actually bundled.
const FORBIDDEN_SOURCES = Object.freeze([
  {
    label: 'E2E seeder source',
    pattern: /scripts[\\/]seed-e2e-user\.ts/u,
  },
  {
    label: 'Google admission role provisioner source',
    pattern: /scripts[\\/]ops[\\/]provision-google-admission-role\.ts/u,
  },
  {
    label: 'simulation source',
    pattern: /scripts[\\/](?:seed|simulate)\.ts/u,
  },
  {
    label: 'Google provider fixture generator source',
    pattern: /scripts[\\/]generate-google-provider-fixtures\.ts/u,
  },
  {
    label: 'operator-only command source',
    pattern: /scripts[\\/]ops[\\/]/u,
  },
  {
    label: 'Storybook source',
    pattern: /(?:^|[\\/])[^\n"']+\.stories\.[cm]?[jt]sx?/u,
  },
])

async function filesBelow(root) {
  const rootPath = resolve(root)
  if (!(await stat(rootPath)).isDirectory()) {
    throw new Error(`Artifact root is not a directory: ${root}`)
  }
  const found = []
  const visit = async (path) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = resolve(path, entry.name)
      if (entry.isDirectory()) await visit(child)
      else if (entry.isFile()) found.push(child)
    }
  }
  await visit(rootPath)
  return found.sort()
}

/**
 * A source map that cannot be read is itself a violation: an unreadable map
 * cannot prove that no forbidden source was bundled.
 */
function collectSourceMapViolations(name, contents, violations) {
  let sourceMap
  try {
    sourceMap = JSON.parse(contents)
  } catch {
    violations.push(`${name}: invalid source map JSON`)
    return
  }
  if (!Array.isArray(sourceMap.sources)) {
    violations.push(`${name}: source map has no sources array`)
    return
  }
  for (const source of sourceMap.sources) {
    if (typeof source !== 'string') {
      violations.push(`${name}: source map contains a non-string source`)
      continue
    }
    for (const rule of FORBIDDEN_SOURCES) {
      if (rule.pattern.test(source)) {
        violations.push(`${name}: ${rule.label} (${source})`)
      }
    }
  }
}

/** Grade one artifact by its name, and — when it is text — by its contents. */
function collectFileViolations(name, path, bytes, violations) {
  for (const pattern of FORBIDDEN_NAMES) {
    if (pattern.test(name)) violations.push(`${name}: forbidden executable/source name`)
  }
  if (!TEXT_EXTENSIONS.has(extname(path))) return
  const contents = bytes.toString('utf8')
  for (const rule of FORBIDDEN_CONTENT) {
    if (rule.pattern.test(contents)) violations.push(`${name}: ${rule.label}`)
  }
  if (extname(path) === '.map') collectSourceMapViolations(name, contents, violations)
}

// Nitro bundles its static-asset manifest (`#nitro/virtual/public-assets-data`)
// into a server chunk and serves every listed id by reading the entry's `path`,
// relative to `server/`. An id whose file the build deleted afterwards answers
// 500, not 404: on 2026-09-29 the client source maps were listed, then deleted
// by the Dockerfile, and every `GET /assets/<chunk>.js.map` paged the owner.
const PUBLIC_ASSET_MANIFEST_REGION =
  /\/\/#region #nitro\/virtual\/public-assets-data\n[^{]*(\{[\s\S]*?\n\});?\n\/\/#endregion/gu

async function isDirectory(path) {
  return stat(path).then(
    (stats) => stats.isDirectory(),
    () => false,
  )
}

async function isFile(path) {
  return stat(path).then(
    (stats) => stats.isFile(),
    () => false,
  )
}

/** Nitro's node-server layout: `server/index.mjs` serving from `public/`. */
async function isNitroOutput(rootPath) {
  return (
    (await isFile(resolve(rootPath, 'server/index.mjs'))) &&
    (await isDirectory(resolve(rootPath, 'public')))
  )
}

function parsePublicAssetManifests(name, contents, violations) {
  return [...contents.matchAll(PUBLIC_ASSET_MANIFEST_REGION)].flatMap(([, literal]) => {
    try {
      return [JSON.parse(literal)]
    } catch {
      violations.push(`${name}: unreadable Nitro public-asset manifest`)
      return []
    }
  })
}

/**
 * Every id the manifest serves must exist. A manifest that cannot be found is
 * itself a violation: without it nothing proves the served set is readable.
 */
async function collectPublicAssetViolations(root, violations) {
  const rootPath = resolve(root)
  if (!(await isNitroOutput(rootPath))) return
  const serverDir = resolve(rootPath, 'server')
  const manifests = []
  for (const path of await filesBelow(serverDir)) {
    if (!path.endsWith('.mjs')) continue
    const name = relative(process.cwd(), path).replaceAll('\\', '/')
    const contents = await readFile(path, 'utf8')
    manifests.push(...parsePublicAssetManifests(name, contents, violations))
  }
  if (manifests.length === 0) {
    violations.push(`${root}: no Nitro public-asset manifest found under server/`)
    return
  }
  for (const manifest of manifests) {
    for (const [id, asset] of Object.entries(manifest)) {
      if (typeof asset?.path !== 'string') continue
      if (await isFile(resolve(serverDir, asset.path))) continue
      violations.push(
        `${root}: public asset ${id} is listed but ${asset.path} does not exist (Nitro would answer 500)`,
      )
    }
  }
}

async function inspect(roots) {
  const digest = createHash('sha256')
  const violations = []
  let fileCount = 0
  for (const root of roots) {
    for (const path of await filesBelow(root)) {
      fileCount += 1
      const name = relative(process.cwd(), path).replaceAll('\\', '/')
      const bytes = await readFile(path)
      digest.update(`${name}\0`)
      digest.update(bytes)
      collectFileViolations(name, path, bytes, violations)
    }
    await collectPublicAssetViolations(root, violations)
  }
  if (fileCount === 0) throw new Error('Artifact roots contain no files')
  return {
    digest: digest.digest('hex'),
    fileCount,
    violations: [...new Set(violations)].sort(),
  }
}

async function main() {
  const roots = process.argv.slice(2)
  if (roots.length === 0) {
    throw new Error(
      'Usage: node scripts/check-production-artifacts.mjs <artifact-root> [...]',
    )
  }
  const result = await inspect(roots)
  if (result.violations.length > 0) {
    throw new Error(
      `Production artifact policy violation:\n${result.violations.map((item) => `- ${item}`).join('\n')}`,
    )
  }
  process.stdout.write(
    `[production-artifact] OK sha256:${result.digest} files=${result.fileCount}\n`,
  )
}

await main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
