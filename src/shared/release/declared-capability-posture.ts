// Declared capability posture (ADR 0032, amended 2026-09-29).
//
// WHY THIS EXISTS. A fresh database seeds every Google content capability
// denied and every merchant AI capability killed — the dark posture an
// operator lifts per environment. Nothing in production lifted it after the
// old activation script was deleted, so every closed-beta database reset
// silently broke "Connect Google" (`capability_killed`) and all AI until
// someone repaired the rows by hand.
//
// The environment now DECLARES which capabilities it runs, and the deploy step
// (scripts/migrate-deploy.ts, web's preDeployCommand) applies that right after
// migrations. It lifts ONLY an untouched seed default. A denial or kill an
// operator made is never overridden, whatever the declaration says: the
// declaration restores a reset database, it is not a second kill switch and
// never re-enables what a person stopped.
//
// This module is the pure half: parse the declaration, decide per capability,
// format the one deploy-log line. The store calls live in
// src/composition/declared-capability-posture.ts.

import {
  GOOGLE_CONTENT_CAPABILITIES,
  type GoogleContentCapability,
} from '#/shared/domain/google-content-capability'
import {
  CURRENT_MERCHANT_AI_CAPABILITIES,
  type MerchantAiCapability,
} from '#/shared/domain/merchant-ai-capability'

/** Recorded as the operator/actor of every change the posture makes. */
export const DECLARED_POSTURE_ACTOR = 'deploy:declared-posture'
/** Ticket reference on the AI control transition audit row. */
export const DECLARED_POSTURE_TICKET = 'declared-posture'
/** Reason on a lifted Google content control row. */
export const DECLARED_POSTURE_GOOGLE_REASON = 'declared_posture'
/** Reason code on an AI control transition (the ops:ai-control restore code). */
export const DECLARED_POSTURE_AI_REASON_CODE = 'operator_restore'

const DECLARE_ALL = '*'
const RELEASE_REVISION = /^[0-9a-f]{40}$/
/** Seed denials carry no operator, or a `migration:<n>` marker (0124). */
const MIGRATION_OPERATOR_PREFIX = 'migration:'
/**
 * ...and a default-deny reason: migration_default_deny,
 * organization_ownership_expand_default_deny,
 * reply_publication_provider_authority_default_deny. Requiring both keeps a
 * migration that denies on purpose, or a hand kill that left the operator
 * blank, out of reach of the declaration.
 */
const SEED_DENY_REASON = /_default_deny$/
/** Every AI capability head is seeded at generation 1. */
const AI_SEED_GENERATION = 1

export type DeclaredCapabilityPostureEnv = Readonly<{
  GOOGLE_CONTENT_CAPABILITIES_ALLOWED?: string
  AI_CAPABILITIES_ENABLED?: string
  RELEASE_SHA?: string
  IMAGE_SOURCE_REVISION?: string
}>

export type DeclaredCapabilityPosture = Readonly<{
  google: ReadonlyArray<GoogleContentCapability>
  ai: ReadonlyArray<MerchantAiCapability>
  /**
   * The revision the AI activation records for audit. The control function
   * refuses a capability activation without one; nothing compares it later.
   */
  candidateReleaseSha: string | null
}>

/** A declaration the deploy refuses to apply. The message names the fix. */
export class DeclaredCapabilityPostureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeclaredCapabilityPostureError'
  }
}

function parseDeclaredList<T extends string>(
  variable: string,
  raw: string | undefined,
  vocabulary: ReadonlyArray<T>,
): ReadonlyArray<T> {
  const entries = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  // Validated even next to `*`: a typo is a mistake the operator wants to hear
  // about, not one `*` should quietly absorb.
  const unknown = entries.find(
    (entry) => entry !== DECLARE_ALL && !vocabulary.some((known) => known === entry),
  )
  if (unknown !== undefined) {
    throw new DeclaredCapabilityPostureError(
      `${variable} names unknown capability "${unknown}". Use ${DECLARE_ALL} or a ` +
        `comma list of: ${vocabulary.join(', ')}.`,
    )
  }
  if (entries.includes(DECLARE_ALL)) return [...vocabulary]
  return vocabulary.filter((known) => entries.includes(known))
}

function concreteRevision(value: string | undefined): string | null {
  return value !== undefined && RELEASE_REVISION.test(value) ? value : null
}

/**
 * One reading of the declaration. Unset or blank declares nothing — the dark
 * posture stays, as it does everywhere these variables are not set. Throws
 * DeclaredCapabilityPostureError on an unknown capability name, so a typo
 * fails the deploy instead of silently leaving a capability dark.
 */
export function parseDeclaredCapabilityPosture(
  env: DeclaredCapabilityPostureEnv,
): DeclaredCapabilityPosture {
  const google = parseDeclaredList(
    'GOOGLE_CONTENT_CAPABILITIES_ALLOWED',
    env.GOOGLE_CONTENT_CAPABILITIES_ALLOWED,
    GOOGLE_CONTENT_CAPABILITIES,
  )
  const ai = parseDeclaredList(
    'AI_CAPABILITIES_ENABLED',
    env.AI_CAPABILITIES_ENABLED,
    CURRENT_MERCHANT_AI_CAPABILITIES,
  )
  const candidateReleaseSha =
    concreteRevision(env.RELEASE_SHA) ?? concreteRevision(env.IMAGE_SOURCE_REVISION)
  if (ai.length > 0 && candidateReleaseSha === null) {
    throw new DeclaredCapabilityPostureError(
      'AI_CAPABILITIES_ENABLED needs RELEASE_SHA (or the image-baked ' +
        'IMAGE_SOURCE_REVISION) to be the deployed 40-character revision: the AI ' +
        'control function records it on every capability activation.',
    )
  }
  return {
    google,
    ai,
    candidateReleaseSha: ai.length > 0 ? candidateReleaseSha : null,
  }
}

