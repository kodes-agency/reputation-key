// EntryPointCatalogue — BQC-2.1 / STD-P1-02 / SPEC-P0-03.
//
// The canonical action/resource assignment for every executable entry point
// in the system (ADR 0033, phase BQC-2 §2.1). This is production data:
// `system-execution-policy.ts` and `delayed-execution-gate.ts` read it and
// fail closed on an unknown entry point, so a missing row denies execution.
// Stale rows are inert. Delete the row of every entry point you delete.
//
// Row vocabulary:
//   kind          — server_function | route_ui | route_api | job | consumer |
//                   schedule | operator_command
//   action        — a Permission for user actions; a SystemAction for
//                   system/session/public/operator work
//   owner         — defining context or platform area
//                   state owner and one FND-03 disposition
//   registration  — registration owner and strongest proven reachability
//   capability    — the beta capability gate (ADR 0032); 'none' when ungated
//   resourceScope — organization | property | tenant_cross | none
//   principals    — user | system | operator | public
//   betaPosture   — derived from the authoritative capability sets
//                   (core / non_core / blocked) — never declared by hand
//   externalEffect— Google/GBP API, email, OAuth, external storage
//   canonicalOnly — true when the code has no mechanically checkable authz
//                   call, so the row is the canonical ASSIGNMENT that
//                   BQC-2.4 must wire into an ExecutionPolicy decision.
//                   Rows with extractable authz are verified against code.
//
// The narrative inventory lives in
// docs/archive/product-readiness-program-2026-07/beta-quality-remediation-2026-07/completion-program-2026-07/bqc2-action-resource-catalogue.md

import type { Capability } from '#/shared/auth/beta-capabilities'
import { isCoreCapability, isBlockedCapability } from '#/shared/auth/beta-capabilities'
import type { Permission } from '#/shared/domain/permissions'

// ── Types ───────────────────────────────────────────────────────────

export type EntryPointKind =
  | 'server_function'
  | 'route_ui'
  | 'route_api'
  | 'job'
  | 'consumer'
  | 'schedule'
  | 'operator_command'

export type PrincipalType = 'user' | 'system' | 'operator' | 'public'

/** What the authorization decision must scope to. */
export type ResourceScope =
  | 'organization'
  | 'property'
  | 'tenant_cross' // system work spanning tenants (sweeps)
  | 'none'

export type BetaPosture = 'core' | 'non_core' | 'blocked'

export type EntryPointOwner =
  | 'activity'
  | 'ai'
  | 'dashboard'
  | 'goal'
  | 'guest'
  | 'identity'
  | 'inbox'
  | 'integration'
  | 'metric'
  | 'notification'
  | 'portal'
  | 'property'
  | 'review'
  | 'staff'
  | 'operations'
  | 'shared'
  | 'web'
  | 'worker'

export type EntryPointRegistration = Readonly<{
  /** File that owns declaration/composition/registry registration. */
  ownerFile: string
  /** Strongest reachability claim this repository can currently prove. */
  reachability:
    'direct_declaration' | 'source_composed' | 'boot_registry' | 'declared_only'
}>

/**
 * Canonical actions for work that has no role Permission: session/identity
 * bootstrap, guest/public surface, machine ingress, UI rendering, delayed
 * system execution, and operator commands.
 */
export type SystemAction =
  // session / identity bootstrap
  | 'system:session.read'
  | 'system:session.mutate'
  | 'system:identity.register'
  | 'system:identity.sign_in'
  | 'system:identity.password_reset'
  | 'system:identity.accept_invitation'
  | 'system:identity.create_organization'
  | 'system:identity.auth_api'
  | 'system:identity.organization_lifecycle'
  | 'system:identity.organization_export'
  // guest / public surface (dark — portal.read gated)
  | 'system:guest.portal_read'
  | 'system:guest.rating'
  | 'system:guest.feedback'
  | 'system:guest.scan'
  | 'system:guest.click_track'
  | 'public:portal.response.submit'
  | 'public:portal.response.correct'
  | 'public:portal.response.start_new'
  | 'public:portal.response.text.submit'
  | 'public:portal.response.text.withdraw'
  | 'public:portal.google_review.select'
  | 'public:portal.secondary_link.select'
  | 'public:portal.response.withdraw'
  | 'public:portal.media.issue'
  | 'public:portal.media.confirm'
  | 'public:portal.read'
  | 'public:portal.analytics.record'
  | 'public:notification.email_unsubscribe'
  // machine ingress
  | 'system:integration.google_callback'
  | 'system:integration.gbp_webhook'
  // UI rendering (page-level; data gated by server functions)
  | 'system:ui.render'
  // delayed/system execution
  | 'system:health.check'
  | 'system:image.process'
  | 'system:image.cleanup'
  | 'system:portal.health_reconcile'
  | 'system:portal.destination_revalidate'
  | 'system:property.import'
  | 'system:property.import_v2'
  | 'system:review.sync'
  | 'system:review.refresh_sweep'
  | 'system:review.discovery_sweep'
  | 'system:review.purge'
  | 'system:review.reconcile'
  | 'system:reply.publish'
  | 'system:metric.refresh'
  | 'system:metric.record'
  | 'system:metric.record_guest_analytics'
  | 'system:metric.record_public_reputation'
  | 'system:metric.record_portal_workflow'
  | 'system:retention.sweep'
  | 'system:quarantine.ttl'
  | 'system:ai.execution_reap'
  | 'system:ai.review_analysis_enrollment_sweep'
  | 'system:permit.start_deadline_fence'
  | 'system:property.import_claim_reap'
  | 'system:goal.reconcile'
  | 'system:goal.spawn'
  | 'system:goal.progress'
  | 'system:goal.maintain'
  | 'system:activity.record'
  | 'system:notification.insert'
  | 'system:notification.insert_goal'
  | 'system:notification.insert_portal'
  | 'system:notification.insert_property_responsibility'
  | 'system:notification.email_urgent'
  | 'system:notification.email_digest'
  | 'system:notification.delivery_event'
  | 'system:notification.reconcile'
  | 'system:inbox.update'
  | 'system:inbox.project_guest_feedback'
  | 'system:ai.trend'
  | 'system:ai.trend_schedule'
  // operator commands
  | 'system:ops'

export type EntryPointAction = Permission | SystemAction

export type EntryPointRow = Readonly<{
  /** Stable id: `<kind>:<name>`. */
  id: string
  kind: EntryPointKind
  /** Export name (server fn), route path, job/schedule name, or command. */
  name: string
  /** Repo-relative file where the entry point is defined. */
  file: string
  /** Context or platform area that owns this executable boundary. */
  owner: EntryPointOwner
  /** Total read/write classification; every write path has an owner/disposition. */
  registration: EntryPointRegistration
  /** Canonical action for the ExecutionPolicy decision request. */
  action: EntryPointAction
  /** Additional permissions the code also asserts (kept exhaustive by the guard). */
  alsoActions?: ReadonlyArray<Permission>
  /** Capability gate; 'none' when the entry point is ungated. */
  capability: Capability | 'none'
  resourceScope: ResourceScope
  principals: ReadonlyArray<PrincipalType>
  /** Derived from capability sets via postureForCapability — never hand-set. */
  betaPosture: BetaPosture
  /** True when execution causes an external side effect (GBP, email, OAuth, S3). */
  externalEffect: boolean
  /** Purpose/consent class; 'none' until governed classes exist (BQC-2 §9). */
  purpose: string
  /** Consumer rows: event tags handled (guard pins to registration tables). */
  eventTags?: ReadonlyArray<string>
  /**
   * BQC-2.5: delayed-execution policy integration state. Required on
   * job/consumer/schedule rows: 'pending_bqc3' until BQC-3 integrates the
   * BQC-2.5 contract into the runtime call site for this entry point,
   * 'integrated_bqc3' once the BQC-3.2 dispatch gate authorizes it.
   * This field IS the record of delayed entry points awaiting BQC-3.
   */
  policyIntegration?: 'pending_bqc3' | 'integrated_bqc3'
  /** True when code carries no mechanically checkable authz — BQC-2.4 must wire. */
  canonicalOnly?: boolean
  notes?: string
}>

/** Beta posture derived from the authoritative capability sets (ADR 0032). */
function postureForCapability(cap: Capability | 'none'): BetaPosture {
  if (cap === 'none') return 'core'
  if (isBlockedCapability(cap)) return 'blocked'
  if (isCoreCapability(cap)) return 'core'
  return 'non_core'
}

// ── Row factories (records of functions — no classes) ───────────────

const CONTEXT_OWNER_RE = /^src\/contexts\/([a-z-]+)\//

function ownerForFile(file: string): EntryPointOwner {
  const context = CONTEXT_OWNER_RE.exec(file)?.[1]
  if (context) return context as EntryPointOwner
  if (file.startsWith('src/routes/')) return 'web'
  if (file === 'src/bootstrap.ts' || file.startsWith('src/worker/')) return 'worker'
  if (file === 'package.json' || file.startsWith('scripts/')) return 'operations'
  return 'shared'
}

function registrationForEntry(
  kind: EntryPointKind,
  file: string,
): EntryPointRegistration {
  if (kind === 'job') {
    return { ownerFile: 'src/bootstrap.ts', reachability: 'boot_registry' }
  }
  if (kind === 'schedule') {
    return { ownerFile: 'src/worker/index.ts', reachability: 'source_composed' }
  }
  if (kind === 'consumer') {
    const context = CONTEXT_OWNER_RE.exec(file)?.[1]
    return {
      ownerFile: context ? `src/contexts/${context}/build.ts` : file,
      reachability: context ? 'source_composed' : 'declared_only',
    }
  }
  return { ownerFile: file, reachability: 'direct_declaration' }
}

type RowOpts = Partial<
  Omit<EntryPointRow, 'id' | 'kind' | 'name' | 'file' | 'betaPosture'>
>

function row(
  kind: EntryPointKind,
  name: string,
  file: string,
  base: Readonly<{
    action: EntryPointAction
    capability: Capability | 'none'
    resourceScope: ResourceScope
    principals: ReadonlyArray<PrincipalType>
  }>,
  opts: RowOpts = {},
): EntryPointRow {
  const owner = opts.owner ?? ownerForFile(file)
  return {
    id: `${kind}:${name}`,
    kind,
    name,
    file,
    owner,
    registration: opts.registration ?? registrationForEntry(kind, file),
    action: base.action,
    capability: base.capability,
    resourceScope: base.resourceScope,
    principals: base.principals,
    betaPosture: postureForCapability(base.capability),
    externalEffect: false,
    purpose: 'none',
    ...opts,
  }
}

/** Server function factory, parameterized by principal. */
const sfFor =
  (principal: 'user' | 'public') =>
  (
    name: string,
    file: string,
    action: EntryPointAction,
    capability: Capability | 'none',
    resourceScope: ResourceScope,
    opts: RowOpts = {},
  ): EntryPointRow =>
    row(
      'server_function',
      name,
      file,
      { action, capability, resourceScope, principals: [principal] },
      opts,
    )

/** Server function (default: authenticated user principal). */
const sf = sfFor('user')

/** Public server function (unauthenticated principal). */
const sfPublic = sfFor('public')

/** UI route (default: authenticated user; override principals for public pages). */
const ui = (
  name: string,
  file: string,
  action: EntryPointAction,
  capability: Capability | 'none',
  resourceScope: ResourceScope,
  opts: RowOpts = {},
): EntryPointRow =>
  row(
    'route_ui',
    name,
    file,
    { action, capability, resourceScope, principals: ['user'] },
    opts,
  )

/** API endpoint (default: public reachability; auth mechanism in notes). */
const api = (
  name: string,
  file: string,
  action: EntryPointAction,
  capability: Capability | 'none',
  resourceScope: ResourceScope,
  opts: RowOpts = {},
): EntryPointRow =>
  row(
    'route_api',
    name,
    file,
    { action, capability, resourceScope, principals: ['public'] },
    opts,
  )

/** BullMQ job (system principal). */
const job = (
  name: string,
  file: string,
  action: EntryPointAction,
  capability: Capability | 'none',
  resourceScope: ResourceScope,
  opts: RowOpts = {},
): EntryPointRow =>
  row(
    'job',
    name,
    file,
    { action, capability, resourceScope, principals: ['system'] },
    { policyIntegration: 'integrated_bqc3', ...opts },
  )

/** Event consumer module (system principal); eventTags pinned by the guard. */
const consumer = (
  name: string,
  file: string,
  action: EntryPointAction,
  capability: Capability | 'none',
  resourceScope: ResourceScope,
  eventTags: ReadonlyArray<string>,
  opts: RowOpts = {},
): EntryPointRow =>
  row(
    'consumer',
    name,
    file,
    { action, capability, resourceScope, principals: ['system'] },
    { policyIntegration: 'integrated_bqc3', ...opts, eventTags },
  )

/** Recurring schedule registered in the worker (system principal). */
const schedule = (
  name: string,
  action: EntryPointAction,
  capability: Capability | 'none',
  resourceScope: ResourceScope,
  opts: RowOpts = {},
): EntryPointRow =>
  row(
    'schedule',
    name,
    'src/worker/index.ts',
    { action, capability, resourceScope, principals: ['system'] },
    { policyIntegration: 'integrated_bqc3', ...opts },
  )

/**
 * Operator command (operator principal; DIRECT-DB bypasses flagged in notes).
 *
 * `capability` defaults to 'none': containment and diagnostic commands
 * deliberately declare none so they keep working while the capability they
 * contain is killed or the org is suspended. A command that PERFORMS the gated
 * work (rather than containing it) passes its capability so the ExecutionPolicy
 * refuses it under the same kill switch the runtime honours.
 */
const ops = (
  name: string,
  file: string,
  resourceScope: ResourceScope,
  opts: RowOpts = {},
  capability: Capability | 'none' = 'none',
): EntryPointRow =>
  row(
    'operator_command',
    name,
    file,
    { action: 'system:ops', capability, resourceScope, principals: ['operator'] },
    opts,
  )

// ── The catalogue ───────────────────────────────────────────────────
// Rows are appended per area below. The guard test proves this list
// matches the mechanically discovered reality.

// Server-directory shortcuts for row definitions.
const IDENTITY = 'src/contexts/identity/server'
const PROPERTY = 'src/contexts/property/server'
const INTEGRATION = 'src/contexts/integration/server'
const REVIEW = 'src/contexts/review/server'
const INBOX = 'src/contexts/inbox/server'
const DASHBOARD = 'src/contexts/dashboard/server'
const NOTIFICATION = 'src/contexts/notification/server'
const ACTIVITY = 'src/contexts/activity/server'
const GOAL = 'src/contexts/goal/server'
const STAFF = 'src/contexts/staff/server'
const PORTAL = 'src/contexts/portal/server'
const GUEST = 'src/contexts/guest/server'
const AUTH_FUNCTIONS = 'src/shared/auth/auth.functions.ts'
const ROUTES = 'src/routes'
const AUTHED = 'src/routes/_authenticated'

