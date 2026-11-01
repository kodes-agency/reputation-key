// The portal editor's story data: "Pool & Terrace" at Avela Resort, published,
// with saved changes waiting, a Linktree of four tiles, two languages and two
// responsible managers. Shared by the editor's stories and the Look section's.
import { fn } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import { previewReader } from '../../portal-preview/__fixtures__/portal-preview-fixtures'
import type { CompleteReviewVariables, UpdatePortalVariables } from '../../shared/types'
import type { PortalEditorResources } from '../portal-editor-types'

export function action<TInput, TOutput = unknown>(
  impl: (input: TInput) => Promise<TOutput>,
): Action<TInput, TOutput> {
  return Object.assign(fn(impl), {
    isPending: false,
    error: null as unknown,
    isSuccess: false,
    data: null,
  }) as unknown as Action<TInput, TOutput>
}

export const portal = {
  id: 'p-1',
  name: 'Pool & Terrace',
  slug: 'pool-terrace',
  description: 'Drinks and lunch by the pool.',
  heroImageUrl: null,
  theme: { primaryColor: '#6366f1', backgroundColor: '#ffffff', textColor: '#111827' },
  privateFeedbackThreshold: 3,
  skipPrivateRating: false,
  propertyId: 'prop-1',
  organizationId: 'org-1',
  publicationState: 'published' as const,
  primaryGuestLocale: 'en' as const,
  additionalGuestLocales: ['bg' as const],
}

/** A Linktree link with an English label and, when given, a Bulgarian one. */
export function storyLink(
  id: string,
  sortKey: string,
  label: string,
  line: string,
  bulgarian: string | null,
) {
  return {
    id,
    categoryId: 'cat-1',
    url: `https://avela.example/${id}`,
    iconKey: null,
    imageAssetId: null,
    sortKey,
    texts: [
      { locale: 'en' as const, label, line, provenance: null },
      ...(bulgarian === null
        ? []
        : [{ locale: 'bg' as const, label: bulgarian, line: null, provenance: null }]),
    ],
    destination: {
      state: 'approved' as const,
      sourceType: 'recognized' as const,
      approvedByUserId: 'u-1',
    },
  }
}

export function makeResources(
  autosaveUpdateMutation: Action<UpdatePortalVariables>,
): PortalEditorResources {
  return {
    portal,
    propertyId: 'prop-1',
    // Live version 5, with saved changes waiting to go live.
    publicationHistory: {
      current: {
        activationSequence: 5,
        version: 5,
        kind: 'publish' as const,
        activatedBy: { userId: 'u-1', displayName: 'Georgi Petrov' },
        activatedAt: '2026-09-20T10:00:00.000Z',
        deactivatedAt: null,
        deactivationReason: null,
      },
      priorActivations: [],
      hasPendingChanges: true,
      nextCursor: null,
    },
    googleReviewDestination: {
      state: 'verified' as const,
      retrievedAt: new Date('2026-08-20T10:00:00.000Z'),
    },
    links: (
      [
        ['l-1', 'a', 'Discover the resort'],
        ['l-2', 'b', 'Spa & treatments'],
        ['l-3', 'c', 'Olive Terrace menu'],
        ['l-4', 'd', 'Getting here'],
      ] as const
    ).map(([id, sortKey, label]) => ({
      id,
      label,
      url: `https://avela.example/${id}`,
      sortKey,
      categoryId: 'cat-1',
    })),
    linktree: {
      portalId: 'p-1',
      enabled: true,
      maxLinks: 4,
      primaryLocale: 'en' as const,
      locales: ['en' as const, 'bg' as const],
      titles: { en: 'Around the resort', bg: 'Около курорта' },
      // The four tiles the preview draws (portal-preview-fixtures.ts), so the
      // list and the phone tell the same story.
      links: [
        storyLink(
          'l-1',
          'a',
          'Discover the resort',
          'Rooms, pools, the sea',
          'Открийте курорта',
        ),
        storyLink('l-2', 'b', 'Spa & treatments', 'Book a time', 'Спа и процедури'),
        {
          ...storyLink('l-3', 'c', 'Olive Terrace menu', 'Lunch and dinner', null),
          destination: {
            state: 'pending' as const,
            sourceType: null,
            approvedByUserId: null,
          },
        },
        storyLink(
          'l-4',
          'd',
          'Getting here',
          'Directions and parking',
          'Как да стигнете',
        ),
      ],
    },
    autosaveUpdateMutation,
    completeReviewMutation: action(async (_input: CompleteReviewVariables) => ({
      status: 'recorded' as const,
    })),
    portalGroups: [{ id: 'g-1', name: 'Pool side', portalIds: ['p-1'] }],
    responsibleManagers: {
      assignments: [{ userId: 'u-1' }, { userId: 'u-2' }],
      eligibleManagers: [
        { userId: 'u-1', role: 'AccountAdmin' as const },
        { userId: 'u-2', role: 'PropertyManager' as const },
      ],
      revision: 1,
      responsibilityNeeded: false,
      responsibilityNeededSince: null,
    },
    responsibleManagerMembers: [
      {
        userId: 'u-1',
        name: 'Georgi Petrov',
        email: 'georgi@example.com',
        role: 'AccountAdmin',
      },
      {
        userId: 'u-2',
        name: 'Elena Petrova',
        email: 'elena@example.com',
        role: 'PropertyManager',
      },
    ],
    updateResponsibleManagersMutation: action(async () => undefined),
    portalExperience: {
      profile: {
        displayName: 'Avela Resort',
        primaryColor: '#2563EB',
        backgroundColor: '#FFFFFF',
        textColor: '#111827',
      },
      // The property's wording in both languages, and this portal's own welcome
      // lines on top: what the preview draws above "Avela Resort".
      content: [
        {
          locale: 'en' as const,
          title: 'Welcome to Avela',
          shortDescription: 'Rate your visit to Avela Resort.',
          version: 1,
        },
        {
          locale: 'bg' as const,
          title: 'Добре дошли в Авела',
          shortDescription: 'Оценете посещението си в Авела.',
          version: 1,
        },
      ],
      overrides: [
        {
          locale: 'en' as const,
          title: 'Pool & Terrace',
          shortDescription: null,
          version: 1,
        },
        {
          locale: 'bg' as const,
          title: 'Басейн и тераса',
          shortDescription: null,
          version: 1,
        },
      ],
      canManagePropertyBrand: true,
    },
    approvedDestinations: { destinations: [], canApprove: true },
    portalExperienceActions: {
      saveContent: action(async () => undefined),
      saveOverride: action(async () => undefined),
      requestDestination: action(async () => undefined),
      approveDestination: action(async () => undefined),
      disableDestination: action(async () => undefined),
    },
    getPortalPreview: previewReader(),
  } satisfies PortalEditorResources
}
