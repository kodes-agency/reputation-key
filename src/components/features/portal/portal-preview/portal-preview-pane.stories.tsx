// The editor's live preview (board A8) in the third column it lives in: the
// toolbar, the phone, the line over it and the filmstrip of guest states. The
// reader is a stand-in for the server function and records what it was asked,
// so the stories can prove that "Try as guest" asks for nothing more.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import type { PortalPreviewSource } from '#/contexts/portal/application/public-api'
import {
  PREVIEW_DRAFT_NO_PHOTO,
  PREVIEW_DRAFT_ONE_LANGUAGE,
  previewReader,
} from './__fixtures__/portal-preview-fixtures'
import { PortalPreviewPane } from './portal-preview-pane'

const COLUMN_WIDTH = 480

const meta = {
  title: 'Portal/PortalPreviewPane',
  component: PortalPreviewPane,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div style={{ width: COLUMN_WIDTH, padding: 24 }}>
        <Story />
      </div>
    ),
  ],
  args: { portalId: 'p-1', getPortalPreview: previewReader() },
} satisfies Meta<typeof PortalPreviewPane>

export default meta
type Story = StoryObj<typeof meta>

const WAIT = { timeout: 5000 }

/** The phone, found by the line over it: the caption, or the start of one (`Draft`). */
const phone = (canvas: ReturnType<typeof within>, caption: string) =>
  canvas.findByRole(
    'region',
    { name: (name: string) => name.startsWith(`Preview of the guest page: ${caption}`) },
    WAIT,
  )

/** Draft, arrival, English: the board's first state. */
export const DraftArrival: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const page = within(await phone(canvas, 'Draft · Arrival · English'))
    await expect(page.getByText('How was your experience?')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Pool & Terrace' })).toBeVisible()
    await expect(page.getByText('Around the resort')).toBeVisible()
    await expect(canvas.getByText('Draft · Arrival · English')).toBeVisible()
    // The draft is the new design; publishing writes the earlier page until it can.
    await expect(canvas.getByText(/reaches guests in an upcoming release/)).toBeVisible()
    // The four states of the board sit under the phone.
    for (const name of [
      'Arrival',
      'After a 2 star rating',
      'After a 5 star rating',
      'After the private note is sent',
    ]) {
      await expect(canvas.getByRole('button', { name })).toBeVisible()
    }
  },
}

/** A tile whose address is not approved is a placeholder: no words of a destination. */
export const WaitingForApprovalTile: Story = {
  play: async ({ canvasElement }) => {
    const page = within(await phone(within(canvasElement), 'Draft'))
    const waiting = page.getByRole('button', { name: /Olive Terrace menu/ })
    await expect(waiting).toHaveAttribute('data-preview-tile', 'awaiting_approval')
    await expect(within(waiting).getByText('Waiting for approval')).toBeVisible()
    await expect(page.getByRole('button', { name: /Getting here/ })).toHaveAttribute(
      'data-preview-tile',
      'ready',
    )
  },
}

/** Switching the language shows the page in it, with the copy pack's own words. */
export const SwitchToBulgarian: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await phone(canvas, 'Draft · Arrival · English')
    await userEvent.click(canvas.getByRole('radio', { name: /БГ/ }))
    const page = within(await phone(canvas, 'Draft · Arrival · Bulgarian'))
    await expect(page.getByRole('heading', { name: 'Басейн и тераса' })).toBeVisible()
    await expect(page.getByText('Около курорта')).toBeVisible()
    // A tile with no Bulgarian text yet reads the primary language, tagged as such.
    const spa = page.getByText('Spa & treatments')
    await expect(spa).toHaveAttribute('lang', 'en')
  },
}

/** A low rating is offered the private note; the Google card comes first either way. */
export const AfterALowRating: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole('button', { name: 'After a 2 star rating' }, WAIT),
    )
    const page = within(await phone(canvas, 'Draft · After 2★ · English'))
    await expect(page.getByText('Fair · sent privately')).toBeVisible()
    await expect(page.getByText('Share your experience on Google')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Write a private note' })).toBeVisible()
  },
}

/** A high rating is not asked for a note. */
export const AfterAHighRating: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole('button', { name: 'After a 5 star rating' }, WAIT),
    )
    const page = within(await phone(canvas, 'Draft · After 5★ · English'))
    await expect(page.getByText('Share your experience on Google')).toBeVisible()
    await expect(page.queryByRole('button', { name: 'Write a private note' })).toBeNull()
  },
}

/** The last state of the board: the note was sent. */
export const NoteSent: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole('button', { name: 'After the private note is sent' }, WAIT),
    )
    const page = within(await phone(canvas, 'Draft · Done · English'))
    await expect(
      page.getByText(/Your note was sent privately to Avela Resort/),
    ).toBeVisible()
  },
}

const asked: PortalPreviewSource[] = []