const SERVER_FUNCTION_ROWS: ReadonlyArray<EntryPointRow> = [
  // ── identity ──────────────────────────────────────────────────────
  ...[
    sf(
      'listOutstandingResponsibilitiesHandler',
      `${IDENTITY}/organization-leave-fns.ts`,
      'identity.leave_org',
      'identity.invite',
      'organization',
      {
        notes:
          'LIF-01-T21 transfer-first leave. Gated by identity.leave_org; a sole AccountAdmin cannot leave, and outstanding responsibilities must transfer before the membership is removed',
      },
    ),
    sf(
      'listOutstandingResponsibilitiesFn',
      `${IDENTITY}/organization-leave-fns.ts`,
      'identity.leave_org',
      'identity.invite',
      'organization',
      {
        canonicalOnly: true,
        notes:
          'LIF-01-T21 transfer-first leave. Gated by identity.leave_org; a sole AccountAdmin cannot leave, and outstanding responsibilities must transfer before the membership is removed',
      },
    ),
    sf(
      'leaveOrganizationHandler',
      `${IDENTITY}/organization-leave-fns.ts`,
      'identity.leave_org',
      'identity.invite',
      'organization',
      {
        notes:
          'LIF-01-T21 transfer-first leave. Gated by identity.leave_org; a sole AccountAdmin cannot leave, and outstanding responsibilities must transfer before the membership is removed',
      },
    ),
    sf(
      'leaveOrganizationFn',
      `${IDENTITY}/organization-leave-fns.ts`,
      'identity.leave_org',
      'identity.invite',
      'organization',
      {
        canonicalOnly: true,
        notes:
          'LIF-01-T21 transfer-first leave. Gated by identity.leave_org; a sole AccountAdmin cannot leave, and outstanding responsibilities must transfer before the membership is removed',
      },
    ),
    sf(
      'submitBetaFeedbackHandler',
      `${IDENTITY}/beta-feedback.ts`,
      'feedback.respond',
      'portal.guest_response',
      'organization',
      {
        externalEffect: true,
        purpose: 'beta_product_feedback',
        notes:
          'Server-only implementation behind submitBetaFeedbackFn; resolves tenant authority through the central execution policy before applying the bounded feedback contract',
      },
    ),
    sf(
      'submitBetaFeedbackFn',
      `${IDENTITY}/beta-feedback.ts`,
      'feedback.respond',
      'portal.guest_response',
      'organization',
      {
        canonicalOnly: true,
        externalEffect: true,
        purpose: 'beta_product_feedback',
        notes:
          'AccountAdmin/PropertyManager only; strict text-only contract; actor + organization rate limits; sends scrubbed report to Sentry',
      },
    ),
    sf(
      'inviteMember',
      `${IDENTITY}/organizations.members.ts`,
      'invitation.create',
      'identity.invite',
      'organization',
      { externalEffect: true, notes: 'sends invitation email' },
    ),
    sf(
      'updateMemberRole',
      `${IDENTITY}/organizations.members.ts`,
      'member.update',
      'identity.invite',
      'organization',
      { notes: 'resets tenant cache' },
    ),
    sf(
      'removeMember',
      `${IDENTITY}/organizations.members.ts`,
      'member.delete',
      'identity.invite',
      'organization',
      { notes: 'resets tenant cache' },
    ),
    sf(
      'acceptInvitation',
      `${IDENTITY}/organizations.invitations.ts`,
      'system:identity.accept_invitation',
      'none',
      'none',
      { canonicalOnly: true, notes: 'session-only; invitee may have no org yet' },
    ),
    sf(
      'cancelInvitation',
      `${IDENTITY}/organizations.invitations.ts`,
      'invitation.cancel',
      'identity.invite',
      'organization',
    ),
    sf(
      'resendInvitation',
      `${IDENTITY}/organizations.invitations.ts`,
      'invitation.resend',
      'identity.invite',
      'organization',
      { externalEffect: true, notes: 'resends invitation email' },
    ),
    sf(
      'listInvitations',
      `${IDENTITY}/organizations.invitations.ts`,
      'invitation.list',
      'identity.invite',
      'organization',
    ),
    sfPublic(
      'registerMember',
      `${IDENTITY}/organizations.registration.ts`,
      'system:identity.register',
      'none',
      'none',
      {
        canonicalOnly: true,
        notes:
          'public; IP rate-limited; content-free pre-provider recovery fence + exact pending manager invitation acceptance; interrupted provider commits are durably resumed, safely compensated, or stopped for manual review',
      },
    ),
    sfPublic(
      'signInUser',
      `${IDENTITY}/organizations.registration.ts`,
      'system:identity.sign_in',
      'none',
      'none',
      { canonicalOnly: true, notes: 'public; IP rate-limited; sets session cookie' },
    ),
    sf(
      'setActiveOrganization',
      `${IDENTITY}/organizations.registration.ts`,
      'system:session.mutate',
      'none',
      'none',
      {
        canonicalOnly: true,
        notes:
          'session-only; may only reassert the exact active beta Organization binding',
      },
    ),
    sf(
      'listUserInvitations',
      `${IDENTITY}/organizations.registration.ts`,
      'system:session.read',
      'none',
      'none',
      { canonicalOnly: true, notes: 'session-only' },
    ),
    sf(
      'getActiveOrganization',
      `${IDENTITY}/organizations.query.ts`,
      'dashboard.read',
      'dashboard.use',
      'organization',
      { notes: 'tolerates no-active-org' },
    ),
    sf(
      'listMembers',
      `${IDENTITY}/organizations.query.ts`,
      'member.list',
      'identity.invite',
      'organization',
    ),
    sf(
      'listUserOrganizations',
      `${IDENTITY}/organizations.query.ts`,
      'system:session.read',
      'none',
      'none',
      { canonicalOnly: true, notes: 'implicit better-auth session; no explicit assert' },
    ),
    sf(
      'createCustomRole',
      `${IDENTITY}/organizations.roles.ts`,
      'member.update',
      'identity.custom_roles',
      'organization',
      { notes: 'beta-disabled capability; dormant use case also re-checks escalation' },
    ),
    sf(
      'updateCustomRole',
      `${IDENTITY}/organizations.roles.ts`,
      'member.update',
      'identity.custom_roles',
      'organization',
    ),
    sf(
      'deleteCustomRole',
      `${IDENTITY}/organizations.roles.ts`,
      'member.update',
      'identity.custom_roles',
      'organization',
    ),
    sf(
      'changePasswordFn',
      `${IDENTITY}/auth-settings.ts`,
      'identity.password.change',
      'identity.invite',
      'organization',
      { notes: 'better-auth delegation' },
    ),
    sf(
      'updateProfileFn',
      `${IDENTITY}/auth-settings.ts`,
      'identity.profile.update',
      'identity.invite',
      'organization',
      { notes: 'better-auth delegation' },
    ),
    sf(
      'updateUserImageFn',
      `${IDENTITY}/auth-settings.ts`,
      'identity.avatar.set',
      'identity.invite',
      'organization',
      { notes: 'better-auth delegation' },
    ),
    sf(
      'createOrganizationFn',
      `${IDENTITY}/auth-settings.org.ts`,
      'system:identity.create_organization',
      'organization.create',
      'organization',
      {
        notes:
          'self-service path is dormant in beta; permanently blocked organization.create capability',
      },
    ),
    sf(
      'updateOrganization',
      `${IDENTITY}/organizations.update.ts`,
      'organization.update',
      'identity.invite',
      'organization',
      { notes: 'policy-wired in BQC-2.4; use case re-checks role' },
    ),
    sf(
      'requestOrgLogoUpload',
      `${IDENTITY}/organizations.upload.ts`,
      'identity.logo_upload',
      'identity.invite',
      'organization',
      { externalEffect: true, notes: 'policy-wired in BQC-2.4; S3 presigned URL' },
    ),
    sf(
      'finalizeOrgLogoUpload',
      `${IDENTITY}/organizations.upload.ts`,
      'identity.logo_upload',
      'identity.invite',
      'organization',
      { externalEffect: true, notes: 'policy-wired in BQC-2.4; S3 verify + org update' },
    ),
    sf(
      'requestAvatarUpload',
      `${IDENTITY}/organizations.upload.ts`,
      'identity.avatar_upload',
      'identity.invite',
      'organization',
      { externalEffect: true, notes: 'policy-wired in BQC-2.4; S3 presigned URL' },
    ),
    sf(
      'finalizeAvatarUpload',
      `${IDENTITY}/organizations.upload.ts`,
      'identity.avatar_upload',
      'identity.invite',
      'organization',
      { externalEffect: true, notes: 'policy-wired in BQC-2.4; S3 verify' },
    ),
    // ── Property access administration (owner-only policy.admin gate) ──
    sf(
      'grantPropertyAccessFn',
      `${IDENTITY}/policy-admin.ts`,
      'policy.admin',
      'identity.invite',
      'property',
      { notes: 'grant with reason + ticket + optional expiry; membership required' },
    ),
    sf(
      'revokePropertyAccessFn',
      `${IDENTITY}/policy-admin.ts`,
      'policy.admin',
      'identity.invite',
      'property',
      { notes: 'revoke with reason' },
    ),
    sf(
      'explainPolicyDecisionFn',
      `${IDENTITY}/policy-admin.ts`,
      'policy.admin',
      'identity.invite',
      'organization',
      { notes: 'read-only decision diagnostic; no PII/secrets' },
    ),
    // ── Merchant AI authorization (private beta) ──
    sf(
      'getMerchantAiAuthorizationFn',
      `${IDENTITY}/merchant-ai.ts`,
      'ai.manage',
      'property.create',
      'property',
      {
        canonicalOnly: true,
        notes: 'shared helper enforces property-scoped ai.manage authorization',
      },
    ),
    sf(
      'enableMerchantAiFn',
      `${IDENTITY}/merchant-ai.ts`,
      'ai.manage',
      'property.create',
      'property',
      {
        canonicalOnly: true,
        notes:
          'shared helper enforces property-scoped ai.manage and step-up authorization',
      },
    ),
    sf(
      'changeMerchantAiCapabilitiesFn',
      `${IDENTITY}/merchant-ai.ts`,
      'ai.manage',
      'property.create',
      'property',
      {
        canonicalOnly: true,
        notes:
          'shared helper enforces property-scoped ai.manage and step-up authorization',
      },
    ),
    sf(
      'revokeMerchantAiFn',
      `${IDENTITY}/merchant-ai.ts`,
      'ai.manage',
      'property.create',
      'property',
      {
        canonicalOnly: true,
        notes:
          'shared helper enforces property-scoped ai.manage and step-up authorization',
      },
    ),
    sf(
      'generateReplySuggestionFn',
      'src/contexts/ai/server/reply-suggestion.ts',
      'ai.reply.generate',
      'ai.generate_reply',
      'property',
      {
        externalEffect: true,
        purpose: 'ai.generate_reply',
        notes: 'manager-only ephemeral reply suggestion; result is browser-held',
      },
    ),
    sf(
      'getPropertyAiTrendFn',
      'src/contexts/ai/server/property-trend.ts',
      'ai.trends.read',
      'ai.detect_trends',
      'property',
      {
        purpose: 'ai.detect_trends',
        notes: 'property-scoped read of a current persisted deterministic trend report',
      },
    ),
    sf(
      'getPropertyAiAggregatesFn',
      'src/contexts/ai/server/property-aggregates.ts',
      'dashboard.read',
      'dashboard.use',
      'property',
      {
        notes:
          'property-scoped read of the 30 local-day AI category and sentiment aggregate window; no analysis-read permission exists and ai.trends.read grants on the unrelated ai.detect_trends, so the review_analysis capability gate lives in the use case',
      },
    ),
  ],

  // ── property ──────────────────────────────────────────────────────
  ...[
    sf(
      'archivePropertyHandler',
      `${PROPERTY}/property-lifecycle.ts`,
      'property.archive',
      'property.create',
      'property',
      {},
    ),
    sf(
      'archiveProperty',
      `${PROPERTY}/property-lifecycle.ts`,
      'property.archive',
      'property.create',
      'property',
      {
        canonicalOnly: true,
      },
    ),
    sf(
      'restorePropertyHandler',
      `${PROPERTY}/property-lifecycle.ts`,
      'property.restore',
      'property.create',
      'property',
      {},
    ),
    sf(
      'restoreProperty',
      `${PROPERTY}/property-lifecycle.ts`,
      'property.restore',
      'property.create',
      'property',
      {
        canonicalOnly: true,
      },
    ),
    sf(
      'disconnectPropertyGoogleBindingHandler',
      `${PROPERTY}/property-lifecycle.ts`,
      'property.disconnect',
      'property.create',
      'property',
      {},
    ),
    sf(
      'disconnectPropertyGoogleBinding',
      `${PROPERTY}/property-lifecycle.ts`,
      'property.disconnect',
      'property.create',
      'property',
      {
        canonicalOnly: true,
      },
    ),
    sf(
      'createProperty',
      `${PROPERTY}/properties.ts`,
      'property.create',
      'property.create',
      'organization',
    ),
    sf(
      'updateProperty',
      `${PROPERTY}/properties.ts`,
      'property.update',
      'property.create',
      'property',
    ),
    sf(
      'listProperties',
      `${PROPERTY}/property-read.ts`,
      'property.read',
      'property.create',
      'organization',
      { notes: 'policy-wired in BQC-2.4; all authenticated roles may list' },
    ),
    sf(
      'getProperty',
      `${PROPERTY}/property-read.ts`,
      'property.read',
      'property.create',
      'property',
      { notes: 'policy-wired in BQC-2.4 with target propertyId' },
    ),
    sf(
      'listPropertyResponsibleManagers',
      `${PROPERTY}/property-responsible-managers.ts`,
      'property.read',
      'property.create',
      'property',
      { notes: 'scoped via authoritative propertyId' },
    ),
    sf(
      'updatePropertyResponsibleManagers',
      `${PROPERTY}/property-responsible-managers.ts`,
      'property.update',
      'property.create',
      'property',
      {
        notes:
          'role/access/participation eligibility and CAS revalidated in the use case',
      },
    ),
    sf(
      'deleteProperty',
      `${PROPERTY}/property-read.ts`,
      'property.delete',
      'property.erase',
      'property',
      {
        notes:
          'LIF-01 containment: blocked capability and server/use-case denial preserve stale-client compatibility without a destructive effect',
      },
    ),
  ],

  // ── integration ───────────────────────────────────────────────────
  ...[
    sf(
      'listGoogleConnections',
      `${INTEGRATION}/google-connections.ts`,
      'integration.manage',
      'integration.use',
      'organization',
    ),
    sf(
      'disconnectGoogle',
      `${INTEGRATION}/google-connections.ts`,
      'integration.manage',
      'integration.use',
      'organization',
      { externalEffect: true, notes: 'disconnects Google account (token revoke)' },
    ),
    sf(
      'updateConnectionVisibility',
      `${INTEGRATION}/google-connections.ts`,
      'integration.manage',
      'integration.use',
      'organization',
    ),
    sf(
      'getGoogleAuthUrl',
      `${INTEGRATION}/google-auth-url.ts`,
      'integration.manage',
      'integration.use',
      'organization',
      { externalEffect: true, notes: 'generates Google OAuth consent URL' },
    ),
    sf(
      'listImportAccounts',
      `${INTEGRATION}/gbp-import.ts`,
      'integration.manage',
      'property.import_gbp_v2',
      'organization',
      {
        externalEffect: true,
        notes: 'POST discovery read through admitted Google provider execution',
      },
    ),
    sf(
      'listImportCandidates',
      `${INTEGRATION}/gbp-import.ts`,
      'integration.manage',
      'property.import_gbp_v2',
      'organization',
      {
        externalEffect: true,
        notes: 'POST paged location discovery with opaque references',
      },
    ),
    sf(
      'renewImportAuthorizationLease',
      `${INTEGRATION}/gbp-import.ts`,
      'integration.manage',
      'property.import_gbp_v2',
      'organization',
      { notes: 'POST renewal of a bounded server-side authorization lease' },
    ),
    sf(
      'startPropertyImportV2',
      `${INTEGRATION}/gbp-import.ts`,
      'integration.manage',
      'property.import_gbp_v2',
      'organization',
      {
        externalEffect: true,
        notes: 'atomically commits identifier-only import intent and durable dispatch',
      },
    ),
    sf(
      'retryPropertyImportItem',
      `${INTEGRATION}/gbp-import.ts`,
      'integration.manage',
      'property.import_gbp_v2',
      'organization',
      {
        externalEffect: true,
        notes: 'atomically advances one retry revision and dispatches the new attempt',
      },
    ),
    sf(
      'cancelPropertyImportV2',
      `${INTEGRATION}/gbp-import.ts`,
      'integration.manage',
      'property.import_gbp_v2',
      'organization',
      {
        notes:
          'initiator-scoped, idempotent cancellation of every active child batch in one import saga',
      },
    ),
    sf(
      'recoverPropertyImportV2',
      `${INTEGRATION}/gbp-import.ts`,
      'integration.manage',
      'property.import_gbp_v2',
      'organization',
      { notes: 'request-id recovery after an ambiguous start response' },
    ),
    sf(
      'getPropertyImportV2Status',
      `${INTEGRATION}/gbp-import.ts`,
      'integration.manage',
      'property.import_gbp_v2',
      'organization',
      { notes: 'tenant and initiator scoped inert status read' },
    ),
    sf(
      'getPropertyGooglePerformance',
      `${INTEGRATION}/google-performance.ts`,
      'property.read',
      'property.read_gbp_performance',
      'property',
      {
        externalEffect: true,
        canonicalOnly: true,
        notes:
          'volatile no-store Google Performance read through fresh policy, approval, permit, and provider authorization',
      },
    ),
    sf(
      'renewPropertyGooglePerformanceLease',
      `${INTEGRATION}/google-performance.ts`,
      'property.read',
      'property.read_gbp_performance',
      'property',
      {
        canonicalOnly: true,
        notes:
          'renews only the bounded volatile Performance authorization lease after a fresh authorization recheck',
      },
    ),
  ],

  // ── review ────────────────────────────────────────────────────────
  ...[
    sf(
      'draftReplyFn',
      `${REVIEW}/reply-draft.ts`,
      'reply.manage',
      'property.publish_reply',
      'property',
      { notes: 'scoped via reviewId' },
    ),
    sf(
      'submitReplyFn',
      `${REVIEW}/reply-draft.ts`,
      'reply.manage',
      'property.publish_reply',
      'property',
      { externalEffect: true, notes: 'enqueues GBP publish job' },
    ),
    sf(
      'approveReplyFn',
      `${REVIEW}/reply-draft.ts`,
      'reply.manage',
      'property.publish_reply',
      'property',
      { externalEffect: true, notes: 'enqueues GBP publish job' },
    ),
    sf(
      'editPublishedReplyFn',
      `${REVIEW}/reply-draft.ts`,
      'reply.manage',
      'property.publish_reply',
      'property',
      {
        externalEffect: true,
        notes: 'edit-and-republish (published → approved) — enqueues GBP upsert',
      },
    ),
    sf(
      'getReplyFn',
      `${REVIEW}/reply-read.ts`,
      'reply.manage',
      'property.publish_reply',
      'property',
      { notes: 'scoped via replyId' },
    ),
    sf(
      'rejectReplyFn',
      `${REVIEW}/reply.ts`,
      'reply.manage',
      'property.publish_reply',
      'property',
      { notes: 'scoped via replyId' },
    ),
    sf(
      'deleteReplyFn',
      `${REVIEW}/reply.ts`,
      'reply.manage',
      'property.publish_reply',
      'property',
      { notes: 'scoped via replyId' },
    ),
    sf(
      'retryPublishFn',
      `${REVIEW}/reply.ts`,
      'reply.manage',
      'property.publish_reply',
      'property',
      { externalEffect: true, notes: 're-enqueues GBP publish job' },
    ),
  ],

  // ── inbox ─────────────────────────────────────────────────────────
  ...[
    sf(
      'getInboxItemsFn',
      `${INBOX}/inbox-queries.ts`,
      'inbox.read',
      'inbox.use',
      'property',
    ),
    sf(
      'getLastVisitCountFn',
      `${INBOX}/inbox-queries.ts`,
      'inbox.read',
      'inbox.use',
      'organization',
    ),
    sf(
      'stampLastInboxViewFn',
      `${INBOX}/inbox-queries.ts`,
      'inbox.read',
      'inbox.use',
      'organization',
      { notes: 'write gated by read permission' },
    ),
    sf(
      'getInboxFolderCountsFn',
      `${INBOX}/inbox-queries.ts`,
      'inbox.read',
      'inbox.use',
      'organization',
    ),
    sf(
      'getInboxItemDetailFn',
      `${INBOX}/inbox-item-queries.ts`,
      'inbox.read',
      'inbox.use',
      'property',
      { notes: 'scoped via inboxItemId' },
    ),
    sf(
      'getResponseTargetPolicySettingsFn',
      `${INBOX}/inbox-response-targets.ts`,
      'organization.update',
      'identity.invite',
      'organization',
      {
        notes:
          'AccountAdmin-only current policy/version read for compare-and-set Organization and optional Property settings',
      },
    ),
    sf(
      'getPrivateFeedbackTargetAnalyticsFn',
      `${INBOX}/inbox-response-targets.ts`,
      'inbox.read',
      'inbox.use',
      'organization',
      {
        alsoActions: ['feedback.read'],
        notes:
          'intersects the caller current private-feedback Property scope; only measured, non-withdrawn target cycles contribute',
      },
    ),
    sf(
      'getGoogleReviewTargetAnalyticsFn',
      `${INBOX}/inbox-response-targets.ts`,
      'inbox.read',
      'inbox.use',
      'organization',
      {
        alsoActions: ['review.read'],
        notes:
          'intersects the caller current Google-review Property scope; only measured target cycles contribute',
      },
    ),
    sf(
      'setResponseTargetPolicyFn',
      `${INBOX}/inbox-response-targets.ts`,
      'organization.update',
      'identity.invite',
      'organization',
      {
        notes:
          'version-fenced Organization target or Private Feedback Property override; commits an identifier-only policy-changed fact',
      },
    ),
    sf(
      'getInboxNotesFn',
      `${INBOX}/inbox-item-queries.ts`,
      'inbox.read',
      'inbox.use',
      'property',
      { notes: 'scoped via inboxItemId' },
    ),
    sf(
      'getInboxItemHistoryFn',
      `${INBOX}/inbox-item-queries.ts`,
      'inbox.read',
      'inbox.use',
      'property',
      {
        notes:
          'IBX-01-T5 complete handling record: cycles, assignments and escalations for one Inbox Item, scoped via inboxItemId; manager-internal note text additionally requires inbox.write and feedback.handle',
      },
    ),
    sf(
      'assignInboxItemFn',
      `${INBOX}/inbox-item-actions.ts`,
      'inbox.write',
      'inbox.use',
      'property',
      { notes: 'scoped via inboxItemId' },
    ),
    sf(
      'bulkAssignInboxItemsFn',
      `${INBOX}/inbox-item-actions.ts`,
      'inbox.write',
      'inbox.use',
      'property',
      {
        alsoActions: ['inbox.manage'],
        notes:
          'bounded all-or-nothing assignment/reassignment/release; scoped via inboxItemIds and transactionally reauthorizes every actor/assignee/property/source tuple',
      },
    ),
    sf(
      'addInboxNoteFn',
      `${INBOX}/inbox-item-actions.ts`,
      'inbox.write',
      'inbox.use',
      'property',
      { notes: 'scoped via inboxItemId' },
    ),
    sf(
      'markFeedbackHandledFn',
      `${INBOX}/inbox-feedback-handling.ts`,
      'inbox.write',
      'inbox.use',
      'property',
      {
        alsoActions: ['feedback.handle'],
        notes:
          'private-feedback source only; exact Property authority and revision/cycle/source/state fences are rechecked transactionally',
      },
    ),
    sf(
      'correctFeedbackHandlingOutcomeFn',
      `${INBOX}/inbox-feedback-handling.ts`,
      'inbox.write',
      'inbox.use',
      'property',
      {
        alsoActions: ['feedback.handle'],
        notes:
          'append-only private-feedback outcome correction; exact Property authority and prior-outcome revision are rechecked transactionally',
      },
    ),
    sf(
      'updateInboxStatusFn',
      `${INBOX}/inbox-status.ts`,
      'inbox.write',
      'inbox.use',
      'property',
      { notes: 'scoped via inboxItemId' },
    ),
    sf(
      'bulkUpdateInboxStatusFn',
      `${INBOX}/inbox-status.ts`,
      'inbox.write',
      'inbox.use',
      'property',
      { notes: 'scoped via inboxItemIds' },
    ),
    sf(
      'escalateInboxItemFn',
      `${INBOX}/inbox-status.ts`,
      'inbox.write',
      'inbox.use',
      'property',
      { notes: 'scoped via inboxItemId' },
    ),
    sf(
      'resolveEscalationFn',
      `${INBOX}/inbox-status.ts`,
      'inbox.write',
      'inbox.use',
      'property',
      { notes: 'scoped via inboxItemId' },
    ),
  ],

  // ── dashboard ─────────────────────────────────────────────────────
  ...[
    sf(
      'getDashboardDataFn',
      `${DASHBOARD}/dashboard.ts`,
      'dashboard.read',
      'dashboard.use',
      'property',
      { notes: 'property-access check; reply fields zeroed for Staff' },
    ),
    sf(
      'getPropertyOverviewFn',
      `${DASHBOARD}/dashboard.ts`,
      'dashboard.read',
      'dashboard.use',
      'property',
      {
        alsoActions: ['dashboard.fleet_read'],
        notes: 'shared KPI snapshot for Property dashboard and attention',
      },
    ),
    sf(
      'getFleetOverviewFn',
      `${DASHBOARD}/fleet-overview.ts`,
      'dashboard.read',
      'dashboard.use',
      'organization',
      {
        alsoActions: ['dashboard.fleet_read'],
        notes: 'role-aware property enumeration server-side',
      },
    ),
    sf(
      'getSetupChecklistFn',
      `${DASHBOARD}/setup-checklist.ts`,
      'dashboard.read',
      'dashboard.use',
      'organization',
      {
        alsoActions: ['dashboard.fleet_read'],
        notes:
          'role-aware exact Property scope; content-free monotonic setup milestones only',
      },
    ),
    sf(
      'getPortalAnalyticsFn',
      `${DASHBOARD}/portal-analytics.ts`,
      'dashboard.read',
      'dashboard.use',
      'property',
      { notes: '+ isPropertyAccessibleForPermission check (D6-001)' },
    ),
  ],

  // ── notification ──────────────────────────────────────────────────
  ...[
    sf(
      'getNotificationsFn',
      `${NOTIFICATION}/notifications.ts`,
      'notification.read',
      'notification.in_app',
      'organization',
      { notes: 'tolerates no-active-org' },
    ),
    sf(
      'getNotificationFeedHeadFn',
      `${NOTIFICATION}/notifications.ts`,
      'notification.read',
      'notification.in_app',
      'organization',
      {
        notes:
          'snapshot-consistent offset-zero page + exact unread count + shared watermark; tolerates no-active-org',
      },
    ),
    sf(
      'markNotificationReadFn',
      `${NOTIFICATION}/notifications.ts`,
      'notification.update',
      'notification.in_app',
      'organization',
    ),
    sf(
      'markNotificationUnreadFn',
      `${NOTIFICATION}/notifications.ts`,
      'notification.update',
      'notification.in_app',
      'organization',
      { notes: 'inverse of markRead; no-op when the ADR 0046 r.2 unread key is taken' },
    ),
    sf(
      'markAllNotificationsReadFn',
      `${NOTIFICATION}/notifications.ts`,
      'notification.update',
      'notification.in_app',
      'organization',
    ),
    sf(
      'dismissAllNotificationsFn',
      `${NOTIFICATION}/notifications.ts`,
      'notification.update',
      'notification.in_app',
      'organization',
    ),
    sf(
      'dismissNotificationFn',
      `${NOTIFICATION}/notifications.ts`,
      'notification.update',
      'notification.in_app',
      'organization',
    ),
    sf(
      'getNotificationPreferencesFn',
      `${NOTIFICATION}/notifications.ts`,
      'notification.read',
      'notification.in_app',
      'organization',
      { notes: 'notification preferences settings route' },
    ),
    sf(
      'updateNotificationPreferenceFn',
      `${NOTIFICATION}/notifications.ts`,
      'notification.update',
      'notification.in_app',
      'organization',
      { notes: 'notification preferences settings route' },
    ),
    sf(
      'muteNotificationCategoryFn',
      `${NOTIFICATION}/notifications.ts`,
      'notification.update',
      'notification.in_app',
      'organization',
      { notes: 'notification-row action; mutes only the selected in-app category' },
    ),
    sf(
      'getNotificationUserSettingsFn',
      `${NOTIFICATION}/notifications.ts`,
      'notification.read',
      'notification.in_app',
      'organization',
      { notes: 'durable user locale, timezone, quiet-hour, and cadence settings' },
    ),
    sf(
      'updateNotificationUserSettingsFn',
      `${NOTIFICATION}/notifications.ts`,
      'notification.update',
      'notification.in_app',
      'organization',
      { notes: 'durable user locale, timezone, quiet-hour, and cadence settings' },
    ),
  ],

  // ── activity ──────────────────────────────────────────────────────
  ...[
    sf(
      'getActivityTimelineFn',
      `${ACTIVITY}/activity.ts`,
      'inbox.read',
      'inbox.use',
      'organization',
      {
        notes:
          'activity surface gated via inbox.read → inbox.use today; remap to activity.use in BQC-2.4',
      },
    ),
    sf(
      'listRecentActivityFn',
      `${ACTIVITY}/activity.ts`,
      'inbox.read',
      'inbox.use',
      'property',
      {
        notes:
          'activity surface gated via inbox.read → inbox.use today; remap to activity.use in BQC-2.4',
      },
    ),
    sf(
      'listOperationalActionHistoryFn',
      `${ACTIVITY}/activity.ts`,
      'policy.admin',
      'identity.invite',
      'organization',
      {
        notes:
          'Current AccountAdmin authority is revalidated inside the Activity application seam; the context build remains default-deny until Identity composition injects that authority.',
      },
    ),
    sf(
      'exportOperationalActionHistoryFn',
      `${ACTIVITY}/activity.ts`,
      'policy.admin',
      'identity.invite',
      'organization',
      {
        notes:
          'Current AccountAdmin authority is revalidated inside the Activity application seam; the context build remains default-deny until Identity composition injects that authority.',
      },
    ),
  ],

  // ── goal (dark) ───────────────────────────────────────────────────
  ...[
    sf(
      'createGoalProgram',
      `${GOAL}/goal-programs.ts`,
      'goal.create',
      'goal.use',
      'property',
      {
        canonicalOnly: true,
        notes:
          'canonical beta Goal Program writer; policy is injected through the application service',
      },
    ),
    sf(
      'reviseGoalProgram',
      `${GOAL}/goal-programs.ts`,
      'goal.update',
      'goal.use',
      'property',
      {
        canonicalOnly: true,
        notes:
          'canonical next-full-month revision; policy is injected through the application service',
      },
    ),
    sf(
      'changeGoalProgramAssignments',
      `${GOAL}/goal-programs.ts`,
      'goal.update',
      'goal.use',
      'property',
      {
        canonicalOnly: true,
        notes:
          'point-in-time Goal Program assignment replacement; the application service reauthorizes every selected Property before the command store commits the new assignment revision',
      },
    ),
    sf(
      'changeGoalProgramStatus',
      `${GOAL}/goal-programs.ts`,
      'goal.update',
      'goal.use',
      'property',
      {
        canonicalOnly: true,
        alsoActions: ['goal.cancel'],
        notes:
          'canonical Goal Program lifecycle transition; end requests assert goal.update here and goal.cancel inside the service',
      },
    ),
    sf(
      'getGoalProgram',
      `${GOAL}/goal-programs.ts`,
      'goal.read',
      'goal.use',
      'property',
      {
        canonicalOnly: true,
        notes: 'canonical Goal Program aggregate read',
      },
    ),
    sf(
      'listGoalPrograms',
      `${GOAL}/goal-programs.ts`,
      'goal.read',
      'goal.use',
      'property',
      {
        canonicalOnly: true,
        notes: 'canonical Property-scoped Goal Program aggregate list',
      },
    ),
  ],

  // ── staff ─────────────────────────────────────────────────────────
  ...[
    sf(
      'createStaffParticipation',
      `${STAFF}/staff-participations.ts`,
      'staff.manage',
      'staff.use',
      'property',
    ),
    sf(
      'listStaffParticipations',
      `${STAFF}/staff-participations.ts`,
      'staff.read',
      'staff.use',
      'property',
    ),
    sf(
      'archiveStaffParticipation',
      `${STAFF}/staff-participations.ts`,
      'staff.manage',
      'staff.use',
      'property',
      { notes: 'scoped through staffParticipationId' },
    ),
    sf(
      'updatePortalResponsibilities',
      `${STAFF}/staff-participations.ts`,
      'staff.manage',
      'staff.use',
      'property',
      { notes: 'scoped through staffParticipationId and portal ownership' },
    ),
  ],

  // ── portal management and guest publication ──────────────────────
  ...[
    sf(
      'createPortal',
      `${PORTAL}/portals.ts`,
      'portal.create',
      'portal.write',
      'property',
    ),
    sf(
      'updatePortal',
      `${PORTAL}/portals.ts`,
      'portal.update',
      'portal.write',
      'property',
      {
        notes:
          'scoped via portalId; publish, archive, and restore commit a dedicated content-minimal semantic fact with state and any immutable publication mutation',
      },
    ),
    sf(
      'rollbackPortalPublication',
      `${PORTAL}/portals.ts`,
      'portal.update',
      'portal.write',
      'property',
      {
        notes:
          'appends a new activation for an earlier immutable snapshot and co-commits the exact target version/digest rollback fact; scoped via portalId',
      },
    ),
    sf(
      'completeContentReview',
      `${PORTAL}/portals.ts`,
      'portal.update',
      'portal.write',
      'property',
      { notes: 'scoped via authoritative portalId before recording workflow facts' },
    ),
    sf('listPortals', `${PORTAL}/portals.ts`, 'portal.read', 'portal.read', 'property'),
    sf(
      'listPortalResponsibleManagers',
      `${PORTAL}/portal-responsible-managers.ts`,
      'portal.read',
      'portal.read',
      'property',
      { notes: 'scoped via authoritative portalId' },
    ),
    sf(
      'updatePortalResponsibleManagers',
      `${PORTAL}/portal-responsible-managers.ts`,
      'portal.update',
      'portal.write',
      'property',
      {
        notes:
          'scoped via authoritative portalId; role/access/participation eligibility and CAS revalidated in the use case',
      },
    ),
    sf('getPortal', `${PORTAL}/portals.ts`, 'portal.read', 'portal.read', 'property', {
      notes: 'scoped via portalId',
    }),
    sf(
      'getPortalPublicationHistory',
      `${PORTAL}/portals.ts`,
      'portal.read',
      'portal.read',
      'property',
      {
        notes:
          'scoped via authoritative portalId; read model queries the exact organization/property/portal tuple',
      },
    ),
    sf(
      'getPropertyPortalExperience',
      `${PORTAL}/portals.ts`,
      'portal.read',
      'portal.read',
      'property',
      { notes: 'Property scope is resolved from the requested Property id' },
    ),
    sf(
      'savePropertyPortalBrandProfile',
      `${PORTAL}/portals.ts`,
      'portal.update',
      'portal.write',
      'property',
      {
        notes:
          'serializes the Property publication source and atomically records pending publication state plus an identifier-only version fact',
      },
    ),
    sf(
      'savePropertyPortalBrandContent',
      `${PORTAL}/portals.ts`,
      'portal.update',
      'portal.write',
      'property',
      {
        notes:
          'serializes localized Property content and atomically records pending publication state plus an identifier-only locale/version fact',
      },
    ),
    sf(
      'savePortalLocalizedOverride',
      `${PORTAL}/portals.ts`,
      'portal.update',
      'portal.write',
      'property',
      {
        notes:
          'locks the exact Portal working copy and atomically records pending publication state plus an identifier-only locale/version fact',
      },
    ),
    sf(
      'listPortalApprovedDestinations',
      `${PORTAL}/portals.ts`,
      'portal.read',
      'portal.read',
      'property',
      {
        notes:
          'scoped via authoritative Portal id; returns manager-only Property destination state',
      },
    ),
    sf(
      'requestPortalApprovedDestination',
      `${PORTAL}/portals.ts`,
      'portal.update',
      'portal.write',
      'property',
      {
        externalEffect: true,
        notes:
          'scoped via authoritative Portal id; every DNS answer and pinned redirect hop is validated before the atomic Property registry write/fact',
      },
    ),
    sf(
      'approvePortalApprovedDestination',
      `${PORTAL}/portals.ts`,
      'portal.update',
      'portal.write',
      'property',
      {
        externalEffect: true,
        notes:
          'AccountAdmin-only approval; network policy is revalidated before the atomic approval/pending/fact transaction',
      },
    ),
    sf(
      'disablePortalApprovedDestination',
      `${PORTAL}/portals.ts`,
      'portal.update',
      'portal.write',
      'property',
      {
        notes:
          'AccountAdmin-only terminal disable; serializes with publication and records pending state plus identifier-only fact',
      },
    ),
    sf(
      'deletePortal',
      `${PORTAL}/portals.ts`,
      'portal.delete',
      'portal.write',
      'property',
      { notes: 'soft-delete via use case; scoped via portalId' },
    ),
    sf(
      'issuePortalToken',
      `${PORTAL}/portals.ts`,
      'portal.update',
      'portal.write',
      'property',
      { notes: 'issues a one-time public capability URL; scoped via portalId' },
    ),
    sf(
      'rotatePortalToken',
      `${PORTAL}/portals.ts`,
      'portal.update',
      'portal.write',
      'property',
      { notes: 'rotates the public capability token; scoped via portalId' },
    ),
    sf(
      'revokePortalTokens',
      `${PORTAL}/portals.ts`,
      'portal.update',
      'portal.write',
      'property',
      { notes: 'revokes every active token; scoped via portalId' },
    ),
    sf(
      'createPortalGroup',
      `${PORTAL}/portal-groups.ts`,
      'portal.create',
      'portal.write',
      'property',
    ),
    sf(
      'updatePortalGroup',
      `${PORTAL}/portal-groups.ts`,
      'portal.update',
      'portal.write',
      'property',
      { notes: 'scoped via groupId' },
    ),
    sf(
      'listPortalGroups',
      `${PORTAL}/portal-groups.ts`,
      'portal.read',
      'portal.read',
      'property',
    ),
    sf(
      'getPortalGroup',
      `${PORTAL}/portal-groups.ts`,
      'portal.read',
      'portal.read',
      'property',
      { notes: 'scoped via groupId' },
    ),
    sf(
      'softDeletePortalGroup',
      `${PORTAL}/portal-groups.ts`,
      'portal.delete',
      'portal.write',
      'property',
      { notes: 'scoped via groupId' },
    ),
    sf(
      'addPortalToGroup',
      `${PORTAL}/portal-groups.ts`,
      'portal.update',
      'portal.write',
      'property',
      {
        canonicalOnly: true,
        notes: 'helper authorizes matching group and Portal resources before mutation',
      },
    ),
    sf(
      'removePortalFromGroup',
      `${PORTAL}/portal-groups.ts`,
      'portal.update',
      'portal.write',
      'property',
      {
        canonicalOnly: true,
        notes: 'helper authorizes matching group and Portal resources before mutation',
      },
    ),
    sf(
      'createLink',
      `${PORTAL}/portal-links.ts`,
      'portal.create',
      'portal.write',
      'property',
    ),
    sf(
      'updateLink',
      `${PORTAL}/portal-links.ts`,
      'portal.update',
      'portal.write',
      'property',
    ),
    sf(
      'deleteLink',
      `${PORTAL}/portal-links.ts`,
      'portal.delete',
      'portal.write',
      'property',
    ),
    sf(
      'reorderLinks',
      `${PORTAL}/portal-links.ts`,
      'portal.update',
      'portal.write',
      'property',
    ),
    sf(
      'listPortalLinks',
      `${PORTAL}/portal-links.ts`,
      'portal.read',
      'portal.read',
      'property',
    ),
    sf(
      'createLinkCategory',
      `${PORTAL}/portal-link-categories.ts`,
      'portal.create',
      'portal.write',
      'property',
    ),
    sf(
      'updateLinkCategory',
      `${PORTAL}/portal-link-categories.ts`,
      'portal.update',
      'portal.write',
      'property',
    ),
    sf(
      'deleteLinkCategory',
      `${PORTAL}/portal-link-categories.ts`,
      'portal.delete',
      'portal.write',
      'property',
    ),
    sf(
      'reorderCategories',
      `${PORTAL}/portal-link-categories.ts`,
      'portal.update',
      'portal.write',
      'property',
    ),
  ],

  // ── guest (public; dark) ──────────────────────────────────────────
  ...[
    sfPublic(
      'submitGuestResponseFn',
      `${GUEST}/public.ts`,
      'public:portal.response.submit',
      'portal.guest_response',
      'property',
      {
        canonicalOnly: true,
        notes:
          'opaque token + signed portal-scoped session + CSRF; free text additionally checks portal.guest_text',
      },
    ),
    sfPublic(
      'correctGuestResponseFn',
      `${GUEST}/public.ts`,
      'public:portal.response.correct',
      'portal.guest_response',
      'property',
      {
        canonicalOnly: true,
        notes: 'same signed session; exactly one correction inside one hour',
      },
    ),
    sfPublic(
      'startNewGuestResponseFn',
      `${GUEST}/public.ts`,
      'public:portal.response.start_new',
      'portal.guest_response',
      'property',
      {
        canonicalOnly: true,
        notes:
          'signed rated session only; rotates shared-device recovery identity without mutating the earlier response',
      },
    ),
    sfPublic(
      'submitPrivateFeedbackFn',
      `${GUEST}/public.ts`,
      'public:portal.response.text.submit',
      'portal.guest_text',
      'property',
      {
        canonicalOnly: true,
        notes:
          'signed rated session; eligibility uses the Portal threshold captured at rating submission',
      },
    ),
    sfPublic(
      'withdrawPrivateFeedbackFn',
      `${GUEST}/public.ts`,
      'public:portal.response.text.withdraw',
      'portal.guest_text',
      'property',
      {
        canonicalOnly: true,
        notes:
          'signed rated session; purges private text within 24 hours while preserving the private rating',
      },
    ),
    sfPublic(
      'selectGoogleReviewFn',
      `${GUEST}/public.ts`,
      'public:portal.google_review.select',
      'portal.public_read',
      'property',
      {
        canonicalOnly: true,
        externalEffect: true,
        notes:
          'signed rated session; records core selection analytics and returns the Property-owned Google URI',
      },
    ),
    sfPublic(
      'selectSecondaryLinkFn',
      `${GUEST}/public.ts`,
      'public:portal.secondary_link.select',
      'portal.public_read',
      'property',
      {
        canonicalOnly: true,
        externalEffect: true,
        notes:
          'signed rated session; explicit mutation records the first session/destination action and returns the approved URL',
      },
    ),
    sfPublic(
      'withdrawGuestResponseFn',
      `${GUEST}/public.ts`,
      'public:portal.response.withdraw',
      'portal.guest_response',
      'property',
      {
        canonicalOnly: true,
        notes: 'terminal anonymization and durable media purge scheduling',
      },
    ),
    sf(
      'moderateGuestResponseFn',
      `${GUEST}/public.ts`,
      'feedback.respond',
      'portal.write',
      'property',
      {
        notes:
          'manager quarantine/delete; tenant and property scoped. Gated on portal.write, NOT portal.guest_response: staff moderation must be enableable independently of guest collection.',
      },
    ),
    sfPublic(
      'recordScanFn',
      `${GUEST}/guest-scans.ts`,
      'public:portal.analytics.record',
      'portal.public_read',
      'property',
      {
        canonicalOnly: true,
        notes:
          'core portal visit analytics; signed-session dedupe and layered rate limits required',
      },
    ),
    sfPublic(
      'getPublicPortal',
      `${GUEST}/guest-scans.ts`,
      'public:portal.read',
      'portal.public_read',
      'property',
      {
        canonicalOnly: true,
        notes: 'opaque-token public portal read; policy enforced by Portal resolver',
      },
    ),
    sfPublic(
      'resolvePublicPortalLink',
      `${GUEST}/guest-scans.ts`,
      'public:portal.read',
      'portal.public_read',
      'property',
      {
        canonicalOnly: true,
        notes:
          'navigation-only no-JavaScript/failure fallback; opaque token resolves through Portal public policy and GET never records analytics',
      },
    ),
  ],

  // ── shared browser observability ──────────────────────────────────
  ...[
    sfPublic(
      'getBrowserObservabilityConfigFn',
      'src/shared/observability/browser-observability.server.ts',
      'system:ui.render',
      'none',
      'none',
      {
        canonicalOnly: true,
        notes:
          'public runtime metadata for browser error monitoring; the DSN is a client-safe ingest address',
      },
    ),
  ],

  // ── shared auth functions ─────────────────────────────────────────
  ...[
    sfPublic('getSession', AUTH_FUNCTIONS, 'system:session.read', 'none', 'none', {
      canonicalOnly: true,
      notes: 'session probe for route guards',
    }),
    sf('ensureActiveOrg', AUTH_FUNCTIONS, 'system:session.mutate', 'none', 'none', {
      canonicalOnly: true,
      notes: 'session-gated; mutates active org if unset',
    }),
  ],
]

