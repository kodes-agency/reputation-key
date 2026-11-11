// The operator command that erases the Reporting readings nothing reads any
// more, the Google per-review stars recorded under `property.review`, together
// with any corrections that point at them:
//
//   pnpm ops erase-retired-readings --operator <id> [--org <id>]
//     — counts, per Organization; nothing is written
//   pnpm ops erase-retired-readings --operator <id> --org <id> --batch-size <n>
//     verified=<iso> verification=<ref> 'confirm=ERASE RETIRED READINGS <org>'
//     --reason <text> --ticket <ref> --apply --yes ops:erase-retired-readings
//
// An apply works one Organization at a time. Before each bounded batch it
// writes an IDs-only journal object naming the batch's readings to the private
// bucket; a failed write alerts, stops the run and deletes nothing. Run the same
// command again to continue: the readings already gone are not selected. Every
// apply leaves one audit event naming the operator, whatever its outcome. Only
// `property.review` is ever selected, so no other metric key is reachable.

import { randomUUID } from 'node:crypto'
import { journalBeforeErasure } from '#/shared/db/lifecycle/erasure-journal.server'
import type { ErasureJournalEntry } from '#/shared/db/lifecycle/erasure-journal.server'
import type {
  OperatorArgs,
  OperatorCommandSpec,
  OperatorContext,
  OperatorIO,
} from './operator-command'
import { derivedUuid, type RightsJournalStore } from './rights/rights-journal'

export const RETIRED_READINGS_COMMAND = 'ops:erase-retired-readings'
export const RETIRED_READINGS_METRIC_KEY = 'property.review'
export const RETIRED_READINGS_BATCH_DEFAULT = 50
/** One journal object names at most this many readings. */
export const RETIRED_READINGS_BATCH_MAX = 200

const EVIDENCE_REF = 'retired-readings:v1'
const AUDIT_ACTION = 'metric.erase_retired_readings'
const CONTENT_FREE_REF = /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$/u

export const retiredReadingsErasureCommandSpec: OperatorCommandSpec = Object.freeze({
  name: RETIRED_READINGS_COMMAND,
  scope: 'global',
  mutation: true,
  destructive: true,
  requiresTicket: true,
  batchSize: Object.freeze({
    default: RETIRED_READINGS_BATCH_DEFAULT,
    max: RETIRED_READINGS_BATCH_MAX,
  }),
  usage:
    'pnpm ops erase-retired-readings --operator <id> [--org <id>] ' +
    '[verified=<iso> verification=<ref> ' +
    "'confirm=ERASE RETIRED READINGS <org>' --reason <text> --ticket <ref> " +
    `--batch-size <n> --apply --yes ${RETIRED_READINGS_COMMAND}]`,
})

export type RetiredReadingsCount = Readonly<{
  organizationId: string
  readings: number
  corrections: number
}>

export type RetiredReadingsStore = Readonly<{
  /** Counts per Organization, or for the one named. */
  count: (organizationId?: string) => Promise<ReadonlyArray<RetiredReadingsCount>>
  /** The next readings of one Organization still to erase, in a fixed order. */
  nextBatch: (organizationId: string, limit: number) => Promise<ReadonlyArray<string>>
  /** Deletes the readings and their corrections in one transaction. */
  erase: (
    organizationId: string,
    readingIds: ReadonlyArray<string>,
  ) => Promise<Readonly<{ readings: number; corrections: number }>>
}>

export type RetiredReadingsAuditEvent = Readonly<{
  organizationId: string
  propertyId: null
  actorType: 'operator'
  actorId: string
  action: string
  outcome: 'succeeded' | 'failed'
  resourceType: 'retired_metric_readings'
  resourceId: string
  sourceKind: 'operator_command'
  sourceId: string
  sourceEventType: null
  sourceEventVersion: null
  sourceContext: null
  sourceAggregateId: null
  occurredAt: Date
}>

export type RetiredReadingsEffects = Readonly<{
  store: RetiredReadingsStore
  journal: RightsJournalStore
  audit: (event: RetiredReadingsAuditEvent) => Promise<void>
  now?: () => Date
  runId?: () => string
}>

export type RetiredReadingsPlan =
  | Readonly<{ mode: 'report'; organizationId?: string }>
  | Readonly<{
      mode: 'apply'
      organizationId: string
      batchSize: number
      verifiedAt: Date
      verificationRef: string
    }>

export function retiredReadingsConfirmationText(organizationId: string): string {
  return `ERASE RETIRED READINGS ${organizationId}`
}

function tokenValue(args: OperatorArgs, name: string): string | undefined {
  const prefix = `${name}=`
  return args.positionals.find((token) => token.startsWith(prefix))?.slice(prefix.length)
}

/** Turn a validated invocation into a plan, or say why not. */
export function planRetiredReadingsErasure(
  ctx: OperatorContext,
  args: OperatorArgs,
):
  | Readonly<{ ok: true; plan: RetiredReadingsPlan }>
  | Readonly<{ ok: false; error: string }> {
  if (ctx.dryRun) {
    return { ok: true, plan: { mode: 'report', organizationId: ctx.organizationId } }
  }
  if (!ctx.organizationId) {
    return {
      ok: false,
      error: '--org is required with --apply: one Organization per run',
    }
  }
  const verifiedRaw = tokenValue(args, 'verified')
  const verificationRef = tokenValue(args, 'verification')
  const verifiedAt = verifiedRaw ? new Date(verifiedRaw) : undefined
  if (!verifiedAt || Number.isNaN(verifiedAt.getTime()) || !verificationRef) {
    return {
      ok: false,
      error:
        'verified=<iso> and verification=<ref> are required: no identity, no erasure',
    }
  }
  if (!CONTENT_FREE_REF.test(verificationRef)) {
    return { ok: false, error: 'verification must be a content-free reference' }
  }
  const expected = retiredReadingsConfirmationText(ctx.organizationId)
  if (tokenValue(args, 'confirm') !== expected) {
    return { ok: false, error: `typed confirmation required: confirm=${expected}` }
  }
  return {
    ok: true,
    plan: {
      mode: 'apply',
      organizationId: ctx.organizationId,
      batchSize: ctx.batchSize ?? RETIRED_READINGS_BATCH_DEFAULT,
      verifiedAt,
      verificationRef,
    },
  }
}

