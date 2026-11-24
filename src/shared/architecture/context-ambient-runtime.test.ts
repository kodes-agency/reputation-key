// Context code takes its logger, clock, identifiers and configuration from the
// composition root, never from ambient runtime state. Lint bans only the wall
// clock in domain code and process.env in contexts and routes (see
// ambient-reads-eslint-rule.test.ts); `getLogger()`, `getEnv()`, `getDb()` and
// random identifiers are importable from infrastructure, so this scan holds the
// contexts and modules that were moved onto injected dependencies.

import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walk } from '#/shared/testing/source-tree'

const ROOT = process.cwd()

const LOGGER = /\bgetLogger\s*\(/u
const RUNTIME_ROOTS = /\bget(?:Db|Env|Pool|Redis)\s*\(/u
const PROCESS_ENV = /\bprocess\.env\b/u
const WALL_CLOCK = /\bnew Date\s*\(\s*\)/u

const GUEST_BANS = [
  LOGGER,
  RUNTIME_ROOTS,
  PROCESS_ENV,
  WALL_CLOCK,
  /\bDate\.now\b/u,
  /\b(?:randomUUID|randomBytes)\b/u,
  /\bMath\.random\b/u,
] as const

const IDENTITY_BANS = [
  LOGGER,
  RUNTIME_ROOTS,
  PROCESS_ENV,
  WALL_CLOCK,
  /\bDate\.now\s*\(/u,
  /\brandomUUID\s*\(/u,
  /\bMath\.random\s*\(/u,
] as const

/** Single modules that must stay on their injected dependencies. */
const MODULE_BANS: ReadonlyArray<readonly [string, readonly RegExp[]]> = [
  ['src/contexts/feed/notify/notification-outbox-consumers.server.ts', [LOGGER]],
  ['src/contexts/feed/build.ts', [/(?:crypto\.)?randomUUID/u]],
  ['src/contexts/feed/build-activity.ts', [/(?:crypto\.)?randomUUID/u]],
  ['src/contexts/feed/email/digest-notification-job.server.ts', [/\brandomUUID\b/u]],
  [
    'src/contexts/feed/server/one-click-unsubscribe.ts',
    [/\bget(?:Container|Env|Logger)\s*\(/u],
  ],
  [
    'src/contexts/feed/email/resend-email.adapter.server.ts',
    [/\bget(?:Env|Logger)\s*\(/u, /\bnew Date\s*\(/u],
  ],
  ['src/composition/google-provider-authority.ts', [PROCESS_ENV, /\bgetEnv\s*\(/u]],
  // Identity's session is an Identity-owned port the root selects; the root
  // never reaches better-auth itself.
  ['src/composition.ts', [/\bgetAuth\s*\(/u]],
  ['src/composition/identity-wiring.ts', [/\bgetAuth\s*\(/u]],
  ['src/composition/container-capabilities.ts', [/\bgetAuth\s*\(/u]],
]

const productionFiles = (directory: string, skipFolders: readonly string[] = []) =>
  walk(join(ROOT, directory))
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .filter((file) => !skipFolders.some((folder) => file.includes(`/${folder}/`)))

const offences = (files: readonly string[], bans: readonly RegExp[]) =>
  files.flatMap((file) => {
    const source = readFileSync(file, 'utf8')
    return bans
      .filter((pattern) => pattern.test(source))
      .map((pattern) => `${relative(ROOT, file)}: ${pattern.source}`)
  })

describe('context runtime dependency injection', () => {
  it('recognises each ambient read it bans', () => {
    const planted = [
      'getLogger()',
      'getDb()',
      'process.env.X',
      'new Date()',
      'Date.now()',
      'randomUUID()',
      'Math.random()',
    ]
    expect(
      planted.map((code) => GUEST_BANS.some((pattern) => pattern.test(code))),
    ).toEqual(planted.map(() => true))
    expect(
      planted.map((code) => IDENTITY_BANS.some((pattern) => pattern.test(code))),
    ).toEqual(planted.map(() => true))
    expect(GUEST_BANS.some((pattern) => pattern.test('clock()'))).toBe(false)
  })

  // Browser screens run in the page and read its clock; these rules hold server code.
  it('keeps Guest production code independent from ambient runtime state', () => {
    expect(offences(productionFiles('src/contexts/guest', ['ui']), GUEST_BANS)).toEqual(
      [],
    )
  })

  // Browser screens run in the page, not in the server runtime.
  it('keeps Identity server code independent from ambient runtime state', () => {
    expect(
      offences(productionFiles('src/contexts/identity', ['ui']), IDENTITY_BANS),
    ).toEqual([])
  })

  it('keeps injected modules off ambient loggers, clocks, identifiers and configuration', () => {
    expect(
      MODULE_BANS.flatMap(([file, bans]) => offences([join(ROOT, file)], bans)),
    ).toEqual([])
  })
})
