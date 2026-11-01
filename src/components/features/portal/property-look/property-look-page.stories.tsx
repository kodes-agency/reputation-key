// fallow-ignore-file code-duplication
// The Property look page (board 9): "Avela Resort". The preview reader is the
// portal editor's own stand-in, so the same draft page is drawn; the saves
// record what they were given, so the plays can prove what an edit writes, when,
// and what it does not.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import {
  AuthedRouterDecorator,
  withRole,
  withPermissions,
} from '../../../../../.storybook/AuthedRouterDecorator'
import { previewReader } from '../portal-preview/__fixtures__/portal-preview-fixtures'
import {
  AVELA_MEDIA,
  AVELA_PORTALS,
  AVELA_PROFILE,
  DEFAULT_PALETTE_PROFILE,
  publishingPortals,
  reviewingPortals,
  savingHero,
  savingLocales,
  savingLogo,
  savingLook,
} from './property-look-page-fixtures'
import {
  AVELA_MIXED_PORTALS,
  TWO_PORTALS_ONE_OWN_PHOTO,
} from './property-look-mixed-fixtures'
import { PropertyLookPage } from './property-look-page'

const WAIT = { timeout: 5000 }

const meta = {
  title: 'Portal/PropertyLook/PropertyLookPage',
  component: PropertyLookPage,
  parameters: { layout: 'fullscreen' },
  decorators: [AuthedRouterDecorator],
  args: {
    propertyId: 'prop-1',
    propertyName: 'Avela Resort',
    profile: AVELA_PROFILE,
    canEdit: true,
    rows: AVELA_PORTALS,
    getPortalPreview: previewReader(),
    getPortalReview: reviewingPortals(),
    publishPortals: publishingPortals(),
    canPublish: true,
    saveLook: savingLook(),
    saveLocales: savingLocales(),
    saveHero: savingHero(),
    saveLogo: savingLogo(),
    media: AVELA_MEDIA,
    photoDescriptions: { en: 'The colonnade pool at dusk' },
  },
} satisfies Meta<typeof PropertyLookPage>

export default meta
type Story = StoryObj<typeof meta>

/** Board 9: the four sections, the readout, the portals, and the page drawn beside them. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const name of [
      'Photo',
      'Colours',
      'Name and logo',
      'Languages offered by default',
    ]) {
      await expect(canvas.getByRole('heading', { level: 2, name })).toBeVisible()
    }
    const readout = within(canvas.getByRole('list', { name: 'Readability' }))
    await expect(readout.getAllByText(/Readable/)).toHaveLength(3)
    await expect(canvas.getByLabelText('Accent')).toHaveValue('#EAD6A8')
    await expect(canvas.getByLabelText('Wordmark')).toHaveValue('AVELA')
    await expect(canvas.getByText('5 live · 1 draft')).toBeVisible()
    await expect(canvas.getByText('5 live portals use this look')).toBeVisible()
    // Nothing about portals having a look of their own while the switch is off.
    await expect(
      canvas.getByText(
        'How every portal at Avela Resort looks. Portal wording and links stay per portal.',
      ),
    ).toBeVisible()
    expect(canvas.queryByRole('link', { name: /Edit its look/ })).toBeNull()
    // The archived portal is not reached by the look.
    await expect(canvas.queryByText('Old kiosk')).toBeNull()
    // The page, drawn from the first live portal's draft, in the draft colours.
    const phone = await canvas.findByRole(
      'region',
      { name: 'Preview of the guest page: Reception, arrival' },
      WAIT,
    )
    await expect(within(phone).getByText('How was your experience?')).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'property settings' })).toHaveAttribute(
      'href',
      '/properties/prop-1/settings/profile',
    )
  },
}

const withPending = (counts: Readonly<Record<string, number>>) =>
  AVELA_PORTALS.map((row) => ({ ...row, pendingChangeCount: counts[row.portalId] ?? 0 }))

/** Coming back later, the bar says the saved look has not reached every live portal. */
export const SavedLookNotYetLive: Story = {
  args: { rows: withPending({ 'p-reception': 2, 'p-pool': 1 }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Changes are waiting to go live on 2 of 5 portals'),
    ).toBeVisible()
    // The count of live portals still leads the button; the plain "use" line is gone.
    expect(canvas.queryByText(/live portals use this look/)).toBeNull()
    await expect(
      canvas.getByRole('button', { name: 'Review & publish 5 portals' }),
    ).toBeEnabled()
  },
}

