// The operator command contract for leaving the Response Targets of restated
// Material Review Revisions out of every count:
//
//   pnpm ops inbox exclude-restated-revision-targets <propertyId> --operator <id>
//     [--reason <text> --ticket <ref> --apply]
//
// Why the exclusion exists, and why it is a row beside the target rather than an
// edit of it, is in drizzle/0070_inbox_response_target_exclusions.sql and
// docs/operations/inbox-response-targets.md. This module is the invocation: the
// spec the harness runs it under, the arguments, what it prints, and the order
// of the steps. The work is done by two stores behind the ports below: Review
// lists the restated revisions (Inbox may not read Review tables), Inbox finds
// the cycles they opened and writes the rows. It sits here, not in
// `scripts/ops/`, because `scripts/**` is wiring only.
//
// The harness stores neither the operator nor the reason. The ledger row keeps
// the operator, the ticket and the correlation id; the reason is free text and
// only the printed record carries it. An applied run prints the operator, the
// reason, the ticket, the correlation id and the counts: the operator copies it
// into the incident record. Every line is ids, numbers and states: no Review
// text, rating or reviewer.

import type {
  OperatorArgs,
  OperatorCommandSpec,
  OperatorContext,
  OperatorIO,
} from './operator-command'

const COMMAND = 'ops:inbox'
const ACTION = 'exclude-restated-revision-targets'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A mutation, so it reports by default and `--apply` needs a reason. Not
 * destructive: it adds ledger rows and cancels reminder slots that were never
 * going to say anything true, and it deletes nothing. `--ticket` is optional.
 */
export const inboxExcludeRestatedRevisionTargetsCommandSpec: OperatorCommandSpec =
  Object.freeze({
    name: COMMAND,
    scope: 'global',
    mutation: true,
    usage: `pnpm ops inbox ${ACTION} <propertyId> --operator <id> [--reason <text> --ticket <ref> --apply]`,
  })

type Plan =
  Readonly<{ ok: true; propertyId: string }> | Readonly<{ ok: false; error: string }>

export function planInboxExcludeRestatedRevisionTargets(args: OperatorArgs): Plan {
  const [action, propertyId, ...extra] = args.positionals
  if (action !== ACTION) return { ok: false, error: `the only action is '${ACTION}'` }
  if (!propertyId) return { ok: false, error: '<propertyId> is required' }
  if (!UUID.test(propertyId)) return { ok: false, error: '<propertyId> must be a UUID' }
  if (extra.length > 0) return { ok: false, error: 'one <propertyId> at a time' }
  return { ok: true, propertyId: propertyId.toLowerCase() }
}

// ── Ports: plain strings and numbers, wired to the two contexts by the script ──

export type ExclusionScope = Readonly<{ organizationId: string; propertyId: string }>

/** A restated revision as Review reports it. */
export type RestatedRevision = Readonly<{
  reviewId: string
  sourceEpoch: number
  revision: number
}>

export type ExclusionCandidate = Readonly<{
  inboxItemId: string
  cycleNumber: number
  reviewId: string
  revision: number
  itemStatus: 'open' | 'closed'
  targetState: 'open' | 'on_time' | 'late' | 'cancelled'
  pendingReminderSlots: number
}>

export type ExclusionOutcome =
  | 'excluded'
  | 'already_excluded'
  | 'refused_cycle_changed'
  | 'refused_target_not_measured'

export type ExclusionResult = Readonly<{
  inboxItemId: string
  cycleNumber: number
  outcome: ExclusionOutcome
  cancelledReminderSlots: number
}>

export type ExclusionAudit = Readonly<{
  operatorId: string
  ticket: string | null
  correlationId: string
  at: Date
}>

export type ExclusionPorts = Readonly<{
  findProperty: (propertyId: string) => Promise<ExclusionScope | null>
  listRestatedRevisions: (
    scope: ExclusionScope,
  ) => Promise<ReadonlyArray<RestatedRevision>>
  scan: (
    input: Readonly<{
      scope: ExclusionScope
      restated: ReadonlyArray<Readonly<{ reviewId: string; revision: number }>>
    }>,
  ) => Promise<ReadonlyArray<ExclusionCandidate>>
  apply: (
    input: Readonly<{
      scope: ExclusionScope
      candidates: ReadonlyArray<ExclusionCandidate>
      audit: ExclusionAudit
    }>,
  ) => Promise<ReadonlyArray<ExclusionResult>>
  now: () => Date
}>

// ── What is printed ───────────────────────────────────────────────────────────

export type CandidateSummary = Readonly<{
  candidates: number
  byItemStatus: Readonly<Record<ExclusionCandidate['itemStatus'], number>>
  byTargetState: Readonly<Record<ExclusionCandidate['targetState'], number>>
  pendingReminderSlots: number
}>

export function summarizeExclusionCandidates(
  candidates: ReadonlyArray<ExclusionCandidate>,
): CandidateSummary {
  const byItemStatus = { open: 0, closed: 0 }
  const byTargetState = { open: 0, on_time: 0, late: 0, cancelled: 0 }
  let pendingReminderSlots = 0
  for (const candidate of candidates) {
    byItemStatus[candidate.itemStatus] += 1
    byTargetState[candidate.targetState] += 1
    pendingReminderSlots += candidate.pendingReminderSlots
  }
  return {
    candidates: candidates.length,
    byItemStatus,
    byTargetState,
    pendingReminderSlots,
  }
}

const OUTCOMES: ReadonlyArray<ExclusionOutcome> = [
  'excluded',
  'already_excluded',
  'refused_cycle_changed',
  'refused_target_not_measured',
]

