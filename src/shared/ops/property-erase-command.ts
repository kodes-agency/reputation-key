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

const PROPERTY_ERASE_MODES = [
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

type PropertyEraseFlags = Readonly<{
  supportAuthorizationRef: string | undefined
  identityVerificationRef: string | undefined
  requestedByUserId: string | undefined
  typedConfirmation: string | undefined
  inventoryRevisionRaw: string | undefined
  authorityId: string | undefined
  reasonCode: string | undefined
}>

function readPropertyEraseFlags(args: OperatorArgs): PropertyEraseFlags {
  return {
    supportAuthorizationRef: flagValue(args, 'support-authorization'),
    identityVerificationRef: flagValue(args, 'identity-verification'),
    requestedByUserId: flagValue(args, 'requested-by'),
    typedConfirmation: flagValue(args, 'typed-confirmation'),
    inventoryRevisionRaw: flagValue(args, 'inventory-revision'),
    authorityId: flagValue(args, 'authority'),
    reasonCode: flagValue(args, 'reason-code'),
  }
}

/**
 * Both references are mandatory and must be independent: the support
 * authorization is what makes this support-MEDIATED rather than a tenant
 * self-service delete wearing an operator's name.
 */
function requestModeError(flags: PropertyEraseFlags): string | null {
  const { supportAuthorizationRef, identityVerificationRef } = flags
  if (!supportAuthorizationRef || !CONTENT_FREE_REF.test(supportAuthorizationRef)) {
    return 'support-authorization=<ref> is required and must be a content-free token'
  }
  if (!identityVerificationRef || !CONTENT_FREE_REF.test(identityVerificationRef)) {
    return 'identity-verification=<ref> is required and must be a content-free token'
  }
  if (supportAuthorizationRef === identityVerificationRef) {
    return 'support authorization must be independent of the requester identity verification'
  }
  if (!flags.requestedByUserId) {
    return 'requested-by=<user-id> is required (the AccountAdmin)'
  }
  return null
}

function confirmModeError(flags: PropertyEraseFlags): string | null {
  if (!flags.typedConfirmation) {
    return 'typed-confirmation="ERASE PROPERTY <property-id>" is required'
  }
  const inventoryRevision = Number(flags.inventoryRevisionRaw)
  if (!Number.isSafeInteger(inventoryRevision) || inventoryRevision < 1) {
    return 'inventory-revision=<n> is required (the revision shown)'
  }
  return null
}

/** What each mutating mode additionally requires. `null` means complete. */
function propertyEraseModeError(
  mode: PropertyEraseMode,
  flags: PropertyEraseFlags,
  dryRun: boolean,
): string | null {
  if (mode === 'request' && !dryRun) return requestModeError(flags)
  if (mode === 'confirm' && !dryRun) {
    const confirmError = confirmModeError(flags)
    if (confirmError) return confirmError
  }
  if (
    (mode === 'preview' || mode === 'confirm' || mode === 'cancel') &&
    !flags.authorityId
  ) {
    return 'authority=<id> is required for this mode'
  }
  return null
}

function propertyErasePlan(
  base: Readonly<{
    mode: PropertyEraseMode
    organizationId: string
    propertyId: string
    reportOnly: boolean
  }>,
  flags: PropertyEraseFlags,
): PropertyEraseCommandPlan {
  return {
    ...base,
    ...(flags.supportAuthorizationRef
      ? { supportAuthorizationRef: flags.supportAuthorizationRef }
      : {}),
    ...(flags.identityVerificationRef
      ? { identityVerificationRef: flags.identityVerificationRef }
      : {}),
    ...(flags.requestedByUserId ? { requestedByUserId: flags.requestedByUserId } : {}),
    ...(flags.typedConfirmation ? { typedConfirmation: flags.typedConfirmation } : {}),
    ...(flags.inventoryRevisionRaw
      ? { inventoryRevision: Number(flags.inventoryRevisionRaw) }
      : {}),
    ...(flags.authorityId ? { authorityId: flags.authorityId } : {}),
    ...(flags.reasonCode ? { reasonCode: flags.reasonCode } : {}),
  }
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

  const flags = readPropertyEraseFlags(args)
  const modeError = propertyEraseModeError(mode, flags, ctx.dryRun)
  if (modeError) return { ok: false, error: modeError }

  return {
    ok: true,
    plan: propertyErasePlan(
      {
        mode,
        organizationId: ctx.organizationId,
        propertyId: ctx.propertyId,
        reportOnly: ctx.dryRun,
      },
      flags,
    ),
  }
}
