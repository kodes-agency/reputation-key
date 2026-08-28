// LIF-01-T20 — the operator command contract for privacy requests.
//
// Lives in `src/shared/ops` rather than `scripts/ops` because `scripts/**` is
// not in the unit test project, and the path that reads, corrects and erases a
// person's data must be covered by tests that actually run.
//
// Report-only by default. Erasure and withdrawal additionally require typed
// confirmation through the harness (`destructive`), because both are
// irreversible for the subject even when they are not irreversible for the
// tenant.

import type {
  OperatorArgs,
  OperatorCommandSpec,
  OperatorContext,
} from '../operator-command'
import {
  PRIVACY_REFUSAL_REASON_CODES,
  PRIVACY_REQUEST_KINDS,
  PRIVACY_SUBJECT_TYPES,
  type PrivacyRefusalReasonCode,
  type PrivacyRequestKind,
  type PrivacySubjectType,
} from './privacy-request'

export const PRIVACY_REQUEST_COMMAND = 'ops:privacy-request'

export const privacyRequestCommandSpec: OperatorCommandSpec = Object.freeze({
  name: PRIVACY_REQUEST_COMMAND,
  scope: 'property',
  mutation: true,
  destructive: true,
  requiresTicket: true,
  usage:
    'pnpm ops:privacy-request (report|receive|verify|fulfil|refuse) --operator <id> --org <id> --property <id> ' +
    'kind=(access|correction|withdrawal|erasure) subject-type=(guest|participant) subject-ref=<sha256> ' +
    '[request=<id> verification=<ref> field=<name> reason-code=<code> --reason <text> --ticket <ref> ' +
    '--apply --yes ops:privacy-request]',
})

export const PRIVACY_REQUEST_MODES = [
  'report',
  'receive',
  'verify',
  'fulfil',
  'refuse',
] as const

export type PrivacyRequestMode = (typeof PRIVACY_REQUEST_MODES)[number]

export type PrivacyRequestCommandPlan = Readonly<{
  mode: PrivacyRequestMode
  organizationId: string
  propertyId: string
  reportOnly: boolean
  requestKind?: PrivacyRequestKind
  subjectType?: PrivacySubjectType
  subjectRef?: string
  requestId?: string
  verificationRef?: string
  targetField?: string
  refusalReasonCode?: PrivacyRefusalReasonCode
}>

export type PrivacyRequestCommandPlanResult =
  | Readonly<{ ok: true; plan: PrivacyRequestCommandPlan }>
  | Readonly<{ ok: false; error: string }>

const SHA256 = /^[0-9a-f]{64}$/u
const CONTENT_FREE_REF = /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$/u
const FIELD_NAME = /^[a-z][a-z0-9_]{0,63}$/u

function flagValue(args: OperatorArgs, name: string): string | undefined {
  const prefix = `${name}=`
  return args.positionals.find((token) => token.startsWith(prefix))?.slice(prefix.length)
}

/**
 * Turn a validated invocation into an explicit plan.
 *
 * The subject reference is checked here as a SHA-256. That single check is what
 * stops an operator pasting the guest's email address into a shell command,
 * which would put it in the shell history, the audit trail and the request row
 * all at once.
 */
export function planPrivacyRequestCommand(
  ctx: OperatorContext,
  args: OperatorArgs,
): PrivacyRequestCommandPlanResult {
  const [rawMode] = args.positionals
  const mode = (rawMode ?? 'report') as PrivacyRequestMode
  if (!PRIVACY_REQUEST_MODES.includes(mode)) {
    return { ok: false, error: `unknown mode '${rawMode}'` }
  }
  if (!ctx.organizationId || !ctx.propertyId) {
    // A privacy request that is not tenant AND property scoped cannot be
    // answered without reading across tenants.
    return { ok: false, error: '--org and --property are required' }
  }

  const subjectRef = flagValue(args, 'subject-ref')
  const kind = flagValue(args, 'kind') as PrivacyRequestKind | undefined
  const subjectType = flagValue(args, 'subject-type') as PrivacySubjectType | undefined
  const requestId = flagValue(args, 'request')
  const verificationRef = flagValue(args, 'verification')
  const targetField = flagValue(args, 'field')
  const refusalReasonCode = flagValue(args, 'reason-code') as
    PrivacyRefusalReasonCode | undefined

  if (subjectRef !== undefined && !SHA256.test(subjectRef)) {
    return {
      ok: false,
      error: 'subject-ref must be the SHA-256 of the verified subject identifier',
    }
  }
  if (targetField !== undefined && !FIELD_NAME.test(targetField)) {
    return { ok: false, error: 'field must be a schema field name, never a value' }
  }

  if (mode === 'receive' && !ctx.dryRun) {
    if (!kind || !PRIVACY_REQUEST_KINDS.includes(kind)) {
      return {
        ok: false,
        error: `kind must be one of ${PRIVACY_REQUEST_KINDS.join('|')}`,
      }
    }
    if (!subjectType || !PRIVACY_SUBJECT_TYPES.includes(subjectType)) {
      return {
        ok: false,
        error: `subject-type must be one of ${PRIVACY_SUBJECT_TYPES.join('|')}`,
      }
    }
    if (!subjectRef) return { ok: false, error: 'subject-ref=<sha256> is required' }
    if (kind === 'correction' && !targetField) {
      return { ok: false, error: 'field=<name> is required for a correction' }
    }
  }

  if (mode === 'verify' && !ctx.dryRun) {
    if (!requestId) return { ok: false, error: 'request=<id> is required' }
    if (!verificationRef || !CONTENT_FREE_REF.test(verificationRef)) {
      // No edge skips identity verification, and the evidence for it is an
      // opaque reference, not a description of what the person said.
      return {
        ok: false,
        error: 'verification=<ref> is required and must be a content-free token',
      }
    }
  }

  if ((mode === 'fulfil' || mode === 'refuse') && !ctx.dryRun && !requestId) {
    return { ok: false, error: 'request=<id> is required' }
  }
  if (mode === 'refuse' && !ctx.dryRun) {
    if (!refusalReasonCode || !PRIVACY_REFUSAL_REASON_CODES.includes(refusalReasonCode)) {
      return {
        ok: false,
        error: `reason-code must be one of ${PRIVACY_REFUSAL_REASON_CODES.join('|')}`,
      }
    }
  }

  return {
    ok: true,
    plan: {
      mode,
      organizationId: ctx.organizationId,
      propertyId: ctx.propertyId,
      reportOnly: ctx.dryRun,
      ...(kind ? { requestKind: kind } : {}),
      ...(subjectType ? { subjectType } : {}),
      ...(subjectRef ? { subjectRef } : {}),
      ...(requestId ? { requestId } : {}),
      ...(verificationRef ? { verificationRef } : {}),
      ...(targetField ? { targetField } : {}),
      ...(refusalReasonCode ? { refusalReasonCode } : {}),
    },
  }
}