/** Nothing waiting: guests already have the saved look, and the button steps back. */
export const EveryLivePortalShowsTheLook: Story = {
  args: { rows: withPending({}) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('All 5 live portals show this look')).toBeVisible()
    const button = canvas.getByRole('button', { name: 'Review & publish 5 portals' })
    await expect(button).toBeEnabled()
    // The outline look, not the filled one a waiting change gets.
    await expect(button).toHaveClass('border')
  },
}

/** A new accent is written once, after a pause, as the draft; nothing is published. */
export const AccentSavesAsADraft: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const accent = canvas.getByLabelText('Accent')
    await userEvent.clear(accent)
    await userEvent.type(accent, '#C8A45A')
    await waitFor(
      () =>
        expect(args.saveLook).toHaveBeenCalledWith({
          data: {
            propertyId: 'prop-1',
            accentColour: '#C8A45A',
            backgroundMode: 'auto',
            wordmark: 'AVELA',
          },
        }),
      WAIT,
    )
    await expect(args.saveLook).toHaveBeenCalledTimes(1)
    await expect(
      await canvas.findByText(
        'Saved as a draft · 5 live portals use this look',
        {},
        WAIT,
      ),
    ).toBeVisible()
  },
}

/** An accent the field cannot show is flagged, and still written: guests see it as light text. */
export const HardToSeeAccentIsFlaggedNotRefused: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const accent = canvas.getByLabelText('Accent')
    await userEvent.clear(accent)
    await userEvent.type(accent, '#1A1A2E')
    const readout = within(canvas.getByRole('list', { name: 'Readability' }))
    await expect(
      readout.getByText(/Hard to read · guests see it as light text/),
    ).toBeVisible()
    await waitFor(
      () =>
        expect(args.saveLook).toHaveBeenCalledWith({
          data: expect.objectContaining({ accentColour: '#1A1A2E' }),
        }),
      WAIT,
    )
    await expect(canvas.queryByText(/Not saved/)).toBeNull()
  },
}

/**
 * The palette every Property starts with (#2563EB, automatic): its accent is
 * hard to see on its field, and a wordmark edit must still save.
 */
export const DefaultPaletteSavesAWordmark: Story = {
  args: {
    profile: DEFAULT_PALETTE_PROFILE,
    saveLook: savingLook(DEFAULT_PALETTE_PROFILE),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const readout = within(canvas.getByRole('list', { name: 'Readability' }))
    await expect(
      readout.getByText(/Hard to read · guests see it as light text/),
    ).toBeVisible()
    await userEvent.type(canvas.getByLabelText('Wordmark'), 'AVELA')
    await waitFor(
      () =>
        expect(args.saveLook).toHaveBeenCalledWith({
          data: {
            propertyId: 'prop-1',
            accentColour: '#2563EB',
            backgroundMode: 'auto',
            wordmark: 'AVELA',
          },
        }),
      WAIT,
    )
    await expect(await canvas.findByText(/Saved as a draft/, {}, WAIT)).toBeVisible()
  },
}

/** "Custom" starts from the field the page paints, not from the old white. */
export const CustomStartsFromAReadableField: Story = {
  args: {
    profile: DEFAULT_PALETTE_PROFILE,
    saveLook: savingLook(DEFAULT_PALETTE_PROFILE),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('radio', { name: 'Custom' }))
    await expect(canvas.getByLabelText('Background colour')).not.toHaveValue('#FFFFFF')
    await expect(canvas.queryByText(/cannot be read on this background/)).toBeNull()
    await waitFor(
      () =>
        expect(args.saveLook).toHaveBeenCalledWith({
          data: expect.objectContaining({ backgroundMode: 'manual' }),
        }),
      WAIT,
    )
  },
}

