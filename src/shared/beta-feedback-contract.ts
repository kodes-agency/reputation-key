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

export const BETA_FEEDBACK_ATTACHMENT_RETENTION_DAYS = 30
export const MASKED_LAYOUT_GRID_WIDTH = 64
export const MASKED_LAYOUT_MAX_BLOCKS = 96

const maskedLayoutBlockSchema = z
  .object({
    kind: z.enum(['surface', 'text', 'input', 'image', 'media']),
    x: z
      .int()
      .min(0)
      .max(MASKED_LAYOUT_GRID_WIDTH - 1),
    y: z
      .int()
      .min(0)
      .max(MASKED_LAYOUT_GRID_WIDTH - 1),
    width: z.int().min(1).max(MASKED_LAYOUT_GRID_WIDTH),
    height: z.int().min(1).max(MASKED_LAYOUT_GRID_WIDTH),
  })
  .strict()

/**
 * A visual wireframe, never a pixel screenshot. The browser reports only
 * quantized rectangle geometry and a closed semantic kind; the server owns
 * rendering, so text, input values, images, and media cannot be smuggled in.
 */
export const maskedLayoutSnapshotSchema = z
  .object({
    profile: z.literal('masked-layout-v1'),
    consented: z.literal(true),
    gridWidth: z.literal(MASKED_LAYOUT_GRID_WIDTH),
    gridHeight: z.int().min(24).max(MASKED_LAYOUT_GRID_WIDTH),
    blocks: z.array(maskedLayoutBlockSchema).min(1).max(MASKED_LAYOUT_MAX_BLOCKS),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    for (const [index, block] of snapshot.blocks.entries()) {
      if (
        block.x + block.width > snapshot.gridWidth ||
        block.y + block.height > snapshot.gridHeight
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'Masked layout block must fit inside the declared grid.',
          path: ['blocks', index],
        })
      }
    }
  })

export type MaskedLayoutSnapshot = z.infer<typeof maskedLayoutSnapshotSchema>

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
    attachment: maskedLayoutSnapshotSchema.optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.attachment && !isBetaFeedbackAttachmentAllowed(input.routePath)) {
      ctx.addIssue({
        code: 'custom',
        message: 'A masked layout preview is unavailable on this page.',
        path: ['attachment'],
      })
    }
  })

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

const ATTACHMENT_ALLOWED_ROUTES: ReadonlySet<BetaFeedbackRouteKey> = new Set([
  'home',
  'dashboard',
  'leaderboard',
  'progress',
  'properties.list',
  'properties.property.overview',
  'properties.property.goals.list',
  'properties.property.goals.new',
  'properties.property.goals.detail',
  'properties.property.portals.list',
  'settings.overview',
  'settings.ai',
  'settings.members',
  'settings.notifications',
  'settings.organization',
  'settings.preferences',
  'settings.recognition',
])

/**
 * Defence in depth around the content-free renderer. Provider content,
 * inbox/private feedback, credentials, uploads, and unknown routes remain
 * ineligible even though the snapshot itself contains no pixels or text.
 */
export function isBetaFeedbackAttachmentAllowed(path: string): boolean {
  return ATTACHMENT_ALLOWED_ROUTES.has(classifyBetaFeedbackRoute(path))
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
