// Story data for the Property look page: "Avela Resort", as board 9 draws it.
import { fn } from 'storybook/test'
import type {
  PortalReview,
  PublishPortalsChangesResult,
} from '#/contexts/portal/application/public-api'
import type { AffectedPortalRow } from './property-look-rules'
import type { PropertyLookProfile } from './property-look-types'
import type { PropertyLookSaves } from './use-property-look-draft'
import type { PortalReviewReader, PublishPortalsAction } from './use-property-look-batch'

/** The two languages a Property starts with in these stories, whatever else is offered. */
const STORY_LOCALES = ['en', 'bg'] as const

export const AVELA_PROFILE: PropertyLookProfile = {
  displayName: 'Avela Resort',
  primaryColor: '#EAD6A8',
  backgroundColor: '#14110F',
  backgroundMode: 'auto',
  wordmark: 'AVELA',
  defaultGuestLocales: STORY_LOCALES,
}

/** What a Property has before anyone picks a colour: the default palette, automatic. */
export const DEFAULT_PALETTE_PROFILE: PropertyLookProfile = {
  displayName: 'Avela Resort',
  primaryColor: '#2563EB',
  backgroundColor: '#FFFFFF',
  backgroundMode: 'auto',
  wordmark: null,
  defaultGuestLocales: STORY_LOCALES,
}

const group = (name: string) => ({ id: `group-${name}`, name })

/** A Property with a great many live portals, to see the list scroll inside the dialog. */
export const manyLivePortals = (count: number): readonly AffectedPortalRow[] =>
  Array.from({ length: count }, (_, index) => ({
    portalId: `p-live-${index + 1}`,
    name: `Live portal ${index + 1}`,
    publicationState: 'published' as const,
    group: null,
  }))

export const AVELA_PORTALS: readonly AffectedPortalRow[] = [
  {
    portalId: 'p-reception',
    name: 'Reception',
    publicationState: 'published',
    group: group('Front of house'),
  },
  {
    portalId: 'p-pool',
    name: 'Pool & Terrace',
    publicationState: 'published',
    group: group('Pool side'),
  },
  {
    portalId: 'p-olive',
    name: 'Olive Terrace restaurant',
    publicationState: 'published',
    group: null,
  },
  {
    portalId: 'p-spa',
    name: 'Spa & thermal pools',
    publicationState: 'published',
    group: group('Pool side'),
  },
  {
    portalId: 'p-rooms',
    name: 'Guest rooms',
    publicationState: 'published',
    group: group('Front of house'),
  },
  {
    portalId: 'p-bar',
    name: 'Pool bar',
    publicationState: 'draft',
    group: group('Pool side'),
  },
  { portalId: 'p-old', name: 'Old kiosk', publicationState: 'archived', group: null },
]

/** An action that answers with what it was given, as the server's Brand Profile. */
export function savingLook(
  profile: PropertyLookProfile = AVELA_PROFILE,
): PropertyLookSaves['saveLook'] {
  return Object.assign(
    fn(async (input: { data: Record<string, unknown> }) => ({
      ...profile,
      ...(typeof input.data.accentColour === 'string'
        ? { primaryColor: input.data.accentColour }
        : {}),
      ...(input.data.backgroundMode === 'manual' || input.data.backgroundMode === 'auto'
        ? { backgroundMode: input.data.backgroundMode }
        : {}),
      ...(typeof input.data.backgroundColour === 'string'
        ? { backgroundColor: input.data.backgroundColour }
        : {}),
      wordmark:
        input.data.wordmark === undefined
          ? profile.wordmark
          : (input.data.wordmark as string | null),
    })),
    { isPending: false, error: null, isSuccess: false, data: null },
  ) as unknown as PropertyLookSaves['saveLook']
}

export function savingLocales(): PropertyLookSaves['saveLocales'] {
  return Object.assign(
    fn(async (input: { data: { locales: string[] } }) => ({
      defaultGuestLocales: input.data.locales,
    })),
    { isPending: false, error: null, isSuccess: false, data: null },
  ) as unknown as PropertyLookSaves['saveLocales']
}

// ── The batch "Review & publish" ─────────────────────────────────────────────

const NOT_ANSWERABLE = { isPending: false, error: null, isSuccess: false, data: null }

/** What a live portal's review says when the look is the only thing waiting. */
export function readyReview(portalId: string, version = 4): PortalReview {
  return {
    portalId,
    publicationState: 'published',
    action: 'publish_changes',
    live: {
      version: version - 1,
      activatedAt: '2026-09-28T09:00:00.000Z',
      activatedBy: { userId: 'u-1', displayName: 'Elena Petrova' },
    },
    publishesAsVersion: version,
    nothingToPublish: false,
    canPublish: true,
    changes: [
      {
        type: 'edit',
        kind: 'property_brand_profile',
        subject: { area: 'look', facet: null },
        propertyWide: true,
        actor: { userId: 'u-1', displayName: 'Elena Petrova' },
        occurredAt: '2026-10-01T09:00:00.000Z',
        previousText: null,
        newText: null,
        editCount: 2,
      },
    ],
    changesMayBeIncomplete: false,
    checks: [{ code: 'property_available', status: 'passed', locale: null, keys: [] }],
    checkCounts: { blocked: 0, warning: 0, passed: 1 },
    languages: [],
  }
}

export const nothingNewReview = (portalId: string): PortalReview => ({
  ...readyReview(portalId),
  nothingToPublish: true,
  canPublish: false,
  changes: [],
})

export const blockedReview = (portalId: string): PortalReview => ({
  ...readyReview(portalId),
  canPublish: false,
  checks: [
    { code: 'responsible_manager', status: 'blocked', locale: null, keys: [] },
    { code: 'primary_text', status: 'blocked', locale: 'bg', keys: ['title'] },
  ],
  checkCounts: { blocked: 2, warning: 0, passed: 0 },
})

/** A reader that answers each portal from `reviews` (a portal not named is ready), or fails for an Error. */
export function reviewingPortals(
  reviews: Readonly<Record<string, PortalReview | Error>> = {},
): PortalReviewReader {
  return fn(async ({ data }: { data: { portalId: string } }) => {
    const answer = reviews[data.portalId] ?? readyReview(data.portalId)
    if (answer instanceof Error) throw answer
    return answer
  }) as unknown as PortalReviewReader
}

/** What a publish answers, or a promise that never settles (a request still in flight). */
type PublishAnswer = (
  ids: readonly string[],
) => PublishPortalsChangesResult | Promise<PublishPortalsChangesResult>

/** A request that is still in flight when the story is read. */
export const neverAnswered: PublishAnswer = () => new Promise(() => undefined)

/** What a publish says when every portal goes live as the next version. */
export const allPublished = (ids: readonly string[]): PublishPortalsChangesResult =>
  ids.map((portalId) => ({
    portalId,
    outcome: 'published' as const,
    snapshotId: `snap-${portalId}`,
    version: 4,
    configurationDigest: 'digest',
    activatedAt: new Date('2026-10-01T10:00:00.000Z'),
  }))

/** An action that records the request and answers with `answer` (or fails with an Error it is given). */
export function publishingPortals(
  answer: PublishAnswer | Error = allPublished,
): PublishPortalsAction {
  return Object.assign(
    fn(async (input: { data: { portalIds: string[] } }) => {
      if (answer instanceof Error) throw answer
      return answer(input.data.portalIds)
    }),
    NOT_ANSWERABLE,
  ) as unknown as PublishPortalsAction
}