/** A custom background brings its own colour field and is held to light text. */
export const CustomBackground: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('radio', { name: 'Custom' }))
    const field = canvas.getByLabelText('Background colour')
    await userEvent.clear(field)
    await userEvent.type(field, '#1B1410')
    await waitFor(
      () =>
        expect(args.saveLook).toHaveBeenCalledWith({
          data: expect.objectContaining({
            backgroundMode: 'manual',
            backgroundColour: '#1B1410',
          }),
        }),
      WAIT,
    )
  },
}

/** The wordmark clears to none, and is held to 24 characters. */
export const WordmarkClearsAndIsBounded: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const wordmark = canvas.getByLabelText('Wordmark')
    await userEvent.type(wordmark, 'X'.repeat(30))
    await expect(canvas.getByText('At most 24 characters')).toBeVisible()
    // Coming back to the field reads why it is refused, not only the alert that appeared.
    await expect(wordmark).toHaveAccessibleDescription('At most 24 characters')
    await expect(
      (await canvas.findAllByText(/Not saved · The wordmark can be at most 24/, {}, WAIT))
        .length,
    ).toBeGreaterThan(0)
    await expect(args.saveLook).not.toHaveBeenCalled()
    await userEvent.clear(wordmark)
    await waitFor(
      () =>
        expect(args.saveLook).toHaveBeenCalledWith({
          data: expect.objectContaining({ wordmark: null }),
        }),
      WAIT,
    )
  },
}

/** "Preview without a photo" switches the preview, and the phone loses its photo. */
export const PreviewWithoutAPhoto: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('region', { name: /Preview of the guest page/ }, WAIT)
    await expect(canvas.getByRole('radio', { name: 'With photo' })).toBeChecked()
    await userEvent.click(canvas.getByRole('button', { name: 'Preview without a photo' }))
    await expect(canvas.getByRole('radio', { name: 'Without photo' })).toBeChecked()
  },
}

/** Choosing another portal draws that portal. */
export const ChoosingAPortalToPreview: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Pool bar/ }))
    await expect(
      await canvas.findByRole(
        'region',
        { name: 'Preview of the guest page: Pool bar, arrival' },
        WAIT,
      ),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: /Pool bar/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  },
}

/** A language that only one is left of cannot be removed; another can become the fallback. */
export const DefaultLanguages: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const list = within(canvas.getByRole('list', { name: 'Default languages' }))
    await expect(list.getByText('Fallback')).toBeVisible()
    await userEvent.click(
      list.getByRole('button', { name: 'Make Bulgarian the fallback' }),
    )
    await waitFor(
      () =>
        expect(args.saveLocales).toHaveBeenCalledWith({
          data: { propertyId: 'prop-1', locales: ['bg', 'en'] },
        }),
      WAIT,
    )
    await userEvent.click(list.getByRole('button', { name: 'Remove English' }))
    await waitFor(
      () =>
        expect(args.saveLocales).toHaveBeenLastCalledWith({
          data: { propertyId: 'prop-1', locales: ['bg'] },
        }),
      WAIT,
    )
    await expect(args.saveLook).not.toHaveBeenCalled()
  },
}

/**
 * On a phone "Make fallback" and "Remove" are tap targets, not 24px marks side by
 * side: both carry the Button's touch minimum (44px below md) and a gap apart.
 */
export const LanguageControlsAreTouchTargets: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = within(canvas.getByRole('list', { name: 'Default languages' }))
    for (const name of ['Make Bulgarian the fallback', 'Remove Bulgarian']) {
      await expect(list.getByRole('button', { name })).toHaveClass(
        'max-md:min-h-(--control-touch)',
      )
    }
  },
}