/** Choosing a state while trying leaves "Try as guest" and shows that state. */
export const FilmstripLeavesTrying: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await phone(canvas, 'Draft')
    await userEvent.click(canvas.getByRole('button', { name: 'Try as guest' }))
    await canvas.findByRole('region', { name: 'Guest page you can try' }, WAIT)
    await userEvent.click(canvas.getByRole('button', { name: 'After a 5 star rating' }))
    await phone(canvas, 'Draft · After 5★ · English')
    await expect(canvas.getByRole('button', { name: 'Try as guest' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  },
}

/** "Try as guest" clicks through the page locally and asks the server for nothing. */
export const TryAsGuest: Story = {
  args: { getPortalPreview: previewReader({}, asked) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await phone(canvas, 'Draft')
    const before = asked.length
    await userEvent.click(canvas.getByRole('button', { name: 'Try as guest' }))
    await expect(
      canvas.getByText(/Nothing is saved or counted, and links don’t open/),
    ).toBeVisible()
    const page = within(
      await canvas.findByRole('region', { name: 'Guest page you can try' }, WAIT),
    )
    // Nothing is chosen yet: sending asks for a star, as the guest page does.
    await userEvent.click(page.getByRole('button', { name: 'Send privately' }))
    await expect(page.getByText('Choose a rating from 1 to 5 stars.')).toBeVisible()
    await userEvent.click(page.getByRole('radio', { name: '2 stars, Fair' }))
    await expect(page.getByRole('radio', { name: '2 stars, Fair' })).toBeChecked()
    await userEvent.click(page.getByRole('button', { name: 'Send privately' }))
    await expect(page.getByText('Fair · sent privately')).toBeVisible()
    // Focus follows the rating into the receipt, as on the guest page.
    await expect(page.getByRole('heading', { name: 'Thank you.' })).toHaveFocus()
    await userEvent.click(page.getByRole('button', { name: 'Write a private note' }))
    await userEvent.type(page.getByRole('textbox'), 'The terrace was lovely')
    await userEvent.click(page.getByRole('button', { name: 'Send note privately' }))
    await expect(
      page.getByText(/Your note was sent privately to Avela Resort/),
    ).toBeVisible()
    // The whole visit was local.
    await expect(asked).toHaveLength(before)
    await userEvent.click(canvas.getByRole('button', { name: 'Stop trying' }))
    await expect(
      await canvas.findByRole('region', { name: /Preview of the guest page/ }, WAIT),
    ).toBeVisible()
  },
}

/** Live shows what guests can open now: no placeholder, the other version's words. */
export const LiveVersion: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await phone(canvas, 'Draft')
    await userEvent.click(canvas.getByRole('radio', { name: 'Live' }))
    const page = within(await phone(canvas, 'Live · Arrival · English'))
    await expect(page.queryByText('Waiting for approval')).toBeNull()
    await expect(page.getByRole('button', { name: /Spa & treatments/ })).toBeVisible()
  },
}

/** A live version from the earlier design has no matching preview, and says what to do. */
export const LiveEarlierDesign: Story = {
  args: {
    getPortalPreview: previewReader({
      live: { status: 'unavailable', source: 'live', reason: 'earlier_design' },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await phone(canvas, 'Draft')
    await userEvent.click(canvas.getByRole('radio', { name: 'Live' }))
    await expect(
      await canvas.findByText('The live page uses the earlier design', undefined, WAIT),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try as guest' })).toBeDisabled()
  },
}

export const LiveNotPublished: Story = {
  args: {
    getPortalPreview: previewReader({
      live: { status: 'unavailable', source: 'live', reason: 'not_published' },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await phone(canvas, 'Draft')
    await userEvent.click(canvas.getByRole('radio', { name: 'Live' }))
    await expect(
      await canvas.findByText('Nothing is live yet', undefined, WAIT),
    ).toBeVisible()
  },
}

/** One language: no language switch, and the page shows no chip. */
export const OneLanguage: Story = {
  args: {
    getPortalPreview: previewReader({ draft: PREVIEW_DRAFT_ONE_LANGUAGE }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const page = within(await phone(canvas, 'Draft · Arrival · English'))
    await expect(
      canvas.queryByRole('radiogroup', { name: 'Preview language' }),
    ).toBeNull()
    await expect(page.queryByRole('img', { name: /Language/ })).toBeNull()
  },
}

/** No photo: the colour field and the arch, as board G09. */
export const NoPhoto: Story = {
  args: { getPortalPreview: previewReader({ draft: PREVIEW_DRAFT_NO_PHOTO }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await phone(canvas, 'Draft')
    await waitFor(() => {
      const surfaces = canvasElement.querySelectorAll('[data-ih-surface]')
      expect(surfaces.length).toBeGreaterThan(0)
      for (const surface of surfaces) {
        expect(surface.getAttribute('data-ih-surface')).toBe('field')
      }
    }, WAIT)
  },
}

/** A failed read is said plainly and can be retried. */
export const LoadFailure: Story = {
  args: { getPortalPreview: previewReader({ fail: true }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText('The preview couldn’t be loaded', undefined, WAIT),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
}