// ── Google content capabilities ──────────────────────────────────────────

export type GoogleCapabilityOutcome =
  'lifted' | 'already_allowed' | 'kept_operator_denied'

export type GoogleCapabilityControlSnapshot = Readonly<{
  denied: boolean
  operatorId: string | null
  reason: string | null
}>

/**
 * What the posture does to one declared Google content capability, given its
 * control row (undefined = no row, which the gate treats as killed).
 */
export function decideGoogleCapabilityPosture(
  control: GoogleCapabilityControlSnapshot | undefined,
): GoogleCapabilityOutcome {
  if (!control) return 'lifted'
  if (!control.denied) return 'already_allowed'
  const hasSeedOperator =
    control.operatorId === null ||
    control.operatorId.startsWith(MIGRATION_OPERATOR_PREFIX)
  const hasSeedReason = control.reason !== null && SEED_DENY_REASON.test(control.reason)
  return hasSeedOperator && hasSeedReason ? 'lifted' : 'kept_operator_denied'
}

// ── Merchant AI capabilities ─────────────────────────────────────────────

export type AiCapabilityOutcome =
  | 'enabled'
  | 'already_enabled'
  | 'kept_operator_killed'
  | 'skipped_plane_stopped'
  | 'skipped_head_absent'

export type AiControlHeadSnapshot = Readonly<{
  generation: number
  executionState: 'enabled' | 'killed'
  admissionState: 'accepting' | 'draining'
}>

export type AiCapabilityControlSnapshot = Readonly<{
  global: AiControlHeadSnapshot | undefined
  provider: AiControlHeadSnapshot | undefined
  capability: AiControlHeadSnapshot | undefined
}>

function isOpen(head: AiControlHeadSnapshot | undefined): boolean {
  return head?.executionState === 'enabled' && head.admissionState === 'accepting'
}

/**
 * What the posture does to one declared AI capability. Any head past the seed
 * generation that is not open was moved there by an operator (a kill or a
 * drain) and stays. A stopped global or provider plane is reported, not
 * forced: the control function refuses a capability activation under it. A
 * missing head is a seed defect and is reported as such.
 */
export function decideAiCapabilityPosture(
  heads: AiCapabilityControlSnapshot,
): AiCapabilityOutcome {
  if (!heads.capability) return 'skipped_head_absent'
  if (isOpen(heads.capability)) return 'already_enabled'
  if (heads.capability.generation > AI_SEED_GENERATION) return 'kept_operator_killed'
  if (!heads.global || !heads.provider) return 'skipped_head_absent'
  if (!isOpen(heads.global) || !isOpen(heads.provider)) return 'skipped_plane_stopped'
  return 'enabled'
}

// ── Deploy-log line ──────────────────────────────────────────────────────

export type DeclaredCapabilityPostureReport = Readonly<{
  google: ReadonlyArray<
    Readonly<{ capability: GoogleContentCapability; outcome: GoogleCapabilityOutcome }>
  >
  ai: ReadonlyArray<
    Readonly<{ capability: MerchantAiCapability; outcome: AiCapabilityOutcome }>
  >
}>

const GOOGLE_OUTCOMES: ReadonlyArray<GoogleCapabilityOutcome> = [
  'lifted',
  'already_allowed',
  'kept_operator_denied',
]
const AI_OUTCOMES: ReadonlyArray<AiCapabilityOutcome> = [
  'enabled',
  'already_enabled',
  'kept_operator_killed',
  'skipped_plane_stopped',
  'skipped_head_absent',
]

function groups<O extends string>(
  entries: ReadonlyArray<Readonly<{ capability: string; outcome: O }>>,
  outcomes: ReadonlyArray<O>,
): string {
  return outcomes
    .map(
      (outcome) =>
        `${outcome}=[${entries
          .filter((entry) => entry.outcome === outcome)
          .map((entry) => entry.capability)
          .join(',')}]`,
    )
    .join(' ')
}

/**
 * One deploy-log line: what was lifted, what was left and why. Capability
 * names only — never an operator identity or any other value.
 */
export function formatDeclaredCapabilityPostureReport(
  report: DeclaredCapabilityPostureReport,
): string {
  if (report.google.length === 0 && report.ai.length === 0) {
    return (
      '[declared-posture] nothing declared (GOOGLE_CONTENT_CAPABILITIES_ALLOWED and ' +
      'AI_CAPABILITIES_ENABLED unset); controls left as they are'
    )
  }
  const google =
    report.google.length === 0
      ? 'google not declared'
      : `google ${groups(report.google, GOOGLE_OUTCOMES)}`
  const ai =
    report.ai.length === 0 ? 'ai not declared' : `ai ${groups(report.ai, AI_OUTCOMES)}`
  return `[declared-posture] ${google}; ${ai}`
}
