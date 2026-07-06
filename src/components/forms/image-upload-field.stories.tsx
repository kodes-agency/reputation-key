// Storybook stories for the shared ImageUploadField form primitive.
// Covers both shape variants (rect / circle), empty vs preview (imageUrl set),
// disabled, and the drag-drop / file-input affordance. Upload progress is
// internal state (not a prop) so it is exercised via an in-flight upload story.

import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, within } from 'storybook/test'
import { ImageUploadField } from './image-upload-field'

const meta: Meta<typeof ImageUploadField> = {
  title: 'Forms/ImageUploadField',
  component: ImageUploadField,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof ImageUploadField>

// 1x1 transparent PNG — always renders, no network dependency.
const PLACEHOLDER_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// onUpload that reports progress then resolves with a URL (happy path).
const progressiveUpload = fn(
  async (_file: File, onProgress: (percent: number) => void) => {
    onProgress(50)
    onProgress(100)
    return PLACEHOLDER_IMAGE
  },
)

// onUpload that never resolves → the field stays in its uploading/progress
// state for the lifetime of the story (used by the Uploading state).
const neverResolvingUpload = fn(
  async (_file: File, _onProgress: (percent: number) => void) =>
    new Promise<string>(() => {}),
)

const onImageUrlChange = fn((_url: string | null) => {})

export const RectEmpty: Story = {
  args: {
    imageUrl: null,
    onImageUrlChange,
    onUpload: progressiveUpload,
    variant: 'rect',
    emptyLabel: 'PNG, JPG or WEBP up to 10MB',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // EmptyState renders the "Click to upload" affordance and the custom label.
    await expect(canvas.getByText(/click to upload/i)).toBeInTheDocument()
    await expect(canvas.getByText(/PNG, JPG or WEBP/i)).toBeInTheDocument()
    // hidden file input is present
    await expect(canvasElement.querySelector('input[type="file"]')).toBeInTheDocument()
  },
}

export const CircleEmpty: Story = {
  args: {
    imageUrl: null,
    onImageUrlChange,
    onUpload: progressiveUpload,
    variant: 'circle',
    emptyLabel: 'Upload avatar',
  },
}

export const RectWithPreview: Story = {
  args: {
    imageUrl: PLACEHOLDER_IMAGE,
    onImageUrlChange,
    onUpload: progressiveUpload,
    variant: 'rect',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // preview <img> rendered; remove affordance present.
    await expect(canvas.getByRole('img')).toBeInTheDocument()
  },
}

export const CircleWithPreview: Story = {
  args: {
    imageUrl: PLACEHOLDER_IMAGE,
    onImageUrlChange,
    onUpload: progressiveUpload,
    variant: 'circle',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // circle branch renders an accessible "Remove image" button.
    await expect(
      canvas.getByRole('button', { name: /remove image/i }),
    ).toBeInTheDocument()
  },
}

export const Disabled: Story = {
  args: {
    imageUrl: null,
    onImageUrlChange,
    onUpload: progressiveUpload,
    variant: 'rect',
    disabled: true,
  },
  play: async ({ canvasElement }) => {
    // disabled field renders a non-interactive file input
    const input = canvasElement.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement | null
    await expect(input).not.toBeNull()
    await expect(input).toBeDisabled()
  },
}

// Upload-in-flight: the hook sets uploading=true + progress and waits on the
// never-resolving onUpload, so the progress UI is visible for the story.
export const Uploading: Story = {
  args: {
    imageUrl: null,
    onImageUrlChange,
    onUpload: neverResolvingUpload,
    variant: 'rect',
  },
  // Trigger a file selection programmatically so the field enters the
  // uploading/progress state without a real drag-drop gesture.
  play: async ({ canvasElement }) => {
    const input = canvasElement.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement | null
    if (!input) throw new Error('file input not found')
    const file = new File(['x'], 'avatar.png', { type: 'image/png' })
    // Refs to the native FileList are not constructable; use DataTransfer.
    const transfer = new DataTransfer()
    transfer.items.add(file)
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  },
}
