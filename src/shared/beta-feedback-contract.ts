import { z } from 'zod/v4'

const messageSchema = z
  .string()
  .trim()
  .min(3, 'Please add at least 3 characters.')
  .max(6_000, 'Keep your feedback to 6,000 characters or fewer.')
const routePathSchema = z.string().min(1).max(2_048)
const viewportSchema = z.enum(['compact', 'regular', 'wide'])

/**
 * Impact is a closed vocabulary the triage table, its CHECK constraint and the
 * monitoring tag already speak. Bug and Suggestion draw from disjoint halves:
 * "I could not finish" and "nice to have" are not the same scale.
 */
export const BUG_IMPACTS = [
  'cannot_complete',
  'workaround_available',
  'small_issue',
] as const
export const SUGGESTION_IMPACTS = ['important', 'helpful', 'nice_to_have'] as const

const impactSchema = z.enum([...BUG_IMPACTS, ...SUGGESTION_IMPACTS])

/**
 * An opaque monitoring event id for an error the browser already reported.
 * Hex only: this carries correlation, never content. Anything that could hold
 * a message, a stack frame or a payload fails the pattern and is rejected.
 */
const clientErrorEventIdSchema = z.string().regex(/^[a-f0-9]{32}$/u)

export const betaFeedbackInputSchema = z
  .object({
    kind: z.enum(['bug', 'suggestion']),
    impact: impactSchema,
    message: messageSchema,
    routePath: routePathSchema,
    viewport: viewportSchema,
    /** Present only when the reporter chose to link a recorded browser error. */
    clientErrorEventId: clientErrorEventIdSchema.nullable().default(null),
  })
  .strict()
  .superRefine((value, ctx) => {
    const allowed: ReadonlyArray<string> =
      value.kind === 'bug' ? BUG_IMPACTS : SUGGESTION_IMPACTS
    if (!allowed.includes(value.impact)) {
      ctx.addIssue({
        code: 'custom',
        path: ['impact'],
        message: `Impact ${value.impact} is not available for ${value.kind}.`,
      })
    }
    // A suggestion has no error to attach; only a Bug may carry one.
    if (value.kind !== 'bug' && value.clientErrorEventId !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['clientErrorEventId'],
        message: 'Only a bug report may reference a recorded error.',
      })
    }
  })

export type BetaFeedbackInput = z.infer<typeof betaFeedbackInputSchema>
export type BetaFeedbackType = BetaFeedbackInput['kind']
export type BetaFeedbackImpact = BetaFeedbackInput['impact']

export type BetaFeedbackRouteKey =
  | 'inbox'
  | 'notifications'
  | 'progress'
  | 'properties.list'
  | 'properties.import.list'
  | 'properties.import.detail'
  | 'properties.property.overview'
  | 'properties.property.ratings'
  | 'properties.property.google'
  | 'properties.property.guests'
  | 'properties.property.people'
  | 'properties.property.reviews'
  | 'properties.property.settings'
  | 'properties.property.goals.list'
  | 'properties.property.goals.new'
  | 'properties.property.goals.detail'
  | 'properties.property.portals.list'
  | 'properties.property.portals.new'
  | 'properties.property.portals.detail'
  | 'settings.overview'
  | 'settings.ai'
  | 'settings.integrations'
  | 'settings.members'
  | 'settings.notifications'
  | 'settings.organization'
  | 'settings.preferences'
  | 'settings.profile'
  | 'settings.security'
  | 'other_authenticated'
export type BetaFeedbackViewport = BetaFeedbackInput['viewport']

export type BetaFeedbackTriageStateView =
  'new' | 'screened' | 'reproducing' | 'accepted' | 'declined' | 'resolved'

/**
 * What a reporter may see about their own report. Severity, privacy class,
 * security class, owner queue and dedupe disposition are deliberately absent:
 * they are internal triage, and the security classification must not leak.
 */