export const AddingALanguage: Story = {
  args: { profile: { ...AVELA_PROFILE, defaultGuestLocales: ['en'] } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Add language' }))
    await userEvent.click(
      await within(document.body).findByRole('menuitem', { name: /Български/ }),
    )
    await waitFor(
      () =>
        expect(args.saveLocales).toHaveBeenCalledWith({
          data: { propertyId: 'prop-1', locales: ['en', 'bg'] },
        }),
      WAIT,
    )
  },
}

// ── Portals with a look of their own (ADR 0070) ──────────────────────────────

/**
 * A mixed property: five live portals and a draft still take something from the
 * look, a spa has its own photo and colours, and two portals have all of it. The
 * title counts the portals the look reaches, the rail names what each has of its
 * own, and the preview starts from a portal the look reaches.
 */
export const PortalsWithTheirOwnLook: Story = {
  args: { rows: AVELA_MIXED_PORTALS, ownLookEnabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(
        'The look every portal at Avela Resort starts with. A portal can use its own photo, colours, or name and logo.',
      ),
    ).toBeVisible()
    await expect(
      canvas.getByRole('heading', { level: 2, name: 'Portals using this look' }),
    ).toBeVisible()
    await expect(canvas.getByText('5 live · 1 draft')).toBeVisible()
    await expect(
      canvas.getByText(
        '5 live portals use this look · 5 portals have their own photo, colours or name and logo',
      ),
    ).toBeVisible()

    // Text chips name the parts a portal has of its own; there are no thumbnails.
    const spa = within(canvas.getByRole('button', { name: /Spa & thermal pools/ }))
    await expect(spa.getByText('Own photo')).toBeVisible()
    await expect(spa.getByText('Own colours')).toBeVisible()
    expect(spa.queryByText('Own name and logo')).toBeNull()
    const reception = within(canvas.getByRole('button', { name: /Reception/ }))
    expect(reception.queryByText(/^Own /)).toBeNull()

    // The portals with all three parts of their own are set apart.
    const heading = canvas.getByRole('heading', { level: 3, name: 'With their own look' })
    const apart = within(heading.parentElement as HTMLElement)
    await expect(apart.getByRole('button', { name: /Wellness annex/ })).toBeVisible()
    const kiosk = apart.getByRole('button', { name: /Beach kiosk/ })
    await expect(within(kiosk).getByText('No photo')).toBeVisible()
    await expect(within(kiosk).getByText('Own name and logo')).toBeVisible()
    expect(apart.queryByRole('button', { name: /Reception/ })).toBeNull()

    // An account admin can open any portal's Look section from here.
    await expect(canvas.getAllByRole('link', { name: /^Edit its look/ })).toHaveLength(8)
    await expect(
      canvas.getByRole('link', { name: 'Edit its look (Spa & thermal pools)' }),
    ).toHaveAttribute('href', '/properties/prop-1/portals/p-spa?tab=page&section=look')

    // The preview starts from a portal the look reaches.
    await expect(
      await canvas.findByRole(
        'region',
        { name: 'Preview of the guest page: Reception, arrival' },
        WAIT,
      ),
    ).toBeVisible()
  },
}

/** A portal with a photo of its own keeps it: the photo switch is the look's, so it steps aside. */
export const APortalsOwnPhotoIsNotThePropertys: Story = {
  args: { rows: AVELA_MIXED_PORTALS, ownLookEnabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('radio', { name: 'With photo' })).toBeChecked()

    await userEvent.click(canvas.getByRole('button', { name: /Spa & thermal pools/ }))
    await expect(
      await canvas.findByRole(
        'region',
        { name: 'Preview of the guest page: Spa & thermal pools, arrival' },
        WAIT,
      ),
    ).toBeVisible()
    await expect(canvas.getByText('Spa & thermal pools has its own photo')).toBeVisible()
    expect(canvas.queryByRole('radio', { name: 'With photo' })).toBeNull()

    await userEvent.click(canvas.getByRole('button', { name: /Beach kiosk/ }))
    await expect(canvas.getByText('Beach kiosk shows no photo')).toBeVisible()

    // A portal that follows the photo gets the switch back.
    await userEvent.click(canvas.getByRole('button', { name: /Guest rooms/ }))
    await expect(canvas.getByRole('radio', { name: 'With photo' })).toBeVisible()
  },
}