const ROUTE_UI_ROWS: ReadonlyArray<EntryPointRow> = [
  // ── root & public pages ───────────────────────────────────────────
  ...[
    ui('__root', `${ROUTES}/__root.tsx`, 'system:ui.render', 'none', 'none', {
      principals: ['public'],
      notes: 'root layout',
    }),
    ui(
      '_authenticated',
      `${ROUTES}/_authenticated.tsx`,
      'system:ui.render',
      'none',
      'none',
      { notes: 'beforeLoad enforces session globally; all children inherit' },
    ),
    ui('/', `${ROUTES}/index.tsx`, 'system:ui.render', 'none', 'none', {
      principals: ['public'],
      notes: 'static marketing landing page',
    }),
    ui('/login', `${ROUTES}/login.tsx`, 'system:identity.sign_in', 'none', 'none', {
      principals: ['public'],
      notes: 'redirects to /dashboard when authenticated',
    }),
    ui(
      '/reset-password',
      `${ROUTES}/reset-password.tsx`,
      'system:identity.password_reset',
      'none',
      'none',
      {
        principals: ['public'],
        externalEffect: true,
        notes: 'authClient.requestPasswordReset sends email',
      },
    ),
    ui(
      '/join',
      `${ROUTES}/join.tsx`,
      'system:identity.accept_invitation',
      'none',
      'none',
      { principals: ['public'], notes: 'invited-member signup; ?redirect passthrough' },
    ),
    ui(
      '/accept-invitation',
      `${ROUTES}/accept-invitation.tsx`,
      'system:identity.accept_invitation',
      'none',
      'none',
      { notes: 'redirects to /join when no session; loader lists invitations' },
    ),
    ui('/unavailable', `${ROUTES}/unavailable.tsx`, 'system:ui.render', 'none', 'none', {
      principals: ['public'],
      notes: 'BQC-2.6: intentional unavailable experience for dark features',
    }),
    ui(
      '/p/$token',
      `${ROUTES}/p/$token.tsx`,
      'system:guest.portal_read',
      'portal.public_read',
      'property',
      {
        principals: ['public'],
        notes: 'opaque-token guest portal; sets guest_session cookie and records scan',
      },
    ),
  ],

  // ── authenticated top-level ───────────────────────────────────────
  ...[
    ui(
      '/dashboard',
      `${AUTHED}/dashboard.tsx`,
      'dashboard.fleet_read',
      'dashboard.use',
      'organization',
      { notes: 'single-property orgs redirect to property deep-dive' },
    ),
    ui('/progress', `${AUTHED}/progress.tsx`, 'system:ui.render', 'none', 'none', {
      notes:
        'retained URL compatibility only; a denied request returns to the dashboard and authorized managers move to the canonical Property Goal Program surface',
    }),
    ui(
      '/properties/import-google',
      `${AUTHED}/properties/import-google/index.tsx`,
      'integration.manage',
      'integration.use',
      'organization',
      { notes: 'Google OAuth connect + GBP import start' },
    ),
    ui(
      '/properties/import-google/$importId',
      `${AUTHED}/properties/import-google/$importId.tsx`,
      'system:ui.render',
      'integration.use',
      'organization',
      { notes: 'polls import job progress' },
    ),
    ui(
      '/inbox',
      `${AUTHED}/inbox/index.tsx`,
      'inbox.manage',
      'inbox.use',
      'organization',
      { notes: 'manager triage surface' },
    ),
    ui(
      '/notifications',
      `${AUTHED}/notifications.tsx`,
      'notification.read',
      'notification.in_app',
      'organization',
      { notes: 'full in-app notification history; reads via notification server fns' },
    ),
  ],

  // ── settings ──────────────────────────────────────────────────────
  ...[
    ui(
      '/settings (layout)',
      `${AUTHED}/settings.tsx`,
      'system:ui.render',
      'none',
      'none',
      { notes: 'layout (Outlet)' },
    ),
    ui('/settings', `${AUTHED}/settings/index.tsx`, 'system:ui.render', 'none', 'none', {
      notes: 'index redirect → /settings/profile',
    }),
    ui(
      '/settings/profile',
      `${AUTHED}/settings/profile.tsx`,
      'system:ui.render',
      'none',
      'none',
      { notes: 'mutations via server fns' },
    ),
    ui(
      '/settings/security',
      `${AUTHED}/settings/security.tsx`,
      'system:ui.render',
      'none',
      'none',
      { notes: 'changePasswordFn mutation' },
    ),
    ui(
      '/settings/preferences',
      `${AUTHED}/settings/preferences.tsx`,
      'system:ui.render',
      'none',
      'none',
      { notes: 'client-side preferences' },
    ),
    ui(
      '/settings/notifications',
      `${AUTHED}/settings/notifications.tsx`,
      'system:ui.render',
      'notification.in_app',
      'organization',
      { notes: 'loader via notification server fns' },
    ),
    ui(
      '/settings/organization',
      `${AUTHED}/settings/organization.tsx`,
      'organization.update',
      'identity.invite',
      'organization',
    ),
    ui(
      '/settings/members',
      `${AUTHED}/settings/members.tsx`,
      'member.list',
      'identity.invite',
      'organization',
      { notes: 'loader caps allowedRoles by inviter role' },
    ),
    ui(
      '/settings/ai',
      `${AUTHED}/settings/ai.tsx`,
      'ai.manage',
      'property.create',
      'property',
      { notes: 'property-scoped Merchant AI authorization and notice' },
    ),
    ui(
      '/settings/integrations',
      `${AUTHED}/settings/integrations.tsx`,
      'integration.manage',
      'integration.use',
      'organization',
      { notes: 'Google connect/disconnect' },
    ),
  ],

  // ── properties ────────────────────────────────────────────────────
  ...[
    ui(
      '/properties',
      `${AUTHED}/properties/index.tsx`,
      'property.admin',
      'property.create',
      'organization',
      { notes: 'manager surface' },
    ),
    ui(
      '/properties/$propertyId (layout)',
      `${AUTHED}/properties/$propertyId.tsx`,
      'property.admin',
      'property.create',
      'property',
      { notes: 'layout for all property children; non-UUID param → notFound' },
    ),
    ui(
      '/properties/$propertyId',
      `${AUTHED}/properties/$propertyId/index.tsx`,
      'system:ui.render',
      'dashboard.use',
      'property',
      { notes: 'property deep-dive dashboard; loader via dashboard fns' },
    ),
    ui(
      '/properties/$propertyId/people',
      `${AUTHED}/properties/$propertyId/people.tsx`,
      'staff.read',
      'staff.use',
      'property',
      { notes: 'staff/teams/portal assignments' },
    ),
    ui(
      '/properties/$propertyId/settings',
      `${AUTHED}/properties/$propertyId/settings.tsx`,
      'property.read',
      'property.create',
      'property',
      { notes: 'responsible-manager settings; mutation requires property.update' },
    ),
    ui(
      '/properties/$propertyId/reviews',
      `${AUTHED}/properties/$propertyId/reviews.tsx`,
      'inbox.read',
      'inbox.use',
      'property',
      { notes: 'property-scoped inbox surface' },
    ),
    ui(
      '/properties/$propertyId/goals (layout)',
      `${AUTHED}/properties/$propertyId/goals.tsx`,
      'system:ui.render',
      'goal.use',
      'property',
      { notes: 'layout (Outlet; dark)' },
    ),
    ui(
      '/properties/$propertyId/goals',
      `${AUTHED}/properties/$propertyId/goals/index.tsx`,
      'goal.read',
      'goal.use',
      'property',
    ),
    ui(
      '/properties/$propertyId/goals/new',
      `${AUTHED}/properties/$propertyId/goals/new.tsx`,
      'goal.create',
      'goal.use',
      'property',
    ),
    ui(
      '/properties/$propertyId/goals/$goalId',
      `${AUTHED}/properties/$propertyId/goals/$goalId.tsx`,
      'goal.read',
      'goal.use',
      'property',
    ),
    ui(
      '/properties/$propertyId/portals',
      `${AUTHED}/properties/$propertyId/portals/index.tsx`,
      'portal.read',
      'portal.read',
      'property',
      { notes: 'dark' },
    ),
    ui(
      '/properties/$propertyId/portals/new',
      `${AUTHED}/properties/$propertyId/portals/new.tsx`,
      'portal.create',
      'portal.write',
      'property',
      { notes: 'hard-blocked (portal.write)' },
    ),
    ui(
      '/properties/$propertyId/portals/$portalId',
      `${AUTHED}/properties/$propertyId/portals/$portalId.tsx`,
      'portal.read',
      'portal.read',
      'property',
      { notes: 'loader notFound if missing; dark' },
    ),
  ],
]

