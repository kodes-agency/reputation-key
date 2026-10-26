// fallow-ignore-file code-duplication
// The Look section of the portal editor (ADR 0070): a portal follows the property
// look until an Account Admin gives it a photo, colours, or a name and logo of its
// own, each group on its own. The writes are the server's, applied to the look the
// story holds, so a play can set colours, edit them and see the section change; the
// spy records exactly what each gesture sent. The pictures are made in the browser.
import { useMemo, useState, useSyncExternalStore } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { openAlertDialog } from '#/components/ui/confirmation-dialog.stories.open'
import type { PortalLookView } from '#/contexts/portal/application/public-api'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import {
  AuthedRouterDecorator,
  withRole,
} from '../../../../../.storybook/AuthedRouterDecorator'
import { ToasterDecorator } from '../../../../../.storybook/ToasterDecorator'
import { PortalEditor } from '../portal-editor/portal-editor'
import { PortalDraftAutosaveProvider } from '../portal-editor/portal-draft-autosave-context'
import { PortalDraftSaveStatus } from '../portal-editor/portal-draft-save-status'
import type { PortalImageUploader } from '../portal-media/upload-portal-image'
import { makeImageFile, uploadingTo } from '../property-look/property-look-page-fixtures'
import {
  FOLLOWS_EVERYTHING,
  NO_PHOTO,
  OWN_COLOURS,
  OWN_EVERYTHING,
  OWN_IDENTITY,
  OWN_PHOTO,
  OWN_PHOTO_ASSET,
  PORTAL_ID,
  PROPERTY_ID,
  TAKEN_DOWN_PHOTO,
  createLookStore,
  lookResources,
  storedLookActions,
} from './__fixtures__/portal-look-story-data'

const WAIT = { timeout: 5000 }
const TARGET = { propertyId: PROPERTY_ID, portalId: PORTAL_ID } as const

type StoryProps = Readonly<{
  look: PortalLookView | null
  siblingPortalCount?: number
  enabled?: boolean
  canManage?: boolean
  archived?: boolean
  /** Every write the section makes, as it was sent. */
  onWrite: (input: unknown) => void
  uploadImage?: PortalImageUploader
}>

/** The editor on the Look section, the writes applied to the look the story holds. */
function LookInTheEditor({ look: initial, onWrite, uploadImage, ...rest }: StoryProps) {
  const [store] = useState(() => createLookStore(initial))
  const look = useSyncExternalStore(store.subscribe, store.get)
  const actions = useMemo(
    () => storedLookActions(store, onWrite, uploadImage),
    [store, onWrite, uploadImage],
  )
  return (
    <div>
      <div className="flex justify-end border-b px-4 py-2" data-testid="save-status">
        <PortalDraftSaveStatus />
      </div>
      <PortalEditor
        resources={lookResources({ look, actions, ...rest })}
        requestedSection="look"
      />
    </div>
  )
}

const meta = {
  title: 'Portal/PortalEditor/Look',
  component: LookInTheEditor,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <PortalDraftAutosaveProvider>
        <Story />
      </PortalDraftAutosaveProvider>
    ),
    ToasterDecorator,
    AuthedRouterDecorator,
  ],
  args: {
    look: FOLLOWS_EVERYTHING,
    onWrite: fn(),
    uploadImage: uploadingTo(OWN_PHOTO_ASSET),
  },
} satisfies Meta<typeof LookInTheEditor>

export default meta
type Story = StoryObj<typeof meta>

/** The Look section, found by its name (the list's link carries it too). */
const lookSection = (canvasElement: HTMLElement) =>
  within(within(canvasElement).getByRole('region', { name: 'Look' }))

/** One group's region, found once the editor's chunk has loaded (it is fetched when first shown). */
const group = async (canvasElement: HTMLElement, name: string) =>
  within(await lookSection(canvasElement).findByRole('region', { name }, WAIT))

const navLine = (canvasElement: HTMLElement) =>
  within(within(canvasElement).getByRole('navigation', { name: 'Editor sections' }))

