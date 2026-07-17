// EntryPointCatalogue — BQC-2.1 / STD-P1-02 / SPEC-P0-03.
//
// The canonical action/resource assignment for every executable entry point
// in the system (ADR 0033, phase BQC-2 §2.1). The guard test
// (entry-point-catalogue.test.ts) fails when a route, server function, job,
// consumer, schedule, API endpoint, or operator command exists without a
// catalogue row — or when a row drifts from what the code actually does.
//
// Row vocabulary:
//   kind          — server_function | route_ui | route_api | job | consumer |
//                   schedule | operator_command
//   action        — a Permission for user actions; a SystemAction for
//                   system/session/public/operator work
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
// docs/product-readiness-program-2026-07/beta-quality-remediation-2026-07/completion-program-2026-07/bqc2-action-resource-catalogue.md

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
  | 'tenant_cross' // system work spanning tenants (sweeps, rollups)
  | 'none'

export type BetaPosture = 'core' | 'non_core' | 'blocked'

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
  // guest / public surface (dark — portal.read gated)
  | 'system:guest.portal_read'
  | 'system:guest.rating'
  | 'system:guest.feedback'
  | 'system:guest.scan'
  | 'system:guest.click_track'
  // machine ingress
  | 'system:integration.google_callback'
  | 'system:integration.gbp_webhook'
  // UI rendering (page-level; data gated by server functions)
  | 'system:ui.render'
  // delayed/system execution
  | 'system:health.check'
  | 'system:image.process'
  | 'system:property.import'
  | 'system:review.sync'
  | 'system:review.refresh_sweep'
  | 'system:review.purge'
  | 'system:reply.publish'
  | 'system:metric.refresh'
  | 'system:metric.record'
  | 'system:retention.sweep'
  | 'system:goal.reconcile'
  | 'system:goal.spawn'
  | 'system:goal.progress'
  | 'system:badge.reconcile'
  | 'system:badge.evaluate'
  | 'system:leaderboard.reconcile'
  | 'system:leaderboard.refresh'
  | 'system:activity.record'
  | 'system:notification.insert'
  | 'system:notification.email_urgent'
  | 'system:notification.email_digest'
  | 'system:inbox.update'
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
   * BQC-2.5 contract into the runtime call site for this entry point.
   * This field IS the record of delayed entry points awaiting BQC-3.
   */
  policyIntegration?: 'pending_bqc3'
  /** True when code carries no mechanically checkable authz — BQC-2.4 must wire. */
  canonicalOnly?: boolean
  notes?: string
}>

/** Beta posture derived from the authoritative capability sets (ADR 0032). */
export function postureForCapability(cap: Capability | 'none'): BetaPosture {
  if (cap === 'none') return 'core'
  if (isBlockedCapability(cap)) return 'blocked'
  if (isCoreCapability(cap)) return 'core'
  return 'non_core'
}

// ── Row factories (records of functions — no classes) ───────────────

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
  return {
    id: `${kind}:${name}`,
    kind,
    name,
    file,
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

/** Server function (default: authenticated user principal). */
const sf = (
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
    { action, capability, resourceScope, principals: ['user'] },
    opts,
  )

/** Public server function (unauthenticated principal). */
const sfPublic = (
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
    { action, capability, resourceScope, principals: ['public'] },
    opts,
  )

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
    { policyIntegration: 'pending_bqc3', ...opts },
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
    { policyIntegration: 'pending_bqc3', ...opts, eventTags },
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
    { policyIntegration: 'pending_bqc3', ...opts },
  )

