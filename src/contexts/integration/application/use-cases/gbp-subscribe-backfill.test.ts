// Integration context — ops:gbp-subscribe command core tests.
//
// The command is the only path by which a tenant that connected BEFORE the
// import-path subscribe wiring, or a deployment whose GBP_PUBSUB_TOPIC changed,
// ever gets push. Its two load-bearing properties: it writes nothing without
// --apply, and it is safe to run again after a partial run.

import { describe, it, expect, vi } from 'vitest'
import {
  createGbpSubscribeBackfill,
  createGbpSubscribeOperatorAction,
} from './gbp-subscribe-backfill'
import type { GbpSubscribeOutcome } from './manage-notifications'
import { buildTestGoogleConnection } from '#/shared/testing/fixtures'
import { organizationId } from '#/shared/domain/ids'
import type { GoogleConnectionStatus } from '../../domain/types'
import { runOperatorCommand } from '#/shared/ops/operator-command'
import type { OperatorRuntime } from '#/shared/ops/operator-command'

const ORG = organizationId('org-00000000-0000-0000-0000-000000000001')
const CONN_A = 'e0000000-0000-0000-0000-00000000000a'
const CONN_B = 'e0000000-0000-0000-0000-00000000000b'
const CONN_C = 'e0000000-0000-0000-0000-00000000000c'

const connection = (id: string, status: GoogleConnectionStatus) =>
  buildTestGoogleConnection({ id, organizationId: ORG, status })

const setup = (
  connections: ReadonlyArray<ReturnType<typeof connection>>,
  outcomes: ReadonlyArray<GbpSubscribeOutcome> = [],
) => {
  const subscribe =
    vi.fn<(org: typeof ORG, connectionId: string) => Promise<GbpSubscribeOutcome>>()
  for (const outcome of outcomes) subscribe.mockResolvedValueOnce(outcome)
  subscribe.mockResolvedValue('subscribed')
  const listConnections = vi.fn().mockResolvedValue(connections)
  const backfill = createGbpSubscribeBackfill({ listConnections, subscribe })
  return { backfill, subscribe, listConnections }
}

const captureIO = () => {
  const lines: string[] = []
  return { io: { out: (line: string) => lines.push(line) }, lines }
}

describe('gbp-subscribe backfill', () => {
  it('reports candidates without calling Google on a plan', async () => {
    const { backfill, subscribe } = setup([
      connection(CONN_A, 'active'),
      connection(CONN_B, 'disconnected'),
    ])

    const report = await backfill.plan(ORG)

    expect(subscribe).not.toHaveBeenCalled()
    expect(report).toEqual({
      action: 'would_subscribe',
      organizationId: ORG,
      connections: 2,
      candidates: 1,
      counts: { skipped_inactive: 1 },
      connectionOutcomes: [
        { connectionId: CONN_A, status: 'active', outcome: null },
        { connectionId: CONN_B, status: 'disconnected', outcome: 'skipped_inactive' },
      ],
    })
  })

  it('subscribes every active and degraded connection and skips the rest', async () => {
    const { backfill, subscribe } = setup([
      connection(CONN_A, 'active'),
      connection(CONN_B, 'degraded'),
      connection(CONN_C, 'reauth_required'),
    ])

    const report = await backfill.apply(ORG)

    expect(subscribe.mock.calls).toEqual([
      [ORG, CONN_A],
      [ORG, CONN_B],
    ])
    expect(report.action).toBe('subscribe')
    expect(report.candidates).toBe(2)
    expect(report.counts).toEqual({ subscribed: 2, skipped_inactive: 1 })
  })

  it('reports each connection outcome instead of collapsing a partial run', async () => {
    const { backfill } = setup(
      [connection(CONN_A, 'active'), connection(CONN_B, 'active')],
      ['subscribed', 'provider_failed'],
    )

    const report = await backfill.apply(ORG)

    expect(report.connectionOutcomes).toEqual([
      { connectionId: CONN_A, status: 'active', outcome: 'subscribed' },
      { connectionId: CONN_B, status: 'active', outcome: 'provider_failed' },
    ])
    expect(report.counts).toEqual({ subscribed: 1, provider_failed: 1 })
  })

  // Re-runnability is the whole safety story: subscribe never throws, so a run
  // that half-failed is repaired by running it again.
  it('re-asserts the topic for the same connections on a second run', async () => {
    const { backfill, subscribe } = setup(
      [connection(CONN_A, 'active'), connection(CONN_B, 'active')],
      ['subscribed', 'provider_failed'],
    )

    const first = await backfill.apply(ORG)
    const second = await backfill.apply(ORG)

    expect(first.counts).toEqual({ subscribed: 1, provider_failed: 1 })
    expect(second.counts).toEqual({ subscribed: 2 })
    expect(subscribe).toHaveBeenCalledTimes(4)
  })
})

