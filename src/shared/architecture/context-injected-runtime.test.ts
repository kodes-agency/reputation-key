// Inbox, Integration, Portal, Reporting and Review take their logger, clock,
// identifiers and configuration from the composition root. Lint bans only the
// wall clock in domain code and process.env in contexts (see
// ambient-reads-eslint-rule.test.ts), so stores, adapters, jobs and builds are
// held here. The injected parameters themselves are required by their types;
// this scan stops a module from reaching around them, including through a
// `clock ?? new Date()` style fallback.

import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walk } from '#/shared/testing/source-tree'

const ROOT = process.cwd()

const LOGGER = /\bgetLogger\s*\(/u
const WALL_CLOCK = /\bnew Date\s*\(\s*\)/u
const EPOCH_NOW = /\bDate\.now\s*\(/u
const RANDOM_ID = /\b(?:crypto\.)?randomUUID\s*\(/u
const MATH_RANDOM = /\bMath\.random\s*\(/u
const CRYPTO_IMPORT =
  /import\s*\{[^}]*\b(?:randomUUID|randomBytes)\b[^}]*\}\s*from\s*['"]node:crypto['"]/su

const PORTAL_BANS = [LOGGER, WALL_CLOCK, EPOCH_NOW, RANDOM_ID, CRYPTO_IMPORT] as const
const REPORTING_BANS = [
  LOGGER,
  /\bget(?:Db|Env|Pool|Redis)\s*\(/u,
  /\bprocess\.env\b/u,
  WALL_CLOCK,
  EPOCH_NOW,
  RANDOM_ID,
  MATH_RANDOM,
] as const
const REVIEW_BANS = [WALL_CLOCK, EPOCH_NOW, RANDOM_ID, MATH_RANDOM] as const

/** Single modules that must stay on their injected dependencies. */
const MODULE_BANS: ReadonlyArray<readonly [string, readonly RegExp[]]> = [
  ['src/contexts/reputation/inbox/outbox-consumers.server.ts', [LOGGER]],
  ['src/contexts/reputation/inbox/inbox-repository.server.ts', [LOGGER]],
  ['src/contexts/reputation/server/inbox-queries.ts', [LOGGER]],
  ...[
    'src/contexts/reputation/inbox/command-store.server.ts',
    'src/contexts/reputation/inbox/command-runtime.server.ts',
    'src/contexts/reputation/inbox/assignment-commands.server.ts',
    'src/contexts/reputation/inbox/status-commands.server.ts',
    'src/contexts/reputation/inbox/note-commands.server.ts',
    'src/contexts/reputation/inbox/source-commands.server.ts',
    'src/contexts/reputation/inbox/inbox-command-guards.server.ts',
    'src/contexts/reputation/inbox/inbox-escalation-history.server.ts',
    'src/contexts/reputation/inbox/inbox-view-repository.server.ts',
    'src/contexts/reputation/inbox/inbox-repository.server.ts',
    'src/contexts/integration/imports/import-store.server.ts',
    'src/contexts/integration/imports/import-claims.server.ts',
    'src/contexts/integration/imports/import-completion.server.ts',
    'src/contexts/integration/imports/import-dispatch-store.server.ts',
    'src/contexts/integration/imports/import-lifecycle-store.server.ts',
    'src/contexts/integration/imports/import-progress-store.server.ts',
    'src/contexts/integration/imports/import-retention.server.ts',
    'src/contexts/integration/imports/import-retry.server.ts',
    'src/contexts/integration/connections/integration-command-store.server.ts',
    'src/contexts/integration/connections/google-connection-repository.server.ts',
  ].map((file) => [file, [WALL_CLOCK, EPOCH_NOW]] as const),
  [
    'src/contexts/integration/build.ts',
    [
      /\b(?:randomUUID|randomBytes)\b/u,
      /\bgetEnv\s*\(/u,
      /from '#\/shared\/config\/env'/u,
    ],
  ],
  ['src/contexts/integration/connections/google-oauth.adapter.server.ts', [WALL_CLOCK]],
  [
    'src/contexts/integration/connections/reconcile-gbp-notification-subscriptions-job.server.ts',
    [LOGGER, EPOCH_NOW],
  ],
  ['src/contexts/integration/imports/google-import-claim-reaper-job.server.ts', [LOGGER]],
  // Token entropy comes from composition; a namespace import cannot stand in.
  [
    'src/contexts/portal/addresses/portal-token-codec.server.ts',
    [/\bcrypto\.randomBytes\b/u, /\?\?\s*randomBytes/u],
  ],
]

const productionFiles = (directory: string, skipFolders: readonly string[] = []) =>
  walk(join(ROOT, directory))
    .filter((file) => /\.tsx?$/u.test(file) && !/\.(?:test|spec)\.tsx?$/u.test(file))
    .filter((file) => !skipFolders.some((folder) => file.includes(`/${folder}/`)))

const offences = (files: readonly string[], bans: readonly RegExp[]) =>
  files.flatMap((file) => {
    const source = readFileSync(file, 'utf8')
    return bans
      .filter((pattern) => pattern.test(source))
      .map((pattern) => `${relative(ROOT, file)}: ${pattern.source}`)
  })

describe('injected runtime in Inbox, Integration, Portal, Reporting and Review', () => {
  it('recognises each ambient read it bans', () => {
    const planted = [
      'getLogger()',
      'getEnv()',
      'process.env.X',
      'new Date()',
      'Date.now()',
      'crypto.randomUUID()',
      'Math.random()',
    ]
    expect(
      planted.map((code) => REPORTING_BANS.some((pattern) => pattern.test(code))),
    ).toEqual(planted.map(() => true))
    expect(CRYPTO_IMPORT.test("import { randomBytes } from 'node:crypto'")).toBe(true)
    expect(REVIEW_BANS.some((pattern) => pattern.test('new Date(now)'))).toBe(false)
  })

  // Browser screens run in the page and read its clock; these rules hold server code.
  it('keeps Portal production code on injected logging, time and identifiers', () => {
    const files = productionFiles('src/contexts/portal', ['testing', 'ui']).filter(
      (file) => file.endsWith('.ts'),
    )
    expect(offences(files, PORTAL_BANS)).toEqual([])
  })

  it('keeps Reporting production code independent from ambient runtime state', () => {
    expect(
      offences(productionFiles('src/contexts/reporting', ['ui']), REPORTING_BANS),
    ).toEqual([])
  })

  it('keeps Review production code on injected time and identifiers', () => {
    // Review's code lives in Reputation's features. Inbox's database fixture
    // seeds rows with fresh ids and was never part of this guard.
    const files = [
      ...productionFiles('src/contexts/review'),
      ...productionFiles('src/contexts/reputation', ['ui']),
    ].filter(
      (file) =>
        file.endsWith('.ts') && !file.endsWith('/inbox/inbox-database.test-fixtures.ts'),
    )
    expect(offences(files, REVIEW_BANS)).toEqual([])
  })

  it('keeps injected Inbox, Integration and Portal modules off ambient runtime state', () => {
    expect(
      MODULE_BANS.flatMap(([file, bans]) => offences([join(ROOT, file)], bans)),
    ).toEqual([])
  })
})
