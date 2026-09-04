#!/usr/bin/env node
// Built-artifact gate for the pinned reply-language runtime (cld3-asm).
//
// Reply drafting cannot mint a suggestion until the local verifier establishes
// one concrete source language, so `loadModule()` from `cld3-asm` is on the
// critical path of every suggestion. That package ships emscripten glue whose
// loader expects to be invoked as a CommonJS factory. Bundling it into the
// Nitro server output rewrites that glue and the first call fails with:
//
//   TypeError: runtimeModule is not a function
//       at .output/server/_libs/cld3-asm+[...].mjs
//       at loadModule (...)
//       at createCld3ReplyLanguageDetector (...)
//
// which surfaced in production as a 500 on ai.generateReplySuggestion and
// "A suggestion is unavailable right now." in the inbox. `cld3-asm` is
// therefore declared external in vite.config.ts and resolved from node_modules
// at runtime — which is also the attested path:
// ai-reply-language-verifier-v1.manifest.json pins the loader file by sha256.
//
// Why a gate against the artifact rather than a unit test: the source imports
// fine. Only the BUILT output can be wrong, and the unit suite injects a fake
// detector (`{ detect: () => ... }`), so nothing else ever calls loadModule.
// Same reasoning as scripts/check-security-headers.mjs: static checks cannot
// prove a runtime module loads, so this loads it from inside the artifact.
//
// Asserts, against .output/server:
//   1. no bundled copy of the package exists (it stayed external),
//   2. the output imports it by bare specifier (it is actually reached),
//   3. it resolves, initializes its WASM and detects a language when imported
//      from a module inside the artifact directory — the exact resolution the
//      server performs,
//   4. the resolved loader file matches the sha256 the manifest attests.
//
// Runs after `pnpm build` (CI: ci.yml check job; local:
// `pnpm check:language-verifier`). Exits 1 listing every failure.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SERVER_DIR = join(ROOT, '.output/server')
const PACKAGE = 'cld3-asm'
const MANIFEST = join(ROOT, 'src/shared/ai-reply-language-verifier-v1.manifest.json')

// Long enough to clear the verifier's 24-letter minimum, and unambiguous.
const PROBE_TEXT =
  'This hotel was wonderful, the staff were extremely helpful and kind throughout our stay.'
const PROBE_LANGUAGE = 'en'

const failures = []
const fail = (message) => failures.push(message)

if (!existsSync(SERVER_DIR)) {
  console.error(`missing ${SERVER_DIR} — run \`pnpm build\` first`)
  process.exit(1)
}

// 1 + 2: the package stayed external and the output still reaches it.
const bundledCopies = existsSync(join(SERVER_DIR, '_libs'))
  ? readdirSync(join(SERVER_DIR, '_libs')).filter((entry) => entry.includes(PACKAGE))
  : []
if (bundledCopies.length > 0) {
  fail(
    `${PACKAGE} was bundled into .output/server/_libs (${bundledCopies.join(', ')}). ` +
      `Its emscripten loader breaks when bundled; keep it in the nitro ` +
      `bundler external list in vite.config.ts.`,
  )
}

// grep exits 1 on no-match, which is precisely the bundled case, so an empty
// result is a finding here and never a crash.
const grepMatches = () => {
  try {
    return execFileSync(
      'grep',
      ['-rlE', `(from|require\\()\\s*['"]${PACKAGE}['"]`, SERVER_DIR],
      { encoding: 'utf8' },
    )
  } catch (error) {
    if (error?.status === 1) return ''
    throw error
  }
}
const bareImports = grepMatches().split('\n').filter(Boolean)
if (bareImports.length === 0) {
  fail(
    `no module in .output/server imports "${PACKAGE}" by bare specifier — the ` +
      `reply-language verifier is no longer reachable in the built server.`,
  )
}

// 3: resolve, initialize and detect from inside the artifact, exactly as the
// server does. A bare import here walks .output/server -> .output -> node_modules.
const probePath = join(SERVER_DIR, '__language-runtime-probe.mjs')
try {
  writeFileSync(
    probePath,
    `import { loadModule } from '${PACKAGE}'\n` +
      `const factory = await loadModule()\n` +
      `const identifier = factory.create(0, 1000)\n` +
      `const result = identifier.findLanguage(${JSON.stringify(PROBE_TEXT)})\n` +
      `identifier.dispose()\n` +
      `process.stdout.write(JSON.stringify({ named: typeof loadModule, result }))\n`,
  )
  const raw = execFileSync(process.execPath, [probePath], {
    encoding: 'utf8',
    timeout: 60_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const { named, result } = JSON.parse(raw)
  if (named !== 'function') fail(`loadModule resolved as ${named}, not a function`)
  if (result?.language !== PROBE_LANGUAGE || result?.is_reliable !== true) {
    fail(
      `language runtime returned ${JSON.stringify(result)} for the English probe; ` +
        `expected a reliable "${PROBE_LANGUAGE}".`,
    )
  }
} catch (error) {
  const detail = [error?.message, error?.stderr?.toString()].filter(Boolean).join(' | ')
  fail(`loading ${PACKAGE} from inside .output/server failed: ${detail.slice(0, 600)}`)
} finally {
  rmSync(probePath, { force: true })
}

// 4: the loader that resolves is the one the manifest attests.
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const attested = manifest.embeddedWasmRuntime
try {
  const resolved = createRequire(join(ROOT, 'package.json')).resolve(
    attested.path.replace(/^node_modules\//, ''),
  )
  const digest = createHash('sha256').update(readFileSync(resolved)).digest('hex')
  if (digest !== attested.sha256) {
    fail(
      `resolved ${attested.path} hashes ${digest}, but the verifier manifest ` +
        `attests ${attested.sha256}. Regenerate the profile deliberately ` +
        `(scripts/generate-ai-reply-language-profile.ts) if the bump is intended.`,
    )
  }
} catch (error) {
  fail(`could not resolve the attested loader ${attested.path}: ${error?.message}`)
}

if (failures.length > 0) {
  console.error(`reply-language runtime gate failed (${failures.length}):`)
  for (const message of failures) console.error(`  - ${message}`)
  process.exit(1)
}

console.log(
  `reply-language runtime OK — ${PACKAGE} external, reached by ` +
    `${bareImports.length} built module(s), loads and detects from the artifact, ` +
    `loader matches the attested sha256.`,
)