describe('ops:gbp-subscribe action', () => {
  it('reports without calling Google when invoked as a dry run', async () => {
    const { backfill, subscribe } = setup([connection(CONN_A, 'active')])
    const { io, lines } = captureIO()

    const exit = await createGbpSubscribeOperatorAction(backfill, 'ops:gbp-subscribe')(
      { organizationId: ORG, dryRun: true },
      {},
      io,
    )

    expect(exit).toBe(0)
    expect(subscribe).not.toHaveBeenCalled()
    expect(JSON.parse(lines[0]!)).toMatchObject({
      action: 'would_subscribe',
      candidates: 1,
    })
    expect(lines[1]).toBe('re-run with --reason <text> --apply to ops:gbp-subscribe')
  })

  it('exits 0 when every candidate reaches subscribed', async () => {
    const { backfill, subscribe } = setup([
      connection(CONN_A, 'active'),
      connection(CONN_B, 'disconnected'),
    ])
    const { io, lines } = captureIO()

    const exit = await createGbpSubscribeOperatorAction(backfill, 'ops:gbp-subscribe')(
      { organizationId: ORG, dryRun: false },
      {},
      io,
    )

    expect(exit).toBe(0)
    expect(subscribe).toHaveBeenCalledOnce()
    expect(JSON.parse(lines[0]!)).toMatchObject({ action: 'subscribe' })
    expect(lines).toHaveLength(1)
  })

  // An empty GBP_PUBSUB_TOPIC in the operator's environment is the likeliest
  // reason a backfill achieves nothing — it must not exit 0.
  it('exits 1 when a candidate did not reach subscribed', async () => {
    const { backfill } = setup([connection(CONN_A, 'active')], ['topic_unset'])
    const { io, lines } = captureIO()

    const exit = await createGbpSubscribeOperatorAction(backfill, 'ops:gbp-subscribe')(
      { organizationId: ORG, dryRun: false },
      {},
      io,
    )

    expect(exit).toBe(1)
    expect(lines[1]).toContain("1 connection(s) did not reach 'subscribed'")
  })
})

// Through the REAL harness: "dry-run by default" and "--apply needs --reason"
// are the harness's contract, not the action's, and the operator-facing promise
// in the script header is only true if the spec the script passes earns them.
describe('ops:gbp-subscribe through the operator harness', () => {
  const SPEC = {
    name: 'ops:gbp-subscribe',
    scope: 'org',
    mutation: true,
    usage: 'pnpm ops:gbp-subscribe --operator <id> --org <id>',
  } as const
  const runtime = {
    decide: async () => ({
      allowed: true,
      reason: 'allowed',
      action: 'system:ops',
      policyVersion: 'test',
    }),
  } satisfies OperatorRuntime

  const run = async (argv: ReadonlyArray<string>) => {
    const { backfill, subscribe } = setup([connection(CONN_A, 'active')])
    const out: string[] = []
    const err: string[] = []
    const result = await runOperatorCommand(
      SPEC,
      createGbpSubscribeOperatorAction(backfill, SPEC.name),
      runtime,
      argv,
      { out: (line) => out.push(line), err: (line) => err.push(line) },
    )
    return { result, subscribe, out, err }
  }

  it('calls Google zero times without --apply', async () => {
    const { result, subscribe, out } = await run(['--operator', 'op-1', '--org', ORG])

    expect(result.exitCode).toBe(0)
    expect(subscribe).not.toHaveBeenCalled()
    expect(out.join('\n')).toContain('"action": "would_subscribe"')
  })

  it('refuses --apply without --reason', async () => {
    const { result, subscribe } = await run([
      '--operator',
      'op-1',
      '--org',
      ORG,
      '--apply',
    ])

    expect(result.exitCode).toBe(1)
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('subscribes with --apply --reason', async () => {
    const { result, subscribe, out } = await run([
      '--operator',
      'op-1',
      '--org',
      ORG,
      '--reason',
      'GCP topic configured; backfilling closed-beta tenants',
      '--apply',
    ])

    expect(result.exitCode).toBe(0)
    expect(subscribe).toHaveBeenCalledWith(ORG, CONN_A)
    expect(out.join('\n')).toContain('"action": "subscribe"')
  })
})
