import { spawnSync } from 'node:child_process'
import { builtinModules } from 'node:module'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const profiles = Object.freeze({
  admission: Object.freeze({
    defaultRoot: 'dist-google-execution-admission',
    label: 'execution admission',
    forbiddenContent:
      /provision-google-admission-role|google-provider-simulator|local_sandbox/u,
  }),
  gateway: Object.freeze({
    defaultRoot: 'dist-google-egress-gateway',
    label: 'egress gateway',
    forbiddenContent:
      /control-proxy|tcp-relay|PROVIDER_CONTROL_TARGET|GOOGLE_PROVIDER_SIMULATOR_ORIGIN|local_sandbox/u,
  }),
})

function filesUnder(root, path = root) {
  const files = []
  for (const entry of readdirSync(path)) {
    const candidate = join(path, entry)
    if (statSync(candidate).isDirectory()) files.push(...filesUnder(root, candidate))
    else files.push(relative(root, candidate).replaceAll('\\', '/'))
  }
  return files
}

function importedSpecifiers(source) {
  const found = []
  for (const pattern of [
    /^import(?:\s+[^'"\n]+?\s+from)?\s*["']([^"']+)["'];?\s*$/gmu,
    /^export\s+[^'"\n]+?\s+from\s*["']([^"']+)["'];?\s*$/gmu,
    /\b__require\(\s*["']([^"']+)["']\s*\)/gu,
  ]) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) found.push(match[1])
    }
  }
  return found
}

function main() {
  const profileName = process.argv[2]
  const profile = profiles[profileName]
  if (!profile) {
    throw new Error(
      'Usage: node scripts/verify-google-runtime-bundle.mjs <admission|gateway> [artifact-root]',
    )
  }
  const root = resolve(process.argv[3] ?? profile.defaultRoot)
  const files = filesUnder(root).sort()
  if (JSON.stringify(files) !== JSON.stringify(['index.js'])) {
    throw new Error(`Google ${profile.label} bundle inventory drift: ${files.join(',')}`)
  }

  // Parse it before inspecting it. The bundle is the artifact that will be
  // COPYed into the runtime image and started with no further checks, so a
  // bundle that cannot be parsed must fail the build, not the container. It
  // did once: an unaliased tsup banner collided with a bundled module's own
  // `import { createRequire } from 'module'` and the admission sidecar exited 1
  // on `SyntaxError: Identifier 'createRequire' has already been declared`.
  // The AI verifier has always done this; this one had not.
  const entry = join(root, 'index.js')
  const syntax = spawnSync(process.execPath, ['--check', entry], { encoding: 'utf8' })
  if (syntax.status !== 0) {
    throw new Error(
      `Google ${profile.label} bundle does not parse: ${(syntax.stderr || '').trim().split('\n')[0] ?? 'unknown'}`,
    )
  }

  const source = readFileSync(entry, 'utf8')
  if (profile.forbiddenContent.test(source)) {
    throw new Error(`Google ${profile.label} bundle contains a local/operator surface`)
  }

  const nodeBuiltins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))
  const allowedOptionalRuntime = new Set(['pg-native', 'pg-cloudflare'])
  for (const specifier of importedSpecifiers(source)) {
    if (
      !nodeBuiltins.has(specifier) &&
      !specifier.startsWith('./') &&
      !specifier.startsWith('../') &&
      !allowedOptionalRuntime.has(specifier)
    ) {
      throw new Error(
        `Google ${profile.label} bundle retains external import ${specifier}`,
      )
    }
  }
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
