// The previewed guest page on its own, in a phone's box: the page the editor,
// Review & publish and the Property look phones all draw. It is the real page
// (the header, the Linktree and the footer of the live route) in its inert
// mode, so the stories check the pieces the old stand-ins left out: a photo
// tile, the waiting tile as a variant of the real tile, and the footer's full
// disclosure. Axe runs on every story (`a11y.test = 'error'`).
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { loadGuestPortalCopyV2 } from '#/components/features/guest'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import { PREVIEW_DRAFT } from './__fixtures__/portal-preview-fixtures'
import { ARRIVAL_STATE } from './portal-preview-states'
import { PreviewGuestPage } from './preview-guest-page'

const PHONE = { width: 390, height: 844 } as const

const english = PREVIEW_DRAFT.experiences.en
if (english === undefined) throw new Error('the draft fixture has no English page')
const pack = await loadGuestPortalCopyV2('en')

const PhoneFrame: Decorator = (Story) => (
  <div style={{ ...PHONE, margin: '0 auto', overflowY: 'auto' }}>
    <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} />
    <Story />
  </div>
)

const meta = {
  title: 'Portal/PreviewGuestPage',
  component: PreviewGuestPage,
  decorators: [PhoneFrame],
  parameters: { layout: 'fullscreen' },
  args: {
    experience: english,
    copy: pack,
    locale: 'en',
    hasLanguageChip: true,
    state: ARRIVAL_STATE,
  },
} satisfies Meta<typeof PreviewGuestPage>
export default meta

type Story = StoryObj<typeof meta>

/** Board 02: a photo tile ("Discover the resort") beside glass tiles, all drawn by the live Linktree. */
export const WithPhotoTile: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    const photo = canvasElement.querySelector<HTMLElement>('.ih-tile--photo')
    await expect(photo).not.toBeNull()
    await expect(
      within(photo as HTMLElement).getByText('Discover the resort'),
    ).toBeVisible()
    await expect(photo?.querySelector('img')).not.toBeNull()
    // A picture: no tile is a link or a button.
    await expect(page.queryAllByRole('link')).toHaveLength(0)
  },
}

/** The waiting tile is the real tile, dashed, with the reason where its line would be. */
export const WaitingTile: Story = {
  play: async ({ canvasElement }) => {
    const waiting = canvasElement.querySelector<HTMLElement>('.ih-tile--waiting')
    await expect(waiting).not.toBeNull()
    await expect(
      within(waiting as HTMLElement).getByText('Waiting for approval'),
    ).toBeVisible()
    await expect(getComputedStyle(waiting as HTMLElement).borderTopStyle).toBe('dashed')
  },
}

/** The footer a first-time guest reads: the one-line notice, the privacy link and "Got it". */
export const WithFooter: Story = {
  play: async ({ canvasElement }) => {
    const footer = within(
      await within(canvasElement).findByRole('region', {
        name: pack.copy.visitNoticeLabel,
      }),
    )
    await expect(
      footer.getByText(/counts visits with one essential cookie/),
    ).toBeVisible()
    await expect(footer.getByText(pack.copy.privacyNoticeLink)).toBeVisible()
    await expect(footer.getByText(pack.copy.visitNoticeAcknowledge)).toBeVisible()
    // Inert: the privacy link has no address and "Got it" is not a button.
    await expect(footer.queryByRole('link')).toBeNull()
    await expect(footer.queryByRole('button')).toBeNull()
  },
}

/** The language chip is drawn, but opens nothing. */
export const LanguageChip: Story = {
  play: async ({ canvasElement }) => {
    const chip = within(canvasElement).getByRole('img', { name: /Language: English/ })
    await expect(chip).toBeVisible()
    await expect(canvasElement.querySelector('dialog')).toBeNull()
  },
}

/** One language shows no chip. */
export const OneLanguage: Story = {
  args: { hasLanguageChip: false },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByRole('img', { name: /Language/ }),
    ).toBeNull()
  },
}