/** Operator command (operator principal; DIRECT-DB bypasses flagged in notes). */
const ops = (
  name: string,
  file: string,
  resourceScope: ResourceScope,
  opts: RowOpts = {},
): EntryPointRow =>
  row(
    'operator_command',
    name,
    file,
    { action: 'system:ops', capability: 'none', resourceScope, principals: ['operator'] },
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
const TEAM = 'src/contexts/team/server'
const LEADERBOARD = 'src/contexts/leaderboard/server'
const BADGE = 'src/contexts/badge/server'
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
      'identity.register',
      'none',
      { notes: 'public unauthenticated; IP rate-limited' },
    ),
    sfPublic(
      'registerUserAndOrg',
      `${IDENTITY}/organizations.registration.ts`,
      'system:identity.register',
      'organization.create',
      'none',
      { notes: 'public; creates org; IP rate-limited' },
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
      { canonicalOnly: true, notes: 'session-only, no permission assert' },
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
      'getOrgResponseSlaFn',
      `${IDENTITY}/organizations.response-sla.ts`,
      'dashboard.read',
      'dashboard.use',
      'organization',
      { notes: 'tolerates no-active-org' },
    ),
    sf(
      'updateOrgResponseSlaFn',
      `${IDENTITY}/organizations.response-sla.ts`,
      'organization.update',
      'identity.invite',
      'organization',
      { notes: 'policy-wired in BQC-2.4 (organization.update); use case re-checks' },
    ),
    sf(
      'createCustomRole',
      `${IDENTITY}/organizations.roles.ts`,
      'member.update',
      'identity.invite',
      'organization',
      { notes: 'use case re-checks + escalation guard' },
    ),
    sf(
      'updateCustomRole',
      `${IDENTITY}/organizations.roles.ts`,
      'member.update',
      'identity.invite',
      'organization',
    ),
    sf(
      'deleteCustomRole',
      `${IDENTITY}/organizations.roles.ts`,
      'member.update',
      'identity.invite',
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
      { notes: 'F045 closed in BQC-2.4: assertGlobalCapability(organization.create)' },
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
  ],

  // ── property ──────────────────────────────────────────────────────
  ...[
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
      'deleteProperty',
      `${PROPERTY}/property-read.ts`,
      'property.delete',
      'property.create',
      'property',
      { notes: 'soft-delete; policy-wired in BQC-2.4 with target propertyId' },
    ),
  ],

  // ── integration ───────────────────────────────────────────────────
  ...[
    sf(
      'connectGoogle',
      `${INTEGRATION}/google-connections.ts`,
      'integration.manage',
      'integration.use',
      'organization',
      { externalEffect: true, notes: 'exchanges OAuth code, stores Google tokens' },
    ),
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
      'listGbpLocations',
      `${INTEGRATION}/gbp-import.ts`,
      'integration.manage',
      'integration.use',
      'organization',
      { externalEffect: true, notes: 'calls Google GBP API; POST used for a read' },
    ),
    sf(
      'startPropertyImport',
      `${INTEGRATION}/gbp-import.ts`,
      'property.create',
      'property.create',
      'organization',
      {
        externalEffect: true,
        notes: 'enqueues GBP import/sync jobs; effect executes in worker',
      },
    ),
    sf(
      'getImportStatus',
      `${INTEGRATION}/gbp-import.ts`,
      'integration.manage',
      'integration.use',
      'organization',
      { notes: 'POST used for a read' },
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
    sf(
      'getStaffRecentActivity',
      `${REVIEW}/staff-recent-activity.ts`,
      'review.read',
      'review.use',
      'property',
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
      'getInboxNotesFn',
      `${INBOX}/inbox-item-queries.ts`,
      'inbox.read',
      'inbox.use',
      'property',
      { notes: 'scoped via inboxItemId' },
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
      'addInboxNoteFn',
      `${INBOX}/inbox-item-actions.ts`,
      'inbox.write',
      'inbox.use',
      'property',
      { notes: 'scoped via inboxItemId' },
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
      'getStaffDashboardDataFn',
      `${DASHBOARD}/staff-dashboard.ts`,
      'dashboard.read',
      'dashboard.use',
      'property',
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
      'getPortalAnalyticsFn',
      `${DASHBOARD}/portal-analytics.ts`,
      'dashboard.read',
      'dashboard.use',
      'property',
      { notes: '+ isPropertyAccessibleForPermission check (D6-001)' },
    ),
    sf(
      'getAttentionSignalsFn',
      `${DASHBOARD}/attention-signals.ts`,
      'dashboard.read',
      'dashboard.use',
      'property',
      {
        alsoActions: ['dashboard.fleet_read'],
        notes: '+ property-access check (D6-001)',
      },
    ),
  ],

  // ── notification ──────────────────────────────────────────────────
  ...[
    sf(
      'getUnreadNotificationCountFn',
      `${NOTIFICATION}/notifications.ts`,
      'notification.read',
      'notification.in_app',
      'organization',
      { notes: 'tolerates no-active-org (returns 0)' },
    ),
    sf(
      'getNotificationsFn',
      `${NOTIFICATION}/notifications.ts`,
      'notification.read',
      'notification.in_app',
      'organization',
      { notes: 'tolerates no-active-org' },
    ),
    sf(
      'markNotificationReadFn',
      `${NOTIFICATION}/notifications.ts`,
      'notification.update',
      'notification.in_app',
      'organization',
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
      { notes: 'staged RPC, UI not yet wired' },
    ),
    sf(
      'updateNotificationPreferenceFn',
      `${NOTIFICATION}/notifications.ts`,
      'notification.update',
      'notification.in_app',
      'organization',
      { notes: 'staged RPC, UI not yet wired' },
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
      'getOrgActivityFn',
      `${ACTIVITY}/activity.ts`,
      'inbox.read',
      'inbox.use',
      'property',
      {
        notes:
          'activity surface gated via inbox.read → inbox.use today; remap to activity.use in BQC-2.4',
      },
    ),
  ],

  // ── goal (dark) ───────────────────────────────────────────────────
  ...[
    sf('createGoal', `${GOAL}/goals.ts`, 'goal.create', 'goal.use', 'property'),
    sf('updateGoal', `${GOAL}/goals.ts`, 'goal.update', 'goal.use', 'property', {
      notes: 'scoped via goalId',
    }),
    sf('cancelGoal', `${GOAL}/goals.ts`, 'goal.cancel', 'goal.use', 'property', {
      notes: 'scoped via goalId',
    }),
    sf('listGoals', `${GOAL}/goals.ts`, 'goal.read', 'goal.use', 'property'),
    sf('getGoal', `${GOAL}/goals.ts`, 'goal.read', 'goal.use', 'property', {
      notes: 'scoped via goalId',
    }),
    sf('listStaffGoals', `${GOAL}/staff-goals.ts`, 'goal.read', 'goal.use', 'property'),
  ],

  // ── team (dark) ───────────────────────────────────────────────────
  ...[
    sf('createTeam', `${TEAM}/teams.ts`, 'team.create', 'team.use', 'property'),
    sf('updateTeam', `${TEAM}/teams.ts`, 'team.update', 'team.use', 'property', {
      notes: 'scoped via teamId',
    }),
    sf('listTeams', `${TEAM}/teams.ts`, 'team.read', 'team.use', 'property'),
    sf('deleteTeam', `${TEAM}/teams.ts`, 'team.delete', 'team.use', 'property', {
      notes: 'soft-delete; scoped via teamId',
    }),
  ],

  // ── leaderboard (dark) ────────────────────────────────────────────
  ...[
    sf(
      'getLeaderboard',
      `${LEADERBOARD}/leaderboards.ts`,
      'leaderboard.read',
      'leaderboard.use',
      'property',
    ),
    sf(
      'getComparisonMatrix',
      `${LEADERBOARD}/leaderboards.ts`,
      'leaderboard.read',
      'leaderboard.use',
      'property',
    ),
  ],

  // ── badge (dark) ──────────────────────────────────────────────────
  ...[
    sf(
      'getStaffVisibleBadges',
      `${BADGE}/badges.ts`,
      'badge.read',
      'badge.use',
      'property',
    ),
    sf(
      'getVisibleTargetBadges',
      `${BADGE}/badges.ts`,
      'badge.read',
      'badge.use',
      'property',
      { notes: '+ role-filtered visibility check (Staff/PM)' },
    ),
    sf(
      'setOrganizationBadgeEnablement',
      `${BADGE}/badges.ts`,
      'badge.manage',
      'badge.use',
      'organization',
    ),
    sf(
      'getOrganizationBadgeDefinitionsFn',
      `${BADGE}/badges.ts`,
      'badge.read',
      'badge.use',
      'organization',
    ),
  ],

  // ── staff ─────────────────────────────────────────────────────────
  ...[
    sf(
      'createStaffAssignment',
      `${STAFF}/staff-assignments.ts`,
      'staff_assignment.create',
      'staff.use',
      'property',
    ),
    sf(
      'removeStaffAssignment',
      `${STAFF}/staff-assignments.ts`,
      'staff_assignment.delete',
      'staff.use',
      'property',
      { notes: 'scoped via assignmentId' },
    ),
    sf(
      'listStaffAssignments',
      `${STAFF}/staff-assignments.ts`,
      'staff_assignment.read',
      'staff.use',
      'property',
    ),
    sf(
      'updateStaffPortals',
      `${STAFF}/staff-portals-update.ts`,
      'staff_assignment.create',
      'staff.use',
      'property',
      { notes: 'defense-in-depth; use case also enforces' },
    ),
    sf(
      'listStaffPortals',
      `${STAFF}/staff-portals.ts`,
      'staff_assignment.read',
      'staff.use',
      'property',
    ),
  ],

  // ── portal (dark; write/upload hard-blocked) ──────────────────────
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
      { notes: 'scoped via portalId' },
    ),
    sf('listPortals', `${PORTAL}/portals.ts`, 'portal.read', 'portal.read', 'property'),
    sf('getPortal', `${PORTAL}/portals.ts`, 'portal.read', 'portal.read', 'property', {
      notes: 'scoped via portalId',
    }),
    sf(
      'deletePortal',
      `${PORTAL}/portals.ts`,
      'portal.delete',
      'portal.write',
      'property',
      { notes: 'soft-delete via use case; scoped via portalId' },
    ),
    sf(
      'requestUploadUrl',
      `${PORTAL}/portals.ts`,
      'portal.create',
      'portal.upload',
      'property',
      { externalEffect: true, notes: 'issues S3 presigned upload URL' },
    ),
    sf(
      'finalizeUpload',
      `${PORTAL}/portals.ts`,
      'portal.create',
      'portal.upload',
      'property',
      { externalEffect: true, notes: 'verifies uploaded object in S3' },
    ),
    sf(
      'getPortalForQR',
      `${PORTAL}/portals.ts`,
      'portal.read',
      'portal.read',
      'property',
      { notes: 'scoped via portalId' },
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
    ),
    sf(
      'removePortalFromGroup',
      `${PORTAL}/portal-groups.ts`,
      'portal.update',
      'portal.write',
      'property',
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
      'submitRatingFn',
      `${GUEST}/public.ts`,
      'system:guest.rating',
      'portal.read',
      'property',
      { notes: 'public; guest session cookie + rate limit' },
    ),
    sfPublic(
      'submitFeedbackFn',
      `${GUEST}/public.ts`,
      'system:guest.feedback',
      'portal.read',
      'property',
      { notes: 'public; honeypot + rate limit' },
    ),
    sfPublic(
      'recordScanFn',
      `${GUEST}/guest-scans.ts`,
      'system:guest.scan',
      'portal.read',
      'property',
      { notes: 'public unauthenticated write; rate-limited' },
    ),
    sfPublic(
      'getPublicPortal',
      `${GUEST}/guest-scans.ts`,
      'system:guest.portal_read',
      'portal.read',
      'property',
      { notes: 'public portal read' },
    ),
    sfPublic(
      'resolveLinkAndTrack',
      `${GUEST}/guest-scans.ts`,
      'system:guest.click_track',
      'portal.read',
      'property',
      { notes: 'public click-tracking redirect' },
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
      '/register',
      `${ROUTES}/register.tsx`,
      'system:identity.register',
      'identity.register',
      'none',
      {
        principals: ['public'],
        notes: 'beforeLoad asserts identity.register capability',
      },
    ),
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
      '/p/$propertySlug/$portalSlug',
      `${ROUTES}/p/$propertySlug/$portalSlug.tsx`,
      'system:guest.portal_read',
      'portal.read',
      'property',
      {
        principals: ['public'],
        notes: 'guest portal; sets guest_session cookie, records scan',
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
    ui(
      '/home',
      `${AUTHED}/home.tsx`,
      'system:ui.render',
      'dashboard.use',
      'organization',
      { notes: 'staff surface; loader via staff server fns' },
    ),
    ui(
      '/progress',
      `${AUTHED}/progress.tsx`,
      'system:ui.render',
      'goal.use',
      'organization',
      { notes: 'staff goals surface (dark)' },
    ),
    ui(
      '/leaderboard',
      `${AUTHED}/leaderboard.tsx`,
      'system:ui.render',
      'leaderboard.use',
      'organization',
      { notes: 'staff leaderboard surface (dark)' },
    ),
    ui('/team', `${AUTHED}/team.tsx`, 'system:ui.render', 'team.use', 'organization', {
      notes: 'placeholder page (dark)',
    }),
    ui(
      '/import',
      `${AUTHED}/import/index.tsx`,
      'integration.manage',
      'integration.use',
      'organization',
      { notes: 'Google OAuth connect + GBP import start' },
    ),
    ui(
      '/import/$importId',
      `${AUTHED}/import/$importId.tsx`,
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
      '/settings/recognition',
      `${AUTHED}/settings/recognition.tsx`,
      'badge.manage',
      'badge.use',
      'organization',
      { notes: 'badge admin surface (dark)' },
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
      '/properties/$propertyId/metrics',
      `${AUTHED}/properties/$propertyId/metrics.tsx`,
      'dashboard.read',
      'dashboard.use',
      'property',
      { notes: 'placeholder "coming soon"' },
    ),
    ui(
      '/properties/$propertyId/people',
      `${AUTHED}/properties/$propertyId/people.tsx`,
      'staff_assignment.read',
      'staff.use',
      'property',
      { notes: 'staff/teams/portal assignments' },
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
    ui(
      '/properties/$propertyId/teams/$teamId (layout)',
      `${AUTHED}/properties/$propertyId/teams/$teamId.tsx`,
      'team.read',
      'team.use',
      'property',
      { notes: 'team layout with tabs; loader notFound if missing (dark)' },
    ),
    ui(
      '/properties/$propertyId/teams/$teamId',
      `${AUTHED}/properties/$propertyId/teams/$teamId/index.tsx`,
      'system:ui.render',
      'team.use',
      'property',
      { notes: 'team settings tab (dark)' },
    ),
    ui(
      '/properties/$propertyId/teams/$teamId/members',
      `${AUTHED}/properties/$propertyId/teams/$teamId/members.tsx`,
      'system:ui.render',
      'team.use',
      'property',
      { notes: 'team members tab (dark)' },
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
    { notes: 'combined DB+Redis readiness (legacy-compatible)' },
  ),
  api(
    '/api/health/live',
    `${ROUTES}/api/health/live.ts`,
    'system:health.check',
    'none',
    'none',
    { notes: 'process liveness probe' },
  ),
  api(
    '/api/health/ready',
    `${ROUTES}/api/health/ready.ts`,
    'system:health.check',
    'none',
    'none',
    { notes: 'DB+Redis readiness probe' },
  ),
  api(
    '/api/health/metrics',
    `${ROUTES}/api/health/metrics.ts`,
    'system:health.check',
    'none',
    'none',
    { notes: 'ops metrics: outbox lag, queue depths, worker heartbeat; no-store' },
  ),
  api(
    '/api/portals/$id/qr',
    `${ROUTES}/api/portals/$id/qr.ts`,
    'portal.read',
    'portal.read',
    'property',
    {
      principals: ['user'],
      notes: 'session + assertBetaCapability(portal.read) via getPortalForQR; QR PNG',
    },
  ),
  api(
    '/api/public/click/$linkId',
    `${ROUTES}/api/public/click/$linkId.ts`,
    'system:guest.click_track',
    'portal.read',
    'property',
    {
      notes:
        'validates external URL; 302 redirect; no capability assert in code — BQC-2.4 wires',
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
        'Google Pub/Sub JWT verify (audience-bound); enqueues sync-property-reviews; capability not asserted in code — job handler gates',
    },
  ),
]

const JOB_ROWS: ReadonlyArray<EntryPointRow> = [
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
      notes: 'R2/S3 fetch+upload (sharp resize); registration-gated; no-op when dark',
    },
  ),
  job(
    'import-property',
    'src/contexts/integration/infrastructure/jobs/import-property.job.ts',
    'system:property.import',
    'property.connect_gbp',
    'property',
    { externalEffect: true, notes: 'GBP property import; in-handler capability gate' },
  ),
  job(
    'sync-property-reviews',
    'src/contexts/review/infrastructure/jobs/sync-property-reviews.job.ts',
    'system:review.sync',
    'property.connect_gbp',
    'property',
    {
      externalEffect: true,
      notes: 'GBP review sync; in-handler gate; enqueued manual/cron/webhook/sweep',
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
    'purge-expired-reviews',
    'src/contexts/review/infrastructure/jobs/purge-expired-reviews.job.ts',
    'system:review.purge',
    'none',
    'tenant_cross',
    { notes: 'DB delete + review.expired event; retention evidence rows' },
  ),
  job(
    'publish-reply',
    'src/contexts/review/infrastructure/jobs/publish-reply.job.ts',
    'system:reply.publish',
    'property.publish_reply',
    'property',
    {
      externalEffect: true,
      notes: 'GBP reply publish; in-handler gate; max 3 attempts → publish_failed',
    },
  ),
  job(
    'refresh-daily-metrics',
    'src/contexts/metric/infrastructure/jobs/refresh-materialized-view.job.ts',
    'system:metric.refresh',
    'none',
    'tenant_cross',
    { notes: 'incremental rollup' },
  ),
  job(
    'refresh-weekly-metrics',
    'src/contexts/metric/infrastructure/jobs/refresh-materialized-view.job.ts',
    'system:metric.refresh',
    'none',
    'tenant_cross',
    { notes: 'incremental rollup' },
  ),
  job(
    'refresh-daily-inbox-metrics',
    'src/contexts/metric/infrastructure/jobs/refresh-materialized-view.job.ts',
    'system:metric.refresh',
    'none',
    'tenant_cross',
    { notes: 'incremental rollup' },
  ),
  job(
    'retention-sweep',
    'src/shared/jobs/retention-sweep.job.ts',
    'system:retention.sweep',
    'none',
    'tenant_cross',
    { notes: 'BQC-1.6: 9 rules; evidence in retention_runs; throws on any rule failure' },
  ),
  job(
    'reconcile-goal-progress',
    'src/contexts/goal/infrastructure/jobs/reconcile-goal-progress.job.ts',
    'system:goal.reconcile',
    'goal.use',
    'tenant_cross',
    { notes: 'registration-gated; no-op when dark' },
  ),
  job(
    'spawn-recurring-instances',
    'src/contexts/goal/infrastructure/jobs/spawn-recurring-instances.job.ts',
    'system:goal.spawn',
    'goal.use',
    'tenant_cross',
    { notes: 'registration-gated; spawns goal instances ±1 day window' },
  ),
  job(
    'insert-activity-log',
    'src/contexts/activity/infrastructure/jobs/insert-activity-log.job.ts',
    'system:activity.record',
    'none',
    'organization',
    { notes: 'enqueued by 24 activity event handlers' },
  ),
  job(
    'insert-notification',
    'src/contexts/notification/infrastructure/jobs/insert-notification.job.ts',
    'system:notification.insert',
    'none',
    'organization',
    { notes: 'DB insert + email-queue rows; enqueued by 11 notification event handlers' },
  ),
  job(
    'urgent-email',
    'src/contexts/notification/infrastructure/jobs/urgent-email.job.ts',
    'system:notification.email_urgent',
    'notification.send_email',
    'organization',
    { externalEffect: true, notes: 'Resend send; registration-gated; blocked for beta' },
  ),
  job(
    'digest-notification',
    'src/contexts/notification/infrastructure/jobs/digest-notification.job.ts',
    'system:notification.email_digest',
    'notification.send_email',
    'organization',
    {
      externalEffect: true,
      notes:
        'hourly tick → sends at org 8am local (ADR 0011); registration-gated; blocked for beta',
    },
  ),
  job(
    'badge.reconcile',
    'src/bootstrap.ts',
    'system:badge.reconcile',
    'badge.use',
    'tenant_cross',
    { notes: 'inline literal (no *.job.ts); registration-gated; dark' },
  ),
  job(
    'leaderboard.reconcile',
    'src/bootstrap.ts',
    'system:leaderboard.reconcile',
    'leaderboard.use',
    'tenant_cross',
    { notes: 'inline literal (no *.job.ts); registration-gated; dark' },
  ),
]

