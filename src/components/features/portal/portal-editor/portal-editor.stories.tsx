// The Page tab's section editor, with the autosave coordinator the workspace
// layout normally provides. The story wraps the editor with the header's
// save-status line so the play tests can watch what a manager would see.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, mocked, userEvent, waitFor, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import { previewReader } from '../portal-preview/__fixtures__/portal-preview-fixtures'
import { PortalEditor } from './portal-editor'
import { PortalDraftAutosaveProvider } from './portal-draft-autosave-context'
import { PortalDraftSaveStatus } from './portal-draft-save-status'
import type { PortalEditorSection } from './portal-editor-sections'
import type { PortalEditorResources } from './portal-editor-types'
import type { CompleteReviewVariables, UpdatePortalVariables } from '../shared/types'
import {
  AuthedRouterDecorator,
  withRole,
} from '../../../../../.storybook/AuthedRouterDecorator'

type EditorStoryProps = Readonly<{
  resources: PortalEditorResources
  requestedSection?: PortalEditorSection
}>

function EditorWithStatus({ resources, requestedSection }: EditorStoryProps) {
  return (
    <div>
      <div className="flex justify-end border-b px-4 py-2" data-testid="save-status">
        <PortalDraftSaveStatus />
      </div>
      <PortalEditor resources={resources} requestedSection={requestedSection} />
    </div>
  )
}

const meta: Meta<typeof EditorWithStatus> = {
  title: 'Portal/PortalEditor',
  component: EditorWithStatus,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <PortalDraftAutosaveProvider>
        <Story />
      </PortalDraftAutosaveProvider>
    ),
    AuthedRouterDecorator,
  ],
}
export default meta
type Story = StoryObj<typeof EditorWithStatus>

function action<TInput, TOutput = unknown>(
  impl: (input: TInput) => Promise<TOutput>,
): Action<TInput, TOutput> {
  return Object.assign(fn(impl), {
    isPending: false,
    error: null as unknown,
    isSuccess: false,
    data: null,
  }) as unknown as Action<TInput, TOutput>
}

const portal = {
  id: 'p-1',
  name: 'Pool & Terrace',
  slug: 'pool-terrace',
  description: 'Drinks and lunch by the pool.',
  heroImageUrl: null,
  theme: { primaryColor: '#6366f1', backgroundColor: '#ffffff', textColor: '#111827' },
  privateFeedbackThreshold: 3,
  propertyId: 'prop-1',
  organizationId: 'org-1',
  publicationState: 'published' as const,
  primaryGuestLocale: 'en' as const,
  additionalGuestLocales: ['bg' as const],
}

