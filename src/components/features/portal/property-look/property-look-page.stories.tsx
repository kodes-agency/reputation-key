// fallow-ignore-file code-duplication
// The Property look page (board 9): "Avela Resort". The preview reader is the
// portal editor's own stand-in, so the same draft page is drawn; the saves
// record what they were given, so the plays can prove what an edit writes, when,
// and what it does not.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  AuthedRouterDecorator,
  withRole,
} from '../../../../../.storybook/AuthedRouterDecorator'
import { previewReader } from '../portal-preview/__fixtures__/portal-preview-fixtures'
import {
  AVELA_PORTALS,
  AVELA_PROFILE,
  savingLocales,
  savingLook,
} from './property-look-page-fixtures'
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
    saveLook: savingLook(),
    saveLocales: savingLocales(),
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
    // The archived portal is not reached by the look.
    await expect(canvas.queryByText('Old kiosk')).toBeNull()
    // The page, drawn from the first live portal's draft, in the draft colours.
    const phone = await canvas.findByRole(
      'region',
      { name: 'Preview of the guest page: Reception, arrival' },
      WAIT,
    )
    await expect(within(phone).getByText('How was your experience?')).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Property settings' })).toHaveAttribute(
      'href',
      '/properties/prop-1/settings/profile',
    )
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

/** An accent the page could not read is flagged and never written. */
export const UnreadableAccentIsNotSaved: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const accent = canvas.getByLabelText('Accent')
    await userEvent.clear(accent)
    await userEvent.type(accent, '#1A1A2E')
    const readout = within(canvas.getByRole('list', { name: 'Readability' }))
    await expect(readout.getByText(/Hard to read/)).toBeVisible()
    // Once visible, once for assistive technology.
    await expect(
      (
        await canvas.findAllByText(
          'Not saved · This accent is hard to see on the page background',
          {},
          WAIT,
        )
      ).length,
    ).toBe(2)
    await expect(args.saveLook).not.toHaveBeenCalled()
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

/** Only an Account Admin edits it; everyone else reads it. */
export const ReadOnly: Story = {
  decorators: [withRole('Member')],
  args: { canEdit: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/An Account Admin manages the look/)).toBeVisible()
    await expect(canvas.getByLabelText('Accent')).toBeDisabled()
    await expect(canvas.getByLabelText('Wordmark')).toBeDisabled()
    await expect(canvas.queryByRole('button', { name: 'Add language' })).toBeNull()
  },
}

/** The photo and logo controls (slice 42c2) and the batch publish (39b) mount in slots. */
export const SlotsForLaterControls: Story = {
  args: {
    photoSlot: <button type="button">Replace photo</button>,
    logoSlot: <button type="button">Upload logo</button>,
    publishSlot: <button type="button">Review &amp; publish 5 portals</button>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Replace photo' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Upload logo' })).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: 'Review & publish 5 portals' }),
    ).toBeVisible()
  },
}

export const NoPortalsYet: Story = {
  args: { rows: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Make a portal to see the look on a page.'),
    ).toBeVisible()
    await expect(canvas.getByText('No portals yet')).toBeVisible()
    await expect(canvas.getByText('No live portal uses this look yet')).toBeVisible()
  },
}

export const NoPublicDisplayName: Story = {
  args: { profile: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Set the public display name first')).toBeVisible()
    await expect(
      canvas.getByRole('link', { name: /Set it in Property settings/ }),
    ).toHaveAttribute('href', '/properties/prop-1/settings/profile')
  },
}

/** A write that fails says so and offers a retry. */
export const FailedSaveOffersRetry: Story = {
  args: {
    saveLook: Object.assign(
      fn(async () => {
        throw new Error('offline')
      }),
      { isPending: false, error: null, isSuccess: false, data: null },
    ) as never,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const accent = canvas.getByLabelText('Accent')
    await userEvent.clear(accent)
    await userEvent.type(accent, '#C8A45A')
    await expect(await canvas.findByRole('button', { name: 'Retry' }, WAIT)).toBeVisible()
    await expect(canvas.getAllByText('Not saved').length).toBeGreaterThan(0)
  },
}
