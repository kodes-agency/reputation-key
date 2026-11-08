// Operator command contract for manual rights requests: access, guest-response
// erasure, participant erasure, Property erasure and Organization closure.
//
// Lives in `src/shared/ops` rather than `scripts/ops` so the path that reads
// and erases a person's data is covered by tests that run. Three modes:
//
//   report  the default; reads nothing it cannot name and writes nothing
//   apply   --apply with typed confirmation; refused in production
//   replay  plans the re-erasure of an exported journal against a restore point
//
// The subject is named by the SHA-256 of a verified identifier, never the
// identifier itself, so it cannot land in shell history or the audit trail.

import {
  planBackupErasureReplay,
  type BackupErasureLedgerEntry,
  type BackupErasureReplayPlanItem,
} from '#/shared/db/lifecycle/backup-erasure-ledger'
import type { ErasureJournalEntry } from '#/shared/db/lifecycle/erasure-journal.server'
import type {
  OperatorArgs,
  OperatorCommandSpec,
  OperatorContext,
} from '../operator-command'

export const RIGHTS_REQUEST_COMMAND = 'ops:rights-request'

export const RIGHTS_REQUEST_SCOPES = [
  'access',
  'guest-response',
  'participant',
  'property',
  'organization',
] as const
export type RightsRequestScope = (typeof RIGHTS_REQUEST_SCOPES)[number]

export const RIGHTS_REQUEST_MODES = ['report', 'apply', 'replay'] as const
export type RightsRequestMode = (typeof RIGHTS_REQUEST_MODES)[number]

/** The requester gets an answer within 30 days of receipt. */
export const ANSWER_DEADLINE_DAYS = 30
/** An export is delivered within seven days of identity verification. */
export const EXPORT_DEADLINE_DAYS = 7
/** An export download link works for 24 hours. */
export const EXPORT_LINK_HOURS = 24
/** An export file is deleted after download and after seven days at the latest. */
export const EXPORT_FILE_MAX_AGE_DAYS = 7
/** One journal entry names at most this many targets. */
export const RIGHTS_BATCH_MAX = 200
export const RIGHTS_BATCH_DEFAULT = 50

const DAY_MS = 24 * 60 * 60 * 1000

export const rightsRequestCommandSpec: OperatorCommandSpec = Object.freeze({
  name: RIGHTS_REQUEST_COMMAND,
  scope: 'org',
  mutation: true,
  destructive: true,
  requiresTicket: true,
  batchSize: { default: RIGHTS_BATCH_DEFAULT, max: RIGHTS_BATCH_MAX },
  usage:
    'pnpm ops rights-request <access|guest-response|participant|property|organization> [replay] ' +
    '--operator <id> --org <id> [--property <id>] received=<iso> [verified=<iso> verification=<ref>] ' +
    '[subject-ref=<sha256>] [response=<uuid>] [journal=<file> restore-point=<iso>] [out=<dir>] ' +
    "[--reason <text> --ticket <ref> --batch-size <n> --apply 'confirm=ERASE <SCOPE> <id>' --yes ops:rights-request]",
})

export type RightsRequestPlan = Readonly<{
  scope: RightsRequestScope
  mode: RightsRequestMode
  organizationId: string
  propertyId?: string
  subjectRef?: string
  responseId?: string
  verificationRef?: string
  receivedAt?: Date
  verifiedAt?: Date
  answerDueAt?: Date
  exportDueAt?: Date
  batchSize: number
  confirmation?: string
  journalFile?: string
  restorePointAt?: Date
  outDir?: string
}>

export type RightsRequestPlanResult =
  Readonly<{ ok: true; plan: RightsRequestPlan }> | Readonly<{ ok: false; error: string }>

export type RightsRequestEnvironment = Readonly<{ production: boolean }>

const SHA256 = /^[0-9a-f]{64}$/u
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const CONTENT_FREE_REF = /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$/u
const FILE_PATH = /^[^\0\s][^\0]{0,1023}$/u

function tokenValue(args: OperatorArgs, name: string): string | undefined {
  const prefix = `${name}=`
  return args.positionals.find((token) => token.startsWith(prefix))?.slice(prefix.length)
}

function parseInstant(value: string | undefined): Date | null | undefined {
  if (value === undefined) return undefined
  const instant = new Date(value)
  return Number.isNaN(instant.getTime()) ? null : instant
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS)
}

/** The text the operator types to confirm one irreversible apply. */
export function rightsConfirmationText(
  scope: RightsRequestScope,
  target: Readonly<{ organizationId: string; propertyId?: string; responseId?: string }>,
): string {
  const id =
    scope === 'guest-response'
      ? target.responseId
      : scope === 'property'
        ? target.propertyId
        : target.organizationId
  return `ERASE ${scope.toUpperCase()} ${id ?? ''}`.trim()
}

