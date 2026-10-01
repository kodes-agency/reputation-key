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
    links: [
      {
        id: 'l-1',
        label: 'Google Reviews',
        url: 'https://google.com',
        sortKey: 'a',
        categoryId: 'cat-1',
      },
    ],
    linktree: {
      portalId: 'p-1',
      enabled: true,
      maxLinks: 4,
      primaryLocale: 'en' as const,
      locales: ['en' as const, 'bg' as const],
      titles: {},
      links: [
        {
          id: 'l-1',
          categoryId: 'cat-1',
          url: 'https://google.com',
          iconKey: null,
          imageAssetId: null,
          sortKey: 'a',
          texts: [
            {
              locale: 'en' as const,
              label: 'Google Reviews',
              line: null,
              provenance: null,
            },
          ],
          destination: {
            state: 'approved' as const,
            sourceType: 'recognized' as const,
            approvedByUserId: 'u-1',
          },
        },
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
      content: [
        { locale: 'en' as const, title: 'Welcome', shortDescription: 'Hi', version: 1 },
      ],
      overrides: [],
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

/**
 * The portal's own description. By id, not by label: the property fallback and
 * this portal's override below it are labelled "Description" too.
 */
function portalDescription(canvasElement: HTMLElement): HTMLTextAreaElement {
  const field = canvasElement.querySelector<HTMLTextAreaElement>(
    '#edit-portal-description',
  )
  if (field === null) throw new Error('the portal description field is not on the page')
  return field
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
      'Linktree1 link',
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
      name: 'More actions for Google Reviews',
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
      within(document.body).getByRole('menuitem', { name: 'Delete link' }),
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
    await expect(body.queryByRole('menuitem', { name: 'Delete link' })).toBeNull()
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

export const AutosavesTheDescription: Story = {
  args: { resources: makeResources(action(async () => undefined)) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.type(portalDescription(canvasElement), ' Open all day.')
    await expect(saveStatus(canvas)).toHaveTextContent('Saving…')
    await waitFor(
      () =>
        expect(args.resources.autosaveUpdateMutation).toHaveBeenCalledWith({
          data: {
            portalId: 'p-1',
            name: 'Pool & Terrace',
            slug: 'pool-terrace',
            description: 'Drinks and lunch by the pool. Open all day.',
          },
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
    await userEvent.type(portalDescription(canvasElement), '!')
    await waitFor(
      () => expect(saveStatus(canvas)).toHaveTextContent('Not saved'),
      AUTOSAVE_WAIT,
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Retry' }))
    await waitFor(
      () => expect(saveStatus(canvas)).toHaveTextContent('Draft saved'),
      AUTOSAVE_WAIT,
    )
    await expect(args.resources.autosaveUpdateMutation).toHaveBeenCalledTimes(2)
  },
}

export const SlugIsSavedWhenLeftNotWhileTyped: Story = {
  args: { resources: makeResources(action(async () => undefined)) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /change slug/i }))
    const slug = canvas.getByRole('textbox', { name: /url slug/i })
    await userEvent.clear(slug)
    await userEvent.type(slug, 'pool-side')
    // Longer than the debounce: a half-typed address must not have been written.
    await new Promise((resolve) => setTimeout(resolve, 1200))
    await expect(args.resources.autosaveUpdateMutation).not.toHaveBeenCalled()
    await userEvent.tab()
    await waitFor(
      () =>
        expect(args.resources.autosaveUpdateMutation).toHaveBeenCalledWith({
          data: expect.objectContaining({ slug: 'pool-side' }),
        }),
      AUTOSAVE_WAIT,
    )
  },
}

// Every write of the form sends the whole form, so a name write that fires while
// the slug is being typed must still send the slug the person last left it with.
export const AnotherWriteKeepsTheCommittedSlug: Story = {
  args: { resources: makeResources(action(async () => undefined)) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Name'), ' 2')
    await userEvent.click(canvas.getByRole('button', { name: /change slug/i }))
    const slug = canvas.getByRole('textbox', { name: /url slug/i })
    await userEvent.clear(slug)
    await userEvent.type(slug, 'pool-side')
    await waitFor(
      () =>
        expect(args.resources.autosaveUpdateMutation).toHaveBeenCalledWith({
          data: expect.objectContaining({
            name: 'Pool & Terrace 2',
            slug: 'pool-terrace',
          }),
        }),
      AUTOSAVE_WAIT,
    )
    await expect(args.resources.autosaveUpdateMutation).not.toHaveBeenCalledWith({
      data: expect.objectContaining({ slug: 'pool-side' }),
    })
    await userEvent.tab()
    await waitFor(
      () =>
        expect(args.resources.autosaveUpdateMutation).toHaveBeenCalledWith({
          data: expect.objectContaining({ slug: 'pool-side' }),
        }),
      AUTOSAVE_WAIT,
    )
  },
}

export const PrivateNoteThreshold: Story = {
  args: {
    resources: makeResources(action(async () => undefined)),
    requestedSection: 'private-note',
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.selectOptions(
      canvas.getByLabelText(/private feedback threshold/i),
      '2',
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

export const MemberSeesTheFieldsReadOnly: Story = {
  args: { resources: makeResources(action(async () => undefined)) },
  decorators: [withRole('Member')],
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByLabelText('Name')).toBeDisabled()
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
