// fallow-ignore-file code-duplication
// The Property look's photograph and logo (round-4 admin boards 9 and 14): the
// photograph with the circle that says what every page keeps in view, the
// "Replace photo" dialog (file facts, checks, a description for screen readers,
// the permission checkbox, "Use photo"), and the logo. The upload and the saves
// are stubs that record what they were asked, so each play proves what a gesture
// sends and what it does not. The pictures are made in the browser.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import {
  AuthedRouterDecorator,
  withRole,
} from '../../../../../.storybook/AuthedRouterDecorator'
import { previewReader } from '../portal-preview/__fixtures__/portal-preview-fixtures'
import {
  AVELA_MEDIA,
  AVELA_PORTALS,
  AVELA_PROFILE,
  NO_MEDIA,
  UPLOADED_ASSET,
  makeImageFile,
  publishingPortals,
  reviewingPortals,
  savingHero,
  savingLocales,
  savingLogo,
  savingLook,
  uploadingTo,
} from './property-look-page-fixtures'
import { PropertyLookPage } from './property-look-page'

const WAIT = { timeout: 5000 }

const meta = {
  title: 'Portal/PropertyLook/Photo and logo',
  component: PropertyLookPage,
  parameters: { layout: 'fullscreen' },
  decorators: [AuthedRouterDecorator],
  args: {
    propertyId: 'prop-1',
    propertyName: 'Avela Resort',
    profile: { ...AVELA_PROFILE, defaultGuestLocales: ['en'] },
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
    uploadImage: uploadingTo(),
  },
} satisfies Meta<typeof PropertyLookPage>

export default meta
type Story = StoryObj<typeof meta>

const dialog = (name: string) => within(document.body).getByRole('dialog', { name })
const noDialog = () => expect(within(document.body).queryByRole('dialog')).toBeNull()

/** Opens the photograph dialog from the Photo section's own button. */
async function openPhotoDialog(canvasElement: HTMLElement, name = 'Replace photo') {
  await userEvent.click(within(canvasElement).getByRole('button', { name }))
  return within(await within(document.body).findByRole('dialog', { name }))
}

/** Chooses a good photograph, ticks the permission and describes it. */
async function chooseGoodPhoto(photo: ReturnType<typeof within>) {
  await userEvent.upload(
    photo.getByLabelText('Photo file'),
    await makeImageFile(1600, 1000),
  )
  await photo.findByText(/1600 × 1000/, {}, WAIT)
}

/** The photograph, with the circle on what guests should see, and the buttons that change it. */
export const WithAPhoto: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('button', {
        name: 'Focal point: 50% across, 42% down. Drag, or use the arrow keys, to move it.',
      }),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Replace photo' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Remove photo' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Upload logo' })).toBeVisible()
    await expect(canvas.getByRole('radio', { name: 'With photo' })).toBeChecked()
  },
}

/** The arrow keys move the circle; the new point autosaves once, as the draft. */
export const FocalPointMovesWithTheKeysAndAutosaves: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const circle = canvas.getByRole('button', {
      name: /^Focal point: 50% across, 42% down/,
    })
    circle.focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowDown}')
    await expect(
      canvas.getByRole('button', { name: /^Focal point: 56% across, 44% down/ }),
    ).toBeVisible()
    await waitFor(
      () =>
        expect(args.saveHero).toHaveBeenCalledWith({
          data: {
            propertyId: 'prop-1',
            assetId: AVELA_MEDIA.hero?.assetId,
            focalX: 0.56,
            focalY: 0.44,
          },
        }),
      WAIT,
    )
    await expect(args.saveHero).toHaveBeenCalledTimes(1)
    await expect(await canvas.findByText(/Saved as a draft/, {}, WAIT)).toBeVisible()
    // Uploading, describing and permission are the dialog's: none was asked.
    await expect(args.uploadImage).not.toHaveBeenCalled()
  },
}

/** Pressing Shift moves the circle further, and it stops at the edge of the photograph. */
export const FocalPointStopsAtTheEdge: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    canvas.getByRole('button', { name: /^Focal point: 50% across, 42% down/ }).focus()
    await userEvent.keyboard(
      '{Shift>}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{/Shift}',
    )
    await expect(
      canvas.getByRole('button', { name: /^Focal point: 100% across, 42% down/ }),
    ).toBeVisible()
  },
}