const ROUTE_API_ROWS: ReadonlyArray<EntryPointRow> = [
  api(
    '/api/auth/$',
    `${ROUTES}/api/auth/$.ts`,
    'system:identity.auth_api',
    'none',
    'none',
    {
      notes:
        'better-auth catch-all; 404-blocks 9 raw org write endpoints; POST IP rate-limited',
    },
  ),
  api(
    '/api/auth/google/callback',
    `${ROUTES}/api/auth/google/callback.ts`,
    'system:integration.google_callback',
    'integration.use',
    'organization',
    {
      principals: ['user'],
      externalEffect: true,
      notes:
        'HMAC-signed OAuth state (10-min freshness) + session; Google code exchange; capability not asserted in code — BQC-2.4 wires',
    },
  ),
  api(
    '/api/health',
    `${ROUTES}/api/health/index.ts`,
    'system:health.check',
    'none',
    'none',
    {
      notes:
        'combined DB+Redis+migrations+policy readiness (legacy-compatible shape — fields added, never removed)',
    },
  ),
  api(
    '/api/health/live',
    `${ROUTES}/api/health/live.ts`,
    'system:health.check',
    'none',
    'none',
    { notes: 'process liveness probe — dependency-free by pin test' },
  ),
  api(
    '/api/health/ready',
    `${ROUTES}/api/health/ready.ts`,
    'system:health.check',
    'none',
    'none',
    {
      notes:
        'DB+Redis+migration-journal+policy readiness probe; 2s per-probe budget; 503 on any degradation; worker heartbeat deliberately excluded (BQC-7.2)',
    },
  ),
  api(
    '/api/health/started',
    `${ROUTES}/api/health/started.ts`,
    'system:health.check',
    'none',
    'none',
    {
      notes:
        'startup diagnostic: container built + migrations match + policy readable; retained for local/staging orchestration while Railway activation uses /api/health/ready',
    },
  ),
  api(
    '/api/health/metrics',
    `${ROUTES}/api/health/metrics.ts`,
    'system:health.check',
    'none',
    'none',
    {
      principals: ['operator'],
      notes:
        'ops metrics: outbox lag, queue depths, worker heartbeat; no-store; PRIVATE — OPS_METRICS_TOKEN gate (x-ops-token / Bearer), 404 not 403 on absent env or wrong/missing token (BQC-7.2)',
    },
  ),
  api(
    '/api/public/p/$token/click/$linkId',
    `${ROUTES}/api/public/p/$token/click/$linkId.ts`,
    'system:guest.click_track',
    'portal.public_read',
    'property',
    {
      notes:
        'token resolves authoritative org/property/Portal and public ExecutionPolicy before exact link ownership; neutral 404/no effect on mismatch; validates stored HTTPS URL; 302 no-referrer redirect',
    },
  ),
  api(
    '/api/notifications/unsubscribe',
    `${ROUTES}/api/notifications/unsubscribe.ts`,
    'public:notification.email_unsubscribe',
    'notification.send_email',
    'none',
    {
      principals: ['public'],
      notes:
        'RFC 8058 unauthenticated POST; exact form value plus active/retained HMAC bearer capability; target resolves an email row or immutable digest batch and atomically disables only represented optional email scopes; mandatory mail excluded; invalid/stale tokens receive neutral 204',
    },
  ),
  api(
    '/api/webhooks/gbp/notifications',
    `${ROUTES}/api/webhooks/gbp/notifications.ts`,
    'system:integration.gbp_webhook',
    'property.connect_gbp',
    'property',
    {
      principals: ['system'],
      externalEffect: true,
      notes:
        'Google Pub/Sub JWT verify (audience-bound); enqueues sync-property-reviews (stamps webhook:gbp initiator); capability not asserted in code — BQC-3.2 dispatch gate authorizes',
    },
  ),
  api(
    '/api/webhooks/resend/events',
    `${ROUTES}/api/webhooks/resend/events.ts`,
    'system:notification.delivery_event',
    'notification.send_email',
    'none',
    {
      principals: ['system'],
      externalEffect: false,
      notes:
        'ADR 0046 r.6: Svix HMAC-SHA256 verify over the raw body (5-min replay window, constant-time compare); maps email.delivered/bounced/complained onto recordProviderState and suppresses a bounced recipient\u2019s remaining queued mail; 503 webhook_disabled when RESEND_WEBHOOK_SECRET is unset; scope none \u2014 the provider message id resolves the tenant',
    },
  ),
]

