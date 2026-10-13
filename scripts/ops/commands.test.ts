import { existsSync, globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkScopedCapability,
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
  type Capability,
} from '../../src/shared/auth/beta-capabilities'
import { capabilityForPermission } from '../../src/shared/auth/capability-for-permission'
import { GOOGLE_PROVIDER_OPERATOR_COMMANDS } from '../../src/shared/ops/google-provider-commands'
import { COMMANDS } from './commands'

const ROOT = resolve(import.meta.dirname, '../..')

/** Live operator guides. Archived plans and review notes are history. */
const OPERATOR_DOCS = [
  'README.md',
  ...globSync(['docs/operations/**/*.md', 'docs/agents/**/*.md'], { cwd: ROOT }),
]

/**
 * Both spellings the guides use for a command: the shell invocation
 * `pnpm ops <name>` and the command's own name, `ops:<name>`.
 */
const INVOCATION = /(?:pnpm ops |(?<![A-Za-z])ops:)([a-z][a-z0-9-]*)/g

describe('pnpm ops command table', () => {
  // README documented `pnpm ops deploy-ci-images` as THE deploy step while
  // the dispatcher had no such entry, so the release command exited 1. The
  // retention registry and the backup guide then named two commands in the
  // `ops:<name>` spelling, which nothing checked, and neither exists.
  it('resolves every documented `pnpm ops <name>` and `ops:<name>` command', () => {
    const unresolved = OPERATOR_DOCS.flatMap((path) =>
      [...readFileSync(resolve(ROOT, path), 'utf8').matchAll(INVOCATION)]
        .filter((match) => !Object.hasOwn(COMMANDS, match[1] ?? ''))
        .map((match) => `${path}: ${match[0]}`),
    )
    expect(unresolved).toEqual([])
  })

  it('points every command at a script that exists', () => {
    const missing = Object.entries(COMMANDS)
      .filter(([, [file]]) => !existsSync(resolve(ROOT, file)))
      .map(([name, [file]]) => `${name}: ${file}`)
    expect(missing).toEqual([])
  })
})

// Three commands need a call to Google, which operator commands cannot make,
// so `--apply` on them is refused. The incident runbooks used to tell the
// operator to apply them anyway.
describe('operator commands that only report', () => {
  const REPORT_ONLY = Object.keys(GOOGLE_PROVIDER_OPERATOR_COMMANDS)
  const INVOKED_NAMES = REPORT_ONLY.map((name) => name.slice('ops:'.length))
  const SCRIPTS = INVOKED_NAMES.map((name) => COMMANDS[name]?.[0] ?? `missing:${name}`)

  /** A file with shell continuations folded, so one invocation is one line. */
  const folded = (path: string): string =>
    readFileSync(resolve(ROOT, path), 'utf8').replace(/\\\n\s*/g, ' ')

  it('are never shown with --apply in a guide, the Pub/Sub setup script or their own help', () => {
    // The flag inside the same code span or shell line as the command. Prose
    // such as "`pnpm ops gbp-subscribe` refuses `--apply`" is not an invocation.
    const applied = new RegExp(
      `(?:pnpm ops |ops:)(?:${INVOKED_NAMES.join('|')})\\b[^\`'\\n]*--apply`,
      'g',
    )
    const offenders = [
      ...OPERATOR_DOCS,
      'scripts/ops/gcp-pubsub-setup.sh',
      ...SCRIPTS,
    ].flatMap((path) =>
      [...folded(path).matchAll(applied)].map((match) => `${path}: ${match[0]}`),
    )
    expect(offenders).toEqual([])
  })

  it('never end a report by telling the operator to re-run with --apply', () => {
    const offenders = SCRIPTS.filter((path) =>
      /re-run with[^\n]*--apply/.test(folded(path)),
    )
    expect(offenders).toEqual([])
  })

  it('are named in the incident runbooks only where the passage says --apply is refused', () => {
    const named = new RegExp(`(?:pnpm ops |ops:)(?:${INVOKED_NAMES.join('|')})\\b`)
    // A passage is a block of lines with no blank line in it.
    const passages = readFileSync(
      resolve(ROOT, 'docs/operations/runbooks.md'),
      'utf8',
    ).split(/\n\s*\n/)
    const silent = passages
      .filter((passage) => named.test(passage) && !/refuses\s+`--apply`/.test(passage))
      .map((passage) => passage.slice(0, passage.indexOf('\n')))
    expect(silent).toEqual([])
  })

  it('are marked report only in the command list', () => {
    const entries = readFileSync(
      resolve(ROOT, 'docs/operations/operator-commands.md'),
      'utf8',
    ).split('\n')
    const unmarked = REPORT_ONLY.filter(
      (name) =>
        !entries
          .find((line) => line.startsWith(`- \`${name} `))
          ?.includes('Report only: `--apply` is refused'),
    )
    expect(unmarked).toEqual([])
  })
})

