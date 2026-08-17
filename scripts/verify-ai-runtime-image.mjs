import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'

const kind = process.argv[2]
const expectedByKind = {
  gateway: {
    directory: '/app/dist-ai-egress-gateway',
    files: ['canary.js', 'index.js', 'runtime-egress-probe.js'],
    forbiddenBundleTerms: [
      'node_modules/pg/',
      'node_modules/ioredis/',
      'node_modules/googleapis/',
      'node_modules/@sentry/',
    ],
  },
  admission: {
    directory: '/app/dist-ai-execution-admission',
    files: ['index.js'],
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

function filesUnder(root) {
  const files = []
  for (const entry of readdirSync(root)) {
    const candidate = join(root, entry)
    if (statSync(candidate).isDirectory()) files.push(...filesUnder(candidate))
    else files.push(relative(expected.directory, candidate).replaceAll('\\', '/'))
  }
  return files
}

const appEntries = readdirSync('/app').sort()
if (
  JSON.stringify(appEntries) !==
  JSON.stringify([expected.directory.slice('/app/'.length)])
) {
  throw new Error(`AI runtime root inventory drift: ${appEntries.join(',')}`)
}
const actual = filesUnder(expected.directory).sort()
if (JSON.stringify(actual) !== JSON.stringify(expected.files)) {
  throw new Error(`AI runtime bundle inventory drift: ${actual.join(',')}`)
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
for (const file of expected.files) {
  const absolute = join(expected.directory, file)
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
