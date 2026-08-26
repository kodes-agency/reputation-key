import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { build } from 'tsup'

const ROOT = resolve(import.meta.dirname, '../..')
const createdDirectories: string[] = []

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('pino development transport in built ESM', () => {
  it('resolves the repository-installed pretty transport from an ESM bundle', async () => {
    // Keep the build below the repository so createRequire(import.meta.url)
    // resolves the same repository-owned node_modules tree as the real build.
    const directory = mkdtempSync(join(ROOT, '.pino-esm-proof-'))
    createdDirectories.push(directory)
    const entry = join(directory, 'probe.ts')
    const outDir = join(directory, 'dist')
    writeFileSync(
      entry,
      [
        "import { getLogger, isPrettyTransportAvailable } from '../src/shared/observability/logger'",
        "if (!isPrettyTransportAvailable()) throw new Error('pretty transport unavailable')",
        "getLogger().info({ outcomeCode: 'built_esm_probe' }, 'pino-built-esm-ready')",
        'getLogger().flush()',
      ].join('\n'),
    )

    await build({
      entry: [entry],
      format: ['esm'],
      platform: 'node',
      target: 'node22',
      outDir,
      clean: true,
      dts: false,
      splitting: false,
      silent: true,
      external: ['pino', 'pino-pretty'],
      noExternal: [/^#\//u],
    })

    const output = resolve(outDir, 'probe.js')
    expect(readFileSync(output, 'utf8')).toContain('createRequire(import.meta.url)')

    const result = spawnSync(process.execPath, [output], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'development' },
    })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('pino-built-esm-ready')
    expect(result.stdout).toContain('built_esm_probe')
  })
})