/** A Linktree link with an English label and, when given, a Bulgarian one. */
function storyLink(
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

/** One language's card in Welcome, found by the language's name. */
function languageCard(canvasElement: HTMLElement, language: RegExp) {
  return within(within(canvasElement).getByRole('group', { name: language }))
}

/** The same portal for someone who may not change the property's wording. */
function asPropertyManager(resources: PortalEditorResources): PortalEditorResources {
  const experience = resources.portalExperience
  if (!experience) return resources
  return {
    ...resources,
    portalExperience: { ...experience, canManagePropertyBrand: false },
  }
}

/** The same portal before anyone wrote the property's Bulgarian wording. */
function withoutBulgarianWording(
  resources: PortalEditorResources,
): PortalEditorResources {
  const experience = resources.portalExperience
  if (!experience) return resources
  return {
    ...resources,
    portalExperience: {
      ...experience,
      content: experience.content.filter((row) => row.locale !== 'bg'),
      overrides: experience.overrides.filter((row) => row.locale !== 'bg'),
    },
  }
}

function makeResources(
  autosaveUpdateMutation: Action<UpdatePortalVariables>,
): PortalEditorResources {
  return {
    portal,
    propertyId: 'prop-1',
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
    updateMutation: action(async (_input: UpdatePortalVariables) => undefined),
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

const AUTOSAVE_WAIT = { timeout: 3000 }

/** The header's autosave line; other panels on the page have status regions too. */
function saveStatus(canvas: ReturnType<typeof within>): HTMLElement {
  return within(canvas.getByTestId('save-status')).getByRole('status')
}

export const SectionList: Story = {
  args: { resources: makeResources(action(async () => undefined)) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const nav = within(canvas.getByRole('navigation', { name: 'Editor sections' }))
    // Guest order first, then what only managers see.
    await expect(nav.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'LookPhoto and colours · property-wide',
      'WelcomePool & Terrace',
      'Rating & GoogleAlways included',
      'Private note3★ or below',
      'Linktree4 links',
      'FooterPrivacy notice',
      'Languages2 languages',
      'GroupPool side',
      'ResponsibleGeorgi, Elena',
    ])
    await expect(nav.getByRole('link', { name: /^Welcome/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(canvas.getByRole('heading', { level: 2, name: 'Welcome' })).toBeVisible()
  },
}

function sectionStory(section: PortalEditorSection, heading: string): Story {
  return {
    args: {
      resources: makeResources(action(async () => undefined)),
      requestedSection: section,
    },
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement)
      await expect(canvas.getByRole('heading', { level: 2, name: heading })).toBeVisible()
      const current = within(canvas.getByRole('navigation', { name: 'Editor sections' }))
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page')
      await expect(current).toHaveLength(1)
      await expect(current[0]?.textContent?.startsWith(heading)).toBe(true)
    },
  }
}

// Every section opens from `?section=` and is the one the list marks current.
export const LookSection: Story = sectionStory('look', 'Look')
export const RatingSection: Story = sectionStory('rating', 'Rating & Google')
export const LinktreeSection: Story = sectionStory('linktree', 'Linktree')

async function openTileMenu(canvasElement: HTMLElement) {
  await userEvent.click(
    await within(canvasElement).findByRole('button', {
      name: 'More actions for Discover the resort',
    }),
  )
}

export const AccountAdminCanDeleteALink: Story = {
  args: {
    resources: makeResources(action(async () => undefined)),
    requestedSection: 'linktree',
  },
  play: async ({ canvasElement }) => {
    await openTileMenu(canvasElement)
    await expect(
      within(document.body).getByRole('menuitem', { name: 'Delete link…' }),
    ).toBeVisible()
  },
}

// `deleteLink` asks for `portal.delete`, which a property manager does not hold:
// the tile must not offer what the server would refuse.
export const PropertyManagerCanEditButNotDeleteALink: Story = {
  args: {
    resources: makeResources(action(async () => undefined)),
    requestedSection: 'linktree',
  },
  decorators: [withRole('PropertyManager')],
  play: async ({ canvasElement }) => {
    await openTileMenu(canvasElement)
    const body = within(document.body)
    await expect(body.getByRole('menuitem', { name: 'Edit' })).toBeVisible()
    await expect(body.queryByRole('menuitem', { name: 'Delete link…' })).toBeNull()
  },
}

export const LanguagesSection: Story = sectionStory('languages', 'Languages')
export const ResponsibleSection: Story = sectionStory('responsible', 'Responsible')

// The section list flags what the coverage read says is missing, beside the count.
export const LanguagesFlagMissingText: Story = {
  args: {
    resources: {
      ...makeResources(action(async () => undefined)),
      languageCoverage: {
        portalId: 'p-1',
        fallbackLocale: 'en',
        languages: [
          { locale: 'en', isFallback: true, total: 3, present: 3, missing: [] },
          {
            locale: 'bg',
            isFallback: false,
            total: 3,
            present: 2,
            missing: [
              {
                key: 'link:l-1',
                kind: 'link_label',
                linkId: 'l-1',
                linkLabel: 'Menu',
                blocksPublish: false,
              },
            ],
          },
        ],
        missingTotal: 1,
      },
    },
    requestedSection: 'languages',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const nav = within(canvas.getByRole('navigation', { name: 'Editor sections' }))
    await expect(nav.getByRole('link', { name: /^Languages/ })).toHaveTextContent(
      /2 languages.*1 missing/,
    )
    await expect(canvas.getByText('2 of 3 · 1 missing')).toBeVisible()
  },
}

export const AutosavesTheName: Story = {
  args: { resources: makeResources(action(async () => undefined)) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Name'), ' 2')
    await expect(saveStatus(canvas)).toHaveTextContent('Saving…')
    await waitFor(
      () =>
        expect(args.resources.autosaveUpdateMutation).toHaveBeenCalledWith({
          data: { portalId: 'p-1', name: 'Pool & Terrace 2' },
        }),
      AUTOSAVE_WAIT,
    )
    // One write for the whole burst of typing, and it is acknowledged.
    await waitFor(
      () => expect(saveStatus(canvas)).toHaveTextContent('Draft saved'),
      AUTOSAVE_WAIT,
    )
    await expect(args.resources.autosaveUpdateMutation).toHaveBeenCalledTimes(1)
    // There is no Save button to press for a portal's own fields.
    await expect(
      canvas.queryByRole('button', { name: /save changes/i }),
    ).not.toBeInTheDocument()
  },
}

// Welcome names what guests read: each language's welcome line and link
// preview, empty when they use the property's wording (shown as placeholders),
// with the property's wording folded away below. The portal's address and its
// old description are not guest-facing, so they are not here.
export const WelcomeLinesPerLanguage: Story = {
  args: { resources: makeResources(action(async () => undefined)) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const english = languageCard(canvasElement, /English/)
    await expect(
      english.getByLabelText('Welcome line', { selector: '#portal-override-title-en' }),
    ).toHaveValue('Pool & Terrace')
    await expect(
      english.getByLabelText('Welcome line', { selector: '#portal-override-title-en' }),
    ).toHaveAttribute('placeholder', 'Welcome to Avela')
    await expect(
      english.getByLabelText('Welcome line', { selector: '#portal-override-title-en' }),
    ).toHaveAccessibleDescription(/above Avela Resort/)
    await expect(
      english.getByLabelText('Link preview', {
        selector: '#portal-override-description-en',
      }),
    ).toBeVisible()
    await expect(
      english.getByRole('button', { name: /Property wording/ }),
    ).toHaveAttribute('aria-expanded', 'false')
    await expect(canvas.queryByText(/url slug/i)).toBeNull()
    await expect(canvas.queryByRole('button', { name: /change slug/i })).toBeNull()
  },
}

// Closing the property's wording keeps what was typed in it: the fold hides its
// form rather than removing it, so an unsaved edit (and the guard that asks
// before leaving with one) survives.
export const PropertyWordingKeepsAnUnsavedEdit: Story = {
  args: { resources: makeResources(action(async () => undefined)) },
  play: async ({ canvasElement }) => {
    const english = languageCard(canvasElement, /English/)
    const fold = english.getByRole('button', { name: /Property wording/ })
    await userEvent.click(fold)
    const field = english.getByLabelText('Welcome line', {
      selector: '#portal-content-title-en',
    })
    await userEvent.clear(field)
    await userEvent.type(field, 'Welcome to the resort')
    await userEvent.click(fold)
    await expect(fold).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(fold)
    await expect(
      english.getByLabelText('Welcome line', { selector: '#portal-content-title-en' }),
    ).toHaveValue('Welcome to the resort')
  },
}

// A property manager reads the property's wording but cannot change it, and a
// language without it says who writes it.
export const PropertyManagerReadsThePropertyWording: Story = {
  args: {
    resources: asPropertyManager(
      withoutBulgarianWording(makeResources(action(async () => undefined))),
    ),
  },
  play: async ({ canvasElement }) => {
    const bulgarian = languageCard(canvasElement, /Bulgarian/)
    await expect(bulgarian.getByText(/An account admin writes it first/)).toBeVisible()
    await expect(
      bulgarian.getByText('Only an account admin can change it.'),
    ).toBeVisible()
    // Read-only, not disabled: the wording is shown at full contrast.
    await expect(
      bulgarian.getByLabelText('Welcome line', { selector: '#portal-content-title-bg' }),
    ).toHaveAttribute('readonly')
    await expect(
      bulgarian.queryByRole('button', { name: 'Save property wording' }),
    ).toBeNull()
    // This portal's own lines are still the manager's to write.
    await expect(
      bulgarian.getByLabelText('Welcome line', { selector: '#portal-override-title-bg' }),
    ).toBeEnabled()
  },
}

// Bulgarian is offered but the property has no Bulgarian wording, so this
// portal's own Bulgarian lines would not count: the card says so and opens the
// property's wording to be written.
export const LanguageWithoutPropertyWording: Story = {
  args: {
    resources: withoutBulgarianWording(makeResources(action(async () => undefined))),
  },
  play: async ({ canvasElement }) => {
    const bulgarian = languageCard(canvasElement, /Bulgarian/)
    await expect(bulgarian.getByText(/has no property wording yet/)).toBeVisible()
    await expect(
      bulgarian.getByRole('button', { name: /Property wording/ }),
    ).toHaveAttribute('aria-expanded', 'true')
    await expect(
      bulgarian.getByRole('button', { name: 'Save property wording' }),
    ).toBeVisible()
  },
}

export const RefusedEditIsNotSaved: Story = {
  args: { resources: makeResources(action(async () => undefined)) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.clear(canvas.getByLabelText('Name'))
    await waitFor(
      () =>
        expect(saveStatus(canvas)).toHaveTextContent(
          'Not saved · check the highlighted fields',
        ),
      AUTOSAVE_WAIT,
    )
    await expect(canvas.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
    await expect(args.resources.autosaveUpdateMutation).not.toHaveBeenCalled()
  },
}

export const FailedSaveCanBeRetried: Story = {
  args: { resources: makeResources(action(async () => undefined)) },
  play: async ({ canvasElement, args }) => {
    // Set up here, not in the args: Storybook resets mocks between runs.
    mocked(args.resources.autosaveUpdateMutation).mockRejectedValueOnce(
      new Error('offline'),
    )
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Name'), '!')
    await waitFor(
      () => expect(saveStatus(canvas)).toHaveTextContent('Not saved'),
      AUTOSAVE_WAIT,
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    await waitFor(
      () => expect(saveStatus(canvas)).toHaveTextContent('Draft saved'),
      AUTOSAVE_WAIT,
    )
    await expect(args.resources.autosaveUpdateMutation).toHaveBeenCalledTimes(2)
  },
}

export const PrivateNoteThreshold: Story = {
  args: {
    resources: makeResources(action(async () => undefined)),
    requestedSection: 'private-note',
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('combobox', { name: /private feedback threshold/i }),
    )
    await userEvent.click(
      await within(document.body).findByRole('option', { name: '2 stars or lower' }),
    )
    await waitFor(
      () =>
        expect(args.resources.autosaveUpdateMutation).toHaveBeenCalledWith({
          data: { portalId: 'p-1', privateFeedbackThreshold: 2 },
        }),
      AUTOSAVE_WAIT,
    )
  },
}

export const LookOpensThePropertyLook: Story = {
  args: {
    resources: makeResources(action(async () => undefined)),
    requestedSection: 'look',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The photo and colours are shared with every portal, so they are edited
    // once, on the Property look page, not in this portal's editor.
    await expect(canvas.getByText('Avela Resort')).toBeVisible()
    await expect(
      canvas.getByRole('img', { name: /accent colour #2563EB/i }),
    ).toBeVisible()
    await expect(
      canvas.getByRole('link', { name: /edit the property look/i }),
    ).toHaveAttribute('href', '/properties/prop-1/portals/look')
    await expect(canvas.queryByRole('button', { name: /save brand colours/i })).toBeNull()
    await expect(canvas.queryByText(/palette for this portal/i)).toBeNull()
  },
}

export const FooterIsFixedText: Story = {
  args: {
    resources: makeResources(action(async () => undefined)),
    requestedSection: 'footer',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/cannot be changed or hidden/i)).toBeVisible()
    await expect(canvas.queryByRole('textbox')).not.toBeInTheDocument()
  },
}

export const GroupSectionNamesTheGroup: Story = {
  args: {
    resources: makeResources(action(async () => undefined)),
    requestedSection: 'group',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      within(canvas.getByRole('region', { name: 'Group' })).getByText('Pool side'),
    ).toBeVisible()
    await expect(
      canvas.getByRole('link', { name: /manage groups on the portals list/i }),
    ).toHaveAttribute('href', '/properties/prop-1/portals')
  },
}

export const UnofferedSectionFallsBackToWelcome: Story = {
  args: {
    resources: {
      ...makeResources(action(async () => undefined)),
      portalGroups: undefined,
    },
    requestedSection: 'group',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { level: 2, name: 'Welcome' })).toBeVisible()
    await expect(
      within(canvas.getByRole('navigation', { name: 'Editor sections' })).queryByRole(
        'link',
        { name: /^Group/ },
      ),
    ).not.toBeInTheDocument()
  },
}

// A viewer reads the values at full contrast (read-only, not greyed out), and
// nothing on the page promises that edits save as they are typed.
export const MemberSeesTheFieldsReadOnly: Story = {
  args: { resources: makeResources(action(async () => undefined)) },
  decorators: [withRole('Member')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('Name')).toHaveAttribute('readonly')
    await expect(canvas.getByLabelText('Name')).toBeEnabled()
    await expect(
      canvas.getByLabelText('Welcome line', { selector: '#portal-override-title-en' }),
    ).toHaveAttribute('readonly')
    await expect(canvas.queryByText(/save as you type/)).toBeNull()
    await expect(canvas.queryByText(/Edits stay in this draft/)).toBeNull()
  },
}

