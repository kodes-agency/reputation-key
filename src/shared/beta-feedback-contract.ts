import { z } from 'zod/v4'

const titleSchema = z
  .string()
  .trim()
  .min(3, 'Add a short title (at least 3 characters).')
  .max(120, 'Keep the title to 120 characters or fewer.')
const detailSchema = z
  .string()
  .trim()
  .min(3, 'Please add at least 3 characters.')
  .max(1_500, 'Keep this response to 1,500 characters or fewer.')
const optionalDetailSchema = z
  .string()
  .trim()
  .max(1_500, 'Keep this response to 1,500 characters or fewer.')
  .transform((value) => value || undefined)
  .optional()
const routePathSchema = z.string().min(1).max(2_048)
const viewportSchema = z.enum(['compact', 'regular', 'wide'])

const sharedFields = {
  title: titleSchema,
  routePath: routePathSchema,
  viewport: viewportSchema,
} as const

export const bugBetaFeedbackInputSchema = z
  .object({
    type: z.literal('bug'),
    ...sharedFields,
    expected: detailSchema,
    actual: detailSchema,
    steps: optionalDetailSchema,
    impact: z.enum(['cannot_complete', 'workaround_available', 'small_issue']),
  })
  .strict()

export const suggestionBetaFeedbackInputSchema = z
  .object({
    type: z.literal('suggestion'),
    ...sharedFields,
    desiredOutcome: detailSchema,
    currentFriction: optionalDetailSchema,
    importance: z.enum(['important', 'helpful', 'nice_to_have']),
  })
  .strict()

export const betaFeedbackInputSchema = z.discriminatedUnion('type', [
  bugBetaFeedbackInputSchema,
  suggestionBetaFeedbackInputSchema,
])

export type BetaFeedbackInput = z.infer<typeof betaFeedbackInputSchema>
export type BetaFeedbackType = BetaFeedbackInput['type']

export type BetaFeedbackRouteKey =
  | 'home'
  | 'dashboard'
  | 'inbox'
  | 'leaderboard'
  | 'notifications'
  | 'progress'
  | 'properties.list'
  | 'properties.import.list'
  | 'properties.import.detail'
  | 'properties.property.overview'
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
  | 'settings.recognition'
  | 'settings.security'
  | 'other_authenticated'
export type BetaFeedbackViewport = BetaFeedbackInput['viewport']

const EXACT_ROUTES: Readonly<Record<string, BetaFeedbackRouteKey>> = {
  '/home': 'home',
  '/dashboard': 'dashboard',
  '/inbox': 'inbox',
  '/leaderboard': 'leaderboard',
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
  '/settings/recognition': 'settings.recognition',
  '/settings/security': 'settings.security',
}

const PROPERTY_ROUTE_SUFFIXES: Readonly<Array<readonly [RegExp, BetaFeedbackRouteKey]>> =
  [
    [/^\/properties\/[^/]+\/people$/, 'properties.property.people'],
    [/^\/properties\/[^/]+\/reviews$/, 'properties.property.reviews'],
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
  const sections =
    input.type === 'bug'
      ? [
          'Type: Bug',
          `Title: ${input.title}`,
          `Route: ${route}`,
          `Impact: ${input.impact}`,
          `Expected: ${input.expected}`,
          `What happened: ${input.actual}`,
          ...(input.steps ? [`Steps: ${input.steps}`] : []),
        ]
      : [
          'Type: Suggestion',
          `Title: ${input.title}`,
          `Route: ${route}`,
          `Importance: ${input.importance}`,
          `Desired outcome: ${input.desiredOutcome}`,
          ...(input.currentFriction
            ? [`Current friction: ${input.currentFriction}`]
            : []),
        ]

  return sections.join('\n\n').slice(0, 6_000)
}
