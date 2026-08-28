// LIF-01-T19 — the operator command contract for permanent Property Erase.
//
// The contract lives here, not in `scripts/ops/property-erase.ts`, for the same
// reason `operator-command.ts` does: `scripts/**` is not in the unit test
// project, and the ONLY authorization path into an irreversible erasure must be
// covered by tests that actually run.
//
// The shim in scripts/ops binds the real runtime (policy store + ExecutionPolicy
// + container) and does nothing else.
//
// Deliberately NOT capability-gated. `property.erase` is a BLOCKED tenant
// capability and stays blocked; declaring it here would imply a capability that
// could be granted. The authorization is the registered operator plus an
// INDEPENDENT support authorization reference.

import type {
  OperatorArgs,
  OperatorCommandSpec,
  OperatorContext,
} from './operator-command'

export const PROPERTY_ERASE_COMMAND = 'ops:property-erase'

/**
 * Report-only by default (`mutation` without `--apply`), destructive on apply,
 * and ticket-bearing. `destructive` makes the harness demand
 * `--yes ops:property-erase` on top of the in-band typed confirmation.
 */
export const propertyEraseCommandSpec: OperatorCommandSpec = Object.freeze({
  name: PROPERTY_ERASE_COMMAND,
  scope: 'property',
  mutation: true,
  destructive: true,
  requiresTicket: true,
  extraFlags: ['confirm-erase'],
  usage:
    'pnpm ops:property-erase (report|request|preview|confirm|cancel|advance) --operator <id> --org <id> --property <id> ' +
    '[--support-authorization <ref> --identity-verification <ref> --requested-by <user-id> ' +
    '--typed-confirmation "ERASE PROPERTY <property-id>" --inventory-revision <n> ' +
    '--reason <text> --ticket <ref> --apply --yes ops:property-erase]',
})

export const PROPERTY_ERASE_MODES = [
  'report',
  'request',
  'preview',
  'confirm',
  'cancel',
  'advance',
] as const

export type PropertyEraseMode = (typeof PROPERTY_ERASE_MODES)[number]

export type PropertyEraseCommandPlan = Readonly<{
  mode: PropertyEraseMode
  organizationId: string
  propertyId: string
  /** True until `--apply`; a report writes nothing. */
  reportOnly: boolean
  supportAuthorizationRef?: string
  identityVerificationRef?: string
  requestedByUserId?: string
  typedConfirmation?: string
  inventoryRevision?: number
  authorityId?: string
  reasonCode?: string
}>

export type PropertyEraseCommandPlanResult =
  | Readonly<{ ok: true; plan: PropertyEraseCommandPlan }>
  | Readonly<{ ok: false; error: string }>

const CONTENT_FREE_REF = /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$/u

function flagValue(args: OperatorArgs, name: string): string | undefined {
  // The harness only parses its own value flags, so command-specific values
  // arrive as `name=value` positionals. Keeping them positional means the
  // harness's flag surface stays identical for every ops command.
  const prefix = `${name}=`
  const found = args.positionals.find((token) => token.startsWith(prefix))
  return found?.slice(prefix.length)
}

/**
 * Turn a validated operator invocation into an explicit plan.
 *
 * Every mode-specific requirement is checked HERE, before anything is written,
 * so a missing support authorization is a usage error rather than a half-run
 * erasure.
 */
export function planPropertyEraseCommand(
  ctx: OperatorContext,
  args: OperatorArgs,
): PropertyEraseCommandPlanResult {
  const [rawMode] = args.positionals
  const mode = (rawMode ?? 'report') as PropertyEraseMode
  if (!PROPERTY_ERASE_MODES.includes(mode)) {
    return { ok: false, error: `unknown mode '${rawMode}'` }
  }
  if (!ctx.organizationId || !ctx.propertyId) {
    return { ok: false, error: '--org and --property are required' }
  }

  const base = {
    mode,
    organizationId: ctx.organizationId,
    propertyId: ctx.propertyId,
    reportOnly: ctx.dryRun,
  }
  const supportAuthorizationRef = flagValue(args, 'support-authorization')
  const identityVerificationRef = flagValue(args, 'identity-verification')
  const requestedByUserId = flagValue(args, 'requested-by')
  const typedConfirmation = flagValue(args, 'typed-confirmation')
  const inventoryRevisionRaw = flagValue(args, 'inventory-revision')
  const authorityId = flagValue(args, 'authority')
  const reasonCode = flagValue(args, 'reason-code')

  if (mode === 'request' && !ctx.dryRun) {
    // Both references are mandatory and must be independent: the support
    // authorization is what makes this support-MEDIATED rather than a tenant
    // self-service delete wearing an operator's name.
    if (!supportAuthorizationRef || !CONTENT_FREE_REF.test(supportAuthorizationRef)) {
      return {
        ok: false,
        error: 'support-authorization=<ref> is required and must be a content-free token',
      }
    }
    if (!identityVerificationRef || !CONTENT_FREE_REF.test(identityVerificationRef)) {
      return {
        ok: false,
        error: 'identity-verification=<ref> is required and must be a content-free token',
      }
    }
    if (supportAuthorizationRef === identityVerificationRef) {
      return {
        ok: false,
        error:
          'support authorization must be independent of the requester identity verification',
      }
    }
    if (!requestedByUserId) {
      return { ok: false, error: 'requested-by=<user-id> is required (the AccountAdmin)' }
    }
  }

  if (mode === 'confirm' && !ctx.dryRun) {
    if (!typedConfirmation) {
      return {
        ok: false,
        error: 'typed-confirmation="ERASE PROPERTY <property-id>" is required',
      }
    }
    const inventoryRevision = Number(inventoryRevisionRaw)
    if (!Number.isSafeInteger(inventoryRevision) || inventoryRevision < 1) {
      return {
        ok: false,
        error: 'inventory-revision=<n> is required (the revision shown)',
      }
    }
  }

  if ((mode === 'preview' || mode === 'confirm' || mode === 'cancel') && !authorityId) {
    return { ok: false, error: 'authority=<id> is required for this mode' }
  }

  return {
    ok: true,
    plan: {
      ...base,
      ...(supportAuthorizationRef ? { supportAuthorizationRef } : {}),
      ...(identityVerificationRef ? { identityVerificationRef } : {}),
      ...(requestedByUserId ? { requestedByUserId } : {}),
      ...(typedConfirmation ? { typedConfirmation } : {}),
      ...(inventoryRevisionRaw
        ? { inventoryRevision: Number(inventoryRevisionRaw) }
        : {}),
      ...(authorityId ? { authorityId } : {}),
      ...(reasonCode ? { reasonCode } : {}),
    },
  }
}