function readMode(positionals: ReadonlyArray<string>, apply: boolean): RightsRequestMode {
  if (positionals.includes('replay')) return 'replay'
  return apply ? 'apply' : 'report'
}

type Fields = Readonly<{
  subjectRef?: string
  responseId?: string
  verificationRef?: string
  receivedAt?: Date | null
  verifiedAt?: Date | null
  restorePointAt?: Date | null
  journalFile?: string
  confirmation?: string
  outDir?: string
}>

function readFields(args: OperatorArgs): Fields {
  return {
    subjectRef: tokenValue(args, 'subject-ref'),
    responseId: tokenValue(args, 'response'),
    verificationRef: tokenValue(args, 'verification'),
    receivedAt: parseInstant(tokenValue(args, 'received')),
    verifiedAt: parseInstant(tokenValue(args, 'verified')),
    restorePointAt: parseInstant(tokenValue(args, 'restore-point')),
    journalFile: tokenValue(args, 'journal'),
    confirmation: tokenValue(args, 'confirm'),
    outDir: tokenValue(args, 'out'),
  }
}

function fieldShapeError(fields: Fields): string | null {
  if (fields.subjectRef !== undefined && !SHA256.test(fields.subjectRef)) {
    return 'subject-ref must be the SHA-256 of the verified subject identifier'
  }
  if (fields.responseId !== undefined && !UUID.test(fields.responseId)) {
    return 'response must be a response UUID'
  }
  if (
    fields.verificationRef !== undefined &&
    !CONTENT_FREE_REF.test(fields.verificationRef)
  ) {
    return 'verification must be a content-free reference'
  }
  if (fields.journalFile !== undefined && !FILE_PATH.test(fields.journalFile)) {
    return 'journal must be a local file path'
  }
  if (fields.outDir !== undefined && !FILE_PATH.test(fields.outDir)) {
    return 'out must be a local directory path'
  }
  if (fields.receivedAt === null) return 'received must be an ISO date'
  if (fields.verifiedAt === null) return 'verified must be an ISO date'
  if (fields.restorePointAt === null) return 'restore-point must be an ISO date'
  return null
}

function scopeError(
  scope: RightsRequestScope,
  ctx: OperatorContext,
  fields: Fields,
): string | null {
  if (scope === 'property' && !ctx.propertyId) return '--property is required'
  if (scope === 'guest-response') {
    if (!ctx.propertyId) return '--property is required'
    if (!fields.responseId) return 'response=<uuid> is required'
  }
  if (scope === 'participant' && !fields.subjectRef) {
    return 'subject-ref=<sha256> is required'
  }
  return null
}

function replayError(fields: Fields): string | null {
  if (!fields.journalFile) return 'journal=<file> is required for replay'
  if (!fields.restorePointAt) return 'restore-point=<iso> is required for replay'
  return null
}

function applyError(
  scope: RightsRequestScope,
  ctx: OperatorContext,
  fields: Fields,
  environment: RightsRequestEnvironment,
): string | null {
  if (environment.production) {
    return 'apply is disabled in production; run report or replay'
  }
  if (scope === 'access') return 'access is a report; it has no apply mode'
  if (!fields.verifiedAt || !fields.verificationRef) {
    return 'verified=<iso> and verification=<ref> are required: no identity, no erasure'
  }
  const expected = rightsConfirmationText(scope, {
    organizationId: ctx.organizationId ?? '',
    propertyId: ctx.propertyId,
    responseId: fields.responseId,
  })
  if (fields.confirmation !== expected) {
    return `typed confirmation required: confirm=${expected}`
  }
  return null
}

/**
 * Turn a validated invocation into an explicit plan, or say why not. Apply is
 * refused in production whatever else is supplied.
 */
