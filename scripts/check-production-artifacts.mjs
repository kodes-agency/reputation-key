import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.map', '.json'])

const FORBIDDEN_NAMES = Object.freeze([
  /(?:^|\/)seed-e2e-user(?:\.|$)/u,
  /(?:^|\/)provision-ai-admission-role(?:\.|$)/u,
  /\.stories\.[cm]?[jt]sx?(?:\.|$)/u,
])

const FORBIDDEN_CONTENT = Object.freeze([
  { label: 'default E2E credential', pattern: /password123/u },
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
    label: 'AI admission role provisioner source',
    pattern: /scripts[\\/]local-stack[\\/]provision-ai-admission-role\.ts/u,
  },
  {
    label: 'simulation source',
    pattern: /scripts[\\/](?:seed|simulate)\.ts/u,
  },
  {
    label: 'local-stack controller source',
    pattern:
      /scripts[\\/]local-stack[\\/](?:stack|fault-operation|google-import-release-drill)\.ts/u,
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
      for (const pattern of FORBIDDEN_NAMES) {
        if (pattern.test(name))
          violations.push(`${name}: forbidden executable/source name`)
      }
      if (!TEXT_EXTENSIONS.has(extname(path))) continue
      const contents = bytes.toString('utf8')
      for (const rule of FORBIDDEN_CONTENT) {
        if (rule.pattern.test(contents)) violations.push(`${name}: ${rule.label}`)
      }
      if (extname(path) === '.map') {
        let sourceMap
        try {
          sourceMap = JSON.parse(contents)
        } catch {
          violations.push(`${name}: invalid source map JSON`)
          continue
        }
        if (!Array.isArray(sourceMap.sources)) {
          violations.push(`${name}: source map has no sources array`)
          continue
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
    }
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
