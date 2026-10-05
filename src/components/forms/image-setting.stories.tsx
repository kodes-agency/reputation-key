// ImageSetting: the one way to set an avatar or a logo. Dark is the default theme; the
// light variants render the same states on the light surface (axe runs on both). The
// Storybook Vitest project compiles no Tailwind, so the plays pin behaviour and wiring
// (Replace and Remove are words, a pending save says so on its Button, a refusal is a
// toast and leaves the picture where it was), not placement.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { ToasterDecorator } from '../../../.storybook/ToasterDecorator'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { ImageSetting } from './image-setting'

// A 1x1 PNG: renders with no network.
const PICTURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const NEW_PICTURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const png = () => new File(['x'], 'logo.png', { type: 'image/png' })

const meta: Meta<typeof ImageSetting> = {
  title: 'Patterns/Image setting',
  component: ImageSetting,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  decorators: [ToasterDecorator],
  args: {
    subject: 'logo',
    imageUrl: null,
    onUpload: async (_file, onProgress) => {
      onProgress(100)
      return NEW_PICTURE
    },
    onRemove: async () => undefined,
  },
}

export default meta
type Story = StoryObj<typeof ImageSetting>

/** Nothing set yet: Upload, in words, and the limit the file is checked against. */
export const Empty: Story = {
  play: ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Upload logo' })).toBeEnabled()
    expect(canvas.queryByRole('button', { name: 'Remove logo' })).not.toBeInTheDocument()
    expect(canvas.getByText('JPG, PNG, WebP or GIF, up to 5 MB.')).toBeInTheDocument()
  },
}

export const EmptyLight: Story = { ...Empty, parameters: { theme: 'light' } }

/** An image is set: Replace and Remove are always there, as words. */
export const WithImage: Story = {
  args: { imageUrl: PICTURE },
  play: ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('img', { name: 'Current logo' })).toBeInTheDocument()
    expect(canvas.getByRole('button', { name: 'Replace logo' })).toBeEnabled()
    expect(canvas.getByRole('button', { name: 'Remove logo' })).toBeEnabled()
  },
}

export const WithImageLight: Story = { ...WithImage, parameters: { theme: 'light' } }

/** The same setting names its buttons for what it is. */
export const Avatar: Story = {
  args: { subject: 'avatar', imageUrl: PICTURE },
  play: ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Replace avatar' })).toBeInTheDocument()
    expect(canvas.getByRole('button', { name: 'Remove avatar' })).toBeInTheDocument()
  },
}

/** A file is chosen: Replace is pending in words, Remove waits, then the new picture shows. */
export const Uploading: Story = {
  args: {
    imageUrl: PICTURE,
    onUpload: (_file, onProgress) =>
      new Promise<string>((resolve) => {
        onProgress(40)
        setTimeout(() => resolve(NEW_PICTURE), 400)
      }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvasElement.querySelector<HTMLInputElement>('input[type="file"]')!
    await userEvent.upload(input, png())
    const busy = await canvas.findByRole('button', { name: 'Uploading…' })
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(busy).toBeDisabled()
    expect(canvas.getByRole('button', { name: 'Remove logo' })).toBeDisabled()
    await waitFor(() =>
      expect(canvas.getByRole('img', { name: 'Current logo' })).toHaveAttribute(
        'src',
        NEW_PICTURE,
      ),
    )
    expect(canvas.getByRole('button', { name: 'Replace logo' })).toBeEnabled()
  },
}

/** The first image: the button becomes Replace once it has landed. */
export const FirstUpload: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvasElement.querySelector<HTMLInputElement>('input[type="file"]')!
    await userEvent.upload(input, png())
    expect(await canvas.findByRole('button', { name: 'Replace logo' })).toBeVisible()
    expect(canvas.getByRole('button', { name: 'Remove logo' })).toBeVisible()
  },
}

/** A refused upload is a toast, in the words every action uses; the picture stays. */
export const UploadRefused: Story = {
  args: {
    imageUrl: PICTURE,
    onUpload: async () => {
      throw new Error('S3 PutObject AccessDenied')
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvasElement.querySelector<HTMLInputElement>('input[type="file"]')!
    await userEvent.upload(input, png())
    expect(
      await within(document.body).findByText("Couldn't upload that logo. Try again."),
    ).toBeInTheDocument()
    expect(canvas.getByRole('img', { name: 'Current logo' })).toHaveAttribute(
      'src',
      PICTURE,
    )
    expect(canvas.getByRole('button', { name: 'Replace logo' })).toBeEnabled()
  },
}

/** A refusal the server wrote for the person keeps its sentence. */
export const UploadRefusedByTheServer: Story = {
  args: {
    onUpload: async () => {
      throw new ServerFunctionError(
        'IdentityError',
        'Images must be smaller than 5 MB.',
        'invalid_input',
        422,
      )
    },
  },
  play: async ({ canvasElement }) => {
    const input = canvasElement.querySelector<HTMLInputElement>('input[type="file"]')!
    await userEvent.upload(input, png())
    expect(
      await within(document.body).findByText('Images must be smaller than 5 MB.'),
    ).toBeInTheDocument()
  },
}

/** A file of the wrong type never leaves the browser. */
export const WrongType: Story = {
  args: { onUpload: fn(async () => NEW_PICTURE) },
  play: async ({ canvasElement, args }) => {
    const input = canvasElement.querySelector<HTMLInputElement>('input[type="file"]')!
    // `applyAccept` off: the input would otherwise filter the file before the check.
    await userEvent.upload(
      input,
      new File(['x'], 'doc.pdf', { type: 'application/pdf' }),
      {
        applyAccept: false,
      },
    )
    expect(
      await within(document.body).findByText('Choose a JPG, PNG, WebP or GIF image.'),
    ).toBeInTheDocument()
    expect(args.onUpload).not.toHaveBeenCalled()
  },
}

/** Remove saves first: pending in words, then the picture goes. */
export const Removing: Story = {
  args: {
    imageUrl: PICTURE,
    onRemove: () => new Promise<void>((resolve) => setTimeout(resolve, 300)),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Remove logo' }))
    const busy = await canvas.findByRole('button', { name: 'Removing…' })
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(canvas.getByRole('button', { name: 'Replace logo' })).toBeDisabled()
    // The picture is still there until the removal is saved.
    expect(canvas.getByRole('img', { name: 'Current logo' })).toBeInTheDocument()
    await waitFor(() => expect(canvas.queryByRole('img')).not.toBeInTheDocument())
    expect(canvas.getByRole('button', { name: 'Upload logo' })).toBeEnabled()
  },
}

/** A refused removal is a toast and the picture is put back exactly where it was. */
export const RemoveRefused: Story = {
  args: {
    imageUrl: PICTURE,
    onRemove: async () => {
      throw new Error('connection reset')
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Remove logo' }))
    expect(
      await within(document.body).findByText("Couldn't remove that logo. Try again."),
    ).toBeInTheDocument()
    expect(canvas.getByRole('img', { name: 'Current logo' })).toHaveAttribute(
      'src',
      PICTURE,
    )
    expect(canvas.getByRole('button', { name: 'Remove logo' })).toBeEnabled()
  },
}

/** Nothing can be changed while the page is saving something else. */
export const Disabled: Story = {
  args: { imageUrl: PICTURE, disabled: true },
  play: ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Replace logo' })).toBeDisabled()
    expect(canvas.getByRole('button', { name: 'Remove logo' })).toBeDisabled()
  },
}