/** Someone who cannot edit still sees what each portal has of its own, but is offered no way to change it. */
export const AManagerSeesWhatIsOwnButCannotEditIt: Story = {
  decorators: [withRole('PropertyManager')],
  args: { rows: AVELA_MIXED_PORTALS, ownLookEnabled: true, canEdit: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      within(canvas.getByRole('button', { name: /Spa & thermal pools/ })).getByText(
        'Own photo',
      ),
    ).toBeVisible()
    await expect(
      canvas.getByRole('heading', { level: 3, name: 'With their own look' }),
    ).toBeVisible()
    expect(canvas.queryByRole('link', { name: /Edit its look/ })).toBeNull()
  },
}

/** Switched off, what portals already have is still told as it is; nothing invites more. */
export const OwnLookSwitchedOffStillTellsTheTruth: Story = {
  args: { rows: AVELA_MIXED_PORTALS, ownLookEnabled: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      within(canvas.getByRole('button', { name: /Olive Terrace restaurant/ })).getByText(
        'Own colours',
      ),
    ).toBeVisible()
    expect(canvas.queryByRole('link', { name: /Edit its look/ })).toBeNull()
  },
}

/** One portal sees nothing new, switch on or not: no sentence about own looks, no link, no group. */
export const OnePortalSeesNothingNew: Story = {
  args: { rows: AVELA_PORTALS.slice(0, 1), ownLookEnabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(
        'How every portal at Avela Resort looks. Portal wording and links stay per portal.',
      ),
    ).toBeVisible()
    await expect(canvas.getByText('1 live portal uses this look')).toBeVisible()
    expect(canvas.queryByRole('link', { name: /Edit its look/ })).toBeNull()
    expect(canvas.queryByRole('heading', { name: 'With their own look' })).toBeNull()
  },
}

/** A second portal with a photo of its own: the line names it, and the other portal is still reached. */
export const OnePortalWithItsOwnPhoto: Story = {
  args: { rows: TWO_PORTALS_ONE_OWN_PHOTO, ownLookEnabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(
        '2 live portals use this look · Spa & thermal pools has its own photo',
      ),
    ).toBeVisible()
    await expect(
      canvas.getByRole('link', { name: 'Edit its look (Reception)' }),
    ).toBeVisible()
  },
}

/** Only an Account Admin edits it; everyone else reads it. */
export const ReadOnly: Story = {
  decorators: [withPermissions(['portal.read', 'property.read'])],
  args: { canEdit: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/An account admin manages the look/)).toBeVisible()
    await expect(canvas.getByLabelText('Accent')).toBeDisabled()
    await expect(canvas.getByLabelText('Wordmark')).toBeDisabled()
    await expect(canvas.queryByRole('button', { name: 'Add language' })).toBeNull()
  },
}

export const NoPortalsYet: Story = {
  args: { rows: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Make a portal to see the look on a page'),
    ).toBeVisible()
    await expect(canvas.getByText('No portals yet')).toBeVisible()
    await expect(canvas.getByText('No live portal uses this look yet')).toBeVisible()
  },
}

const savingName = () =>
  Object.assign(
    fn(
      async (_input: { data: { propertyId: string; displayName: string } }) => undefined,
    ),
    { isPending: false, error: null, isSuccess: false, data: null },
  )