export function planRightsRequest(
  ctx: OperatorContext,
  args: OperatorArgs,
  environment: RightsRequestEnvironment,
): RightsRequestPlanResult {
  const [rawScope] = args.positionals
  const scope = rawScope as RightsRequestScope
  if (!RIGHTS_REQUEST_SCOPES.includes(scope)) {
    return { ok: false, error: `scope must be one of ${RIGHTS_REQUEST_SCOPES.join('|')}` }
  }
  if (!ctx.organizationId) return { ok: false, error: '--org is required' }
  const mode = readMode(args.positionals, !ctx.dryRun)
  const fields = readFields(args)
  const error =
    fieldShapeError(fields) ??
    scopeError(scope, ctx, fields) ??
    (mode === 'replay' ? replayError(fields) : null) ??
    (mode === 'apply' ? applyError(scope, ctx, fields, environment) : null)
  if (error) return { ok: false, error }

  const receivedAt = fields.receivedAt ?? undefined
  const verifiedAt = fields.verifiedAt ?? undefined
  return {
    ok: true,
    plan: {
      scope,
      mode,
      organizationId: ctx.organizationId,
      batchSize: ctx.batchSize ?? RIGHTS_BATCH_DEFAULT,
      ...(ctx.propertyId ? { propertyId: ctx.propertyId } : {}),
      ...(fields.subjectRef ? { subjectRef: fields.subjectRef } : {}),
      ...(fields.responseId ? { responseId: fields.responseId } : {}),
      ...(fields.verificationRef ? { verificationRef: fields.verificationRef } : {}),
      ...(fields.confirmation ? { confirmation: fields.confirmation } : {}),
      ...(fields.journalFile ? { journalFile: fields.journalFile } : {}),
      ...(fields.outDir ? { outDir: fields.outDir } : {}),
      ...(fields.restorePointAt ? { restorePointAt: fields.restorePointAt } : {}),
      ...(receivedAt
        ? { receivedAt, answerDueAt: addDays(receivedAt, ANSWER_DEADLINE_DAYS) }
        : {}),
      ...(verifiedAt
        ? { verifiedAt, exportDueAt: addDays(verifiedAt, EXPORT_DEADLINE_DAYS) }
        : {}),
    },
  }
}

/** The lines a report prints: deadlines and delivery rules, never content. */
export function describeRightsReport(plan: RightsRequestPlan): ReadonlyArray<string> {
  const lines = [
    `${plan.mode} ${plan.scope} for org=${plan.organizationId}` +
      (plan.propertyId ? ` property=${plan.propertyId}` : ''),
    plan.answerDueAt
      ? `answer due ${plan.answerDueAt.toISOString()} (${ANSWER_DEADLINE_DAYS} days from receipt)`
      : 'answer due: pass received=<iso> to compute the 30-day deadline',
  ]
  if (plan.scope === 'access' || plan.scope === 'organization') {
    lines.push(
      plan.exportDueAt
        ? `export due ${plan.exportDueAt.toISOString()} (${EXPORT_DEADLINE_DAYS} days from verification)`
        : 'export due: pass verified=<iso> to start the seven-day export deadline',
      `export delivery: ${EXPORT_LINK_HOURS}-hour download link to a private bucket file; ` +
        `file deleted after download and within ${EXPORT_FILE_MAX_AGE_DAYS} days; never emailed as an attachment`,
      plan.outDir
        ? `export files are written under ${plan.outDir}`
        : 'export files: pass out=<dir> to write them; upload them to the private bucket by hand',
    )
  }
  if (plan.scope === 'organization') {
    lines.push(
      'closure warning: closing an Organization erases every Property in it; export first',
    )
  }
  if (plan.mode === 'report' && plan.scope !== 'access') {
    lines.push(
      `to execute: add --apply, verified=<iso> verification=<ref> and ` +
        `'confirm=${rightsConfirmationText(plan.scope, plan)}' (refused in production)`,
    )
  }
  return lines
}

export type RightsReplayItem = Readonly<{
  journalId: string
  scope: RightsRequestPlan['scope'] | 'unscoped'
  disposition: BackupErasureReplayPlanItem['disposition']
}>

/**
 * Replay is bounded to the plan's Organization (and Property, when set): an
 * entry for another tenant or Property is never listed, so one request cannot
 * replay another customer's erasure.
 */
export function planRightsReplay(
  plan: RightsRequestPlan,
  entries: readonly ErasureJournalEntry[],
): readonly RightsReplayItem[] {
  if (!plan.restorePointAt) throw new Error('restore point is required for replay')
  const inScope = entries.filter(
    (entry) =>
      entry.organizationId === plan.organizationId &&
      (plan.propertyId === undefined || entry.propertyId === plan.propertyId),
  )
  return planBackupErasureReplay(inScope, plan.restorePointAt).map((item) => ({
    journalId: item.entry.id,
    scope: replayScopeOf(item.entry),
    disposition: item.disposition,
  }))
}

function replayScopeOf(entry: BackupErasureLedgerEntry): RightsReplayItem['scope'] {
  if (entry.subjectClass === 'organization') return 'organization'
  if (entry.subjectClass === 'property') return 'property'
  if (entry.journalTargets?.kind === 'staff_participant') return 'participant'
  if (entry.journalTargets?.kind === 'guest_response') return 'guest-response'
  return 'unscoped'
}
