import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'

const kind = process.argv[2]
// `directories` is an exact allowlist, not a relaxation: the gateway image ships TWO
// governed bundles, because the runtime egress probe is a separately deployed
// artifact (`railway.ai-egress-probe.json` starts it directly) and is attested as
// its own `bundleDirectory` inside AI_GATEWAY_BUILD_ATTESTATION. Asserting a single
// root directory here contradicted the Dockerfile and the attestation.
const expectedByKind = {
  gateway: {
    directories: {
      '/app/dist-ai-egress-gateway': ['canary.js', 'index.js'],
      '/app/dist-ai-egress-probe': ['runtime-egress-probe.js'],
    },
    forbiddenBundleTerms: [
      'node_modules/pg/',
      'node_modules/ioredis/',
      'node_modules/googleapis/',
      'node_modules/@sentry/',
    ],
  },
  admission: {
    directories: { '/app/dist-ai-execution-admission': ['index.js'] },
    forbiddenBundleTerms: [
      'node_modules/openai/',
      'node_modules/undici/',
      'node_modules/cld3-asm/',
      'node_modules/googleapis/',
      'node_modules/ioredis/',
      'node_modules/@sentry/',
    ],
  },
}
const expected = expectedByKind[kind]
if (!expected) throw new Error('AI runtime image kind is invalid')
if (typeof process.getuid === 'function' && process.getuid() === 0) {
  throw new Error('AI runtime image runs as root')
}

function filesUnder(root, base) {
  const files = []
  for (const entry of readdirSync(root)) {
    const candidate = join(root, entry)
    if (statSync(candidate).isDirectory()) files.push(...filesUnder(candidate, base))
    else files.push(relative(base, candidate).replaceAll('\\', '/'))
  }
  return files
}

const expectedDirectories = Object.keys(expected.directories).sort()
const appEntries = readdirSync('/app').sort()
if (
  JSON.stringify(appEntries) !==
  JSON.stringify(expectedDirectories.map((path) => path.slice('/app/'.length)))
) {
  throw new Error(`AI runtime root inventory drift: ${appEntries.join(',')}`)
}
for (const [directory, files] of Object.entries(expected.directories)) {
  const actual = filesUnder(directory, directory).sort()
  if (JSON.stringify(actual) !== JSON.stringify([...files].sort())) {
    throw new Error(`AI runtime bundle inventory drift: ${actual.join(',')}`)
  }
}
for (const forbiddenPath of [
  '/app/node_modules',
  '/app/package.json',
  '/pnpm',
  '/opt/corepack',
  '/usr/local/bin/npm',
  '/usr/local/bin/npx',
  '/usr/local/bin/corepack',
  '/usr/local/bin/pnpm',
  '/usr/local/bin/yarn',
  '/usr/local/lib/node_modules/npm',
]) {
  if (existsSync(forbiddenPath))
    throw new Error(`AI runtime image contains ${forbiddenPath}`)
}
for (const forbiddenName of [
  'PNPM_HOME',
  'COREPACK_HOME',
  'HUSKY',
  'IMAGE_SOURCE_REVISION',
  'OPENAI_BASE_URL',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'REDIS_URL',
  'SENTRY_DSN',
]) {
  if (process.env[forbiddenName] !== undefined) {
    throw new Error(`AI runtime image inherits forbidden environment ${forbiddenName}`)
  }
}
for (const [directory, files] of Object.entries(expected.directories)) {
  for (const file of files) {
    const absolute = join(directory, file)
    const syntax = spawnSync(process.execPath, ['--check', absolute], {
      encoding: 'utf8',
      env: { NODE_ENV: 'production', PATH: process.env.PATH ?? '' },
    })
    if (syntax.status !== 0) throw new Error(`AI runtime bundle syntax failed: ${file}`)
    const source = readFileSync(absolute, 'utf8')
    for (const term of expected.forbiddenBundleTerms) {
      if (source.includes(term)) throw new Error(`AI runtime bundle contains ${term}`)
    }
  }
}
