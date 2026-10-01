// A tile's photo (round-4 admin board 02, "Icon or photo"): the dashed tile in
// the picker opens a dialog that uploads a photo for the tile. The upload and the
// section's writes are stubs, so each story can assert what a manager's gesture
// asks for. The photo's address is the app's own media route, which Storybook
// does not serve, so a photo shows as an empty frame here.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, mocked, userEvent, waitFor, within } from 'storybook/test'
import type {
  PortalLinktreeLink,
  PortalLinktreeView,
} from '#/contexts/portal/application/public-api'
import { PortalDraftAutosaveProvider } from '../portal-editor/portal-draft-autosave-context'
import type { PortalImageUploader } from '../portal-media/upload-portal-image'
import { LinkTree } from './link-tree'
import type { LinktreeMutations } from './use-linktree-mutations'

const ASSET = '30000000-0000-4000-8000-000000000001'

const tile = (overrides: Partial<PortalLinktreeLink> = {}): PortalLinktreeLink => ({
  id: 'discover',
  categoryId: 'cat-1',
  url: 'https://avela.bg/discover',
  iconKey: 'waves',
  imageAssetId: null,
  sortKey: 'a0',
  texts: [
    {
      locale: 'en',
      label: 'Discover the resort',
      line: 'Rooms, pools, the sea',
      provenance: null,
    },
  ],
  destination: { state: 'approved', sourceType: 'custom', approvedByUserId: 'u-2' },
  ...overrides,
})

const view = (link: PortalLinktreeLink): PortalLinktreeView => ({
  portalId: 'p-1',
  enabled: true,
  maxLinks: 4,
  primaryLocale: 'en',
  locales: ['en'],
  titles: { en: 'Around the resort' },
  links: [link],
})

const stubMutations = () =>
  ({
    saveTexts: fn(async () => undefined),
    saveSettings: fn(async () => undefined),
    createLink: fn(async () => ({ link: { id: 'l-new' } })),
    updateLink: fn(async () => undefined),
    deleteLink: fn(async () => undefined),
    reorderLinks: fn(async () => undefined),
    updateFailure: null,
    clearUpdateFailure: fn(),
  }) as unknown as LinktreeMutations

type StoryProps = Readonly<{
  view: PortalLinktreeView
  mutations: LinktreeMutations
  uploadPhoto: PortalImageUploader
  canEdit: boolean
}>

function Harness({ view: current, mutations, uploadPhoto, canEdit }: StoryProps) {
  return (
    <div className="max-w-2xl p-6">
      <LinkTree
        propertyId="prop-1"
        view={current}
        mutations={mutations}
        memberNames={new Map()}
        canEdit={canEdit}
        canDelete
        uploadPhoto={uploadPhoto}
      />
    </div>
  )
}

type LinkWrite = Readonly<{
  linkId: string
  iconKey?: string
  imageAssetId?: string | null
}>

/** A Linktree whose saves land in its own view, as the server's would. */
function SavingHarness({ view: first, mutations, uploadPhoto, canEdit }: StoryProps) {
  const [current, setCurrent] = useState(first)
  const updateLink = async (input: { data: LinkWrite }) => {
    const { data } = input
    await mutations.updateLink(input as never)
    setCurrent((before) => ({
      ...before,
      links: before.links.map((link) =>
        link.id === data.linkId
          ? {
              ...link,
              ...(data.iconKey === undefined ? {} : { iconKey: data.iconKey }),
              ...(data.imageAssetId === undefined
                ? {}
                : { imageAssetId: data.imageAssetId }),
            }
          : link,
      ),
    }))
  }
  return (
    <Harness
      view={current}
      mutations={{ ...mutations, updateLink } as unknown as LinktreeMutations}
      uploadPhoto={uploadPhoto}
      canEdit={canEdit}
    />
  )
}

const uploadOk = (): PortalImageUploader =>
  fn(async () => ({ ok: true as const, assetId: ASSET }))

const meta: Meta<typeof Harness> = {
  title: 'Portal/Linktree/Tile photo',
  component: Harness,
  parameters: { theme: 'light' },
  decorators: [
    (Story) => (
      <PortalDraftAutosaveProvider>
        <Story />
      </PortalDraftAutosaveProvider>
    ),
  ],
  args: {
    view: view(tile()),
    mutations: stubMutations(),
    uploadPhoto: uploadOk(),
    canEdit: true,
  },
}
export default meta
type Story = StoryObj<typeof Harness>

const JPEG = () => new File([new Uint8Array(2048)], 'terrace.jpg', { type: 'image/jpeg' })