const CONSUMER_ROWS: ReadonlyArray<EntryPointRow> = [
  consumer(
    'inbox.outbox-consumers',
    'src/contexts/inbox/infrastructure/outbox-consumers.ts',
    'system:inbox.update',
    'none',
    'organization',
    ['review.created', 'review.expired'],
    {
      notes:
        'durable outbox consumers (receipt-idempotent); dispatch disabled — BQR-0 containment',
    },
  ),
  consumer(
    'activity.event-handlers',
    'src/contexts/activity/infrastructure/event-handlers/index.ts',
    'system:activity.record',
    'none',
    'organization',
    [
      'inbox.inbox_item.created',
      'inbox.inbox_item.status_changed',
      'inbox.inbox_item.escalated',
      'inbox.inbox_item.escalation_resolved',
      'inbox.inbox_item.assigned',
      'inbox.inbox_item.unassigned',
      'inbox.inbox_note.added',
      'inbox.inbox_item.bulk_status_changed',
      'review.reply.published',
      'review.reply.submitted',
      'review.reply.approved',
      'review.reply.rejected',
      'team.created',
      'team.updated',
      'team.deleted',
      'staff.assigned',
      'staff.unassigned',
      'identity.member.invited',
      'identity.invitation.accepted',
      'identity.invitation.canceled',
      'identity.member.removed',
      'identity.member.role_changed',
      'integration.google_account.connected',
      'integration.google_account.disconnected',
    ],
    { notes: 'each handler enqueues insert-activity-log' },
  ),
  consumer(
    'badge.event-handlers',
    'src/contexts/badge/infrastructure/event-handlers/index.ts',
    'system:badge.evaluate',
    'none',
    'organization',
    ['metric.recorded'],
    { notes: 'dark context; ungated in code — BQC-2.6 gates or removes' },
  ),
  consumer(
    'goal.event-handlers',
    'src/contexts/goal/infrastructure/event-handlers/index.ts',
    'system:goal.progress',
    'none',
    'organization',
    ['metric.recorded', 'portal.deleted', 'portal_group.deleted'],
    { notes: 'dark context; ungated in code — BQC-2.6 gates or removes' },
  ),
  consumer(
    'leaderboard.event-handlers',
    'src/contexts/leaderboard/infrastructure/event-handlers/index.ts',
    'system:leaderboard.refresh',
    'none',
    'organization',
    ['metric.recorded'],
    { notes: 'dark context; ungated in code — BQC-2.6 gates or removes' },
  ),
  consumer(
    'metric.event-handlers',
    'src/contexts/metric/infrastructure/event-handlers/index.ts',
    'system:metric.record',
    'none',
    'organization',
    [
      'guest.scan.recorded',
      'guest.rating.submitted',
      'guest.feedback.submitted',
      'guest.review_link.clicked',
      'review.created',
    ],
    { notes: 'guest-sourced tags only flow when portal.read is enabled (dark)' },
  ),
  consumer(
    'notification.event-handlers',
    'src/contexts/notification/infrastructure/event-handlers/index.ts',
    'system:notification.insert',
    'none',
    'organization',
    [
      'inbox.inbox_item.created',
      'inbox.inbox_item.assigned',
      'inbox.inbox_item.escalated',
      'inbox.inbox_note.added',
      'review.reply.submitted',
      'review.reply.approved',
      'review.reply.rejected',
      'review.reply.published',
      'review.reply.publish_failed',
      'goal.completed',
      'badge.awarded',
    ],
    { notes: 'each handler enqueues insert-notification' },
  ),
  consumer(
    'review.event-handlers',
    'src/contexts/review/infrastructure/event-handlers/index.ts',
    'system:review.sync',
    'none',
    'property',
    ['property.created'],
    { notes: 'enqueues initial GBP sync (job handler gates capability)' },
  ),
  consumer(
    'inbox.event-handlers',
    'src/contexts/inbox/infrastructure/event-handlers/index.ts',
    'system:inbox.update',
    'none',
    'organization',
    [
      'review.created',
      'guest.feedback.submitted',
      'review.reply.published',
      'review.reply.submitted',
      'review.expired',
    ],
    { notes: 'in-process twin of the durable consumers' },
  ),
]