// What the report-only commands point to is gated like any other work, so the
// stops the same runbooks use can refuse it. The runbooks sent the operator to
// an in-app disconnect after suspending the Organization, and to two Google
// reads after the targeted Google stop: each ends in a refusal.
describe('what the report-only commands point to, under the runbook stops', () => {
  const ORGANIZATION = 'org-under-incident'
  const RUNBOOKS = readFileSync(resolve(ROOT, 'docs/operations/runbooks.md'), 'utf8')
  const COMMAND_LIST = readFileSync(
    resolve(ROOT, 'docs/operations/operator-commands.md'),
    'utf8',
  )

  /** The targeted Google stop runbook §11 gives as its example. */
  const TARGETED_GOOGLE_STOP =
    /Targeted stop → set a comma list, e\.g\. `BETA_CAPABILITIES_OFF=([a-z_.,]+)`/.exec(
      RUNBOOKS,
    )?.[1] ?? 'runbook §11 no longer gives a targeted stop'

  const STOPS = {
    none: {},
    organizationSuspended: { BETA_SUSPENDED_ORGS: ORGANIZATION },
    targetedGoogleStop: { BETA_CAPABILITIES_OFF: TARGETED_GOOGLE_STOP },
    fullStop: { BETA_CAPABILITIES_OFF: 'all' },
  } as const

  /** The in-app disconnect is an `integration.manage` action. */
  const IN_APP_DISCONNECT = capabilityForPermission('integration.manage')
  /** Check Google again is a reply command before it reads. */
  const CHECK_GOOGLE_AGAIN = capabilityForPermission('reply.manage')
  /** Both reconciliation reads are review-sync provider calls
   * (google-review-sync-authorizer.ts returns this capability). */
  const GOOGLE_READ: Capability = 'property.connect_gbp'

  const decisionsFor = (capability: Capability) =>
    Object.fromEntries(
      Object.entries(STOPS).map(([stop, env]) => {
        initCapabilityPolicyStore(
          createEnvCapabilityPolicyStore({ BETA_ALLOWLIST_ORGS: '*', ...env }),
        )
        return [
          stop,
          checkScopedCapability({ organizationId: ORGANIZATION }, capability).reason,
        ]
      }),
    )

  /** Blocks of lines with no blank line in them, from both operator guides. */
  const passagesNaming = (needle: string): string[] =>
    [...RUNBOOKS.split(/\n\s*\n/), ...COMMAND_LIST.split('\n')].filter((passage) =>
      passage.includes(needle),
    )

  const opening = (passage: string): string => passage.slice(0, 60)

  /** Runbook section `number`, from its heading to the next one. */
  const section = (number: number): string =>
    new RegExp(`^## ${number}\\. [^]*?(?=^## )`, 'm').exec(RUNBOOKS)?.[0] ??
    `runbook §${number} is missing`

  afterEach(() => {
    resetCapabilityPolicyStore()
  })

  it('the in-app disconnect survives the targeted Google stop and is refused by a suspension or the full stop', () => {
    expect(decisionsFor(IN_APP_DISCONNECT)).toEqual({
      none: 'allowed',
      organizationSuspended: 'org_suspended',
      targetedGoogleStop: 'allowed',
      fullStop: 'capability_disabled',
    })
  })

  it('the reconciliation reads and Check Google again are refused by every one of those stops', () => {
    const refusedByAll = {
      none: 'allowed',
      organizationSuspended: 'org_suspended',
      targetedGoogleStop: 'capability_disabled',
      fullStop: 'capability_disabled',
    }
    expect(decisionsFor(GOOGLE_READ)).toEqual(refusedByAll)
    expect(decisionsFor(CHECK_GOOGLE_AGAIN)).toEqual(refusedByAll)
  })

  it('every passage that sends the operator to the in-app disconnect says what refuses it and gives the order', () => {
    const saysWhatRefusesIt = (passage: string): boolean =>
      passage.includes(
        'refuses that disconnect while the Organization is in `BETA_SUSPENDED_ORGS`',
      ) &&
      passage.includes(`names \`${IN_APP_DISCONNECT}\``) &&
      passage.includes('disconnect before you suspend the Organization')
    const passages = passagesNaming('Settings, Integrations')

    // At least runbook §2 and §10, and the command list.
    expect(passages.length).toBeGreaterThanOrEqual(3)
    expect(
      passages.filter((passage) => !saysWhatRefusesIt(passage)).map(opening),
    ).toEqual([])
  })

  it('runbook §2 says what to do when the Organization is already suspended', () => {
    expect(section(2)).toContain('If it is already suspended, or the full stop is on')
    expect(section(2)).toContain(
      'the stored credentials stay until the disconnect can run',
    )
  })

  it('every passage that sends the operator to the reconciliation reads says which capabilities they need', () => {
    const saysWhatTheyNeed = (passage: string): boolean =>
      passage.includes(`\`${GOOGLE_READ}\``) &&
      passage.includes(`\`${CHECK_GOOGLE_AGAIN}\``) &&
      passage.includes('`BETA_SUSPENDED_ORGS`')
    const passages = passagesNaming('Check Google again')

    // At least runbook §6 and the command list.
    expect(passages.length).toBeGreaterThanOrEqual(2)
    expect(passages.filter((passage) => !saysWhatTheyNeed(passage)).map(opening)).toEqual(
      [],
    )
  })

  it('runbook §6 says what happens to a due reply while its read is refused, and what the operator does', () => {
    expect(section(6)).toContain('each due check passes without a read')
    expect(section(6)).toContain('stop `property.publish_reply` alone')
    expect(section(6)).toContain('until the capabilities are back for that Organization')
  })
})
