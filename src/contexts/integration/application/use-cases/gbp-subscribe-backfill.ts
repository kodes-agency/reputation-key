// Integration context — gbp-subscribe backfill core.
//
// Why this exists: `manageNotifications.subscribe` runs on the import path, so
// every property connected with push working gets it. Nothing else subscribes
// the tenants imported while push was off or broken (closed-beta-v2 until
// 2026-09-29), and nothing re-points an existing subscription when
// GBP_PUBSUB_TOPIC changes — Google stores the topic per GBP account, not per
// deployment. Both are the same operation: re-run `subscribe` over every usable
// connection of an organization. That is this backfill.
//
// Two callers run it. The daily `reconcile-gbp-notification-subscriptions`
// job runs it for every organization the capability allows, because the
// operator command cannot reach a database inside a private network; and
// ops:gbp-subscribe runs it on demand for one organization. Neither re-PATCHes
// an account behind anyone's back: `subscribe` reads the account's setting
// first and writes only when it differs from the configured topic.
//
// The command's parse + action live here (with their unit tests); scripts/ is
// outside tsconfig/eslint, so scripts/ops/gbp-subscribe.ts is wiring only — the
// same split as ops:property-capabilities.

import { organizationId as toOrganizationId } from '#/shared/domain/ids'
import type { OrganizationId } from '#/shared/domain/ids'
import type { GoogleConnection, GoogleConnectionStatus } from '../../domain/types'
import {
  NO_GBP_ACCOUNTS,
  sumGbpAccountTallies,
  type GbpAccountTally,
  type GbpSubscribeOutcome,
  type ManageNotificationsApi,
} from './manage-notifications'

/**
 * `skipped_inactive` is ours, not the use case's: a pending/reauth_required/
 * disconnected connection holds no usable credential, so calling `subscribe` on
 * it would burn a token refresh to learn what the row already says.
 */
export type GbpSubscribeConnectionOutcome = GbpSubscribeOutcome | 'skipped_inactive'

export type GbpSubscribeBackfillDeps = Readonly<{
  /** Every Google connection of the organization, whatever its status. */
  listConnections: (
    organizationId: OrganizationId,
  ) => Promise<ReadonlyArray<GoogleConnection>>
  subscribe: ManageNotificationsApi['subscribe']
}>

export type GbpSubscribeConnectionReport = Readonly<{
  connectionId: string
  status: GoogleConnectionStatus
  /**
   * null = a candidate on a DRY RUN: it would be attempted, and nothing was
   * called. `skipped_inactive` is decided from the row in both modes.
   */
  outcome: GbpSubscribeConnectionOutcome | null
  /** What happened to each GBP account of the connection; null when nothing was called. */
  accounts: GbpAccountTally | null
}>

export type GbpSubscribeBackfillReport = Readonly<{
  action: 'would_subscribe' | 'subscribe'
  organizationId: string
  /** Connections examined, and how many of those were subscribe candidates. */
  connections: number
  candidates: number
  /** Outcome → count. Only the resolved outcomes, so empty on a dry run. */
  counts: Readonly<Partial<Record<GbpSubscribeConnectionOutcome, number>>>
  /** Every GBP account the run reached, across its connections. */
  accounts: GbpAccountTally
  connectionOutcomes: ReadonlyArray<GbpSubscribeConnectionReport>
}>

/**
 * Only an `active` connection holds a credential `subscribe` can refresh and
 * use. `degraded` is deliberately included: it means recent provider trouble,
 * not a dead credential, and re-asserting the topic is exactly the repair an
 * operator is reaching for.
 */
const isSubscribeCandidate = (connection: GoogleConnection): boolean =>
  connection.status === 'active' || connection.status === 'degraded'

const tally = (
  outcomes: ReadonlyArray<GbpSubscribeConnectionReport>,
): Readonly<Partial<Record<GbpSubscribeConnectionOutcome, number>>> => {
  const counts: Partial<Record<GbpSubscribeConnectionOutcome, number>> = {}
  for (const entry of outcomes) {
    if (entry.outcome === null) continue
    counts[entry.outcome] = (counts[entry.outcome] ?? 0) + 1
  }
  return counts
}