const SCHEDULE_ROWS: ReadonlyArray<EntryPointRow> = [
  schedule('health-check-recurring', 'system:health.check', 'none', 'none', {
    notes: 'every 5 min',
  }),
  schedule(
    'refresh-expiring-reviews-recurring',
    'system:review.refresh_sweep',
    'none',
    'tenant_cross',
    { notes: 'hourly (BQC-1.5 bounded sweep)' },
  ),
  schedule(
    'purge-expired-reviews-recurring',
    'system:review.purge',
    'none',
    'tenant_cross',
    { notes: 'daily, offset 2h' },
  ),
  schedule(
    'retention-sweep-recurring',
    'system:retention.sweep',
    'none',
    'tenant_cross',
    { notes: 'daily, offset 3h (after purge)' },
  ),
  schedule(
    'refresh-daily-metrics-recurring',
    'system:metric.refresh',
    'none',
    'tenant_cross',
    { notes: 'cron 0 * * * * (hourly)' },
  ),
  schedule(
    'refresh-weekly-metrics-recurring',
    'system:metric.refresh',
    'none',
    'tenant_cross',
    { notes: 'daily' },
  ),
  schedule(
    'refresh-daily-inbox-metrics-recurring',
    'system:metric.refresh',
    'none',
    'tenant_cross',
    { notes: 'cron 5 * * * * (hourly)' },
  ),
  schedule(
    'reconcile-goal-progress-recurring',
    'system:goal.reconcile',
    'goal.use',
    'tenant_cross',
    { notes: 'cron 10 * * * *; NOT scheduled while goal.use dark' },
  ),
  schedule(
    'spawn-recurring-instances-recurring',
    'system:goal.spawn',
    'goal.use',
    'tenant_cross',
    { notes: 'daily; NOT scheduled while goal.use dark' },
  ),
  schedule(
    'badge.reconcile-recurring',
    'system:badge.reconcile',
    'badge.use',
    'tenant_cross',
    { notes: 'cron 20 * * * *; NOT scheduled while badge.use dark' },
  ),
  schedule(
    'leaderboard.reconcile-recurring',
    'system:leaderboard.reconcile',
    'leaderboard.use',
    'tenant_cross',
    { notes: 'cron 30 * * * *; NOT scheduled while leaderboard.use dark' },
  ),
  schedule(
    'digest-notification-recurring',
    'system:notification.email_digest',
    'notification.send_email',
    'organization',
    { notes: 'cron 0 * * * *; blocked for beta (notification.send_email)' },
  ),
]