/** Board 14: a good photograph, its facts and checks, a description, the permission, "Use photo". */
export const ReplacePhoto: Story = {
  play: async ({ canvasElement, args }) => {
    const photo = await openPhotoDialog(canvasElement)
    await expect(
      photo.getByText('Shown at the top of every portal at Avela Resort.'),
    ).toBeVisible()
    const use = photo.getByRole('button', { name: 'Save' })
    await expect(use).toBeDisabled()
    await chooseGoodPhoto(photo)
    await expect(photo.getByText('terrace-evening.png')).toBeVisible()
    const checks = within(photo.getByRole('list', { name: 'Checks' }))
    await expect(checks.getByText(/Large enough for every phone/)).toBeVisible()
    await expect(checks.getByText('JPG, PNG or WebP, up to 10 MB')).toBeVisible()
    // A chosen file is not enough: the photo must be confirmed as usable.
    const send = photo.getByRole('button', { name: 'Use photo' })
    await expect(send).toBeDisabled()
    const description = photo.getByLabelText('Describe the photo')
    await expect(description).toHaveValue('')
    await userEvent.type(description, 'Evening on the sea terrace')
    await userEvent.click(
      photo.getByRole('checkbox', {
        name: 'Avela Resort owns this photo or has permission to use it.',
      }),
    )
    await expect(send).toBeEnabled()
    await userEvent.click(send)
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
        expect(args.saveHero).toHaveBeenCalledWith({
          data: {
            propertyId: 'prop-1',
            assetId: UPLOADED_ASSET,
            focalX: 0.5,
            focalY: 0.5,
            altTexts: [{ locale: 'en', text: 'Evening on the sea terrace' }],
          },
        }),
      WAIT,
    )
    await waitFor(noDialog, WAIT)
    await expect(args.saveLook).not.toHaveBeenCalled()
  },
}

/** The dialog's phone draws the chosen photograph on the guest page, beside the form. */
export const ReplacePhotoShowsAPhone: Story = {
  parameters: { viewport: { defaultViewport: 'desktop' } },
  play: async ({ canvasElement }) => {
    const photo = await openPhotoDialog(canvasElement)
    await expect(
      await photo.findByRole(
        'region',
        { name: 'Preview of the guest page: Reception, arrival' },
        WAIT,
      ),
    ).toBeInTheDocument()
  },
}

/** Too small for a phone: the check says so and names what is needed, and nothing can be sent. */
export const SmallPhotoFailsTheCheck: Story = {
  play: async ({ canvasElement, args }) => {
    const photo = await openPhotoDialog(canvasElement)
    await userEvent.upload(
      photo.getByLabelText('Photo file'),
      await makeImageFile(600, 400),
    )
    await photo.findByText(/600 × 400/, {}, WAIT)
    const checks = within(photo.getByRole('list', { name: 'Checks' }))
    await expect(checks.getByText(/Too small to stay sharp on a phone/)).toBeVisible()
    await userEvent.click(photo.getByRole('checkbox'))
    await expect(photo.getByRole('button', { name: 'Use photo' })).toBeDisabled()
    await expect(args.uploadImage).not.toHaveBeenCalled()
  },
}

/** A file of the wrong kind is turned away before it is read, and the form is unchanged. */
export const WrongFormatIsTurnedAway: Story = {
  play: async ({ canvasElement, args }) => {
    const photo = await openPhotoDialog(canvasElement)
    const heic = new File([new Uint8Array(64)], 'terrace.heic', { type: 'image/heic' })
    await userEvent.upload(photo.getByLabelText('Photo file'), heic, {
      applyAccept: false,
    })
    await expect(await photo.findByRole('alert')).toHaveTextContent(/JPEG, PNG or WebP/)
    await expect(photo.queryByRole('list', { name: 'Checks' })).toBeNull()
    await expect(args.uploadImage).not.toHaveBeenCalled()
  },
}