/** The open tile's dialog lives in a portal, outside the canvas. */
const dialog = () =>
  within(document.body).getByRole('dialog', { name: 'Photo for this tile' })

/** Opens the one tile the stories use, returning the canvas queries. */
async function openTile(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  await userEvent.click(canvas.getByRole('button', { name: /^Discover the resort/ }))
  return canvas
}

async function openPhotoDialog(canvasElement: HTMLElement) {
  const canvas = await openTile(canvasElement)
  await userEvent.click(
    canvas.getByRole('button', { name: 'Upload a photo instead of an icon' }),
  )
  return within(await within(document.body).findByRole('dialog'))
}

/** Picks a good photo, confirms the rights and presses Use photo. */
async function submitJpeg(photo: ReturnType<typeof within>) {
  await userEvent.upload(photo.getByLabelText('Photo file'), JPEG())
  await userEvent.click(photo.getByRole('checkbox'))
  await userEvent.click(photo.getByRole('button', { name: 'Use photo' }))
}

export const UploadsAPhotoForATile: Story = {
  play: async ({ canvasElement, args }) => {
    const photo = await openPhotoDialog(canvasElement)
    const use = photo.getByRole('button', { name: 'Use photo' })
    await expect(use).toBeDisabled()

    await userEvent.upload(photo.getByLabelText('Photo file'), JPEG())
    await expect(photo.getByText('terrace.jpg · 2 KB')).toBeVisible()
    // A chosen file is not enough: the photo must be confirmed as usable.
    await expect(use).toBeDisabled()
    await userEvent.click(photo.getByRole('checkbox'))
    await expect(use).toBeEnabled()
    await userEvent.click(use)

    await waitFor(() =>
      expect(args.uploadPhoto).toHaveBeenCalledWith(
        {
          propertyId: 'prop-1',
          portalId: 'p-1',
          purpose: 'link_image',
          rightsConfirmed: true,
        },
        expect.objectContaining({ name: 'terrace.jpg', type: 'image/jpeg' }),
      ),
    )
    await waitFor(() =>
      expect(args.mutations.updateLink).toHaveBeenCalledWith({
        data: { linkId: 'discover', imageAssetId: ASSET },
      }),
    )
    await waitFor(() =>
      expect(within(document.body).queryByRole('dialog')).not.toBeInTheDocument(),
    )
  },
}

export const KeepsTheDialogOpenWhenTheServerRefuses: Story = {
  args: {
    uploadPhoto: fn(async () => ({
      ok: false as const,
      message: 'That photo is too small to stay sharp on a phone. Choose a larger one.',
    })),
  },
  play: async ({ canvasElement, args }) => {
    const photo = await openPhotoDialog(canvasElement)
    await submitJpeg(photo)

    await expect(await photo.findByRole('alert')).toHaveTextContent(/too small/)
    await expect(dialog()).toBeVisible()
    await expect(args.mutations.updateLink).not.toHaveBeenCalled()
    // Another photo can be tried at once.
    await expect(photo.getByRole('button', { name: 'Use photo' })).toBeEnabled()
  },
}

export const NeverSendsAFileTheServerWouldRefuse: Story = {
  play: async ({ canvasElement, args }) => {
    const photo = await openPhotoDialog(canvasElement)
    const gif = new File([new Uint8Array(16)], 'party.gif', { type: 'image/gif' })

    await userEvent.upload(photo.getByLabelText('Photo file'), gif, {
      applyAccept: false,
    })

    await expect(photo.getByRole('alert')).toHaveTextContent(
      'Use a JPEG, PNG or WebP photo.',
    )
    await expect(photo.getByRole('button', { name: 'Use photo' })).toBeDisabled()
    await expect(args.uploadPhoto).not.toHaveBeenCalled()
  },
}

export const SaysSoWhenThePhotoUploadsButTheTileCannotTakeIt: Story = {
  args: {
    mutations: {
      ...stubMutations(),
      updateLink: fn(async () => {
        throw new Error('revision_conflict')
      }),
    } as unknown as LinktreeMutations,
  },
  play: async ({ canvasElement }) => {
    const photo = await openPhotoDialog(canvasElement)
    await submitJpeg(photo)

    await expect(await photo.findByRole('alert')).toHaveTextContent(
      'could not be put on the tile',
    )
    await expect(dialog()).toBeVisible()
  },
}