// An archived portal is read-only for everyone, an account admin included.
export const ArchivedPortalIsReadOnly: Story = {
  args: {
    resources: {
      ...makeResources(action(async () => undefined)),
      portal: { ...portal, publicationState: 'archived' as const },
    },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByLabelText('Name')).toHaveAttribute('readonly')
  },
}

// Boards 02 and 04: the preview outlines the part of the page the active
// section edits (it follows `?section=`), and Languages opens the sheet in it.
export const PreviewOutlinesTheActiveSection: Story = {
  args: {
    resources: makeResources(action(async () => undefined)),
    requestedSection: 'linktree',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const preview = within(
      await canvas.findByRole('complementary', { name: 'Live preview' }),
    )
    const linktree = await preview.findByRole(
      'button',
      { name: 'Edit Linktree' },
      { timeout: 5000 },
    )
    await expect(linktree).toHaveAttribute('aria-current', 'true')
    await expect(
      preview.getByRole('button', { name: 'Edit Welcome' }),
    ).not.toHaveAttribute('aria-current')
    await expect(preview.getByText('Click any part of the page to edit it')).toBeVisible()
  },
}

export const LanguagesOpensTheSheetInThePreview: Story = {
  args: {
    resources: makeResources(action(async () => undefined)),
    requestedSection: 'languages',
  },
  play: async ({ canvasElement }) => {
    const preview = within(
      await within(canvasElement).findByRole('complementary', { name: 'Live preview' }),
    )
    const languages = await preview.findByRole(
      'button',
      { name: 'Edit Languages' },
      { timeout: 5000 },
    )
    await expect(languages).toHaveAttribute('aria-current', 'true')
    await expect(preview.getByText('Language', { selector: 'h2' })).toBeVisible()
  },
}
