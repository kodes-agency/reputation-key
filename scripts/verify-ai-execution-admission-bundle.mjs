import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { builtinModules } from 'node:module'

const root = resolve('dist-ai-execution-admission')
const expected = ['index.js']

function filesUnder(path) {
  const files = []
  for (const entry of readdirSync(path)) {
    const candidate = join(path, entry)
    if (statSync(candidate).isDirectory()) files.push(...filesUnder(candidate))
    else files.push(relative(root, candidate).replaceAll('\\', '/'))
  }
  return files
}

const actual = filesUnder(root).sort()
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error(`AI admission bundle inventory drift: ${actual.join(',')}`)
}

const source = readFileSync(join(root, 'index.js'), 'utf8')
const forbidden =
  /^(?:openai|undici|cld3-asm|libphonenumber-js|ioredis|redis|@sentry\/|googleapis|next|react|@tanstack\/|bullmq)(?:$|\/)/u
const allowedOptionalPg = new Set(['pg-native', 'pg-cloudflare'])
const nodeBuiltins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))
for (const pattern of [
  /^import(?:\s+[^'"\n]+?\s+from)?\s*["']([^"']+)["'];?\s*$/gmu,
  /^export\s+[^'"\n]+?\s+from\s*["']([^"']+)["'];?\s*$/gmu,
  /\b__require\(\s*["']([^"']+)["']\s*\)/gu,
]) {
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1]
    if (!specifier) continue
    if (forbidden.test(specifier)) {
      throw new Error(`AI admission bundle reaches forbidden dependency ${specifier}`)
    }
    if (
      !nodeBuiltins.has(specifier) &&
      !specifier.startsWith('./') &&
      !specifier.startsWith('../') &&
      !allowedOptionalPg.has(specifier)
    ) {
      throw new Error(`AI admission bundle retains external import ${specifier}`)
    }
  }
}
