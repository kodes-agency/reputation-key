import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

type Inventory = Record<string, { name: string; version: string }[]>
type Exception = {
  package: string
  license: string
  scope: 'prod' | 'dev' | 'both'
  owner: string
  reason: string
  expiresAt: string
}

function runGate(prod: Inventory, dev: Inventory = {}, exceptions: Exception[] = []) {
  const directory = mkdtempSync(join(tmpdir(), 'license-gate-'))
  directories.push(directory)
  for (const folder of ['scripts', 'security', 'bin']) {
    mkdirSync(join(directory, folder))
  }
  for (const file of ['check-licenses.mjs', 'license-expression.mjs']) {
    copyFileSync(join(root, 'scripts', file), join(directory, 'scripts', file))
  }
  symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'))
  writeFileSync(join(directory, 'package.json'), '{"private":true,"type":"module"}')
  writeFileSync(join(directory, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
  writeFileSync(
    join(directory, 'security/license-policy.json'),
    JSON.stringify({ allowed: ['MIT', 'ISC'], exceptions }),
  )
  // Fake only pnpm's inventory transport; execute the real gate and policy path.
  writeFileSync(
    join(directory, 'bin/pnpm'),
    `#!/usr/bin/env node
if (process.argv[2] === 'install') process.exit(0)
process.stdout.write(process.env[process.argv.includes('--prod') ? 'LICENSE_PROD_INVENTORY' : 'LICENSE_DEV_INVENTORY'])
`,
    { mode: 0o755 },
  )
  const result = spawnSync(
    process.execPath,
    [join(directory, 'scripts/check-licenses.mjs')],
    {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
        LICENSE_PROD_INVENTORY: JSON.stringify(prod),
        LICENSE_DEV_INVENTORY: JSON.stringify(dev),
      },
    },
  )
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

const dependency = [{ name: 'example-package', version: '1.0.0' }]

describe('license policy command', () => {
  it.each(['prod', 'dev'] as const)(
    'rejects a forbidden conjunction in the %s tree',
    (scope) => {
      const inventory = { '(MIT OR ISC) AND GPL-3.0-only': dependency }
      const result = runGate(
        scope === 'prod' ? inventory : {},
        scope === 'dev' ? inventory : {},
      )
      expect(result.status).toBe(1)
      expect(result.output).toContain(`[${scope}] example-package@1.0.0`)
    },
  )

  it('accepts a permitted choice of complete license terms', () => {
    const result = runGate({ '(GPL-3.0-only AND MIT) OR (MIT AND ISC)': dependency })
    expect(result.status).toBe(0)
    expect(result.output).toContain('[licenses] OK')
  })

  it('rejects malformed terms even when one token is allowed', () => {
    const result = runGate({ 'MIT OR': dependency })
    expect(result.status).toBe(1)
    expect(result.output).toContain('license "MIT OR" is not in the allow-list')
  })

  it('keeps exact, scoped, dated package exceptions after expression rejection', () => {
    const license = '(MIT OR ISC) AND GPL-3.0-only'
    const exception: Exception = {
      package: 'example-package',
      license,
      scope: 'dev',
      owner: 'platform',
      reason: 'Synthetic policy fixture',
      expiresAt: '2999-01-01',
    }
    const inventory = { [license]: dependency }
    const accepted = runGate({}, inventory, [exception])
    expect(accepted.status).toBe(0)
    expect(accepted.output).toContain('excepted (dev')

    expect(runGate(inventory, {}, [exception]).status).toBe(1)
    expect(runGate({}, { 'GPL-3.0-only': dependency }, [exception]).status).toBe(1)
    expect(
      runGate({}, { [license]: [{ name: 'another-package', version: '1.0.0' }] }, [
        exception,
      ]).status,
    ).toBe(1)
    const expired = runGate({}, inventory, [{ ...exception, expiresAt: '2000-01-01' }])
    expect(expired.status).toBe(1)
    expect(expired.output).toContain('EXPIRED on 2000-01-01')
  })
})