const JOB_ROWS: ReadonlyArray<EntryPointRow> = [
  job(
    'portal-approved-destination-revalidation',
    'src/contexts/portal/infrastructure/jobs/revalidate-approved-destinations.job.ts',
    'system:portal.destination_revalidate',
    'portal.write',
    'tenant_cross',
    {
      externalEffect: true,
      notes:
        'bounded tenant-cross discovery; each Property is independently authorized before pinned DNS/redirect validation and any exact-fenced quarantine transaction',
    },
  ),
  job(
    'health-check',
    'src/shared/jobs/health-check.job.ts',
    'system:health.check',
    'none',
    'none',
    { notes: 'Redis heartbeat stamp for /api/health/metrics' },
  ),
  job(
    'process-image',
    'src/contexts/portal/infrastructure/jobs/process-image.job.ts',
    'system:image.process',
    'portal.upload',
    'property',
    {
      externalEffect: true,
      notes:
        'issuance-only private read + derived writes (sharp re-encode); stale-fenced; registration-gated; no-op when dark',
    },
  ),
  job(
    'portal-upload-source-cleanup',
    'src/contexts/portal/infrastructure/jobs/cleanup-upload-sources.job.ts',
    'system:image.cleanup',
    'none',
    'tenant_cross',
    {
      externalEffect: true,
      notes:
        'bounded oldest-first cleanup of issuance-derived private source objects; DeleteObject is idempotent and a durable source-deleted marker makes crash replay convergent; stays active while portal.upload is dark',
    },
  ),
  job(
    'import-gbp-property-item-v2',
    'src/contexts/integration/infrastructure/jobs/import-gbp-property-item-v2.job.ts',
    'system:property.import_v2',
    'property.import_gbp_v2',
    'organization',
    {
      externalEffect: true,
      notes:
        'tenant-scoped GBP import v2 item; dispatch re-resolves current item routing before fenced effects',
    },
  ),
  job(
    'sync-property-reviews',
    'src/contexts/review/infrastructure/jobs/sync-property-reviews.job.ts',
    'system:review.sync',
    'property.connect_gbp',
    'property',
    {
      externalEffect: true,
      notes:
        'GBP review sync; BQC-3.2 dispatch gate authorizes; enqueued manual/cron/webhook/sweep',
    },
  ),
  job(
    'generate-property-ai-trend',
    'src/contexts/ai/infrastructure/jobs/generate-property-trend.job.ts',
    'system:ai.trend',
    'ai.detect_trends',
    'property',
    {
      notes:
        'content-free coalesced property trend generation after durable review analysis',
    },
  ),
  job(
    'schedule-property-ai-trends',
    'src/contexts/ai/infrastructure/jobs/schedule-property-trends.job.ts',
    'system:ai.trend_schedule',
    'ai.detect_trends',
    'tenant_cross',
    {
      notes:
        'DB-fenced property-local calendar scheduler; scans at most 100 due properties per firing',
    },
  ),
  job(
    'refresh-expiring-reviews',
    'src/contexts/review/infrastructure/jobs/refresh-expiring-reviews.job.ts',
    'system:review.refresh_sweep',
    'none',
    'tenant_cross',
    {
      notes:
        'BQC-1.5 bounded sweep (500×10, cursor in review_refresh_runs); enqueues gated sync jobs',
    },
  ),
  job(
    'reconcile-missing-notifications',
    'src/contexts/notification/infrastructure/jobs/reconcile-missing-notifications.job.ts',
    'system:notification.reconcile',
    'none',
    'tenant_cross',
    {
      notes:
        'notification-gap healing sweep (100x5, keyset on inbox_items (created_at, id), 24h lookback with a 5m grace edge); enqueues the ordinary insert-notification job, so preferences and the unread-coalescing dedupe still apply. Capability none + a distinct tenant-cross action for the same reason as system:review.discovery_sweep: the sweep carries no propertyId, so the property-scoped system:notification.insert would missing_scope-deny it',
    },
  ),
  job(
    'release-response-target-reminders',
    'src/contexts/inbox/infrastructure/jobs/release-response-target-reminders.job.ts',
    'system:inbox.update',
    'inbox.use',
    'tenant_cross',
    {
      notes:
        'bounded 100-slot timing sweep; each reminder release and its identifier-only durable fact commit atomically, and the exact target is revalidated downstream before delivery',
    },
  ),
  job(
    'discover-new-reviews',
    'src/contexts/review/infrastructure/jobs/discover-new-reviews.job.ts',
    'system:review.discovery_sweep',
    'none',
    'tenant_cross',
    {
      notes:
        'new-review discovery sweep (200×10, keyset on property id, per-property due times in review_sync_state); enqueues gated sync jobs — never calls the provider itself, so no externalEffect. Distinct tenant-cross action with capability none for the same reason as system:review.reconcile: the strictest-scope merge on property-scoped system:review.sync would missing_scope-deny this sweep',
    },
  ),
  job(
    'purge-expired-reviews',
    'src/contexts/review/infrastructure/jobs/purge-expired-reviews.job.ts',
    'system:review.purge',
    'none',
    'tenant_cross',
    {
      notes:
        'SAFE-03/REV-01 content-free checkpointed report/shadow authority; no Review/source/Reply/Inbox mutation and no destructive apply authority',
    },
  ),
  job(
    'expire-review-provider-source',
    'src/contexts/review/infrastructure/jobs/review-provider-lifecycle-sweeps.job.ts',
    'system:review.purge',
    'none',
    'tenant_cross',
    {
      notes:
        'SAFE-03 quarantine continuation; validates and drains legacy expiry jobs without invoking row deletion',
    },
  ),
  job(
    'sweep-review-provider-tombstones',
    'src/contexts/review/infrastructure/jobs/review-provider-lifecycle-sweeps.job.ts',
    'system:review.purge',
    'none',
    'tenant_cross',
    {
      notes:
        'bounded expired provider-correlation tombstone continuation after the fixed retention fence',
    },
  ),
  job(
    'publish-reply',
    'src/contexts/review/infrastructure/jobs/publish-reply.job.ts',
    'system:reply.publish',
    'property.publish_reply',
    'property',
    {
      externalEffect: true,
      notes:
        'GBP reply publish; BQC-3.2 dispatch gate authorizes; BQC-3.8 durable claim (publication_state) + classified outcome marks; max 3 attempts → publish_failed',
    },
  ),
  job(
    'reconcile-ambiguous-publications',
    'src/contexts/review/infrastructure/jobs/reconcile-ambiguous-publications.job.ts',
    'system:review.reconcile',
    'none',
    'tenant_cross',
    {
      notes:
        'BQC-3.8 provider-pending and ambiguous publication reconcile sweep; provider re-read only — never a send; exact observations heal and every non-confirming/error row is guardedly rescheduled; distinct action: shares nothing with property-scoped system:review.sync (strictest-scope merge would missing_scope-deny this tenant-cross sweep)',
    },
  ),
  job(
    'goal-program.maintain',
    'src/contexts/goal/infrastructure/jobs/goal-program-maintenance.job.ts',
    'system:goal.maintain',
    'goal.use',
    'tenant_cross',
    {
      notes:
        'canonical monthly Goal Program lifecycle; discovers operational programs, then freshly authorizes every property before activation, next-month materialization, or governed result reconciliation',
    },
  ),
  job(
    'retention-sweep',
    'src/shared/jobs/retention-sweep.job.ts',
    'system:retention.sweep',
    'none',
    'tenant_cross',
    {
      notes:
        'Guest-owned Contact Request encrypted-material expiry, registered static rules, and Google import lifecycle (incl. per-entry cache expiry, 24h/7d guest pseudonym redaction, settled invitation-registration fences, and 365d audit evidence); separate deletion/redaction counts in retention_runs; throws on any subject failure',
    },
  ),
  job(
    'quarantine-ttl-sweep',
    'src/shared/jobs/quarantine-ttl-sweep.job.ts',
    'system:quarantine.ttl',
    'none',
    'tenant_cross',
    {
      notes:
        'BQC-7.8: dead-letter TTL bound (QUARANTINE_TTL_DAYS, default 30d); per-entry job.remove(), capped, evidence subject quarantine.ttl',
    },
  ),
  job(
    'ai-operation-execution-reaper',
    'src/shared/jobs/ai-operation-execution-reaper.job.ts',
    'system:ai.execution_reap',
    'none',
    'tenant_cross',
    {
      notes:
        'Fences AI operations abandoned in executing past their own expires_at; bounded 100-row scan through the recordFailure CAS, terminal operation_ambiguous (never retried — the provider may already have been charged)',
    },
  ),
  job(
    'ai-review-analysis-enrollment-sweep',
    'src/shared/jobs/ai-review-analysis-enrollment-sweep.job.ts',
    'system:ai.review_analysis_enrollment_sweep',
    'none',
    'tenant_cross',
    {
      notes:
        'Unconditional, bounded recovery for durable first-enablement enrollment intents. The owning AI use case rechecks each exact authorization lineage/source/capability fence and current global/provider/capability controls before it can open a replay; a full 50-head batch waits for the next recurrence rather than recursively enqueueing.',
    },
  ),
  job(
    'permit-start-deadline-sweep',
    'src/shared/jobs/permit-start-deadline-sweep.job.ts',
    'system:permit.start_deadline_fence',
    'none',
    'tenant_cross',
    {
      notes:
        'ADR 0050: bounded CAS of admitted -> fenced past start_deadline_at through fenceElapsedStartDeadlinePermit; unblocks ON DELETE RESTRICT approval rotation',
    },
  ),
  job(
    'advance-organization-lifecycle',
    'src/contexts/identity/infrastructure/jobs/advance-organization-lifecycle.job.ts',
    'system:identity.organization_lifecycle',
    'none',
    'tenant_cross',
    {
      notes:
        'bounded 50-Organization lifecycle pass; current boot registration is a no-mutation safety handler and the recurring schedule remains reconciled away until every context-owned contributor plus independent support authorization is composed',
    },
  ),
  job(
    'generate-organization-export',
    'src/contexts/identity/infrastructure/jobs/generate-organization-export.job.ts',
    'system:identity.organization_export',
    'none',
    'tenant_cross',
    {
      externalEffect: true,
      notes:
        'one renewable generation claim and one deterministic private encrypted object write; currently a no-mutation safety handler with its schedule reconciled away pending all 17 reviewed contributors and storage binding',
    },
  ),
  job(
    'purge-expired-organization-exports',
    'src/contexts/identity/infrastructure/jobs/purge-expired-organization-exports.job.ts',
    'system:identity.organization_export',
    'none',
    'tenant_cross',
    {
      externalEffect: true,
      notes:
        'one expired export claim and verified encrypted-object deletion; currently a no-mutation safety handler with its schedule reconciled away pending storage binding and a live absence drill',
    },
  ),
  job(
    'recover-invited-registrations',
    'src/contexts/identity/infrastructure/jobs/recover-invited-registrations.job.ts',
    'system:identity.accept_invitation',
    'none',
    'tenant_cross',
    {
      notes:
        'bounded recovery of Better Auth verification records; exact preallocated provider identities only, with safe compensation or fail-closed manual review',
    },
  ),
  job(
    'google-import-claim-reaper',
    'src/contexts/integration/infrastructure/jobs/google-import-claim-reaper.job.ts',
    'system:property.import_claim_reap',
    'property.import_gbp_v2',
    'tenant_cross',
    {
      notes:
        'bounded claim-lease recovery: releases or terminalizes items still processing past claim_lease_expires_at through the store CAS helpers; no provider effect',
    },
  ),
  job(
    'project-recent-activity',
    'src/contexts/activity/infrastructure/jobs/project-recent-activity.job.ts',
    'system:activity.record',
    'none',
    'organization',
    { notes: 'enqueued by 29 activity event handlers' },
  ),
  job(
    'insert-activity-log',
    'src/contexts/activity/infrastructure/jobs/project-recent-activity.job.ts',
    'system:activity.record',
    'none',
    'organization',
    {
      notes:
        'registered solely to drain pre-migration-0160 queued work; all current producers use project-recent-activity',
    },
  ),
  job(
    'insert-notification',
    'src/contexts/notification/infrastructure/jobs/insert-notification.job.ts',
    'system:notification.insert',
    'none',
    'property',
    { notes: 'property-scoped durable in-app + email-queue insert' },
  ),
  job(
    'urgent-email',
    'src/contexts/notification/infrastructure/jobs/urgent-email.job.ts',
    'system:notification.email_urgent',
    'notification.send_email',
    'property',
    {
      externalEffect: true,
      notes:
        'property resolution, current preference, quiet-hours, and policy rechecked before provider effect',
    },
  ),
  job(
    'digest-notification',
    'src/contexts/notification/infrastructure/jobs/digest-notification.job.ts',
    'system:notification.email_digest',
    'notification.send_email',
    'tenant_cross',
    {
      externalEffect: true,
      notes:
        'hourly fanout re-enqueues immediate orphans per authorized property; ADR 0046 r.4 digest batches are per USER in the user timezone, grouped by property inside one email',
    },
  ),
]

