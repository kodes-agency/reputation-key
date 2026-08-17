import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { builtinModules } from 'node:module'

const gatewayRoot = resolve('dist-ai-egress-gateway')
const probeRoot = resolve('dist-ai-egress-probe')
const bundles = [
  {
    label: 'gateway',
    root: gatewayRoot,
    expected: ['canary.js', 'index.js'],
  },
  {
    label: 'runtime egress probe',
    root: probeRoot,
    expected: ['runtime-egress-probe.js'],
  },
]

function filesUnder(root, path) {
  const files = []
  for (const entry of readdirSync(path)) {
    const candidate = join(path, entry)
    if (statSync(candidate).isDirectory()) files.push(...filesUnder(root, candidate))
    else files.push(relative(root, candidate).replaceAll('\\', '/'))
  }
  return files
}

for (const bundle of bundles) {
  const actual = filesUnder(bundle.root, bundle.root).sort()
  if (JSON.stringify(actual) !== JSON.stringify(bundle.expected)) {
    throw new Error(`AI ${bundle.label} bundle inventory drift: ${actual.join(',')}`)
  }
}

const forbiddenExternal =
  /^(?:pg|pg-pool|ioredis|redis|@sentry\/|googleapis|next|react|@tanstack\/|bullmq)(?:$|\/)/u
const nodeBuiltins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))
const allowedOptionalRuntime = new Set(['sqlite'])
const specifierPatterns = [
  /^import(?:\s+[^'"\n]+?\s+from)?\s*["']([^"']+)["'];?\s*$/gmu,
  /^export\s+[^'"\n]+?\s+from\s*["']([^"']+)["'];?\s*$/gmu,
  /\b__require\(\s*["']([^"']+)["']\s*\)/gu,
]
for (const bundle of bundles) {
  for (const file of bundle.expected) {
    const source = readFileSync(join(bundle.root, file), 'utf8')
    for (const pattern of specifierPatterns) {
      for (const match of source.matchAll(pattern)) {
        const specifier = match[1]
        if (
          specifier &&
          !nodeBuiltins.has(specifier) &&
          !specifier.startsWith('./') &&
          !specifier.startsWith('../') &&
          !allowedOptionalRuntime.has(specifier)
        ) {
          throw new Error(
            `AI ${bundle.label} bundle retains external import ${specifier} in ${file}`,
          )
        }
        if (specifier && forbiddenExternal.test(specifier)) {
          throw new Error(
            `AI ${bundle.label} bundle reaches forbidden dependency ${specifier}`,
          )
        }
      }
    }
  }
}

const probe = spawnSync(process.execPath, [join(probeRoot, 'runtime-egress-probe.js')], {
  encoding: 'utf8',
  timeout: 20_000,
  env: {
    PATH: process.env.PATH ?? '',
    AI_EGRESS_PROBE_RELEASE_SHA: '0'.repeat(40),
    AI_EGRESS_PROBE_IMAGE_DIGEST: `sha256:${'0'.repeat(64)}`,
    AI_EGRESS_PROBE_REGION: 'bundle-proof',
  },
})
if (probe.error || probe.signal || probe.status === null) {
  throw new Error(
    'AI runtime egress probe built artifact did not terminate within its wall bound',
  )
}
const evidenceLines = probe.stdout.split('\n').filter((line) => line.length > 0)
if (evidenceLines.length !== 1) {
  throw new Error(
    `AI runtime egress probe emitted ${evidenceLines.length} evidence lines`,
  )
}
let evidence
try {
  evidence = JSON.parse(evidenceLines[0])
} catch {
  throw new Error('AI runtime egress probe emitted invalid evidence JSON')
}
if (
  evidence.releaseSha !== '0'.repeat(40) ||
  evidence.imageDigest !== `sha256:${'0'.repeat(64)}` ||
  evidence.region !== 'bundle-proof' ||
  !Array.isArray(evidence.attempts) ||
  evidence.attempts.length !== 3
) {
  throw new Error('AI runtime egress probe built artifact emitted incomplete evidence')
}
const expectedStatus =
  evidence.controlReachable === true && evidence.arbitraryEgressReachable === true ? 0 : 1
if (probe.status !== expectedStatus) {
  throw new Error('AI runtime egress probe failure exit does not match its evidence')
}
