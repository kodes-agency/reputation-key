export const CAPABILITIES = [
  'identity.invite',
  'identity.custom_roles',
  'identity.register',
  'organization.create',
  'property.create',
  'property.erase',
  'property.connect_gbp',
  'property.import_gbp_v2',
  'property.read_gbp_performance',
  'property.publish_reply',
  'notification.send_email',
  'notification.send_mandatory_email',
  'notification.in_app',
  'portal.read',
  'portal.write',
  'portal.upload',
  'portal.public_read',
  'portal.guest_response',
  'portal.guest_text',
  'portal.guest_contact',
  'portal.guest_media',
  'goal.use',
  'ai.analyze',
  'ai.generate_reply',
  'ai.detect_trends',
  'gbp.reply.auto_publish',
  'gbp.ai.cross_property_summary',
  'gbp.review_solicitation_gamification',
  'review.use',
  'inbox.use',
  'dashboard.use',
  'staff.use',
  'staff.accounts',
  'integration.use',
  'activity.use',
  'metric.internal',
  'feedback.beta_report',
] as const

export type Capability = (typeof CAPABILITIES)[number]

/**
 * The four operational switches (BETA_CAPABILITIES_OFF names). Each turns off
 * a whole group of work: every call to Google, every AI call, every guest
 * page and guest submission, and optional email. Everything off and
 * Organization suspension are controls, not switches.
 */
export const FEATURE_SWITCHES = ['google', 'ai', 'guest_pages', 'optional_email'] as const

export type FeatureSwitch = (typeof FEATURE_SWITCHES)[number]

/**
 * Product fate is deliberately more precise than the runtime's two-way
 * on/blocked posture. Several different decisions fail closed in the same
 * runtime set but have different reactivation rules.
 */
export type CapabilityFate =
  'core' | 'beta_disabled' | 'safety_blocked' | 'permanently_denied'

export type CapabilityFateRecord = Readonly<{
  fate: CapabilityFate
  /** The switch that turns this capability off; null when only the controls do. */
  featureSwitch: FeatureSwitch | null
  authority: string
  activation: string
}>

const fate = (
  value: CapabilityFate,
  authority: string,
  activation: string,
  featureSwitch: FeatureSwitch | null = null,
): CapabilityFateRecord =>
  Object.freeze({ fate: value, featureSwitch, authority, activation })

const CORE = (authority: string, featureSwitch: FeatureSwitch | null = null) =>
  fate(
    'core',
    authority,
    featureSwitch === null
      ? 'Enabled by default; everything off and Organization suspension still win.'
      : `Enabled by default; the ${featureSwitch} switch, everything off and Organization suspension still win.`,
    featureSwitch,
  )

const DISABLED = (authority: string, featureSwitch: FeatureSwitch | null = null) =>
  fate(
    'beta_disabled',
    authority,
    'Cannot be activated by tenant policy; requires an accepted product decision and code posture change.',
    featureSwitch,
  )

/**
 * Exhaustive product/runtime authority for the current capability vocabulary,
 * and the switch each capability answers to.
 * Route/job/consumer catalogues reference these exact capability keys, so an
 * added capability cannot exist without an explicit fate decision.
 */