const CONSUMER_ROWS: ReadonlyArray<EntryPointRow> = [
  consumer(
    'review.outbox-consumers',
    'src/contexts/review/infrastructure/outbox-consumers.ts',
    'system:reply.publish',
    'property.publish_reply',
    'property',
    ['review.reply.publication_requested'],
    {
      notes:
        'durable identifier-only publication admission; reloads reply state and requires the exact committed publication cycle before enqueueing a deterministic reply+cycle job',
    },
  ),
  consumer(
    'portal.outbox-consumers',
    'src/contexts/portal/infrastructure/outbox-consumers.ts',
    'system:image.process',
    'portal.upload',
    'property',
    ['portal.hero_image.processing_requested'],
    {
      externalEffect: true,
      notes:
        'durable ETag-bound image processing; stale issuance is obsolete and retries converge on issuance state',
    },
  ),
  consumer(
    'portal.health-outbox-consumers',
    'src/contexts/portal/infrastructure/portal-health-outbox-consumers.ts',
    'system:portal.health_reconcile',
    'portal.write',
    'property',
    [
      'property.archived',
      'property.restored',
      'property.updated',
      'property.deleted',
      'property.google_binding.changed',
      'portal.responsible_managers.updated',
    ],
    {
      notes:
        'recomputes derived Portal Health from committed dependencies and atomically settles the receipt, effective-dated interval, and identifier-only change fact',
    },
  ),
  consumer(
    'inbox.outbox-consumers',
    'src/contexts/inbox/infrastructure/outbox-consumers.ts',
    'system:inbox.update',
    'none',
    'organization',
    [
      'review.created',
      'review.expired',
      'review.source_transitioned',
      'review.updated',
      'review.reply.published',
      'review.reply.observed',
    ],
    {
      notes:
        'durable outbox consumers: source transition co-commits legacy-content scrub/close/receipt; publication is receipt-only; exact current reply observation applyOnce co-commits close/reopen state, facts, and receipt',
    },
  ),
  consumer(
    'inbox.guest-feedback',
    'src/contexts/inbox/infrastructure/guest-feedback-outbox-consumers.ts',
    'system:inbox.project_guest_feedback',
    'portal.read',
    'organization',
    ['guest.feedback.submitted', 'guest.feedback.retracted'],
    {
      notes:
        'durable metadata-only private-feedback projection with source existence check',
    },
  ),
  consumer(
    'notification.outbox-consumers',
    'src/contexts/notification/infrastructure/outbox-consumers.ts',
    'system:notification.insert',
    'none',
    'organization',
    ['inbox.inbox_item.created'],
    {
      notes:
        'durable identifier-only fan-out to insert-notification jobs; receipt written after the enqueue and each job carries the deterministic id <eventId>-<userId>, so redelivery converges instead of coalescing a second arrival. The notification durable consumer delivers; reconcile-missing-notifications remains the at-least-once repair sweep rather than the sole delivery path',
    },
  ),
  consumer(
    'notification.identity-account-outbox-consumers',
    'src/contexts/notification/infrastructure/identity-account-outbox-consumers.ts',
    'system:notification.insert',
    'none',
    'organization',
    [
      'identity.invitation.accepted',
      'identity.member.role_changed',
      'identity.member.removed',
      'identity.organization_lifecycle.changed',
    ],
    {
      notes:
        'durable affected-account access notices; exact schema-validated Identity fact is re-read at delivery, so role-change actor and target cannot be confused and a removed user still receives their own notice. LIF-01 program bullet 5: the lifecycle fact additionally carries the MANDATORY Purge Pending final notice, which is the one delivery deliberately carved out of the Closing suppression',
    },
  ),
  consumer(
    'notification.workflow-outbox-consumers',
    'src/contexts/notification/infrastructure/workflow-outbox-consumers.ts',
    'system:notification.insert',
    'none',
    'organization',
    [
      'inbox.inbox_item.assigned',
      'inbox.inbox_item.escalated',
      'inbox.inbox_note.added',
      'review.reply.submitted',
      'review.reply.approved',
      'review.reply.rejected',
      'review.reply.published',
      'review.reply.publish_failed',
    ],
    {
      notes:
        'durable identifier-only recovery for the notification workflow handlers; deterministic recipient jobs converge with the in-process fast path before the receipt is acknowledged',
    },
  ),
  consumer(
    'notification.bulk-assignment-outbox-consumers',
    'src/contexts/notification/infrastructure/bulk-assignment-outbox-consumers.ts',
    'system:notification.insert',
    'none',
    'organization',
    ['inbox.inbox_items.bulk_assignment_completed'],
    {
      notes:
        'one durable identifier-only notification per next-assignee and Property; exact current assignment and Property eligibility are rechecked at delivery, while deterministic jobs converge before the completion receipt is acknowledged',
    },
  ),
  consumer(
    'notification.escalation-resolution-outbox-consumers',
    'src/contexts/notification/infrastructure/escalation-resolution-outbox-consumers.ts',
    'system:notification.insert',
    'none',
    'organization',
    ['inbox.inbox_item.escalation_resolved'],
    {
      notes:
        'durable identifier-only resolution fan-out to the current assignee or current responsible managers; actor suppression and deterministic per-recipient jobs make stale delivery safe',
    },
  ),
  consumer(
    'notification.handling-cycle-outbox-consumers',
    'src/contexts/notification/infrastructure/handling-cycle-outbox-consumers.ts',
    'system:notification.insert',
    'none',
    'organization',
    ['inbox.handling_cycle.opened', 'inbox.handling_cycle.reopened'],
    {
      notes:
        'durable identifier-only material-revision and reopen fan-out; initial item cycles are receipt-only, while exact current cycle/head, source-specific responsibility, and actor suppression are revalidated at delivery',
    },
  ),
  consumer(
    'notification.response-target-outbox-consumers',
    'src/contexts/notification/infrastructure/response-target-outbox-consumers.ts',
    'system:notification.insert',
    'none',
    'organization',
    ['inbox.response_target.reminder_due'],
    {
      notes:
        'durable one-shot target reminder fan-out; the exact active target and current source-specific responsibility are revalidated both before enqueue and at notification materialization',
    },
  ),
  consumer(
    'notification.goal-outbox-consumers',
    'src/contexts/notification/infrastructure/goal-outbox-consumers.ts',
    'system:notification.insert_goal',
    'goal.use',
    'property',
    ['goal.monthly_result.closed', 'goal.monthly_result.revised'],
    {
      notes:
        'achieved-close and neutral result-revision fan-out; exact current result/revision fence and responsibility are reloaded before deterministic recipient jobs are acknowledged',
    },
  ),
  consumer(
    'notification.on-google-reauthorization-required',
    'src/contexts/notification/infrastructure/integration-outbox-consumers.ts',
    'system:notification.insert',
    'none',
    'organization',
    ['integration.google_account.reauthorization_required'],
    {
      notes:
        'durable identifier-only AccountAdmin recovery fan-out for connector departure; recipient jobs converge by event and user before the receipt is acknowledged',
    },
  ),
  consumer(
    'notification.portal-outbox-consumers',
    'src/contexts/notification/infrastructure/portal-outbox-consumers.ts',
    'system:notification.insert_portal',
    'portal.write',
    'property',
    ['portal.responsibility_became_needed'],
    {
      notes:
        'portal-gated durable AccountAdmin recovery fan-out; identifier-only payload, receipt fencing, deterministic per-recipient job ids',
    },
  ),
  consumer(
    'notification.portal-health-outbox-consumers',
    'src/contexts/notification/infrastructure/portal-health-outbox-consumers.ts',
    'system:notification.insert_portal',
    'portal.write',
    'property',
    ['portal.health.changed'],
    {
      notes:
        'durable serious Portal Health fan-out; expected states and recovery settle receipt-only, while recipient jobs revalidate the exact enum/fence state before delivery',
    },
  ),
  consumer(
    'notification.property-outbox-consumers',
    'src/contexts/notification/infrastructure/property-outbox-consumers.ts',
    'system:notification.insert_property_responsibility',
    'property.create',
    'property',
    ['property.responsibility_became_needed'],
    {
      notes:
        'durable AccountAdmin recovery fan-out; identifier-only payload, receipt fencing, deterministic per-recipient job ids',
    },
  ),
  consumer(
    'integration.property-import-dispatch',
    'src/contexts/integration/infrastructure/outbox-consumers.ts',
    'system:property.import_v2',
    'property.import_gbp_v2',
    'organization',
    ['integration.property_import.requested', 'property.google_binding.changed'],
    {
      notes:
        'durable identifier-only import dispatch plus provider-authorization invalidation; deterministic item jobs and versioned invalidation delivery converge ambiguous relay delivery',
    },
  ),
  consumer(
    'integration.google-review-push-dispatch',
    'src/contexts/integration/infrastructure/google-review-push-outbox-consumers.ts',
    'system:review.sync',
    'property.connect_gbp',
    'property',
    ['integration.google_review_push.accepted'],
    {
      externalEffect: true,
      notes:
        'durable identifier-only GBP push dispatch; deterministic existing review-sync job admission re-resolves current Property routing and credential home before provider access',
    },
  ),
  consumer(
    'property.import-retention-release',
    'src/contexts/property/infrastructure/outbox-consumers.ts',
    'system:property.import_v2',
    'property.import_gbp_v2',
    'organization',
    ['integration.property_import.retention_released'],
    {
      notes:
        'durable bounded retention-release projection; state and consumer receipt co-commit',
    },
  ),
  consumer(
    'ai.outbox-consumers',
    'src/contexts/ai/infrastructure/outbox-consumers.ts',
    'system:ai.trend',
    'ai.detect_trends',
    'property',
    [
      'review.created',
      'review.updated',
      'review.source_transitioned',
      'identity.merchant_ai.changed',
      'ai.review_analysis.backfill_requested',
      'ai.property_trend.generation_requested',
    ],
    {
      notes:
        'durable review-analysis consumers plus identifier-only trend-generation dispatch; each event family retains its exact event-catalogue capability',
    },
  ),
  consumer(
    'activity.outbox-consumers',
    'src/contexts/activity/infrastructure/outbox-consumers.ts',
    'system:activity.record',
    'none',
    'organization',
    [
      'goal.monthly_result.closed',
      'goal.monthly_result.reconciled',
      'goal.monthly_result.revised',
      'identity.invitation.accepted',
      'identity.invitation.canceled',
      'identity.member.invited',
      'identity.member.removed',
      'identity.member.role_changed',
      'identity.merchant_ai.changed',
      'identity.organization.created',
      'inbox.inbox_item.assigned',
      'inbox.inbox_item.bulk_status_changed',
      'inbox.inbox_item.created',
      'inbox.inbox_item.escalated',
      'inbox.inbox_item.escalation_resolved',
      'inbox.inbox_item.status_changed',
      'inbox.inbox_item.unassigned',
      'inbox.inbox_note.added',
      'integration.google_account.connected',
      'integration.google_account.disconnected',
      'integration.google_connection.visibility_changed',
      'portal.archived',
      'portal.approved_destination.updated',
      'portal.health.changed',
      'portal.hero_image.published',
      'portal.publication.published',
      'portal.publication.rolled_back',
      'portal.restored',
      'property.created',
      'property.deleted',
      'property.archived',
      'property.restored',
      'property.updated',
      'review.reply.approved',
      'review.reply.publication_cancelled',
      'review.reply.published',
      'review.reply.rejected',
      'review.reply.submitted',
      'review.reply.updated',
    ],
    {
      notes:
        'durable Recent Activity projection plus the explicit Operational Action History source-fact subset; Recent Activity settles each content-free replay fact, projected row, and receipt atomically, while restricted history settles its identifier-only record and receipt through its separate append authority',
    },
  ),
  consumer(
    'goal.metric-correction-reconciliation',
    'src/contexts/goal/infrastructure/metric-correction-outbox-consumers.ts',
    'system:goal.maintain',
    'goal.use',
    'property',
    ['metric.corrected'],
    {
      notes:
        'durable exact-scope Metric correction impact reconciliation; appends serialized closed-result revisions and their identifier-only facts atomically',
    },
  ),
  consumer(
    'metric.portal-workflow',
    'src/contexts/metric/infrastructure/outbox-consumers.ts',
    'system:metric.record_portal_workflow',
    'portal.write',
    'organization',
    [
      'portal.content_review.completed',
      'portal.configuration_completeness.recorded',
      'portal.approved_destination_ratio.recorded',
    ],
    { notes: 'durable governed Portal workflow metric ingestion' },
  ),
  consumer(
    'metric.public-reputation',
    'src/contexts/metric/infrastructure/public-reputation-outbox-consumers.ts',
    'system:metric.record_public_reputation',
    'none',
    'organization',
    ['review.created'],
    {
      notes:
        'durable bounded-period Google Review activity ingestion; reloads the eligible rating from Review authority and settles the Metric write with its consumer receipt',
    },
  ),
  consumer(
    'metric.current-google-reputation',
    'src/contexts/metric/infrastructure/current-google-reputation-outbox-consumers.ts',
    'system:metric.record_public_reputation',
    'none',
    'organization',
    ['review.google_reputation_snapshot.verified'],
    {
      notes:
        'durable Review-verified provider aggregate projected into Metric current state with atomic receipt and source-epoch/evaluated-time fencing; never a bounded-period metric reading',
    },
  ),
  consumer(
    'metric.guest-analytics',
    'src/contexts/metric/infrastructure/guest-outbox-consumers.ts',
    'system:metric.record_guest_analytics',
    'portal.read',
    'organization',
    [
      'guest.scan.recorded',
      'guest.qualified_scan.recorded',
      'guest.qualified_scan.retracted',
      'guest.rating.submitted',
      'guest.rating.retracted',
      'guest.feedback.submitted',
      'guest.feedback.retracted',
      'guest.review_link.clicked',
    ],
    { notes: 'durable, content-free Guest analytics ingestion' },
  ),
  consumer(
    'metric.correction-reconciliation',
    'src/contexts/metric/infrastructure/correction-outbox-consumers.ts',
    'system:metric.record',
    'none',
    'organization',
    ['metric.corrected'],
    { notes: 'durable append-only correction reconciliation watermark' },
  ),
]

const SCHEDULE_ROWS: ReadonlyArray<EntryPointRow> = [
  schedule(
    'portal-approved-destination-revalidation-recurring',
    'system:portal.destination_revalidate',
    'portal.write',
    'tenant_cross',
    { notes: 'every 15 min; oldest validation timestamp first, bounded at 100' },
  ),
  schedule(
    'portal-upload-source-cleanup-recurring',
    'system:image.cleanup',
    'none',
    'tenant_cross',
    {
      notes:
        'hourly bounded private-source cleanup; intentionally active when portal.upload is disabled',
    },
  ),
  schedule('health-check-recurring', 'system:health.check', 'none', 'none', {
    notes: 'every 5 min',
  }),
  schedule(
    'schedule-property-ai-trends-recurring',
    'system:ai.trend_schedule',
    'ai.detect_trends',
    'tenant_cross',
    { notes: 'every minute; DB lease and property-local due date fence duplicate scans' },
  ),
  schedule(
    'refresh-expiring-reviews-recurring',
    'system:review.refresh_sweep',
    'none',
    'tenant_cross',
    { notes: 'hourly (BQC-1.5 bounded sweep)' },
  ),
  schedule(
    'discover-new-reviews-recurring',
    'system:review.discovery_sweep',
    'none',
    'tenant_cross',
    {
      notes:
        'every 15 min; per-property due times fence duplicate polls and back off on a 15m/1h/6h ladder keyed on review + push recency (REVIEW_DISCOVERY_INTERVAL_MINUTES, default 15, is the hot rung); properties mid-import are excluded',
    },
  ),
  schedule(
    'reconcile-missing-notifications-recurring',
    'system:notification.reconcile',
    'none',
    'tenant_cross',
    {
      notes:
        'every 10 min; the 5m grace edge keeps the sweep off items the happy path is still delivering, and the zero-notification candidate filter fences repeats',
    },
  ),
  schedule(
    'release-response-target-reminders-recurring',
    'system:inbox.update',
    'inbox.use',
    'tenant_cross',
    {
      notes:
        'every 5 min; releases at most 100 exact one-shot halfway or target-passed slots and leaves any remainder for the next tick',
    },
  ),
  schedule(
    'reconcile-ambiguous-publications-recurring',
    'system:review.reconcile',
    'none',
    'tenant_cross',
    {
      notes: 'every 5 min (BQC-3.8 provider-pending and ambiguous observation sweep)',
    },
  ),
  schedule(
    'retention-sweep-recurring',
    'system:retention.sweep',
    'none',
    'tenant_cross',
    { notes: 'daily, offset 3h (after purge)' },
  ),
  schedule(
    'quarantine-ttl-sweep-recurring',
    'system:quarantine.ttl',
    'none',
    'tenant_cross',
    { notes: 'daily, offset 4h (after retention sweep)' },
  ),
  schedule(
    'ai-operation-execution-reaper-recurring',
    'system:ai.execution_reap',
    'none',
    'tenant_cross',
    {
      notes:
        'every 5 min; reapable condition is the operation expires_at, not this cadence',
    },
  ),
  schedule(
    'ai-review-analysis-enrollment-sweep-recurring',
    'system:ai.review_analysis_enrollment_sweep',
    'none',
    'tenant_cross',
    {
      notes:
        'every 5 min; one tick visits at most 50 enrollment heads and a full batch waits for the next recurrence, preventing continuation fan-out',
    },
  ),
  schedule(
    'permit-start-deadline-sweep-recurring',
    'system:permit.start_deadline_fence',
    'none',
    'tenant_cross',
    { notes: 'every 5 min (execution-permit start-deadline fence)' },
  ),
  schedule(
    'advance-organization-lifecycle-recurring',
    'system:identity.organization_lifecycle',
    'none',
    'tenant_cross',
    {
      notes:
        'intended every 5 minutes, but operational posture is quarantined and reconciliation removes it until all 17 lifecycle contributors plus independent support authorization are bound',
    },
  ),
  schedule(
    'generate-organization-export-recurring',
    'system:identity.organization_export',
    'none',
    'tenant_cross',
    {
      externalEffect: true,
      notes:
        'intended every minute, but operational posture is quarantined and reconciliation removes it until reviewed contributors and encrypted storage are bound',
    },
  ),
  schedule(
    'purge-expired-organization-exports-recurring',
    'system:identity.organization_export',
    'none',
    'tenant_cross',
    {
      externalEffect: true,
      notes:
        'intended hourly, but operational posture is quarantined and reconciliation removes it until encrypted storage plus live deletion verification are bound',
    },
  ),
  schedule(
    'recover-invited-registrations-recurring',
    'system:identity.accept_invitation',
    'none',
    'tenant_cross',
    {
      notes:
        'every 60s; atomic updatedAt claims prevent duplicate workers and the five-minute due time avoids racing an active foreground provider request',
    },
  ),
  schedule(
    'google-import-claim-reaper-recurring',
    'system:property.import_claim_reap',
    'property.import_gbp_v2',
    'tenant_cross',
    {
      notes:
        'every 60s (one claim-lease width); tenant-cross enumeration only — each recovered item is re-authorized by the item job before any effect',
    },
  ),
  schedule(
    'goal-program.maintain-recurring',
    'system:goal.maintain',
    'goal.use',
    'tenant_cross',
    {
      notes:
        'hourly; database constraints and idempotent inserts fence duplicate activation, period materialization, and two-pass reconciliation',
    },
  ),
  schedule(
    'digest-notification-recurring',
    'system:notification.email_digest',
    'notification.send_email',
    'tenant_cross',
    { notes: 'hourly tenant enumeration; each org delivery is capability-scoped' },
  ),
]