/** An account admin sets the name on this page; nobody is sent to property settings. */
export const NoPublicDisplayName: Story = {
  args: { profile: null, saveDisplayName: savingName() as never },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Set the public display name first')).toBeVisible()
    expect(canvas.queryByRole('link', { name: /Set it in property settings/ })).toBeNull()
    // The card points to Property look for colours; on Property look it would point at itself.
    // (The breadcrumb names the page but is not a link.)
    expect(
      canvas
        .queryAllByRole('link', { name: 'Property look' })
        .filter((link) => link.hasAttribute('href')),
    ).toHaveLength(0)
    await userEvent.type(canvas.getByLabelText('Public display name'), 'Avela Resort')
    await userEvent.click(
      canvas.getByRole('button', { name: 'Save public display name' }),
    )
    await waitFor(() =>
      expect(args.saveDisplayName).toHaveBeenCalledWith({
        data: { propertyId: 'prop-1', displayName: 'Avela Resort' },
      }),
    )
  },
}

/** Someone who cannot set the name is told who can, and sees no field. */
export const NoPublicDisplayNameForAReader: Story = {
  decorators: [withPermissions(['portal.read', 'property.read'])],
  args: { profile: null, canEdit: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Set the public display name first')).toBeVisible()
    await expect(canvas.getByText(/Ask an account admin to set it/)).toBeVisible()
    expect(canvas.queryByLabelText('Public display name')).toBeNull()
  },
}

const rejectingLook = (error: Error) =>
  Object.assign(
    fn(async () => {
      throw error
    }),
    { isPending: false, error: null, isSuccess: false, data: null },
  ) as never

/** A write that fails says so and offers a retry. */
export const FailedSaveOffersRetry: Story = {
  args: { saveLook: rejectingLook(new Error('offline')) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const accent = canvas.getByLabelText('Accent')
    await userEvent.clear(accent)
    await userEvent.type(accent, '#C8A45A')
    await expect(
      await canvas.findByRole('button', { name: 'Try again' }, WAIT),
    ).toBeVisible()
    await expect(canvas.getAllByText('Not saved').length).toBeGreaterThan(0)
  },
}

/** A refusal in words says why, and offers no retry: trying again cannot cure it. */
export const RefusedSaveSaysWhy: Story = {
  args: {
    saveLook: rejectingLook(
      new ServerFunctionError(
        'PortalError',
        'Portals are switched off here',
        'forbidden',
        403,
      ),
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const accent = canvas.getByLabelText('Accent')
    await userEvent.clear(accent)
    await userEvent.type(accent, '#C8A45A')
    await expect(
      (await canvas.findAllByText('Not saved · Portals are switched off here', {}, WAIT))
        .length,
    ).toBeGreaterThan(0)
    await expect(canvas.queryByRole('button', { name: 'Try again' })).toBeNull()
  },
}

/**
 * Leaving with a save that failed asks first, names what was not saved and
 * offers to try again; keeping on stays, and nothing is lost silently.
 */
export const LeavingAfterAFailedSaveAsks: Story = {
  args: { saveLook: rejectingLook(new Error('offline')) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    const accent = canvas.getByLabelText('Accent')
    await userEvent.clear(accent)
    await userEvent.type(accent, '#C8A45A')
    await canvas.findByRole('button', { name: 'Try again' }, WAIT)
    await userEvent.click(canvas.getByRole('link', { name: 'Portals' }))
    await expect(
      await body.findByRole('alertdialog', { name: 'Save before you leave?' }),
    ).toBeVisible()
    await expect(body.getByText(/Not saved: the property look\./)).toBeVisible()
    await expect(body.getByRole('button', { name: 'Try saving again' })).toBeVisible()
    await userEvent.click(body.getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(body.queryByRole('alertdialog')).not.toBeInTheDocument())
    await expect(canvas.getByLabelText('Accent')).toHaveValue('#C8A45A')
  },
}

/** An edit still inside its pause is written before the page is left, and leaving is quiet. */
export const LeavingWritesWhatIsWaiting: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    const accent = canvas.getByLabelText('Accent')
    await userEvent.clear(accent)
    await userEvent.type(accent, '#C8A45A')
    await userEvent.click(canvas.getByRole('link', { name: 'Portals' }))
    await waitFor(() => expect(args.saveLook).toHaveBeenCalledTimes(1), WAIT)
    await expect(body.queryByRole('alertdialog')).not.toBeInTheDocument()
  },
}