/** The server's refusal is shown in the dialog, which stays open, and nothing is put on the look. */
export const RefusedUploadIsShownInPlace: Story = {
  args: {
    uploadImage: fn(async () => ({
      ok: false as const,
      message: 'That photo is too detailed to store. Try a smaller or simpler one.',
    })),
  },
  play: async ({ canvasElement, args }) => {
    const photo = await openPhotoDialog(canvasElement)
    await chooseGoodPhoto(photo)
    await userEvent.click(photo.getByRole('checkbox'))
    await userEvent.click(photo.getByRole('button', { name: 'Use photo' }))
    await expect(await photo.findByRole('alert')).toHaveTextContent(
      /too detailed to store/,
    )
    await expect(args.saveHero).not.toHaveBeenCalled()
    await expect(dialog('Replace photo')).toBeVisible()
  },
}

/** A write that fails the first time it is asked and succeeds after. */
function failingOnce() {
  let asked = 0
  return Object.assign(
    fn(async () => {
      asked += 1
      if (asked === 1) throw new Error('offline')
      return { media: AVELA_MEDIA }
    }),
    { isPending: false, error: null, isSuccess: false, data: null },
  ) as never
}

/** Putting a sent photograph on the look failed: the same file is not sent again on the retry. */
export const RetryDoesNotSendTheFileTwice: Story = {
  args: { saveHero: failingOnce() },
  play: async ({ canvasElement, args }) => {
    const photo = await openPhotoDialog(canvasElement)
    await chooseGoodPhoto(photo)
    await userEvent.click(photo.getByRole('checkbox'))
    await userEvent.click(photo.getByRole('button', { name: 'Use photo' }))
    await expect(await photo.findByRole('alert')).toHaveTextContent(
      /uploaded, but it could not be put on the look/,
    )
    await userEvent.click(photo.getByRole('button', { name: 'Use photo' }))
    await waitFor(noDialog, WAIT)
    await expect(args.uploadImage).toHaveBeenCalledTimes(1)
    await expect(args.saveHero).toHaveBeenCalledTimes(2)
  },
}

/** A refusal in words (the photograph was taken down meanwhile) is shown as the server said it. */
export const RefusedWriteSaysWhy: Story = {
  args: {
    saveHero: Object.assign(
      fn(async () => {
        throw new ServerFunctionError(
          'PortalError',
          'image not found for this Property',
          'media_not_found',
          404,
        )
      }),
      { isPending: false, error: null, isSuccess: false, data: null },
    ) as never,
  },
  play: async ({ canvasElement }) => {
    const photo = await openPhotoDialog(canvasElement)
    await chooseGoodPhoto(photo)
    await userEvent.click(photo.getByRole('checkbox'))
    await userEvent.click(photo.getByRole('button', { name: 'Use photo' }))
    await expect(await photo.findByRole('alert')).toHaveTextContent(
      'image not found for this Property',
    )
  },
}

/** With a photograph in place and no new file, the same dialog edits its descriptions: "Save". */
export const EditingTheDescriptionAlone: Story = {
  args: {
    profile: { ...AVELA_PROFILE, defaultGuestLocales: ['en', 'bg'] },
  },
  play: async ({ canvasElement, args }) => {
    const photo = await openPhotoDialog(canvasElement)
    await expect(photo.getByLabelText('Describe the photo in English')).toHaveValue(
      'The colonnade pool at dusk',
    )
    const bulgarian = photo.getByLabelText('Describe the photo in Bulgarian')
    await expect(bulgarian).toHaveValue('')
    const save = photo.getByRole('button', { name: 'Save' })
    await expect(save).toBeDisabled()
    await userEvent.type(bulgarian, 'Колонадният басейн по залез')
    await userEvent.click(save)
    await waitFor(
      () =>
        expect(args.saveHero).toHaveBeenCalledWith({
          data: {
            propertyId: 'prop-1',
            assetId: AVELA_MEDIA.hero?.assetId,
            focalX: 0.5,
            focalY: 0.42,
            altTexts: [{ locale: 'bg', text: 'Колонадният басейн по залез' }],
          },
        }),
      WAIT,
    )
    await expect(args.uploadImage).not.toHaveBeenCalled()
    await waitFor(noDialog, WAIT)
  },
}

