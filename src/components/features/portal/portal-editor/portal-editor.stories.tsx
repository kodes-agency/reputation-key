// The Page tab's section editor, with the autosave coordinator the workspace
// layout normally provides. The story wraps the editor with the header's
// save-status line so the play tests can watch what a manager would see.
import type { Meta, StoryObj } from '@storybook/react'
import { useRouterState } from '@tanstack/react-router'
import { expect, mocked, userEvent, waitFor, within } from 'storybook/test'
import { action, makeResources, portal } from './__fixtures__/portal-editor-fixtures'
import type { PortalPreviewReader } from '../portal-preview/portal-preview-pane'
import { PortalWritesOffDecorator } from '../portal-overview/portal-writes-off-decorator'
import { PortalUnsavedChangesPrompt } from '../portal-detail/portal-unsaved-changes-prompt'
import { PortalEditor } from './portal-editor'
import { PortalDraftAutosaveProvider } from './portal-draft-autosave-context'
import { PortalDraftSaveStatus } from './portal-draft-save-status'
import type { PortalEditorSection } from './portal-editor-sections'
import type { PortalEditorResources } from './portal-editor-types'
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

/** The editor on the section its address names, as the route renders it. */
function EditorFollowingTheAddress({ resources }: EditorStoryProps) {
  const section = useRouterState({
    select: (state) =>
      (state.location.search as Readonly<{ section?: PortalEditorSection }>).section,
  })
  return <EditorWithStatus resources={resources} requestedSection={section} />
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
      'LookThe property look',
      'WelcomePool & Terrace',
      'Rating & GoogleAlways included',
      'Private note3★ or below',
      'Linktree4 links · 1 hidden from guests',
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

// The link check names the page it covers, says changes waiting to go live are
// not covered, and words the checkbox for what is checked.
export const LinkCheckNamesTheLiveVersion: Story = {
  args: {
    resources: makeResources(action(async () => undefined)),
    requestedSection: 'rating',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'Link check' })).toBeVisible()
    await expect(
      canvas.getByText(
        /This check covers live version 5. Changes waiting to go live are not part of it/,
      ),
    ).toBeVisible()
    await expect(
      canvas.getByRole('checkbox', {
        name: /every Linktree link on live version 5, and each one opens the page it should/,
      }),
    ).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: 'Record the link check' }),
    ).toBeDisabled()
    await expect(canvas.queryByText(/content review/i)).toBeNull()
  },
}
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
      english.getByLabelText('This portal’s welcome line', {
        selector: '#portal-override-title-en',
      }),
    ).toHaveValue('Pool & Terrace')
    await expect(
      english.getByLabelText('This portal’s welcome line', {
        selector: '#portal-override-title-en',
      }),
    ).toHaveAttribute('placeholder', 'Welcome to Avela')
    await expect(
      english.getByLabelText('This portal’s welcome line', {
        selector: '#portal-override-title-en',
      }),
    ).toHaveAccessibleDescription(/above Avela Resort/)
    await expect(
      english.getByLabelText('This portal’s link preview', {
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

/** A preview read that never answers: the pane stays on its loading placeholder. */
const previewNeverLoads: PortalPreviewReader = () => new Promise(() => undefined)

// Closing the property's wording keeps what was typed in it: the fold hides its
// form rather than removing it, so an unsaved edit (and the guard that asks
// before leaving with one) survives.
//
// It runs without the live preview. With the guest page drawn beside it, these
// fold toggles and this fast typing wedged headless Chromium on Linux CI in
// about one run of this file in fifty: tile raster work the compositor had
// scheduled never ran, so the page's main thread blocked for good waiting to
// commit the next frame, no test timeout could fire, and storybook-test hung
// until the job was cancelled. Without the preview, none in 585 runs. See its
// row in docs/operations/e2e-flake-register.md.
export const PropertyWordingKeepsAnUnsavedEdit: Story = {
  args: {
    resources: {
      ...makeResources(action(async () => undefined)),
      getPortalPreview: previewNeverLoads,
    },
  },
  play: async ({ canvasElement }) => {
    const english = languageCard(canvasElement, /English/)
    const fold = english.getByRole('button', { name: /Property wording/ })
    await userEvent.click(fold)
    const field = english.getByLabelText('Welcome line for every portal', {
      selector: '#portal-content-title-en',
    })
    await userEvent.clear(field)
    await userEvent.type(field, 'Welcome to the resort')
    await userEvent.click(fold)
    await expect(fold).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(fold)
    await expect(
      english.getByLabelText('Welcome line for every portal', {
        selector: '#portal-content-title-en',
      }),
    ).toHaveValue('Welcome to the resort')
    // The guest page never drew beside the typing (see above).
    const preview = within(
      within(canvasElement).getByRole('complementary', { name: 'Live preview' }),
    )
    await expect(preview.getByText('Loading preview…')).toBeInTheDocument()
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
      bulgarian.getByLabelText('Welcome line for every portal', {
        selector: '#portal-content-title-bg',
      }),
    ).toHaveAttribute('readonly')
    await expect(
      bulgarian.queryByRole('button', { name: 'Save property wording' }),
    ).toBeNull()
    // This portal's own lines are still the manager's to write.
    await expect(
      bulgarian.getByLabelText('This portal’s welcome line', {
        selector: '#portal-override-title-bg',
      }),
    ).toBeEnabled()
  },
}

// Bulgarian is offered but the property has no Bulgarian wording, so this
// portal's own Bulgarian lines would not count: the card says so, and the
// property's wording comes first, open, right under the warning that points at
// it; this portal's own lines follow, saying when they will count. Welcome in
// the section list carries the flag too, not only Languages.
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
    const propertyField = bulgarian.getByLabelText('Welcome line for every portal', {
      selector: '#portal-content-title-bg',
    })
    const ownField = bulgarian.getByLabelText('This portal’s welcome line', {
      selector: '#portal-override-title-bg',
    })
    await expect(
      Boolean(
        propertyField.compareDocumentPosition(ownField) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true)
    await expect(
      bulgarian.getByText(/own lines count once the property wording above is saved/),
    ).toBeVisible()
    const nav = within(
      within(canvasElement).getByRole('navigation', { name: 'Editor sections' }),
    )
    await expect(nav.getByRole('link', { name: /^Welcome/ })).toHaveTextContent(
      /1 language without wording/,
    )
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
      canvas.getByRole('combobox', { name: 'Offer a private note at' }),
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
    // This property has one portal, so the look is the property's alone: it is
    // edited once, on the Property look page, not in this portal's editor.
    await expect(canvas.getByText('Avela Resort')).toBeVisible()
    await expect(
      canvas.getByRole('img', { name: /accent colour #2563EB/i }),
    ).toBeVisible()
    await expect(
      canvas.getByText('The photo, colours and name guests see on this portal.'),
    ).toBeVisible()
    await expect(
      canvas.getByRole('link', { name: /edit the property look/i }),
    ).toHaveAttribute('href', '/properties/prop-1/portals/look')
    await expect(canvas.queryByRole('button', { name: /save brand colours/i })).toBeNull()
    await expect(canvas.queryByText(/palette for this portal/i)).toBeNull()
    await expect(canvas.queryByRole('button', { name: /set colours/i })).toBeNull()
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
      canvas.getByLabelText('This portal’s welcome line', {
        selector: '#portal-override-title-en',
      }),
    ).toHaveAttribute('readonly')
    await expect(canvas.queryByText(/save as you type/)).toBeNull()
    await expect(canvas.queryByText(/Edits stay in this draft/)).toBeNull()
  },
}

// The role may change portals but the organisation's portal writes are off:
// every save would be refused, so the fields are read-only. The workspace says
// why under its header (PortalReadOnlyNotice).
export const ChangesOffForTheOrganizationReadsOnly: Story = {
  args: { resources: makeResources(action(async () => undefined)) },
  decorators: [PortalWritesOffDecorator],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('Name')).toHaveAttribute('readonly')
    await expect(canvas.queryByText(/save as you type/)).toBeNull()
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

// Someone who may change the portal gets editable fields.
export const ManagerCanEditTheFields: Story = {
  args: { resources: makeResources(action(async () => undefined)) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('Name')).not.toHaveAttribute('readonly')
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

// Below lg the preview stacks under the form, so a click on a part happens far
// from the section it opens: the section is brought into view and focus lands
// on its heading, not only the outline in the phone moving.
export const PreviewClickRevealsTheSectionItOpens: Story = {
  args: { resources: makeResources(action(async () => undefined)) },
  decorators: [
    withRole('AccountAdmin', {
      at: '/properties/prop-1/portals/p-1?tab=page&section=linktree',
    }),
  ],
  render: (args) => <EditorFollowingTheAddress {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const preview = within(
      await canvas.findByRole('complementary', { name: 'Live preview' }),
    )
    await userEvent.click(
      await preview.findByRole('button', { name: 'Edit Welcome' }, { timeout: 5000 }),
    )
    const heading = await canvas.findByRole('heading', { level: 2, name: 'Welcome' })
    await waitFor(() => expect(heading).toHaveFocus())
  },
}

// Responsible keeps an explicit Save (every save notifies people), so ticks
// waiting for it are registered with the leave guard: switching section asks
// instead of dropping them.
export const UnsavedResponsibleTicksAskBeforeLeaving: Story = {
  args: { resources: makeResources(action(async () => undefined)) },
  decorators: [
    withRole('AccountAdmin', {
      at: '/properties/prop-1/portals/p-1?tab=page&section=responsible',
    }),
  ],
  render: (args) => (
    <>
      <PortalUnsavedChangesPrompt />
      <EditorFollowingTheAddress {...args} />
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await expect(canvas.getByText(/Changes apply when you save them/)).toBeVisible()
    await userEvent.click(canvas.getByRole('checkbox', { name: /Elena Petrova/ }))
    const nav = within(canvas.getByRole('navigation', { name: 'Editor sections' }))
    await userEvent.click(nav.getByRole('link', { name: /^Welcome/ }))
    const dialog = await body.findByRole('alertdialog', { name: 'Leave without saving?' })
    await expect(dialog).toBeVisible()
    // It names what would be lost, once.
    await expect(dialog).toHaveTextContent(
      'Not saved: the responsible managers. If you go on, these changes are discarded.',
    )
    await userEvent.click(body.getByRole('button', { name: 'Keep editing' }))
    await expect(
      canvas.getByRole('checkbox', { name: /Elena Petrova/ }),
    ).not.toBeChecked()
  },
}