const OPERATOR_ROWS: ReadonlyArray<EntryPointRow> = [
  // ── ops ───────────────────────────────────────────────────────────
  // BQC-7.5: every ops:* command runs through the operator-command harness
  // (scripts/ops/operator-command.ts) — named operator (--operator, matched
  // against OPS_OPERATOR_IDENTITIES) + target scope evaluated through the
  // ExecutionPolicy operator branch, dry-run default for mutations, and typed
  // --yes confirmation for destructive commands.
  ops('scripts/ops/operator-command.ts', 'scripts/ops/operator-command.ts', 'none', {
    notes:
      'BQC-7.5: operator-command harness wiring (boots the policy store + ExecutionPolicy, binds OPS_OPERATOR_IDENTITIES) — the module every ops:* command imports; contract + tests in src/shared/ops/operator-command.ts; not a command itself',
  }),
  ops(
    'scripts/ops/queue-quarantine.ts',
    'scripts/ops/queue-quarantine.ts',
    'tenant_cross',
    {
      notes:
        'ops:queue — pause/resume/status BullMQ queues; jobs preserved (BQC-0.5); pause/resume report-first + --reason/--apply (BQC-7.5)',
    },
  ),
  ops(
    'scripts/ops/quarantine-redrive.ts',
    'scripts/ops/quarantine-redrive.ts',
    'tenant_cross',
    {
      notes:
        'ops:quarantine — list/redrive/discard exhausted jobs from the BQC-3.6 failure quarantine; redrive uses createRedriveJob, discard removes without execution; both mutations are report-first and require --apply + --reason (BQC-7.5)',
    },
  ),
  ops(
    'scripts/ops/report-capability-refusal.ts',
    'scripts/ops/report-capability-refusal.ts',
    'tenant_cross',
    {
      notes:
        'ops:report-capability-refusal — read-only live refusal explanation across capability fate, tenant policy, Google execution control, and empirical permit outcomes; no apply path, and it never invokes or duplicates the mutating Postgres start authority',
    },
  ),
  ops(
    'scripts/ops/report-portal-access-artifacts.ts',
    'scripts/ops/report-portal-access-artifacts.ts',
    'tenant_cross',
    {
      notes:
        'ops:report-portal-artifacts — read-only, explicit-time inventory of reachable legacy QR/NFC addresses that lack a published Qualified Scan Access Artifact; stable content-free replacement list',
    },
  ),
  ops(
    'scripts/ops/report-portal-beta-readiness.ts',
    'scripts/ops/report-portal-beta-readiness.ts',
    'tenant_cross',
    {
      notes:
        'ops:report-portal-beta-readiness — read-only POR-01 legacy Portal inventory with an explicit cutoff and optional Organization set; canonical identifier/reason/count output only, with no apply or provenance-inference path',
    },
  ),
  ops(
    'scripts/ops/report-guest-response-readiness.ts',
    'scripts/ops/report-guest-response-readiness.ts',
    'tenant_cross',
    {
      notes:
        'ops:report-guest-response-readiness — read-only GST-01 legacy Rating/Feedback and canonical Guest Response reconciliation at an explicit observation time; identifier-only classifications, star distributions, and source/correction/retraction identities; no apply or inferred-provenance path',
    },
  ),
  ops(
    'scripts/ops/report-organization-lifecycle.ts',
    'scripts/ops/report-organization-lifecycle.ts',
    'organization',
    {
      notes:
        'ops:report-organization-lifecycle — read-only exact lifecycle authority and contributor/storage composition readiness; it cannot waive recovery, cancel pending purge, cross the irreversible boundary, reactivate, generate an export, or delete storage',
    },
  ),
  ops(
    'scripts/ops/triage-beta-feedback.ts',
    'scripts/ops/triage-beta-feedback.ts',
    'tenant_cross',
    {
      notes:
        'ops:triage-beta-feedback — content-free support queue report by default; apply changes exactly one delivered feedback receipt with optimistic concurrency, a named pseudonymous owner, ticketed reason, and an append-only transition in the same transaction; report text and masked attachments remain restricted provider content and engineering issues are linked only by an explicit later operator decision',
    },
  ),
  ops(
    'scripts/ops/recover-recent-activity.ts',
    'scripts/ops/recover-recent-activity.ts',
    'tenant_cross',
    {
      notes:
        'ops:recover-recent-activity — explicit-time readiness plus audited, bounded, cursor-resumable repair from Activity-owned replay facts; dry-run is read-only and --apply requires a reason',
    },
  ),
  ops(
    'scripts/ops/reconcile-recent-activity-vocabulary.ts',
    'scripts/ops/reconcile-recent-activity-vocabulary.ts',
    'tenant_cross',
    {
      notes:
        'ops:reconcile-recent-activity-vocabulary — Organization-scoped content-free report and one-pair exact-fingerprint compatibility repair; apply is ticketed, operation-idempotent, typed-confirmed, transactionally receipted, and never infers unmappable vocabulary',
    },
  ),
  ops('scripts/ops/property-erase.ts', 'scripts/ops/property-erase.ts', 'property', {
    notes:
      'ops:property-erase — LIF-01-T19 support-mediated permanent Property Erase. Report-only by default; the destructive path additionally requires --apply, the typed confirmation, an operator id, a ticket, and an INDEPENDENT support authorization reference. It declares no capability on purpose: property.erase stays in BLOCKED_CAPABILITIES, so this operator command is the only entry point and no tenant-facing authorization path exists',
  }),
  ops('scripts/ops/privacy-request.ts', 'scripts/ops/privacy-request.ts', 'property', {
    notes:
      'ops:privacy-request — LIF-01-T20 privacy access, correction, withdrawal and erasure for Guest and Participant subjects. Tenant and property scoped; the subject is named only by the SHA-256 of a verified identifier, never in the clear. Report-only by default, destructive only under --apply',
  }),
  ops(
    'scripts/ops/repair-partial-offboarding.ts',
    'scripts/ops/repair-partial-offboarding.ts',
    'property',
    {
      notes:
        'ops:repair-partial-offboarding — LIF-01-T21 recovery for a membership removal that transferred some responsibilities and then failed. Reports the outstanding transfers by default and completes them only under --apply',
    },
  ),
  ops(
    'scripts/ops/report-legacy-custom-roles.ts',
    'scripts/ops/report-legacy-custom-roles.ts',
    'tenant_cross',
    {
      notes:
        'ops:report-legacy-custom-roles — read-only bullet-12 inventory of retained custom-role rows that must be reconciled or archived before migration; content-free counts at an explicit --as-of, no apply path',
    },
  ),
  ops(
    'scripts/ops/report-legacy-multi-org.ts',
    'scripts/ops/report-legacy-multi-org.ts',
    'tenant_cross',
    {
      notes:
        'ops:report-legacy-multi-org — read-only bullet-12 inventory of users holding more than one Organization binding, which the singular-binding model must reconcile without erasing the evidence needed to resolve the conflict; no apply path',
    },
  ),
  ops(
    'scripts/ops/report-legacy-guest-compatibility.ts',
    'scripts/ops/report-legacy-guest-compatibility.ts',
    'tenant_cross',
    {
      notes:
        'ops:report-legacy-guest-compatibility — read-only bullet-12 inventory of the legacy Guest compatibility rows. It is a reference scan, not a table inventory: the compatibility mirrors it reads are already claimed by ops:report-compatibility-read-surfaces, and claiming them twice would break the one-tool-per-table registry',
    },
  ),
  ops(
    'scripts/ops/report-inbox-handling-cutover.ts',
    'scripts/ops/report-inbox-handling-cutover.ts',
    'tenant_cross',
    {
      notes:
        'ops:report-inbox-handling-cutover — read-only IBX-01 legacy cutover and parity evidence over one Organization: opens a single REPEATABLE READ, READ ONLY snapshot at a mandatory --observed-at, classifies each relationship exact/mappable/ambiguous/orphan, and prints one content-free canonical report with its digest; no apply path and no inferred handling outcome',
    },
  ),
  ops(
    'scripts/ops/report-compatibility-read-surfaces.ts',
    'scripts/ops/report-compatibility-read-surfaces.ts',
    'tenant_cross',
    {
      notes:
        'ops:report-compatibility-read-surfaces — read-only inventory of all seven compatibility_read mirrors plus the Integration-owned physical-to-Drizzle name mapping, carrying an active reader count per mirror so a mirror with live readers can never be presented as a contraction candidate; no apply path',
    },
  ),
  ops(
    'scripts/ops/report-non-fk-references.ts',
    'scripts/ops/report-non-fk-references.ts',
    'tenant_cross',
    {
      notes:
        'ops:report-non-fk-references — read-only non-foreign-key reference scan for contraction candidates covering uuid columns without a declared reference, resource_type/resource_id pairs, textual aggregate identifiers and jsonb documents; content-free counts at an explicit --as-of with no apply path',
    },
  ),
  ops(
    'scripts/ops/rebuild-projection.ts',
    'scripts/ops/rebuild-projection.ts',
    'organization',
    {
      notes:
        'ops:rebuild-projection — repair/rebuild the inbox projection via the rebuildInboxProjection use case (bounded, dry-run default; BQC-7.5)',
    },
  ),
  ops(
    'scripts/ops/rebuild-metric-projection.ts',
    'scripts/ops/rebuild-metric-projection.ts',
    'property',
    {
      notes:
        'ops:rebuild-metric-projection — report-first parity inspection and non-destructive repair for one anonymous Portal lifetime projection; exact Organization/Property/Portal scope, governed Metric facts, and the retained sealed checkpoint remain authoritative',
    },
    'metric.internal',
  ),
  ops(
    'scripts/ops/reconcile-publication.ts',
    'scripts/ops/reconcile-publication.ts',
    'tenant_cross',
    {
      notes:
        'ops:reconcile-publication — reconcile ambiguous Google reply publication (single reply, or one ≤500-row due batch via the sweep bound); provider re-read only, never a send (BQC-3.8/7.5)',
    },
  ),
  ops(
    'scripts/ops/enqueue-refresh.ts',
    'scripts/ops/enqueue-refresh.ts',
    'tenant_cross',
    {
      notes:
        'ops:refresh — bounded re-run of the Review refresh sweep by enqueueing via jobEnqueueOptions (BQC-3 producer contract; dispatch re-authorizes) (BQC-7.5)',
    },
  ),
  ops('scripts/ops/enqueue-purge.ts', 'scripts/ops/enqueue-purge.ts', 'tenant_cross', {
    notes:
      'ops:purge — content-free static retention-rule report by default; retention apply is destructive and typed-confirmed; Review apply reaches the SAFE-03 no-mutation quarantine handler until REV-01 (BQC-7.5/GST-01)',
  }),
  ops(
    'scripts/ops/reparse-review-translations.ts',
    'scripts/ops/reparse-review-translations.ts',
    'property',
    {
      notes:
        "ops:reparse-review-translations — re-splits Google's \"(Translated by Google) … (Original) …\" envelope on reviews stored before the adapter parsed it, so cld3 reads the guest's words instead of Google's English; recomputes content_hash and the ai_source_digest/byte_length pair with the same production functions the sync path uses, via a targeted column UPDATE that leaves source_revision, analysis_sequence and the review lifecycle untouched so no reviewUpdated event crosses the analysis watermark; report/repair, dry-run by default, idempotent (BQC-7.5)",
    },
  ),
  ops('scripts/ops/inspect-decision.ts', 'scripts/ops/inspect-decision.ts', 'property', {
    notes:
      'ops:inspect — read-only policy-decision explanation (org scope); audited per read (BQC-7.5)',
  }),
  ops(
    'scripts/ops/disconnect-connection.ts',
    'scripts/ops/disconnect-connection.ts',
    'organization',
    {
      notes:
        'ops:disconnect-connection — revoke Google connection credentials via disconnectGoogleAccount (revoke+redact+purge; reconnect rotates); destructive: typed --yes; key rotation stays runbook-manual (BQC-7.5)',
    },
  ),
  ops('scripts/ops/gbp-subscribe.ts', 'scripts/ops/gbp-subscribe.ts', 'organization', {
    notes:
      "ops:gbp-subscribe — re-asserts each active/degraded Google connection's GBP notificationSetting at GBP_PUBSUB_TOPIC via manageNotifications.subscribe (idempotent PATCH); the backfill for tenants connected before the import path subscribed automatically, and the ONLY migration path when the topic changes (Google stores the topic on the GBP account); dry-run by default, per-connection outcome report, exits 1 on any candidate short of 'subscribed' (BQC-7.5)",
  }),
  ops('scripts/ops/restore-preflight.ts', 'scripts/ops/restore-preflight.ts', 'none', {
    notes:
      'ops:restore-preflight — guided runbook §8 target preflight (exact loopback or attested Railway PITR sibling, Data Cell binding, journal readability, backup-window checklist); NOT a PITR executor (platform-owned) (REG-04)',
  }),
  ops('scripts/ops/restore-verify.ts', 'scripts/ops/restore-verify.ts', 'tenant_cross', {
    notes:
      'ops:restore-verify — isolated restore retention/recovery proof (REG-04): hard-requires RESTORE_MODE=isolated + exact loopback or attested Railway PITR sibling; runs all retention/Google-import reconciliation in-process, invalidates restored auth/provider/AI/job authority, fences unpublished outbox facts, and records a replayable cell recovery generation; destructive: typed --yes',
  }),
  // ── top-level scripts ─────────────────────────────────────────────
  ops('scripts/audit-member-roles.ts', 'scripts/audit-member-roles.ts', 'tenant_cross', {
    notes: 'audit:member-roles — read-only role audit (raw pg)',
  }),
  ops('scripts/check-db.ts', 'scripts/check-db.ts', 'tenant_cross', {
    notes: 'read-only diagnostics; identifiers + clocks only (BQC-1.6)',
  }),
  ops('scripts/check-schema-drift.ts', 'scripts/check-schema-drift.ts', 'tenant_cross', {
    notes:
      'check:schema-drift — read-only model↔catalog comparison; exits 1 on drift (BQC-5.4)',
  }),
  ops(
    'scripts/check-component-boundaries.mjs',
    'scripts/check-component-boundaries.mjs',
    'none',
    { notes: 'CI lint: component boundary check' },
  ),
  ops(
    'scripts/check-architecture-boundary-controls.mjs',
    'scripts/check-architecture-boundary-controls.mjs',
    'none',
    {
      notes:
        'CI lint: executable negative/positive controls proving production files are classified and architectural dependency policies reject forbidden seams',
    },
  ),
  ops('scripts/check-bundle-budget.mjs', 'scripts/check-bundle-budget.mjs', 'none', {
    notes:
      'check:bundles — CI build gate (BQC-6.8): client bundle budgets on .output/public/assets; exits 1 over budget',
  }),
  ops(
    'scripts/check-production-artifacts.mjs',
    'scripts/check-production-artifacts.mjs',
    'none',
    {
      notes:
        'check:production-artifacts — build/image gate rejecting local-only executables, credentials, simulations, operator commands, and Storybook sources from promoted web/worker artifacts',
    },
  ),
  ops(
    'scripts/check-google-provider-identifiers.mjs',
    'scripts/check-google-provider-identifiers.mjs',
    'none',
    {
      notes:
        'static gate rejecting uncatalogued Google provider-resource literals outside the generated fixture targets',
    },
  ),
  ops(
    'scripts/ai-language-attestation.ts',
    'scripts/ai-language-attestation.ts',
    'none',
    {
      notes:
        'dependency-neutral build helper for domain-separated, length-prefixed AI language-profile attestations',
    },
  ),
  ops(
    'scripts/generate-ai-language-script-table.ts',
    'scripts/generate-ai-language-script-table.ts',
    'none',
    {
      notes:
        'deterministically generates the pinned Unicode script-extension table used by the reply language gate',
    },
  ),
  ops(
    'scripts/generate-ai-reply-language-profile.ts',
    'scripts/generate-ai-reply-language-profile.ts',
    'none',
    {
      notes:
        'deterministically generates the pinned reply-language verifier profile and CLD3 attestation',
    },
  ),
  ops(
    'scripts/generate-ai-review-language-profile.ts',
    'scripts/generate-ai-review-language-profile.ts',
    'none',
    {
      notes:
        'deterministically generates the immutable Review-language catalogue profile',
    },
  ),
  ops(
    'scripts/generate-ai-review-language-regions.ts',
    'scripts/generate-ai-review-language-regions.ts',
    'none',
    {
      notes:
        'deterministically generates the closed supported regional language-tag data',
    },
  ),
  ops(
    'scripts/generate-ai-zh-orthography-table.ts',
    'scripts/generate-ai-zh-orthography-table.ts',
    'none',
    {
      notes:
        'deterministically generates the pinned allocation-free Chinese orthography evidence table',
    },
  ),
  ops(
    'scripts/generate-ai-unicode-case-folding.ts',
    'scripts/generate-ai-unicode-case-folding.ts',
    'none',
    {
      notes:
        'deterministically generates the pinned Unicode case-fold table consumed by ai-source-v1',
    },
  ),
  ops(
    'scripts/generate-google-provider-fixtures.ts',
    'scripts/generate-google-provider-fixtures.ts',
    'none',
    {
      notes:
        'deterministically generates the canonical synthetic Google provider-resource fixture catalogue and test targets',
    },
  ),
  ops('scripts/check-changed-code.mjs', 'scripts/check-changed-code.mjs', 'none', {
    notes:
      'check:changed-code — CI gate (BQC-6.9): every added src production file must carry a colocated test (or a registered exemption)',
  }),
  ops('scripts/local-doctor.mjs', 'scripts/local-doctor.mjs', 'none', {
    notes:
      'local:doctor — read-only local preflight (pinned runtime, docker daemon, stack host ports, stale containers); starts and stops nothing',
  }),
  ops('scripts/check-filenames.mjs', 'scripts/check-filenames.mjs', 'none', {
    notes: 'CI lint: filename convention check',
  }),
  ops(
    'scripts/check-security-headers.mjs',
    'scripts/check-security-headers.mjs',
    'none',
    {
      notes:
        'check:security-headers — CI gate (BQC-7.6, STD-P1-07): boots the built production server and asserts the full B0.7 header set on 200 AND 404 responses, x-request-id behavior, and the 413 body limit; exits 1 listing missing headers',
    },
  ),
  ops(
    'scripts/check-runtime-language-verifier.mjs',
    'scripts/check-runtime-language-verifier.mjs',
    'none',
    {
      notes:
        'check:language-verifier — CI gate: asserts cld3-asm stayed external to the Nitro server bundle and still resolves, initializes its WASM and detects a language from inside .output/server, with the loader matching the sha256 attested by ai-reply-language-verifier-v1.manifest.json; bundling it throws "runtimeModule is not a function" and 500s every reply suggestion',
    },
  ),
  ops('scripts/check-test-quality.mjs', 'scripts/check-test-quality.mjs', 'none', {
    notes:
      'check:test-quality — lint gate (BQC-6.9): focused/skipped tests, generic-error acceptance, unasserted async failures; registered skips only',
  }),
  ops(
    'scripts/check-dependency-audit.mjs',
    'scripts/check-dependency-audit.mjs',
    'none',
    {
      notes:
        'check:dependency-audit — CI gate (BQC-7.7): pnpm audit prod (fail ≥high) + full tree (fail ≥critical, highs reported); dated/owned exceptions in security/audit-exceptions.json, expired/stale fail',
    },
  ),
  ops('scripts/check-licenses.mjs', 'scripts/check-licenses.mjs', 'none', {
    notes:
      'check:licenses — CI gate (BQC-7.7): prod+dev license inventory vs security/license-policy.json allow-list; reviewed exceptions with owner/reason/expiry (expired fails)',
  }),
  ops('scripts/check-action-pins.mjs', 'scripts/check-action-pins.mjs', 'none', {
    notes:
      'check:action-pins — CI gate (BQC-7.7): every workflow uses: is full-SHA pinned with # v… comment; every image: is digest-pinned',
  }),
  ops(
    'scripts/ci/check-container-image-policy.ts',
    'scripts/ci/check-container-image-policy.ts',
    'none',
    {
      notes:
        'check:container-images — read-only CI gate: every Dockerfile is explicitly classified and covered by build, smoke, SBOM, vulnerability scan, release posture, digest pinning, and Dependabot directory policy',
    },
  ),
  ops(
    'scripts/ci/check-typescript-project-coverage.ts',
    'scripts/ci/check-typescript-project-coverage.ts',
    'none',
    {
      notes:
        'check:typescript-project-coverage — read-only OPS-03 gate proving every TypeScript module is owned by an invoked project',
    },
  ),
  ops(
    'scripts/ci/check-product-state-consistency.ts',
    'scripts/ci/check-product-state-consistency.ts',
    'none',
    {
      notes:
        'check:product-state-consistency — read-only EXP-02 gate: inventories query-key, broad invalidation, and local state-mirror sites against an owned classification ledger',
    },
  ),
  ops(
    'scripts/ci/check-runtime-environment-contract.ts',
    'scripts/ci/check-runtime-environment-contract.ts',
    'none',
    {
      notes:
        'check:runtime-environment-contract — digests the files that decide what a deployed service must supply at boot and fails when they move, so a contract change cannot pass repository-only CI and crash-loop production (the 739ccbc9 service-port split exposed this class); writes the snapshot only under --update',
    },
  ),
  ops(
    'scripts/review/zod-v4-conformance.ts',
    'scripts/review/zod-v4-conformance.ts',
    'none',
    {
      notes:
        'check:zod-conformance — scans source code for ambiguous Zod package-root imports and deprecated chained string-format APIs; enforced by lint',
    },
  ),
  ops('scripts/cleanup-all.ts', 'scripts/cleanup-all.ts', 'tenant_cross', {
    notes: 'DIRECT-DB: deletes ALL reviews/replies/inbox items/properties — dev-only',
  }),
  ops('scripts/cleanup-kodes.ts', 'scripts/cleanup-kodes.ts', 'tenant_cross', {
    notes: 'DIRECT-DB: deletes hardcoded KODES property + reviews',
  }),
  ops(
    'scripts/generate-google-ai-policy-clarification.py',
    'scripts/generate-google-ai-policy-clarification.py',
    'none',
    { notes: 'renders policy clarification PDF; no DB access' },
  ),
  ops('scripts/seed.ts', 'scripts/seed.ts', 'tenant_cross', {
    notes: 'seed / seed:simulate — scenario seed + queue jobs; partial DIRECT-DB',
  }),
  ops('scripts/seed-e2e-user.ts', 'scripts/seed-e2e-user.ts', 'tenant_cross', {
    notes:
      'seed:e2e-user — better-auth API + DIRECT-DB writes; writes e2e/.seed-state.json',
  }),
  ops('scripts/seed-demo-reviews.ts', 'scripts/seed-demo-reviews.ts', 'tenant_cross', {
    notes:
      'demo seed — DIRECT-DB inserts of 6 reviews + inbox items (+replies) for UI demos; idempotent by externalId',
  }),
  ops('scripts/simulate.ts', 'scripts/simulate.ts', 'tenant_cross', {
    externalEffect: true,
    notes:
      'local disposable PostgreSQL database lifecycle + deploy-equivalent migrations + seed + invariants; ignores the application DATABASE_URL and reads no inherited/customer data',
  }),
  ops(
    'scripts/simulation-invocation.ts',
    'scripts/simulation-invocation.ts',
    'tenant_cross',
    {
      notes:
        'simulation support library: constructs the shell-free Node/tsx seed invocation; imported by simulate.ts and not a standalone mutator',
    },
  ),
  ops('scripts/test-db-setup.ts', 'scripts/test-db-setup.ts', 'tenant_cross', {
    notes:
      'BQC-6.1 — create + migrate the isolated local scratch test DB (auth:migrate → db:migrate → registered deploy SQL); localhost-guarded, idempotent',
  }),
  ops('scripts/migrate-drizzle.ts', 'scripts/migrate-drizzle.ts', 'tenant_cross', {
    notes:
      'db:migrate — staged local Drizzle runner that commits required enum additions before dependent migrations',
  }),
  ops('scripts/migrate-deploy.ts', 'scripts/migrate-deploy.ts', 'tenant_cross', {
    notes:
      'BQC-7.1 — predeploy migration runner (db:migrate-deploy / Railway preDeployCommand): advisory-locked idempotent sequence (Better Auth, Drizzle journal, registered deploy SQL, provider key inventory); forward recovery — fix forward, rerun converges',
  }),
  ops('scripts/better-auth-schema.ts', 'scripts/better-auth-schema.ts', 'tenant_cross', {
    notes:
      'auth:migrate — applies auth-table changes through the exact repository-pinned Better Auth runtime; never network-fetches a separate CLI',
  }),
  ops(
    'scripts/ops/deploy-ci-images.ts',
    'scripts/ops/deploy-ci-images.ts',
    'tenant_cross',
    {
      externalEffect: true,
      notes:
        'ops:deploy-ci-images — report/apply controller for the three digest-pinned production images proved by a successful main push CI run; refuses cross-revision maps, non-ancestor revisions, and artifacts from any other workflow run, then moves each fixed Railway service only after the previous service is healthy',
    },
  ),
  ops(
    'scripts/ops/provision-google-admission-role.ts',
    'scripts/ops/provision-google-admission-role.ts',
    'tenant_cross',
    {
      notes:
        'ops:google-admission-role — explicit --apply infrastructure provisioner/rotator; uses the Railway PostgreSQL owner credential to grant one login only the four journaled Google permit operations and no tables or sequences',
    },
  ),
  ops(
    'scripts/ops/identity-invitation-fact-contract.ts',
    'scripts/ops/identity-invitation-fact-contract.ts',
    'tenant_cross',
    {
      notes:
        'ops:identity-invitation-facts — report-first rolling v1→v2 fact issuance, bounded PostgreSQL/live-queue/quarantine redaction, zero-copy verification, and pre-verification rollback; mutations require quiesced queues and typed confirmation',
    },
  ),
  ops(
    'scripts/ops/ai-execution-control.ts',
    'scripts/ops/ai-execution-control.ts',
    'tenant_cross',
    {
      notes:
        'ops:ai-control — ticketed hierarchical global/provider/capability kill, drain, and canary-gated restore controls',
    },
  ),
  ops(
    'scripts/ops/ai-approve-enrollment.ts',
    'scripts/ops/ai-approve-enrollment.ts',
    'property',
    {
      notes:
        'ops:ai-approve-enrollment — ticketed, typed-confirmation approval of one exact, complete first-enablement snapshot above the fixed 10,000-revision safety ceiling; records content-free immutable approval evidence but never changes consent, selects a subset, starts replay, or activates provider execution',
    },
    'ai.analyze',
  ),
  ops(
    'scripts/ops/permit-start-deadline-backfill.ts',
    'scripts/ops/permit-start-deadline-backfill.ts',
    'tenant_cross',
    {
      notes:
        'ops:permit-start-deadline-fence — one-off bounded backfill of admitted execution permits past start_deadline_at; reuses the recurring sweeper and its fenceElapsedStartDeadlinePermit path (no raw UPDATE)',
    },
  ),
  ops(
    'scripts/verify-auth-schema.mjs',
    'scripts/verify-auth-schema.mjs',
    'tenant_cross',
    { notes: 'audit:auth-schema — read-only better-auth column casing check' },
  ),
  // ── migrations (DIRECT-DB) ────────────────────────────────────────
  ops(
    'scripts/migrations/null-inbox-source-copies.ts',
    'scripts/migrations/null-inbox-source-copies.ts',
    'tenant_cross',
    { notes: 'DIRECT-DB: BQC-1.2 null-backfill of inbox raw copies; resumable batches' },
  ),
  ops(
    'scripts/migrations/0000-auth-tables-bootstrap.sql',
    'scripts/migrations/0000-auth-tables-bootstrap.sql',
    'tenant_cross',
    {
      notes:
        'RECOVERY-ONLY DIRECT-DB (psql): db:bootstrap-auth — compatibility provisioning for 8 Better Auth baseline tables; normal deploy uses db:migrate-deploy',
    },
  ),
  ops(
    'scripts/migrations/2026-07-06-permission-version-triggers.sql',
    'scripts/migrations/2026-07-06-permission-version-triggers.sql',
    'tenant_cross',
    { notes: 'DIRECT-DB (psql): DAC permission-version triggers + last-owner guard' },
  ),
  ops(
    'scripts/migrations/verify-existing-emails.sql',
    'scripts/migrations/verify-existing-emails.sql',
    'tenant_cross',
    { notes: 'DIRECT-DB (psql): marks all existing users email-verified' },
  ),
  ops(
    'scripts/migrations/denormalize-inbox-reviewer-name.sql',
    'scripts/migrations/denormalize-inbox-reviewer-name.sql',
    'tenant_cross',
    {
      notes: 'DIRECT-DB (psql): legacy inbox reviewer_name copy (writes stopped BQC-1.2)',
    },
  ),
  ops(
    'scripts/migrations/fix-portal-schema-sync.sql',
    'scripts/migrations/fix-portal-schema-sync.sql',
    'tenant_cross',
    { notes: 'DIRECT-DB (psql): portal sort_key + group-members table' },
  ),
  ops(
    'scripts/migrations/add-reply-unique-index.sql',
    'scripts/migrations/add-reply-unique-index.sql',
    'tenant_cross',
    { notes: 'DIRECT-DB (psql): one published reply per review' },
  ),
  // ── local beta stack ───────────────────────────────────────────────
  ops('scripts/local-stack/stack.ts', 'scripts/local-stack/stack.ts', 'tenant_cross', {
    notes:
      'Generates revision-bound loopback configuration and orchestrates the isolated Docker acceptance stack',
  }),
  ops(
    'scripts/local-stack/fault-operation.ts',
    'scripts/local-stack/fault-operation.ts',
    'tenant_cross',
    {
      notes:
        'Executes one bounded Compose dependency fault/restore probe selected by the beta stack acceptance controller',
    },
  ),
  // ── perf ──────────────────────────────────────────────────────────
  ops('scripts/perf/load-test.ts', 'scripts/perf/load-test.ts', 'none', {
    notes:
      'perf:catalog prints the SLO/scenario/fault catalogue; perf:run executes scenario harnesses via the BQC-3 producer seam (BQC-8.1)',
  }),
  ops('scripts/perf/seed-scale.ts', 'scripts/perf/seed-scale.ts', 'tenant_cross', {
    notes:
      'DIRECT-DB: deterministic scale dataset load/verify/clean (raw pg bulk INSERT, manifest hash, BQC-8.1)',
  }),
  ops('scripts/perf/seed-fleet.ts', 'scripts/perf/seed-fleet.ts', 'tenant_cross', {
    notes:
      'DIRECT-DB: deterministic beta-local 5,000-property P1/P2 fleet fixture with constant-query verification evidence',
  }),
  ops(
    'scripts/perf/write-scale-evidence.ts',
    'scripts/perf/write-scale-evidence.ts',
    'none',
    {
      notes:
        'perf:evidence — ingests measured scenario results into scale-and-recovery evidence; fails closed on missing samples/identity (BQC-8.1)',
    },
  ),
  ops('scripts/perf/staging-cell.ts', 'scripts/perf/staging-cell.ts', 'tenant_cross', {
    notes:
      'perf:cell — local production-shaped cell orchestration: creates/migrates/drops ONLY repkey_bqc8_* databases, spawns web/worker/stub processes (BQC-8.2)',
  }),
  ops('scripts/perf/cell-stub-server.ts', 'scripts/perf/cell-stub-server.ts', 'none', {
    notes:
      'perf:cell stub process — GBP/mail sandbox fixtures serving the cell (no DB; provider endpoints pinned here, BQC-8.2)',
  }),
  // ── package.json-only commands (CLI tools, no repo script file) ───
  ops('db:generate', 'package.json', 'none', {
    notes: 'drizzle-kit generate — writes migration SQL (broken meta chain: STD-P2-02)',
  }),
  ops('db:migrate', 'package.json', 'tenant_cross', {
    notes: 'drizzle-kit migrate — schema db-write',
  }),
  ops('db:push', 'package.json', 'tenant_cross', {
    notes: 'drizzle-kit push — schema db-write',
  }),
  ops('db:pull', 'package.json', 'tenant_cross', {
    notes: 'drizzle-kit pull — introspects DB to files',
  }),
]

export const ENTRY_POINT_CATALOGUE: ReadonlyArray<EntryPointRow> = [
  ...SERVER_FUNCTION_ROWS,
  ...ROUTE_UI_ROWS,
  ...ROUTE_API_ROWS,
  ...JOB_ROWS,
  ...CONSUMER_ROWS,
  ...SCHEDULE_ROWS,
  ...OPERATOR_ROWS,
]