export const ATileWithAPhoto: Story = {
  args: { view: view(tile({ imageAssetId: ASSET })) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const media = `/api/public/portal-media/${ASSET}`
    // The tile's row wears the photo instead of its icon.
    const row = canvas.getByRole('button', { name: /^Discover the resort/ })
    await expect(
      row.closest('li')?.querySelector(`img[src="${media}"]`),
    ).toBeInTheDocument()

    await userEvent.click(row)
    await expect(canvas.getByRole('radio', { name: 'Your photo' })).toBeChecked()
    await expect(canvas.getByRole('radio', { name: 'Waves' })).not.toBeChecked()
    await expect(canvas.getByRole('button', { name: 'Replace photo' })).toBeVisible()
  },
}

export const ChoosingAnIconTakesThePhotoOff: Story = {
  args: { view: view(tile({ imageAssetId: ASSET })) },
  play: async ({ canvasElement, args }) => {
    const canvas = await openTile(canvasElement)
    await userEvent.click(canvas.getByRole('radio', { name: 'Car' }))

    await waitFor(() =>
      expect(mocked(args.mutations.updateLink)).toHaveBeenCalledWith({
        data: { linkId: 'discover', iconKey: 'car', imageAssetId: null },
      }),
    )
  },
}

export const ReadOnlyCannotUpload: Story = {
  args: { canEdit: false },
  play: async ({ canvasElement }) => {
    const canvas = await openTile(canvasElement)
    await expect(
      canvas.getByRole('button', { name: 'Upload a photo instead of an icon' }),
    ).toBeDisabled()
  },
}

export const AKeySlipDoesNotLoseThePhoto: Story = {
  render: (args) => <SavingHarness {...args} />,
  args: { view: view(tile({ imageAssetId: ASSET })) },
  play: async ({ canvasElement, args }) => {
    const canvas = await openTile(canvasElement)
    const photo = canvas.getByRole('radio', { name: 'Your photo' })
    await expect(photo).toBeChecked()

    // Tab lands on the checked choice; one arrow key moves to the next, which a
    // radio group checks at once.
    photo.focus()
    await expect(photo).toHaveFocus()
    // The group moves focus a moment after the key goes down, and checks the new
    // choice only if the key is still down then; a person's key press lasts that
    // long, user-event's instant one does not.
    await userEvent.keyboard('{ArrowRight>}')
    await waitFor(() => expect(photo).not.toHaveFocus())
    await userEvent.keyboard('{/ArrowRight}')
    await waitFor(() =>
      expect(mocked(args.mutations.updateLink)).toHaveBeenCalledWith({
        data: {
          linkId: 'discover',
          iconKey: expect.any(String),
          imageAssetId: null,
        },
      }),
    )

    // The photo is still on offer, and choosing it puts it back as it was.
    const again = await canvas.findByRole('radio', { name: 'Your photo' })
    await expect(again).not.toBeChecked()
    await userEvent.click(again)
    await waitFor(() =>
      expect(mocked(args.mutations.updateLink)).toHaveBeenLastCalledWith({
        data: { linkId: 'discover', imageAssetId: ASSET },
      }),
    )
    await waitFor(() =>
      expect(canvas.getByRole('radio', { name: 'Your photo' })).toBeChecked(),
    )
  },
}

export const ChoosingThePhotoAgainSavesItsAssetNotAnUpload: Story = {
  render: (args) => <SavingHarness {...args} />,
  args: { view: view(tile({ imageAssetId: ASSET })), uploadPhoto: uploadOk() },
  play: async ({ canvasElement, args }) => {
    const canvas = await openTile(canvasElement)
    await userEvent.click(canvas.getByRole('radio', { name: 'Car' }))
    await userEvent.click(await canvas.findByRole('radio', { name: 'Your photo' }))

    await waitFor(() =>
      expect(canvas.getByRole('radio', { name: 'Your photo' })).toBeChecked(),
    )
    await expect(mocked(args.mutations.updateLink)).toHaveBeenLastCalledWith({
      data: { linkId: 'discover', imageAssetId: ASSET },
    })
    await expect(args.uploadPhoto).not.toHaveBeenCalled()
  },
}

export const StaysOpenWhileThePhotoIsOnItsWay: Story = {
  args: {
    uploadPhoto: fn(
      () =>
        new Promise<never>(() => {
          // Never answers: the upload is still in flight for the whole story.
        }),
    ),
  },
  play: async ({ canvasElement, args }) => {
    const photo = await openPhotoDialog(canvasElement)
    await submitJpeg(photo)
    await waitFor(() => expect(args.uploadPhoto).toHaveBeenCalled())

    await userEvent.keyboard('{Escape}')

    await expect(dialog()).toBeVisible()
    await expect(photo.getByRole('button', { name: 'Uploading…' })).toBeDisabled()
    await expect(args.mutations.updateLink).not.toHaveBeenCalled()
  },
}