function countOutcomes(
  results: ReadonlyArray<ExclusionResult>,
): Readonly<Record<ExclusionOutcome, number>> {
  const counts: Record<ExclusionOutcome, number> = {
    excluded: 0,
    already_excluded: 0,
    refused_cycle_changed: 0,
    refused_target_not_measured: 0,
  }
  for (const result of results) counts[result.outcome] += 1
  return counts
}

const REFUSAL_WORDS: Readonly<Record<ExclusionOutcome, string>> = {
  excluded: '',
  already_excluded: '',
  refused_cycle_changed:
    'is no longer the one recorded for that revision of its review (nothing was written for it)',
  refused_target_not_measured:
    'holds no measured Google Response Target (nothing was written for it)',
}

type Context = Pick<
  OperatorContext,
  'dryRun' | 'operatorId' | 'correlationId' | 'reason' | 'ticket'
>

export type RunInput = Readonly<{
  ctx: Context
  propertyId: string
  ports: ExclusionPorts
  io: OperatorIO
}>

type Found = Readonly<{
  scope: ExclusionScope
  restatedRevisions: number
  candidates: ReadonlyArray<ExclusionCandidate>
}>

async function find(ports: ExclusionPorts, propertyId: string): Promise<Found | null> {
  const scope = await ports.findProperty(propertyId)
  if (!scope) return null
  const restated = await ports.listRestatedRevisions(scope)
  const candidates = await ports.scan({
    scope,
    restated: restated.map(({ reviewId, revision }) => ({ reviewId, revision })),
  })
  return { scope, restatedRevisions: restated.length, candidates }
}

function describeFound(found: Found) {
  return {
    organizationId: found.scope.organizationId,
    propertyId: found.scope.propertyId,
    restatedRevisions: found.restatedRevisions,
    ...summarizeExclusionCandidates(found.candidates),
  }
}

/** The ledger's CHECK takes a ticket of 1 to 200 characters after trimming, or none. */
const MAX_TICKET_LENGTH = 200

function ticketRefusal(ticket: string | undefined): string | null {
  if (ticket === undefined) return null
  const trimmed = ticket.trim()
  if (trimmed.length === 0) return 'refused: --ticket is blank'
  return trimmed.length > MAX_TICKET_LENGTH
    ? `refused: --ticket is longer than ${String(MAX_TICKET_LENGTH)} characters`
    : null
}

function refuseUnknownProperty(io: OperatorIO): number {
  io.out(JSON.stringify({ outcome: 'property_not_found' }, null, 2))
  io.err('refused: no Property has that id')
  return 1
}

function report(io: OperatorIO, found: Found): number {
  io.out(
    JSON.stringify(
      {
        outcome: 'would_exclude',
        ...describeFound(found),
        candidateIds: found.candidates.map(({ inboxItemId, cycleNumber }) => ({
          inboxItemId,
          cycleNumber,
        })),
      },
      null,
      2,
    ),
  )
  io.out(
    found.candidates.length === 0
      ? 'report only — nothing to exclude'
      : `report only — ${String(found.candidates.length)} cycle(s) opened on a revision Google only restated, ` +
          'each with a measured Response Target that is not excluded yet. ' +
          'Re-run with --reason <text> --apply to leave them out of reporting, reminders and waiting time.',
  )
  return 0
}

function outcomeLabel(
  found: Found,
  counts: Readonly<Record<ExclusionOutcome, number>>,
): string {
  if (found.candidates.length === 0) return 'nothing_to_exclude'
  const refused = counts.refused_cycle_changed + counts.refused_target_not_measured
  return refused > 0 ? 'partly_refused' : 'excluded'
}

function printRefusals(io: OperatorIO, results: ReadonlyArray<ExclusionResult>): void {
  for (const result of results) {
    if (result.outcome === 'excluded' || result.outcome === 'already_excluded') continue
    io.err(
      `refused: cycle ${String(result.cycleNumber)} of item ${result.inboxItemId} ${REFUSAL_WORDS[result.outcome]}`,
    )
  }
}

async function apply(input: RunInput, found: Found): Promise<number> {
  const { ctx, ports, io } = input
  const results =
    found.candidates.length === 0
      ? []
      : await ports.apply({
          scope: found.scope,
          candidates: found.candidates,
          audit: {
            operatorId: ctx.operatorId,
            ticket: ctx.ticket?.trim() ?? null,
            correlationId: ctx.correlationId,
            at: ports.now(),
          },
        })
  const counts = countOutcomes(results)
  io.out(
    JSON.stringify(
      {
        outcome: outcomeLabel(found, counts),
        operator: ctx.operatorId,
        reason: ctx.reason,
        ticket: ctx.ticket?.trim() ?? null,
        correlationId: ctx.correlationId,
        ...describeFound(found),
        results: Object.fromEntries(
          OUTCOMES.map((outcome) => [outcome, counts[outcome]]),
        ),
        cancelledReminderSlots: results.reduce(
          (total, result) => total + result.cancelledReminderSlots,
          0,
        ),
      },
      null,
      2,
    ),
  )
  printRefusals(io, results)
  return counts.refused_cycle_changed + counts.refused_target_not_measured > 0 ? 1 : 0
}

/**
 * Report, or with `--apply` write. Returns the exit code: 1 when the Property
 * does not exist or a candidate was refused. The candidates come from a fresh
 * scan in the same run; each is checked again under its locks before anything
 * is written for it.
 */
export async function runInboxExcludeRestatedRevisionTargets(
  input: RunInput,
): Promise<number> {
  const refusal = ticketRefusal(input.ctx.ticket)
  if (refusal) {
    input.io.err(refusal)
    return 1
  }
  const found = await find(input.ports, input.propertyId)
  if (!found) return refuseUnknownProperty(input.io)
  return input.ctx.dryRun ? report(input.io, found) : apply(input, found)
}