/** The IDs-only journal object for one batch; a retry of the batch writes the same bytes. */
export function retiredReadingsJournalEntry(
  plan: Extract<RetiredReadingsPlan, { mode: 'apply' }>,
  readingIds: ReadonlyArray<string>,
): ErasureJournalEntry {
  const ids = [...readingIds].sort()
  const seed = (kind: string) =>
    [EVIDENCE_REF, kind, plan.organizationId, plan.verificationRef, ids.join(',')].join(
      '|',
    )
  return {
    id: derivedUuid(seed('entry')),
    recordedBeforeErasure: true,
    context: 'metric',
    subjectClass: 'organization',
    organizationId: plan.organizationId,
    closureLineageId: derivedUuid(seed('lineage')),
    lifecycleRevision: 1,
    effectiveErasureAt: plan.verifiedAt,
    erasedRowCount: ids.length,
    evidenceRef: EVIDENCE_REF,
    journalTargets: { kind: 'purge_batch', ids },
  }
}

async function report(
  store: RetiredReadingsStore,
  plan: Extract<RetiredReadingsPlan, { mode: 'report' }>,
  io: OperatorIO,
): Promise<number> {
  const counts = await store.count(plan.organizationId)
  for (const row of counts) {
    io.out(
      `org=${row.organizationId} readings=${row.readings} corrections=${row.corrections}`,
    )
  }
  const readings = counts.reduce((sum, row) => sum + row.readings, 0)
  const corrections = counts.reduce((sum, row) => sum + row.corrections, 0)
  io.out(
    `total metric_key=${RETIRED_READINGS_METRIC_KEY} organizations=${counts.length} ` +
      `readings=${readings} corrections=${corrections}`,
  )
  const target = plan.organizationId ?? '<org>'
  io.out(
    `to execute, per Organization: add --org ${target} --apply verified=<iso> ` +
      `verification=<ref> 'confirm=${retiredReadingsConfirmationText(target)}' ` +
      `--reason <text> --ticket <ref> --yes ${RETIRED_READINGS_COMMAND}`,
  )
  return 0
}

type Progress = { batches: number; readings: number; corrections: number }

/** Erases batch by batch until none is left; the journal write precedes each delete. */
async function eraseAll(
  effects: RetiredReadingsEffects,
  plan: Extract<RetiredReadingsPlan, { mode: 'apply' }>,
  progress: Progress,
): Promise<void> {
  for (;;) {
    const ids = await effects.store.nextBatch(plan.organizationId, plan.batchSize)
    if (ids.length === 0) return
    const erased = await journalBeforeErasure(
      retiredReadingsJournalEntry(plan, ids),
      effects.journal,
      () => effects.store.erase(plan.organizationId, ids),
    )
    progress.batches += 1
    progress.readings += erased.readings
    progress.corrections += erased.corrections
  }
}

async function apply(
  effects: RetiredReadingsEffects,
  plan: Extract<RetiredReadingsPlan, { mode: 'apply' }>,
  ctx: OperatorContext,
  io: OperatorIO,
): Promise<number> {
  const progress: Progress = { batches: 0, readings: 0, corrections: 0 }
  let failure: string | null = null
  try {
    await eraseAll(effects, plan, progress)
  } catch (error) {
    failure = error instanceof Error ? error.message : 'unexpected error'
  }
  const summary =
    `org=${plan.organizationId} batches=${progress.batches} ` +
    `readings=${progress.readings} corrections=${progress.corrections}`
  io.out(failure ? `stopped ${summary}` : `erased ${summary}`)
  if (failure) {
    io.err(
      `${RETIRED_READINGS_COMMAND}: ${failure}; run the same command again to resume`,
    )
  }
  try {
    await effects.audit({
      organizationId: plan.organizationId,
      propertyId: null,
      actorType: 'operator',
      actorId: ctx.operatorId,
      action: AUDIT_ACTION,
      outcome: failure ? 'failed' : 'succeeded',
      resourceType: 'retired_metric_readings',
      resourceId: plan.verificationRef,
      sourceKind: 'operator_command',
      sourceId: `retired-readings-${(effects.runId ?? randomUUID)()}`,
      sourceEventType: null,
      sourceEventVersion: null,
      sourceContext: null,
      sourceAggregateId: null,
      occurredAt: (effects.now ?? (() => new Date()))(),
    })
  } catch {
    io.err(`${RETIRED_READINGS_COMMAND}: the audit event could not be written`)
    return 1
  }
  return failure ? 1 : 0
}

export async function runRetiredReadingsErasure(
  effects: RetiredReadingsEffects,
  ctx: OperatorContext,
  args: OperatorArgs,
  io: OperatorIO,
): Promise<number> {
  const planned = planRetiredReadingsErasure(ctx, args)
  if (!planned.ok) {
    io.err(`${RETIRED_READINGS_COMMAND}: ${planned.error}`)
    return 1
  }
  const { plan } = planned
  return plan.mode === 'report'
    ? report(effects.store, plan, io)
    : apply(effects, plan, ctx, io)
}
