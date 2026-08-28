import type { Capability } from '#/shared/auth/beta-capabilities'

export const REQUIRED_CONTEXT_HEADINGS = Object.freeze([
  '## Bounded context',
  '## Invariants',
  '## Events produced',
  '## Public API',
] as const)

export type ContextDocumentationMode = 'active' | 'controlled' | 'quarantined' | 'legacy'

export type ContextStandardsRow = Readonly<{
  name: string
  directory: string
  documentationMode: ContextDocumentationMode
  capabilities: ReadonlyArray<Capability>
}>

/**
 * Executable inventory for the 17 retained context packages. Capability fate
 * remains owned by capability-fate.ts; this matrix binds every capability to
 * the context document responsible for explaining its product posture.
 */
export const CONTEXT_STANDARDS_AUTHORITY = Object.freeze([
  {
    name: 'Activity',
    directory: 'activity',
    documentationMode: 'active',
    capabilities: ['activity.use'],
  },
  {
    name: 'AI',
    directory: 'ai',
    documentationMode: 'controlled',
    capabilities: [
      'ai.analyze',
      'ai.generate_reply',
      'ai.detect_trends',
      'gbp.ai.cross_property_summary',
    ],
  },
  {
    name: 'Badge',
    directory: 'badge',
    documentationMode: 'legacy',
    capabilities: ['badge.use'],
  },
  {
    name: 'Dashboard',
    directory: 'dashboard',
    documentationMode: 'active',
    capabilities: ['dashboard.use'],
  },
  {
    name: 'Goal',
    directory: 'goal',
    documentationMode: 'controlled',
    capabilities: ['goal.use'],
  },
  {
    name: 'Guest',
    directory: 'guest',
    documentationMode: 'controlled',
    capabilities: [
      'portal.guest_response',
      'portal.guest_text',
      'portal.guest_contact',
      'portal.guest_media',
    ],
  },
  {
    name: 'Identity',
    directory: 'identity',
    documentationMode: 'active',
    capabilities: [
      'identity.invite',
      'identity.custom_roles',
      'identity.register',
      'organization.create',
    ],
  },
  {
    name: 'Inbox',
    directory: 'inbox',
    documentationMode: 'active',
    capabilities: ['inbox.use'],
  },
  {
    name: 'Integration',
    directory: 'integration',
    documentationMode: 'active',
    capabilities: [
      'integration.use',
      'property.connect_gbp',
      'property.import_gbp_v2',
      'property.read_gbp_performance',
    ],
  },
  {
    name: 'Leaderboard',
    directory: 'leaderboard',
    documentationMode: 'legacy',
    capabilities: ['leaderboard.use'],
  },
  {
    name: 'Metric',
    directory: 'metric',
    documentationMode: 'active',
    capabilities: ['metric.internal'],
  },
  {
    name: 'Notification',
    directory: 'notification',
    documentationMode: 'active',
    capabilities: ['notification.in_app', 'notification.send_email'],
  },
  {
    name: 'Portal',
    directory: 'portal',
    documentationMode: 'controlled',
    capabilities: [
      'portal.read',
      'portal.write',
      'portal.upload',
      'portal.public_read',
      'gbp.review_solicitation_gamification',
    ],
  },
  {
    name: 'Property',
    directory: 'property',
    documentationMode: 'active',
    capabilities: ['property.create', 'property.erase'],
  },
  {
    name: 'Review',
    directory: 'review',
    documentationMode: 'active',
    capabilities: ['review.use', 'property.publish_reply', 'gbp.reply.auto_publish'],
  },
  {
    name: 'Staff',
    directory: 'staff',
    documentationMode: 'active',
    capabilities: ['staff.use'],
  },
  {
    name: 'Team',
    directory: 'team',
    documentationMode: 'quarantined',
    capabilities: ['team.use'],
  },
] as const satisfies ReadonlyArray<ContextStandardsRow>)

export function validateRequiredContextHeadings(body: string): readonly string[] {
  const positions = REQUIRED_CONTEXT_HEADINGS.map((heading) => body.indexOf(heading))
  const issues: string[] = []

  REQUIRED_CONTEXT_HEADINGS.forEach((heading, index) => {
    if (positions[index] < 0) issues.push(`missing heading: ${heading}`)
  })

  const present = positions.filter((position) => position >= 0)
  if (present.some((position, index) => index > 0 && position < present[index - 1]!)) {
    issues.push('required headings are out of order')
  }

  return issues
}