export const CAPABILITY_FATE = Object.freeze({
  'identity.invite': CORE('Invite-only manager onboarding is a beta core flow.'),
  'identity.custom_roles': DISABLED(
    'Runtime custom-role mutation and assignment are excluded from beta; retained definitions are reconciliation input only.',
  ),
  'identity.register': DISABLED('Public self-registration is excluded from beta.'),
  'organization.create': DISABLED(
    'Self-service secondary Organization creation is excluded from beta.',
  ),
  'property.create': CORE('Authorized manager Property creation is beta core.'),
  'property.erase': DISABLED(
    'Ordinary product lifecycle uses recoverable Archive/Disconnect; permanent erasure is support-mediated.',
  ),
  'property.connect_gbp': CORE(
    'Google connection is part of the core manager journey.',
    'google',
  ),
  'property.import_gbp_v2': CORE(
    'Google discovery/import is active only through the governed import saga.',
    'google',
  ),
  'property.read_gbp_performance': CORE(
    'Google performance reads are provider-readiness gated.',
    'google',
  ),
  'property.publish_reply': CORE(
    'Human-confirmed reply publication is core; automated publication remains denied.',
    'google',
  ),
  'notification.send_email': CORE(
    'Optional email delivery follows notification class and recipient preference; mandatory classes go through notification.send_mandatory_email and survive this switch.',
    'optional_email',
  ),
  'notification.send_mandatory_email': CORE(
    'Mandatory account/security notices are Organization policy, not optional mail: the last warning before an irreversible deletion must still go out while optional email is switched off.',
  ),
  'notification.in_app': CORE('In-app notification delivery is a beta core function.'),
  'portal.read': CORE('Portal manager reads are beta core.'),
  'portal.write': CORE(
    'Portal management and publication are beta core, subject to lifecycle readiness.',
  ),
  'portal.upload': CORE(
    'Portal image upload is beta core. The owner removed the SAFE-01 completion ceremony on 2026-09-30; the technical safeguards stay in the build (server-side re-encoding, metadata stripping, size and type limits, same-origin serving) - ADR 0063.',
  ),
  'portal.public_read': CORE(
    'The public review gateway is active only for published Portal resources.',
    'guest_pages',
  ),
  'portal.guest_response': CORE(
    'Private rating-first Guest Responses are beta core.',
    'guest_pages',
  ),
  'portal.guest_text': CORE(
    'Private feedback text is beta core with separate retention and access rules.',
    'guest_pages',
  ),
  'portal.guest_contact': fate(
    'safety_blocked',
    'Contact Request storage is backend-only; phone is excluded and external beta activation awaits approved notice, handling, retention, and channel evidence.',
    'Remove the safety block only after named counsel/product approval and complete guest-notice, manager-handling, retention, and channel-readiness evidence; tenant policy alone cannot enable it.',
    'guest_pages',
  ),
  'portal.guest_media': DISABLED(
    'Guest media is excluded from the first beta cohort and has no public issuance surface.',
    'guest_pages',
  ),
  'goal.use': CORE(
    'Property, Portal Group, and individual Portal Goals over scans, rating count, and rating average are beta core.',
  ),
  'ai.analyze': CORE(
    'Per-Property Review Analysis requires independent merchant authorization and readiness.',
    'ai',
  ),
  'ai.generate_reply': CORE(
    'Per-Property genuine EN/BG drafting requires independent authorization and explicit human adoption.',
    'ai',
  ),
  'ai.detect_trends': DISABLED(
    'Property Trends is retired; recorded grants do not authorize execution.',
    'ai',
  ),
  'gbp.reply.auto_publish': fate(
    'permanently_denied',
    'Replies require explicit human confirmation and observed Google truth.',
    'No activation path exists.',
    'google',
  ),
  'gbp.ai.cross_property_summary': fate(
    'permanently_denied',
    'AI processing is Property-local and cannot create cross-Property or cross-Organization summaries.',
    'No activation path exists.',
    'ai',
  ),
  'gbp.review_solicitation_gamification': fate(
    'permanently_denied',
    'The beta does not use AI or competitive mechanics to influence review solicitation.',
    'No activation path exists.',
    'ai',
  ),
  'review.use': CORE('Stable Google Review identity and lifecycle are beta core.'),
  'inbox.use': CORE('Inbox handling is beta core.'),
  'dashboard.use': CORE('Governed manager reporting is beta core.'),
  'staff.use': CORE(
    'Staff Participants/participation/attribution are core; this does not activate Member login.',
  ),
  'staff.accounts': CORE(
    'ADR 0076 and owner decision D18 (2026-11-01): personal Portals and staff self reads are beta core; scan targets have the separate STAFF_SCAN_TARGETS_ENABLED switch.',
  ),
  'integration.use': CORE('Google integration lifecycle is beta core.'),
  'activity.use': CORE('Privacy-aware Recent Activity is beta core.'),
  // The report channel must survive the failure it is used to report, so it
  // is core rather than gated behind the feature the reporter is stuck on.
  'feedback.beta_report': CORE(
    'Beta core: a blocked capability must still be reportable.',
  ),
  'metric.internal': CORE(
    'Governed internal metrics and always-on analytics are beta core.',
  ),
} satisfies Readonly<Record<Capability, CapabilityFateRecord>>)

export function listCapabilitiesByFate(target: CapabilityFate): readonly Capability[] {
  return (Object.entries(CAPABILITY_FATE) as Array<[Capability, CapabilityFateRecord]>)
    .filter(([, record]) => record.fate === target)
    .map(([capability]) => capability)
    .sort()
}

/** The capabilities one switch turns off. */
export function listCapabilitiesBySwitch(target: FeatureSwitch): readonly Capability[] {
  return (Object.entries(CAPABILITY_FATE) as Array<[Capability, CapabilityFateRecord]>)
    .filter(([, record]) => record.featureSwitch === target)
    .map(([capability]) => capability)
    .sort()
}