const OPERATOR_ROWS: ReadonlyArray<EntryPointRow> = [
  // ── ops ───────────────────────────────────────────────────────────
  ops(
    'scripts/ops/queue-quarantine.ts',
    'scripts/ops/queue-quarantine.ts',
    'tenant_cross',
    { notes: 'ops:queue — pause/resume/status BullMQ queues; jobs preserved (BQC-0.5)' },
  ),
  ops(
    'scripts/ops/reconcile-staff-grants.ts',
    'scripts/ops/reconcile-staff-grants.ts',
    'tenant_cross',
    {
      notes:
        'ops:reconcile-grants — report/apply staff→grant reconciliation (BQC-2.3); anomalies never auto-converted',
    },
  ),
  // ── top-level scripts ─────────────────────────────────────────────
  ops('scripts/audit-member-roles.ts', 'scripts/audit-member-roles.ts', 'tenant_cross', {
    notes: 'audit:member-roles — read-only role audit (raw pg)',
  }),
  ops('scripts/check-db.ts', 'scripts/check-db.ts', 'tenant_cross', {
    notes: 'read-only diagnostics; identifiers + clocks only (BQC-1.6)',
  }),
  ops(
    'scripts/check-component-boundaries.mjs',
    'scripts/check-component-boundaries.mjs',
    'none',
    { notes: 'CI lint: component boundary check' },
  ),
  ops('scripts/check-filenames.mjs', 'scripts/check-filenames.mjs', 'none', {
    notes: 'CI lint: filename convention check',
  }),
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
  ops('scripts/simulate.ts', 'scripts/simulate.ts', 'tenant_cross', {
    externalEffect: true,
    notes: 'Neon branch lifecycle (Neon API) + seed + invariants',
  }),
  ops(
    'scripts/verify-auth-schema.mjs',
    'scripts/verify-auth-schema.mjs',
    'tenant_cross',
    { notes: 'audit:auth-schema — read-only better-auth column casing check' },
  ),
  // ── bqc ───────────────────────────────────────────────────────────
  ops('scripts/bqc/validate-status.ts', 'scripts/bqc/validate-status.ts', 'none', {
    notes: 'bqc:validate-status — status manifest schema validation',
  }),
  ops('scripts/bqc/generate-status.ts', 'scripts/bqc/generate-status.ts', 'none', {
    notes: 'bqc:generate-status — regenerates STATUS.md from manifest',
  }),
  ops('scripts/bqc/run-baseline.ts', 'scripts/bqc/run-baseline.ts', 'tenant_cross', {
    notes: 'bqc:run-baseline — full gate run incl. migrations/seed/e2e; writes evidence',
  }),
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
        'DIRECT-DB (psql): db:bootstrap-auth — provisions 8 better-auth baseline tables',
    },
  ),
  ops(
    'scripts/migrations/2026-07-06-permission-version-triggers.sql',
    'scripts/migrations/2026-07-06-permission-version-triggers.sql',
    'tenant_cross',
    { notes: 'DIRECT-DB (psql): DAC permission-version triggers + last-owner guard' },
  ),
  ops(
    'scripts/migrations/add-materialized-views-and-gbp-index.sql',
    'scripts/migrations/add-materialized-views-and-gbp-index.sql',
    'tenant_cross',
    { notes: 'DIRECT-DB (psql): db:matviews — 3 materialized views + GBP unique index' },
  ),
  ops(
    'scripts/migrations/verify-existing-emails.sql',
    'scripts/migrations/verify-existing-emails.sql',
    'tenant_cross',
    { notes: 'DIRECT-DB (psql): marks all existing users email-verified' },
  ),
  ops(
    'scripts/migrations/add-org-id-to-goal-progress.sql',
    'scripts/migrations/add-org-id-to-goal-progress.sql',
    'tenant_cross',
    { notes: 'DIRECT-DB (psql): goal_progress org column + backfill' },
  ),
  ops(
    'scripts/migrations/fix-goal-progress-org-id-notnull.sql',
    'scripts/migrations/fix-goal-progress-org-id-notnull.sql',
    'tenant_cross',
    { notes: 'DIRECT-DB (psql): NOT NULL constraint after backfill' },
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
    'scripts/migrations/create-missing-tables.sql',
    'scripts/migrations/create-missing-tables.sql',
    'tenant_cross',
    { notes: 'DIRECT-DB (psql): notifications/badges/leaderboards tables' },
  ),
  ops(
    'scripts/migrations/fix-portal-schema-sync.sql',
    'scripts/migrations/fix-portal-schema-sync.sql',
    'tenant_cross',
    { notes: 'DIRECT-DB (psql): portal sort_key + group-members table' },
  ),
  ops(
    'scripts/migrations/add-missing-indexes.sql',
    'scripts/migrations/add-missing-indexes.sql',
    'tenant_cross',
    { notes: 'DIRECT-DB (psql): composite/FK indexes; idempotent' },
  ),
  ops(
    'scripts/migrations/add-goals-parent-period-uniq.sql',
    'scripts/migrations/add-goals-parent-period-uniq.sql',
    'tenant_cross',
    {
      notes:
        'DIRECT-DB (psql): unique partial index preventing duplicate recurring goals',
    },
  ),
  ops(
    'scripts/migrations/add-reply-unique-index.sql',
    'scripts/migrations/add-reply-unique-index.sql',
    'tenant_cross',
    { notes: 'DIRECT-DB (psql): one published reply per review' },
  ),
  ops(
    'scripts/migrations/add-invitation-property-ids.sql',
    'scripts/migrations/add-invitation-property-ids.sql',
    'tenant_cross',
    { notes: 'DIRECT-DB (psql): invitation propertyIds JSON column' },
  ),
  ops(
    'scripts/migrations/add-response-sla-hours.sql',
    'scripts/migrations/add-response-sla-hours.sql',
    'tenant_cross',
    { notes: 'DIRECT-DB (psql): organization response_sla_hours column' },
  ),
  // ── perf ──────────────────────────────────────────────────────────
  ops('scripts/perf/load-test.ts', 'scripts/perf/load-test.ts', 'none', {
    notes: 'perf:catalog — prints SLO/scenario/fault catalog; no execution',
  }),
  ops('scripts/perf/seed-scale.ts', 'scripts/perf/seed-scale.ts', 'tenant_cross', {
    notes: 'DIRECT-DB: synthetic scale seed (raw pg bulk INSERT)',
  }),
  ops(
    'scripts/perf/write-scale-evidence.ts',
    'scripts/perf/write-scale-evidence.ts',
    'none',
    { notes: 'perf:evidence — writes scale-and-recovery evidence markdown' },
  ),
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
  ops('db:studio', 'package.json', 'tenant_cross', {
    notes: 'drizzle-kit studio — browser DB inspector',
  }),
  ops('auth:generate', 'package.json', 'none', {
    notes: 'better-auth CLI generate — writes auth schema output',
  }),
  ops('auth:migrate', 'package.json', 'tenant_cross', {
    notes: 'better-auth CLI migrate — applies better-auth migrations',
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