const saveStatus = (canvasElement: HTMLElement) =>
  within(within(canvasElement).getByTestId('save-status')).getByRole('status')

const noDialog = () => expect(within(document.body).queryByRole('dialog')).toBeNull()

// ── What each portal sees ────────────────────────────────────────────────────

/** A portal with no look of its own: all three groups follow the property, and say what they follow. */
export const FollowsEverything: Story = {
  play: async ({ canvasElement, args }) => {
    const section = lookSection(canvasElement)
    await group(canvasElement, 'Photo')
    await expect(section.getByText(/Pool & Terrace uses/)).toBeVisible()
    await expect(
      section.getByText(/Give it its own photo, colours, or name and logo/),
    ).toBeVisible()
    for (const link of section.getAllByRole('link', { name: 'the property look' })) {
      await expect(link).toHaveAttribute('href', '/properties/prop-1/portals/look')
    }
    await expect(section.getAllByText(/^Follows/)).toHaveLength(3)
    await expect(
      section.getByText(/currently accent #EAD6A8, automatic background/),
    ).toBeVisible()
    await expect(section.getByText('The property’s photo.')).toBeVisible()
    await expect(section.getByText(/currently the wordmark AVELA/)).toBeVisible()
    await expect(
      section.getByText(/Guests see the business name Avela Resort, set in/),
    ).toBeVisible()
    for (const name of [
      'Use a different photo here',
      'No photo on this portal',
      'Set colours for this portal',
      'Set name and logo for this portal',
    ]) {
      await expect(section.getByRole('button', { name })).toBeVisible()
    }
    await expect(
      section.queryByRole('button', { name: /^Use the property’s/ }),
    ).toBeNull()
    await expect(navLine(canvasElement).getByText('The property look')).toBeVisible()
    await expect(args.onWrite).not.toHaveBeenCalled()
  },
}

/** One portal at the property: nothing new appears, and the section is as it was. */
export const SinglePortalKeepsTodaysView: Story = {
  args: { siblingPortalCount: 1 },
  play: async ({ canvasElement }) => {
    const section = lookSection(canvasElement)
    await expect(
      section.getByText('The photo, colours and name guests see on this portal.'),
    ).toBeVisible()
    await expect(
      section.getByRole('img', { name: /accent colour #EAD6A8/i }),
    ).toBeVisible()
    await expect(
      section.getByRole('link', { name: /edit the property look/i }),
    ).toHaveAttribute('href', '/properties/prop-1/portals/look')
    await expect(section.queryByRole('button')).toBeNull()
  },
}

/** While the switch is off, a portal that has none of its own sees today's view too. */
export const SwitchedOffKeepsTodaysView: Story = {
  args: { enabled: false },
  play: async ({ canvasElement }) => {
    const section = lookSection(canvasElement)
    await expect(
      section.getByRole('link', { name: /edit the property look/i }),
    ).toBeVisible()
    await expect(section.queryByRole('button', { name: /set colours/i })).toBeNull()
  },
}

/** A portal with a photo of its own: the photo, its focus point and the way back. */
export const OwnPhotoOnly: Story = {
  args: { look: OWN_PHOTO },
  play: async ({ canvasElement }) => {
    const section = lookSection(canvasElement)
    const photo = await group(canvasElement, 'Photo')
    await expect(section.getByText(/Pool & Terrace follows/)).toBeVisible()
    await expect(
      photo.getByRole('button', { name: /^Focal point: 30% across, 60% down/ }),
    ).toBeVisible()
    await expect(photo.getByRole('button', { name: 'Replace photo' })).toBeVisible()
    await expect(photo.getByRole('button', { name: 'Remove photo' })).toBeVisible()
    await expect(
      photo.getByRole('button', { name: 'Use the property’s photo' }),
    ).toBeVisible()
    await expect(photo.getByText(/Set here instead of/)).toBeVisible()
    await expect(
      photo.getByText(/Without one, screen readers skip the photo/),
    ).toBeVisible()
    // The other two groups still follow the property.
    await expect(
      (await group(canvasElement, 'Colours')).getByRole('button', {
        name: 'Set colours for this portal',
      }),
    ).toBeVisible()
    await expect(navLine(canvasElement).getByText('Own photo')).toBeVisible()
  },
}

/** A portal with colours of its own: the accent, the tint and what a guest can read. */
export const OwnColoursOnly: Story = {
  args: { look: OWN_COLOURS },
  play: async ({ canvasElement }) => {
    const colours = await group(canvasElement, 'Colours')
    await expect(colours.getByRole('textbox', { name: 'Accent' })).toHaveValue('#9AD6C8')
    await expect(colours.getByRole('list', { name: 'Readability' })).toBeVisible()
    await expect(
      colours.getByRole('button', { name: 'Use the property’s colours' }),
    ).toBeVisible()
    await expect(colours.getByText(/Set here instead of/)).toBeVisible()
    await expect(navLine(canvasElement).getByText('Own colours')).toBeVisible()
  },
}

/** A portal with its own wordmark and logo; the business name stays the property's. */
export const OwnNameAndLogo: Story = {
  args: { look: OWN_IDENTITY },
  play: async ({ canvasElement }) => {
    const identity = await group(canvasElement, 'Name and logo')
    await expect(identity.getByRole('textbox', { name: 'Wordmark' })).toHaveValue('POOL')
    await expect(identity.getByRole('img', { name: 'Avela Resort logo' })).toBeVisible()
    await expect(identity.getByRole('button', { name: 'Replace logo' })).toBeVisible()
    await expect(
      identity.getByRole('button', { name: 'Use the property’s name and logo' }),
    ).toBeVisible()
    await expect(
      identity.getByText(/Guests see the business name Avela Resort, set in/),
    ).toBeVisible()
    await expect(navLine(canvasElement).getByText('Own name and logo')).toBeVisible()
  },
}

/** All three groups the portal's own. */
export const OwnLook: Story = {
  args: { look: OWN_EVERYTHING },
  play: async ({ canvasElement }) => {
    await group(canvasElement, 'Photo')
    await expect(navLine(canvasElement).getByText('Own look')).toBeVisible()
    await expect(
      lookSection(canvasElement).queryByRole('button', { name: /^Set / }),
    ).toBeNull()
    for (const name of [
      'Use the property’s photo',
      'Use the property’s colours',
      'Use the property’s name and logo',
    ]) {
      await expect(lookSection(canvasElement).getByRole('button', { name })).toBeVisible()
    }
  },
}

/** The portal was told to go without a photo: it shows the colour field, not the property's photograph. */
export const NoPhotoOnThisPortal: Story = {
  args: { look: NO_PHOTO },
  play: async ({ canvasElement }) => {
    const photo = await group(canvasElement, 'Photo')
    await expect(
      photo.getByText('No photo on this portal. Its pages use the colour field.'),
    ).toBeVisible()
    await expect(photo.getByRole('button', { name: 'Add a photo' })).toBeVisible()
    await expect(
      photo.getByRole('button', { name: 'Use the property’s photo' }),
    ).toBeVisible()
    await expect(photo.queryByRole('button', { name: /^Focal point/ })).toBeNull()
    await expect(navLine(canvasElement).getByText('No photo')).toBeVisible()
  },
}

/** The portal's own photo was taken down: it has no photo now, and the section says so. */
export const OwnPhotoTakenDown: Story = {
  args: { look: TAKEN_DOWN_PHOTO },
  play: async ({ canvasElement }) => {
    const photo = await group(canvasElement, 'Photo')
    await expect(
      photo.getByText(
        'This portal’s photo was taken down. Choose another or use the property’s photo.',
      ),
    ).toBeVisible()
    await expect(
      photo.getByRole('button', { name: 'Choose another photo' }),
    ).toBeVisible()
    await expect(
      photo.getByRole('button', { name: 'Use the property’s photo' }),
    ).toBeVisible()
    await expect(photo.queryByRole('button', { name: /^Focal point/ })).toBeNull()
  },
}

// ── Who sees what ────────────────────────────────────────────────────────────

/** A Property Manager reads facts and who changes them; no control is drawn to be disabled. */
export const PropertyManagerSeesFacts: Story = {
  args: { look: OWN_PHOTO, canManage: false },
  decorators: [withRole('PropertyManager')],
  play: async ({ canvasElement }) => {
    const section = lookSection(canvasElement)
    const facts = within(section.getByText('Photo').closest('dl')!)
    await expect(facts.getByText('This portal’s own')).toBeVisible()
    await expect(facts.getAllByText('The property’s')).toHaveLength(2)
    await expect(
      section.getByText('An account admin changes this portal’s look.'),
    ).toBeVisible()
    await expect(
      section.getByRole('link', { name: 'See the property look' }),
    ).toHaveAttribute('href', '/properties/prop-1/portals/look')
    await expect(section.queryByRole('button')).toBeNull()
  },
}

/** An archived portal is kept as it was: its look is told, not edited, even to an Account Admin. */
export const ArchivedPortalShowsFacts: Story = {
  args: { look: OWN_COLOURS, archived: true },
  play: async ({ canvasElement }) => {
    const section = lookSection(canvasElement)
    await expect(section.getByText('This portal’s own')).toBeVisible()
    await expect(
      section.getByText('An archived portal keeps the look it had.'),
    ).toBeVisible()
    await expect(section.queryByRole('button')).toBeNull()
    await expect(section.queryByRole('textbox')).toBeNull()
  },
}

/** With the switch off, a portal that has its own look is told, and nobody is named to change it. */
export const SwitchedOffOwnLookShowsFacts: Story = {
  args: { look: OWN_COLOURS, enabled: false },
  play: async ({ canvasElement }) => {
    const section = lookSection(canvasElement)
    await expect(section.getByText('This portal’s own')).toBeVisible()
    await expect(
      section.getByText('A portal’s own look cannot be changed at the moment.'),
    ).toBeVisible()
    await expect(section.queryByRole('button')).toBeNull()
  },
}

/** After the other portals are archived a portal that has its own look keeps the way back. */
export const OwnLookKeepsTheEditorAtOnePortal: Story = {
  args: { look: OWN_COLOURS, siblingPortalCount: 1 },
  play: async ({ canvasElement }) => {
    await expect(
      (await group(canvasElement, 'Colours')).getByRole('button', {
        name: 'Use the property’s colours',
      }),
    ).toBeVisible()
  },
}

// ── Colours ──────────────────────────────────────────────────────────────────

/** "Set colours for this portal" starts from the property's, so nothing guests see moves until they are edited. */
export const SetColoursStartsFromThePropertysAndAutosaves: Story = {
  play: async ({ canvasElement, args }) => {
    const colours = await group(canvasElement, 'Colours')
    await userEvent.click(
      colours.getByRole('button', { name: 'Set colours for this portal' }),
    )
    await waitFor(
      () =>
        expect(args.onWrite).toHaveBeenCalledWith({
          ...TARGET,
          colours: { mode: 'own' },
        }),
      WAIT,
    )
    const accent = await colours.findByRole('textbox', { name: 'Accent' }, WAIT)
    await expect(accent).toHaveValue('#EAD6A8')
    // Starting own colours is one write; the values follow only once they are edited.
    await expect(args.onWrite).toHaveBeenCalledTimes(1)

    await userEvent.clear(accent)
    await userEvent.type(accent, '#9AD6C8')
    await waitFor(
      () =>
        expect(args.onWrite).toHaveBeenLastCalledWith({
          ...TARGET,
          colours: { mode: 'own', accentColour: '#9AD6C8', backgroundMode: 'auto' },
        }),
      WAIT,
    )
    await waitFor(
      () => expect(saveStatus(canvasElement)).toHaveTextContent('Draft saved'),
      WAIT,
    )
    await expect(args.onWrite).toHaveBeenCalledTimes(2)
    await expect(
      colours.getByRole('button', { name: 'Use the property’s colours' }),
    ).toBeVisible()
    await expect(navLine(canvasElement).getByText('Own colours')).toBeVisible()
  },
}

/** "Use the property's colours" gives them back; the fields go and the property's are followed again. */
export const UsingThePropertysColoursGivesThemBack: Story = {
  args: { look: OWN_COLOURS },
  play: async ({ canvasElement, args }) => {
    const colours = await group(canvasElement, 'Colours')
    await userEvent.click(
      colours.getByRole('button', { name: 'Use the property’s colours' }),
    )
    await waitFor(
      () =>
        expect(args.onWrite).toHaveBeenCalledWith({
          ...TARGET,
          colours: { mode: 'inherit' },
        }),
      WAIT,
    )
    await waitFor(() => expect(colours.queryByRole('textbox')).toBeNull(), WAIT)
    await expect(
      colours.getByRole('button', { name: 'Set colours for this portal' }),
    ).toBeVisible()
    await expect(navLine(canvasElement).getByText('The property look')).toBeVisible()
  },
}

/** A background light text cannot be read on is flagged and held back, not written. */
export const UnreadableColoursAreNotSaved: Story = {
  args: { look: OWN_COLOURS },
  play: async ({ canvasElement, args }) => {
    const colours = await group(canvasElement, 'Colours')
    await userEvent.click(colours.getByRole('radio', { name: 'Custom' }))
    const background = await colours.findByRole('textbox', { name: 'Background colour' })
    await waitFor(() => expect(args.onWrite).toHaveBeenCalledTimes(1), WAIT)
    await userEvent.clear(background)
    await userEvent.type(background, '#FFFFFF')
    await waitFor(
      () =>
        expect(saveStatus(canvasElement)).toHaveTextContent(
          'Not saved · check the highlighted fields',
        ),
      WAIT,
    )
    await expect(background).toHaveAttribute('aria-invalid', 'true')
    await expect(args.onWrite).toHaveBeenCalledTimes(1)
  },
}

/** A refusal of "Set colours" is a toast, and the section stays as it was. */
export const RefusedSwitchIsToldInAToast: Story = {
  args: {
    onWrite: fn(() => {
      throw new ServerFunctionError(
        'PortalError',
        'Only an Account Admin can change a portal’s look',
        'forbidden',
        403,
      )
    }),
  },
  play: async ({ canvasElement }) => {
    const colours = await group(canvasElement, 'Colours')
    await userEvent.click(
      colours.getByRole('button', { name: 'Set colours for this portal' }),
    )
    await expect(
      await within(document.body).findByText(
        'Only an Account Admin can change a portal’s look',
        {},
        WAIT,
      ),
    ).toBeInTheDocument()
    await expect(
      colours.getByRole('button', { name: 'Set colours for this portal' }),
    ).toBeEnabled()
    await expect(colours.queryByRole('textbox')).toBeNull()
  },
}

// ── Photo ────────────────────────────────────────────────────────────────────

/** The circle moves with the arrow keys; the new point autosaves alone, so the photo and its descriptions stay. */
export const FocusPointAutosaves: Story = {
  args: { look: OWN_PHOTO },
  play: async ({ canvasElement, args }) => {
    const photo = await group(canvasElement, 'Photo')
    photo.getByRole('button', { name: /^Focal point: 30% across, 60% down/ }).focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowDown}')
    await expect(
      photo.getByRole('button', { name: /^Focal point: 36% across, 62% down/ }),
    ).toBeVisible()
    await waitFor(
      () =>
        expect(args.onWrite).toHaveBeenCalledWith({
          ...TARGET,
          photo: { mode: 'own', focalX: 0.36, focalY: 0.62 },
        }),
      WAIT,
    )
    await waitFor(
      () => expect(saveStatus(canvasElement)).toHaveTextContent('Draft saved'),
      WAIT,
    )
    await expect(args.onWrite).toHaveBeenCalledTimes(1)
    await expect(args.uploadImage).not.toHaveBeenCalled()
  },
}

/** "Use a different photo here": the file, its descriptions in the portal's languages, the permission. */
export const ChoosingAPhotoForThisPortal: Story = {
  play: async ({ canvasElement, args }) => {
    const photo = await group(canvasElement, 'Photo')
    await userEvent.click(
      photo.getByRole('button', { name: 'Use a different photo here' }),
    )
    const dialog = within(
      await within(document.body).findByRole('dialog', { name: 'Add a photo' }, WAIT),
    )
    await expect(
      dialog.getByText('Shown at the top of Pool & Terrace only.'),
    ).toBeVisible()
    await expect(
      dialog.getByText('Live pages change when you publish this portal.'),
    ).toBeVisible()
    await userEvent.upload(
      dialog.getByLabelText('Photo file'),
      await makeImageFile(1600, 1000),
    )
    await dialog.findByText(/1600 × 1000/, {}, WAIT)
    // A description for each of the portal's languages, none taken from the property.
    await userEvent.type(
      dialog.getByLabelText('Describe the photo in English'),
      'The thermal pool, lit at dusk',
    )
    await expect(dialog.getByLabelText('Describe the photo in Bulgarian')).toHaveValue('')
    await userEvent.click(
      dialog.getByRole('checkbox', {
        name: 'Avela Resort owns this photo or has permission to use it.',
      }),
    )
    await userEvent.click(dialog.getByRole('button', { name: 'Use photo' }))
    await waitFor(
      () =>
        expect(args.uploadImage).toHaveBeenCalledWith(
          { propertyId: 'prop-1', purpose: 'hero', rightsConfirmed: true },
          expect.objectContaining({ name: 'terrace-evening.png' }),
        ),
      WAIT,
    )
    await waitFor(
      () =>
        expect(args.onWrite).toHaveBeenCalledWith({
          ...TARGET,
          photo: {
            mode: 'own',
            heroAssetId: OWN_PHOTO_ASSET,
            focalX: 0.5,
            focalY: 0.5,
            altTexts: [{ locale: 'en', text: 'The thermal pool, lit at dusk' }],
          },
        }),
      WAIT,
    )
    await waitFor(noDialog, WAIT)
    await expect(
      await (
        await group(canvasElement, 'Photo')
      ).findByRole('button', { name: 'Replace photo' }, WAIT),
    ).toBeVisible()
    await expect(navLine(canvasElement).getByText('Own photo')).toBeVisible()
  },
}

/** Replacing the portal's photo shows the descriptions it already has, in the portal's languages. */
export const ReplacingThePhotoKeepsItsDescriptions: Story = {
  args: { look: OWN_PHOTO },
  play: async ({ canvasElement }) => {
    const photo = await group(canvasElement, 'Photo')
    await userEvent.click(photo.getByRole('button', { name: 'Replace photo' }))
    const dialog = within(
      await within(document.body).findByRole('dialog', { name: 'Replace photo' }, WAIT),
    )
    await expect(dialog.getByLabelText('Describe the photo in English')).toHaveValue(
      'The thermal pool, lit at dusk',
    )
    await expect(dialog.getByLabelText('Describe the photo in Bulgarian')).toHaveValue('')
  },
}

/** "No photo on this portal" is one write, and the property's photograph is not shown instead. */
export const NoPhotoOnThisPortalIsOneWrite: Story = {
  play: async ({ canvasElement, args }) => {
    const photo = await group(canvasElement, 'Photo')
    await userEvent.click(photo.getByRole('button', { name: 'No photo on this portal' }))
    await waitFor(
      () =>
        expect(args.onWrite).toHaveBeenCalledWith({ ...TARGET, photo: { mode: 'none' } }),
      WAIT,
    )
    await expect(
      await photo.findByText(
        'No photo on this portal. Its pages use the colour field.',
        {},
        WAIT,
      ),
    ).toBeVisible()
    await expect(args.onWrite).toHaveBeenCalledTimes(1)
  },
}

/** Taking the portal's photo off asks first, and leaves the portal with no photo, not the property's. */
export const RemovingThePortalsPhotoLeavesNone: Story = {
  args: { look: OWN_PHOTO },
  play: async ({ canvasElement, args }) => {
    const confirm = await openAlertDialog(canvasElement, 'Remove photo')
    expect(args.onWrite).not.toHaveBeenCalled()
    await expect(confirm.getByText('Remove the photo?')).toBeVisible()
    await expect(
      confirm.getByText(
        /Pool & Terrace will have no photo, and its pages will use the colour field/,
      ),
    ).toBeVisible()
    await userEvent.click(confirm.getByRole('button', { name: 'Remove photo' }))
    await waitFor(
      () =>
        expect(args.onWrite).toHaveBeenCalledWith({ ...TARGET, photo: { mode: 'none' } }),
      WAIT,
    )
    await expect(
      await (
        await group(canvasElement, 'Photo')
      ).findByRole('button', { name: 'Add a photo' }, WAIT),
    ).toBeVisible()
  },
}

/** "Use the property's photo" gives the photo back; the thumbnail of the property's returns. */
export const UsingThePropertysPhotoGivesItBack: Story = {
  args: { look: NO_PHOTO },
  play: async ({ canvasElement, args }) => {
    const photo = await group(canvasElement, 'Photo')
    await userEvent.click(photo.getByRole('button', { name: 'Use the property’s photo' }))
    await waitFor(
      () =>
        expect(args.onWrite).toHaveBeenCalledWith({
          ...TARGET,
          photo: { mode: 'inherit' },
        }),
      WAIT,
    )
    await expect(await photo.findByText('The property’s photo.', {}, WAIT)).toBeVisible()
  },
}

// ── Name and logo ────────────────────────────────────────────────────────────

/** "Set name and logo for this portal" starts from the property's wordmark. */
export const SetNameAndLogoStartsFromThePropertys: Story = {
  play: async ({ canvasElement, args }) => {
    const identity = await group(canvasElement, 'Name and logo')
    await userEvent.click(
      identity.getByRole('button', { name: 'Set name and logo for this portal' }),
    )
    await waitFor(
      () =>
        expect(args.onWrite).toHaveBeenCalledWith({
          ...TARGET,
          identity: { mode: 'own' },
        }),
      WAIT,
    )
    await expect(
      await identity.findByRole('textbox', { name: 'Wordmark' }, WAIT),
    ).toHaveValue('AVELA')
    await expect(identity.getByRole('button', { name: 'Upload logo' })).toBeVisible()
    await expect(args.onWrite).toHaveBeenCalledTimes(1)
  },
}

/** The wordmark autosaves alone; emptied, the business name shows. */
export const WordmarkAutosaves: Story = {
  args: { look: OWN_IDENTITY },
  play: async ({ canvasElement, args }) => {
    const identity = await group(canvasElement, 'Name and logo')
    const wordmark = identity.getByRole('textbox', { name: 'Wordmark' })
    await userEvent.clear(wordmark)
    await userEvent.type(wordmark, 'POOL BAR')
    // The phone follows the typing at once: the preview read here never changes.
    const phone = within(
      await within(canvasElement).findByRole('region', {
        name: /^Preview of the guest page/,
      }),
    )
    await expect(await phone.findByText('POOL BAR', {}, WAIT)).toBeInTheDocument()
    await waitFor(
      () =>
        expect(args.onWrite).toHaveBeenLastCalledWith({
          ...TARGET,
          identity: { mode: 'own', wordmark: 'POOL BAR' },
        }),
      WAIT,
    )
    await waitFor(
      () => expect(saveStatus(canvasElement)).toHaveTextContent('Draft saved'),
      WAIT,
    )
    await expect(args.onWrite).toHaveBeenCalledTimes(1)
  },
}

/** The phone's Live version is shown as guests have it: a look edit is of the draft, not of the live page. */
export const LiveVersionIgnoresADraftEdit: Story = {
  args: { look: OWN_IDENTITY },
  play: async ({ canvasElement }) => {
    const identity = await group(canvasElement, 'Name and logo')
    const wordmark = identity.getByRole('textbox', { name: 'Wordmark' })
    await userEvent.clear(wordmark)
    await userEvent.type(wordmark, 'POOL BAR')
    const draftPhone = within(
      await within(canvasElement).findByRole('region', {
        name: /^Preview of the guest page: Draft/,
      }),
    )
    await expect(await draftPhone.findByText('POOL BAR', {}, WAIT)).toBeInTheDocument()
    await userEvent.click(within(canvasElement).getByRole('radio', { name: 'Live' }))
    const livePhone = within(
      await within(canvasElement).findByRole(
        'region',
        { name: /^Preview of the guest page: Live/ },
        WAIT,
      ),
    )
    await expect(await livePhone.findByText('AVELA', {}, WAIT)).toBeInTheDocument()
    await expect(livePhone.queryByText('POOL BAR')).toBeNull()
  },
}

/** A wordmark over 24 characters is held back with the reason beside it. */
export const LongWordmarkIsNotSaved: Story = {
  args: { look: OWN_IDENTITY },
  play: async ({ canvasElement, args }) => {
    const identity = await group(canvasElement, 'Name and logo')
    const wordmark = identity.getByRole('textbox', { name: 'Wordmark' })
    await userEvent.clear(wordmark)
    await userEvent.type(wordmark, 'W'.repeat(25), { delay: null })
    await expect(identity.getByText('At most 24 characters')).toBeVisible()
    await waitFor(
      () =>
        expect(saveStatus(canvasElement)).toHaveTextContent(
          'Not saved · check the highlighted fields',
        ),
      WAIT,
    )
    await expect(args.onWrite).not.toHaveBeenCalled()
  },
}

/** Replacing the logo names this portal only, and writes the logo alone. */
export const ReplacingTheLogoNamesThisPortalOnly: Story = {
  args: { look: OWN_IDENTITY },
  play: async ({ canvasElement, args }) => {
    const identity = await group(canvasElement, 'Name and logo')
    await userEvent.click(identity.getByRole('button', { name: 'Replace logo' }))
    const dialog = within(
      await within(document.body).findByRole('dialog', { name: 'Replace logo' }, WAIT),
    )
    await expect(
      dialog.getByText('Replaces the wordmark at the top of Pool & Terrace only.'),
    ).toBeVisible()
    await expect(
      dialog.getByText('Live pages change when you publish this portal.'),
    ).toBeVisible()
    await userEvent.upload(
      dialog.getByLabelText('Logo file'),
      await makeImageFile(480, 120, 'pool-logo.png'),
    )
    await dialog.findByText(/480 × 120/, {}, WAIT)
    await userEvent.click(dialog.getByRole('checkbox'))
    await userEvent.click(dialog.getByRole('button', { name: 'Use logo' }))
    await waitFor(
      () =>
        expect(args.onWrite).toHaveBeenCalledWith({
          ...TARGET,
          identity: { mode: 'own', logoAssetId: OWN_PHOTO_ASSET },
        }),
      WAIT,
    )
    await waitFor(noDialog, WAIT)
  },
}

/** "Use the property's name and logo" gives both back; the wordmark field and the logo go. */
export const GivingBackTheNameAndLogo: Story = {
  args: { look: OWN_IDENTITY },
  play: async ({ canvasElement, args }) => {
    const identity = await group(canvasElement, 'Name and logo')
    await userEvent.click(
      identity.getByRole('button', { name: 'Use the property’s name and logo' }),
    )
    await waitFor(
      () =>
        expect(args.onWrite).toHaveBeenCalledWith({
          ...TARGET,
          identity: { mode: 'inherit' },
        }),
      WAIT,
    )
    await waitFor(() => expect(identity.queryByRole('textbox')).toBeNull(), WAIT)
  },
}