export type GbpSubscribeBackfill = Readonly<{
  /** Reports the candidates without calling Google — the --apply-less path. */
  plan: (organizationId: OrganizationId) => Promise<GbpSubscribeBackfillReport>
  /**
   * Re-asserts the topic for every candidate. Safely re-runnable: `subscribe`
   * reads the account's single notificationSetting resource, PATCHes it only
   * when it differs, and never throws, so a partial run is repaired by running
   * it again. Sequential on purpose — a backfill must not burst GBP's
   * per-project quota.
   */
  apply: (organizationId: OrganizationId) => Promise<GbpSubscribeBackfillReport>
}>

export const createGbpSubscribeBackfill = (
  deps: GbpSubscribeBackfillDeps,
): GbpSubscribeBackfill => {
  const examine = async (
    organizationId: OrganizationId,
    call: boolean,
  ): Promise<GbpSubscribeBackfillReport> => {
    const connections = await deps.listConnections(organizationId)
    const connectionOutcomes: GbpSubscribeConnectionReport[] = []
    let candidates = 0

    for (const connection of connections) {
      if (!isSubscribeCandidate(connection)) {
        connectionOutcomes.push({
          connectionId: connection.id,
          status: connection.status,
          outcome: 'skipped_inactive',
          accounts: null,
        })
        continue
      }
      candidates += 1
      const result = call ? await deps.subscribe(organizationId, connection.id) : null
      connectionOutcomes.push({
        connectionId: connection.id,
        status: connection.status,
        outcome: result?.outcome ?? null,
        accounts: result?.accounts ?? null,
      })
    }

    return {
      action: call ? 'subscribe' : 'would_subscribe',
      organizationId,
      connections: connections.length,
      candidates,
      counts: tally(connectionOutcomes),
      accounts: sumGbpAccountTallies([
        NO_GBP_ACCOUNTS,
        ...connectionOutcomes.flatMap((entry) =>
          entry.accounts ? [entry.accounts] : [],
        ),
      ]),
      connectionOutcomes,
    }
  }

  return {
    plan: (organizationId) => examine(organizationId, false),
    apply: (organizationId) => examine(organizationId, true),
  }
}

/** Outcomes that leave nothing for an operator to repair. */
const SETTLED_OUTCOMES: ReadonlySet<GbpSubscribeConnectionOutcome> = new Set([
  'subscribed',
  'already_subscribed',
  'skipped_inactive',
  'account_unresolved',
])

/** The subset of the harness context/io this action reads (structural). */
type GbpSubscribeOperatorContext = Readonly<{
  organizationId?: string
  dryRun: boolean
}>
type GbpSubscribeOperatorIO = Readonly<{ out: (line: string) => void }>

/**
 * The ops:gbp-subscribe action — structurally compatible with the harness's
 * OperatorAction. DRY-RUN by default: the harness sets ctx.dryRun for a mutation
 * invoked without --apply, and then nothing calls Google at all.
 *
 * Exit code 1 when an applied run left any connection neither subscribed nor
 * with nothing to subscribe (`skipped_inactive`, or `account_unresolved`: no
 * bound Property yet), so a backfill that quietly achieved nothing is not
 * mistaken for a successful one. `topic_unset` lands there too: it means
 * GBP_PUBSUB_TOPIC is empty in the environment the command ran in, which is the
 * single most likely reason an operator's backfill does nothing.
 */
export function createGbpSubscribeOperatorAction(
  backfill: GbpSubscribeBackfill,
  commandName: string,
): (
  ctx: GbpSubscribeOperatorContext,
  args: unknown,
  io: GbpSubscribeOperatorIO,
) => Promise<number> {
  return async (ctx, _args, io) => {
    // The harness rejects the invocation before the action runs when a
    // scope-'org' command is missing --org.
    const organization = toOrganizationId(ctx.organizationId ?? '')
    if (ctx.dryRun) {
      io.out(JSON.stringify(await backfill.plan(organization), null, 2))
      io.out(`re-run with --reason <text> --apply to ${commandName}`)
      return 0
    }
    const report = await backfill.apply(organization)
    io.out(JSON.stringify(report, null, 2))
    const unresolved = report.connectionOutcomes.filter(
      (entry) => entry.outcome === null || !SETTLED_OUTCOMES.has(entry.outcome),
    )
    if (unresolved.length === 0) return 0
    io.out(
      `${unresolved.length} connection(s) did not reach 'subscribed' or 'already_subscribed' — safe to re-run; see the per-connection outcomes above`,
    )
    return 1
  }
}
