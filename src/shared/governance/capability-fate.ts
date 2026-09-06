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
  'integration.use',
  'activity.use',
  'metric.internal',
] as const

export type Capability = (typeof CAPABILITIES)[number]

/**
 * Product fate is deliberately more precise than the runtime's three-way
 * core/non-core/blocked posture. Several different decisions fail closed in
 * the same runtime set but have different reactivation rules.
 */
export type CapabilityFate =
  'core' | 'controlled_beta' | 'beta_disabled' | 'safety_blocked' | 'permanently_denied'

export type CapabilityFateRecord = Readonly<{
  fate: CapabilityFate
  authority: string
  activation: string
}>

const fate = (
  value: CapabilityFate,
  authority: string,
  activation: string,
): CapabilityFateRecord => Object.freeze({ fate: value, authority, activation })

const CORE = (authority: string) =>
  fate(
    'core',
    authority,
    'Enabled by default; global kill and tenant suspension still win.',
  )

const CONTROLLED = (authority: string) =>
  fate(
    'controlled_beta',
    authority,
    'Requires persisted Organization and, where applicable, Property policy plus readiness gates.',
  )

const DISABLED = (authority: string) =>
  fate(
    'beta_disabled',
    authority,
    'Cannot be activated by tenant policy; requires an accepted product decision and code posture change.',
  )

/**
 * Exhaustive product/runtime authority for the current capability vocabulary.
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
  'property.connect_gbp': CORE('Google connection is part of the core manager journey.'),
  'property.import_gbp_v2': CONTROLLED(
    'Google discovery/import is active only through the governed import saga.',
  ),
  'property.read_gbp_performance': CONTROLLED(
    'Google performance is separately allowlisted and provider-readiness gated.',
  ),
  'property.publish_reply': CORE(
    'Human-confirmed reply publication is core; automated publication remains denied.',
  ),
  'notification.send_email': CONTROLLED(
    'Email delivery is active by notification class and tenant policy; mandatory classes cannot be opted out.',
  ),
  'notification.in_app': CORE('In-app notification delivery is a beta core function.'),
  'portal.read': CONTROLLED('Portal manager reads require controlled-beta policy.'),
  'portal.write': CONTROLLED(
    'Portal management and publication require controlled-beta policy and lifecycle readiness.',
  ),
  'portal.upload': fate(
    'safety_blocked',
    'Portal upload activation waits for the complete SAFE-01 public-edge and object-store evidence.',
    'Remove the safety block only after the signed SAFE-01 completion record; tenant policy alone cannot enable it.',
  ),
  'portal.public_read': CONTROLLED(
    'The public review gateway is active only for published, allowlisted Portal resources.',
  ),
  'portal.guest_response': CONTROLLED(
    'Private rating-first Guest Responses are controlled beta behavior.',
  ),
  'portal.guest_text': CONTROLLED(
    'Private feedback text is controlled beta behavior with separate retention and access rules.',
  ),
  'portal.guest_contact': fate(
    'safety_blocked',
    'Contact Request storage is backend-only; phone is excluded and external beta activation awaits approved notice, handling, retention, and channel evidence.',
    'Remove the safety block only after named counsel/product approval and complete guest-notice, manager-handling, retention, and channel-readiness evidence; tenant policy alone cannot enable it.',
  ),
  'portal.guest_media': DISABLED(
    'Guest media is excluded from the first beta cohort and has no public issuance surface.',
  ),
  'goal.use': CONTROLLED(
    'Property, Portal Group, and individual Portal Goals over scans, rating count, and rating average are controlled beta.',
  ),
  'ai.analyze': CONTROLLED(
    'Per-Property Review Analysis requires independent merchant authorization and readiness.',
  ),
  'ai.generate_reply': CONTROLLED(
    'Per-Property genuine EN/BG drafting requires independent authorization and explicit human adoption.',
  ),
  'ai.detect_trends': CONTROLLED(
    'Per-Property deterministic trends require independent authorization and caught-up analysis.',
  ),
  'gbp.reply.auto_publish': fate(
    'permanently_denied',
    'Replies require explicit human confirmation and observed Google truth.',
    'No activation path exists.',
  ),
  'gbp.ai.cross_property_summary': fate(
    'permanently_denied',
    'AI processing is Property-local and cannot create cross-Property or cross-Organization summaries.',
    'No activation path exists.',
  ),
  'gbp.review_solicitation_gamification': fate(
    'permanently_denied',
    'The beta does not use AI or competitive mechanics to influence review solicitation.',
    'No activation path exists.',
  ),
  'review.use': CORE('Stable Google Review identity and lifecycle are beta core.'),
  'inbox.use': CORE('Inbox handling is beta core.'),
  'dashboard.use': CORE('Governed manager reporting is beta core.'),
  'staff.use': CORE(
    'Staff Participants/participation/attribution are core; this does not activate Staff User login.',
  ),
  'integration.use': CORE('Google integration lifecycle is beta core.'),
  'activity.use': CORE('Privacy-aware Recent Activity is beta core.'),
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