/** A description is held to 160 characters, and the button waits until it fits. */
export const DescriptionIsBounded: Story = {
  play: async ({ canvasElement }) => {
    const photo = await openPhotoDialog(canvasElement)
    const description = photo.getByLabelText('Describe the photo')
    await userEvent.clear(description)
    await userEvent.type(description, 'x'.repeat(161), { delay: null })
    await expect(
      photo.getByText('A description can be at most 160 characters'),
    ).toBeVisible()
    await expect(description).toHaveAttribute('aria-invalid', 'true')
    await expect(photo.getByRole('button', { name: 'Save' })).toBeDisabled()
  },
}

/** A new photograph starts afresh: the old description was about the old photograph. */
export const ANewPhotographStartsWithoutTheOldDescription: Story = {
  play: async ({ canvasElement }) => {
    const photo = await openPhotoDialog(canvasElement)
    await expect(photo.getByLabelText('Describe the photo')).toHaveValue(
      'The colonnade pool at dusk',
    )
    await chooseGoodPhoto(photo)
    await expect(photo.getByLabelText('Describe the photo')).toHaveValue('')
  },
}

/** A Property with no photograph gets "Add a photo", and a first one starts at the middle. */
export const AddingAFirstPhoto: Story = {
  args: { media: NO_MEDIA, photoDescriptions: {}, saveHero: savingHero(NO_MEDIA) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: /^Focal point/ })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Remove photo' })).toBeNull()
    await expect(canvas.getByRole('radio', { name: 'With photo' })).toBeDisabled()
    const photo = await openPhotoDialog(canvasElement, 'Add a photo')
    await expect(photo.queryByLabelText('Describe the photo')).toBeNull()
    await chooseGoodPhoto(photo)
    await userEvent.type(photo.getByLabelText('Describe the photo'), 'Sea terrace')
    await userEvent.click(photo.getByRole('checkbox'))
    await userEvent.click(photo.getByRole('button', { name: 'Use photo' }))
    await waitFor(
      () =>
        expect(args.saveHero).toHaveBeenCalledWith({
          data: expect.objectContaining({
            assetId: UPLOADED_ASSET,
            focalX: 0.5,
            focalY: 0.5,
          }),
        }),
      WAIT,
    )
    // The page now has a photograph: the circle is there, and the preview can show it.
    await expect(
      await canvas.findByRole('button', { name: /^Focal point/ }, WAIT),
    ).toBeVisible()
    await expect(canvas.getByRole('radio', { name: 'With photo' })).toBeEnabled()
  },
}

/** Taking the photograph off writes null and returns the section to "Add a photo". */
export const RemovingThePhoto: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Remove photo' }))
    await waitFor(
      () =>
        expect(args.saveHero).toHaveBeenCalledWith({
          data: { propertyId: 'prop-1', assetId: null },
        }),
      WAIT,
    )
    await expect(
      await canvas.findByRole('button', { name: 'Add a photo' }, WAIT),
    ).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /^Focal point/ })).toBeNull()
  },
}

/** A photograph that could not be taken off says so beside it. */
export const RemovingFailsInPlace: Story = {
  args: {
    saveHero: Object.assign(
      fn(async () => {
        throw new Error('offline')
      }),
      { isPending: false, error: null, isSuccess: false, data: null },
    ) as never,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Remove photo' }))
    await expect(
      await canvas.findByText('The photo could not be taken off. Try again.'),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Replace photo' })).toBeVisible()
  },
}

/** Board 9's "Name and logo": no logo yet, and what one is for. */
export const NoLogoYet: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(
        /A light logo, best as a PNG or WebP with a transparent background/,
      ),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Upload logo' })).toBeVisible()
  },
}