export type BetaFeedbackReportView = Readonly<{
  reference: string
  feedbackType: BetaFeedbackType
  impactCode: BetaFeedbackImpact
  routeKey: BetaFeedbackRouteKey
  deliveryState: 'prepared' | 'delivered' | 'failed'
  triageState: BetaFeedbackTriageStateView
  engineeringIssueRef: string | null
  createdAt: Date
  updatedAt: Date
}>

const EXACT_ROUTES: Readonly<Record<string, BetaFeedbackRouteKey>> = {
  '/inbox': 'inbox',
  '/notifications': 'notifications',
  '/progress': 'progress',
  '/properties': 'properties.list',
  '/properties/import-google': 'properties.import.list',
  '/settings': 'settings.overview',
  '/settings/ai': 'settings.ai',
  '/settings/integrations': 'settings.integrations',
  '/settings/members': 'settings.members',
  '/settings/notifications': 'settings.notifications',
  '/settings/organization': 'settings.organization',
  '/settings/preferences': 'settings.preferences',
  '/settings/profile': 'settings.profile',
  '/settings/security': 'settings.security',
}

const PROPERTY_ROUTE_SUFFIXES: Readonly<Array<readonly [RegExp, BetaFeedbackRouteKey]>> =
  [
    [/^\/properties\/[^/]+\/people$/, 'properties.property.people'],
    [/^\/properties\/[^/]+\/reviews$/, 'properties.property.reviews'],
    [/^\/properties\/[^/]+\/ratings$/, 'properties.property.ratings'],
    [/^\/properties\/[^/]+\/google$/, 'properties.property.google'],
    [/^\/properties\/[^/]+\/guests$/, 'properties.property.guests'],
    [/^\/properties\/[^/]+\/settings$/, 'properties.property.settings'],
    [/^\/properties\/[^/]+\/goals$/, 'properties.property.goals.list'],
    [/^\/properties\/[^/]+\/goals\/new$/, 'properties.property.goals.new'],
    [/^\/properties\/[^/]+\/goals\/[^/]+$/, 'properties.property.goals.detail'],
    [/^\/properties\/[^/]+\/portals$/, 'properties.property.portals.list'],
    [/^\/properties\/[^/]+\/portals\/new$/, 'properties.property.portals.new'],
    [/^\/properties\/[^/]+\/portals\/[^/]+$/, 'properties.property.portals.detail'],
    [/^\/properties\/[^/]+$/, 'properties.property.overview'],
  ]

/**
 * Convert a browser pathname into a controlled, identifier-free route key.
 * Unknown paths deliberately collapse to one bucket rather than becoming tags.
 */
export function classifyBetaFeedbackRoute(path: string): BetaFeedbackRouteKey {
  const pathOnly = path.split(/[?#]/u, 1)[0] ?? ''
  const normalized = pathOnly.length > 1 ? pathOnly.replace(/\/+$/u, '') : pathOnly
  const exact = EXACT_ROUTES[normalized]
  if (exact) return exact
  if (/^\/properties\/import-google\/[^/]+$/u.test(normalized)) {
    return 'properties.import.detail'
  }
  for (const [pattern, route] of PROPERTY_ROUTE_SUFFIXES) {
    if (pattern.test(normalized)) return route
  }
  return 'other_authenticated'
}

/** Broad categories are useful for layout diagnosis without exact fingerprinting. */
export function classifyBetaFeedbackViewport(width: number): BetaFeedbackViewport {
  if (width < 640) return 'compact'
  if (width < 1_280) return 'regular'
  return 'wide'
}

/** Build the sole free-text payload sent to the feedback provider. */
export function formatBetaFeedbackMessage(input: BetaFeedbackInput): string {
  const route = classifyBetaFeedbackRoute(input.routePath)
  const kind = input.kind === 'bug' ? 'Bug' : 'Suggestion'
  const lines = [
    `Type: ${kind}`,
    `Impact: ${input.impact}`,
    `Route: ${route}`,
    `Message: ${input.message}`,
  ]
  if (input.clientErrorEventId) {
    lines.splice(3, 0, `Recorded error: ${input.clientErrorEventId}`)
  }
  return lines.join('\n\n').slice(0, 6_000)
}