/** A logo goes through the same steps, to its own purpose, and replaces the wordmark in the preview. */
export const UploadingALogo: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Upload logo' }))
    const logo = within(
      await within(document.body).findByRole('dialog', { name: 'Upload logo' }),
    )
    const use = logo.getByRole('button', { name: 'Use logo' })
    await expect(use).toBeDisabled()
    await userEvent.upload(
      logo.getByLabelText('Logo file'),
      await makeImageFile(480, 120, 'avela-light.png'),
    )
    await logo.findByText(/480 × 120/, {}, WAIT)
    await expect(use).toBeDisabled()
    await userEvent.click(
      logo.getByRole('checkbox', {
        name: 'Avela Resort owns this logo or has permission to use it.',
      }),
    )
    await userEvent.click(use)
    await waitFor(
      () =>
        expect(args.uploadImage).toHaveBeenCalledWith(
          { propertyId: 'prop-1', purpose: 'logo', rightsConfirmed: true },
          expect.objectContaining({ name: 'avela-light.png' }),
        ),
      WAIT,
    )
    await waitFor(
      () =>
        expect(args.saveLogo).toHaveBeenCalledWith({
          data: { propertyId: 'prop-1', assetId: UPLOADED_ASSET },
        }),
      WAIT,
    )
    await waitFor(noDialog, WAIT)
    await expect(
      await canvas.findByRole('button', { name: 'Replace logo' }, WAIT),
    ).toBeVisible()
    const identity = within(canvas.getByRole('region', { name: 'Name and logo' }))
    await expect(identity.getByRole('img', { name: 'Avela Resort logo' })).toBeVisible()
    await expect(args.saveHero).not.toHaveBeenCalled()
  },
}

/** A logo that is too small is refused with a sentence about a logo, not a photo. */
export const SmallLogoFailsTheCheck: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Upload logo' }))
    const logo = within(
      await within(document.body).findByRole('dialog', { name: 'Upload logo' }),
    )
    await userEvent.upload(
      logo.getByLabelText('Logo file'),
      await makeImageFile(100, 40, 'tiny.png'),
    )
    await logo.findByText(/100 × 40/, {}, WAIT)
    await expect(
      within(logo.getByRole('list', { name: 'Checks' })).getByText(
        /Too small to stay sharp/,
      ),
    ).toBeVisible()
    await userEvent.click(logo.getByRole('checkbox'))
    await expect(logo.getByRole('button', { name: 'Use logo' })).toBeDisabled()
  },
}

/** Taking the logo off brings the wordmark back. */
export const RemovingTheLogo: Story = {
  args: {
    media: {
      hero: AVELA_MEDIA.hero,
      logo: { assetId: 'l', url: 'x', width: 480, height: 120 },
    },
    saveLogo: savingLogo(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Remove logo' }))
    await waitFor(
      () =>
        expect(args.saveLogo).toHaveBeenCalledWith({
          data: { propertyId: 'prop-1', assetId: null },
        }),
      WAIT,
    )
    await expect(
      await canvas.findByRole('button', { name: 'Upload logo' }, WAIT),
    ).toBeVisible()
  },
}

/** Everyone but an Account Admin sees the photograph and logo, and none of the controls. */
export const ReadOnlySeesNoControls: Story = {
  decorators: [withRole('Member')],
  args: {
    canEdit: false,
    media: {
      hero: AVELA_MEDIA.hero,
      logo: { assetId: 'l', url: 'x', width: 480, height: 120 },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('img', { name: 'The colonnade pool at dusk' }),
    ).toBeVisible()
    const identity = within(canvas.getByRole('region', { name: 'Name and logo' }))
    await expect(identity.getByRole('img', { name: 'Avela Resort logo' })).toBeVisible()
    for (const name of [
      'Replace photo',
      'Remove photo',
      'Add a photo',
      'Replace logo',
      'Remove logo',
      'Upload logo',
    ]) {
      await expect(canvas.queryByRole('button', { name })).toBeNull()
    }
    await expect(canvas.queryByRole('button', { name: /^Focal point/ })).toBeNull()
  },
}

/** While a photograph is on its way the dialog cannot be dismissed, so it cannot land after the person left. */
export const CannotBeClosedWhileSending: Story = {
  args: {
    uploadImage: fn(() => new Promise<never>(() => undefined)),
  },
  play: async ({ canvasElement }) => {
    const photo = await openPhotoDialog(canvasElement)
    await chooseGoodPhoto(photo)
    await userEvent.click(photo.getByRole('checkbox'))
    await userEvent.click(photo.getByRole('button', { name: 'Use photo' }))
    await expect(await photo.findByRole('button', { name: 'Uploading…' })).toBeDisabled()
    await expect(photo.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    await expect(dialog('Replace photo')).toBeVisible()
  },
}
