// fallow-ignore-file code-duplication
// Review & publish (board A9): what guests will see change, the checks, the
// languages and the 1 star and 5 star pages side by side, with the footer that
// publishes. The reader stands in for the draft preview; the publish is a spy.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import type { Action } from '#/components/hooks/use-action'
import type { UpdatePortalVariables } from '../shared/types'
import {
  PREVIEW_DRAFT,
  PREVIEW_DRAFT_ONE_LANGUAGE,
  previewReader,
} from '../portal-preview/__fixtures__/portal-preview-fixtures'
import {
  REVIEW_ALL_CLEAR,
  REVIEW_BLOCKED,
  REVIEW_FIRST_PUBLICATION,
  REVIEW_LIVE_WITH_CHANGES,
  REVIEW_NOTHING_TO_PUBLISH,
  REVIEW_PEOPLE,
  REVIEW_PORTAL,
  REVIEW_PROPERTY_ID,
} from './__fixtures__/portal-review-fixtures'
import { PortalReviewPage } from './portal-review-page'

const idleMutation = Object.assign(
  async (_input: UpdatePortalVariables) => ({ success: true }),
  { isPending: false, error: null as unknown, isSuccess: false, data: null },
) as Action<UpdatePortalVariables, { success: boolean }>

/** The four languages of board 05; the German and Spanish pages reuse the English one. */
const FOUR_LANGUAGES = {
  ...PREVIEW_DRAFT,
  locales: ['en', 'bg', 'es', 'de'],
  experiences: {
    ...PREVIEW_DRAFT.experiences,
    es: PREVIEW_DRAFT.experiences.en,
    de: PREVIEW_DRAFT.experiences.en,
  },
} satisfies typeof PREVIEW_DRAFT

const meta = {
  title: 'Portal/PortalReviewPage',
  component: PortalReviewPage,
  parameters: { layout: 'fullscreen' },
  decorators: [AuthedRouterDecorator],
  args: {
    propertyId: REVIEW_PROPERTY_ID,
    portal: REVIEW_PORTAL,
    review: REVIEW_LIVE_WITH_CHANGES,
    timeZone: 'Europe/Sofia',
    viewerId: 'u-me',
    fixPeople: REVIEW_PEOPLE,
    tab: 'page',
    getPortalPreview: previewReader({ draft: FOUR_LANGUAGES }),
    onPublish: fn(),
    isPublishing: false,
    updateMutation: idleMutation,
    canManage: true,
  },
} satisfies Meta<typeof PortalReviewPage>

export default meta
type Story = StoryObj<typeof meta>

const WAIT = { timeout: 5000 }

const pagePhone = (canvas: ReturnType<typeof within>, rating: string) =>
  canvas.findByRole(
    'region',
    { name: (name: string) => name.startsWith(`Page after ${rating}`) },
    WAIT,
  )

/** Board 05: the changes, the warning, the languages, and the pair under one Google card. */
export const LiveWithChanges: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { level: 2, name: /What guests will see change/ }),
    ).toHaveTextContent('2')
    await expect(
      canvas.getByRole('button', {
        name: 'Show on the page: Linktree · renamed ‘Dinner menu’ to ‘Olive Terrace menu’',
      }),
    ).toBeVisible()
    // Who made it, and when, under the change.
    await expect(canvas.getByText(/^Georgi Ivanov ·/)).toBeVisible()
    // The warning names the label and says publishing can go on.
    await expect(canvas.getByText(/· 1 label missing\./)).toBeVisible()
    await expect(canvas.getByText(/^German guests see /)).toBeVisible()
    await expect(canvas.getByText('You can publish without it.')).toBeVisible()
    await expect(canvas.getByText('Who can fix: you or Georgi Ivanov')).toBeVisible()
    // No AI translate control on the warning (owner decision 3).
    await expect(canvas.queryByRole('button', { name: /translate|\bAI\b/i })).toBeNull()
    await expect(canvas.queryByRole('link', { name: /translate|\bAI\b/i })).toBeNull()
    await expect(canvas.getByText(/7 checks passed/)).toBeVisible()
    // Every language, with its own coverage.
    await expect(canvas.getByText('13 of 14 · 1 missing')).toBeVisible()
    await expect(canvas.getByText('2 AI drafts not checked')).toBeVisible()
    // The footer.
    await expect(canvas.getByText('Publishes as version 6')).toBeVisible()
    await expect(canvas.getByText('Printed codes keep working')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Publish changes' })).toBeEnabled()
    await expect(canvas.getByRole('link', { name: 'Back to editing' })).toBeVisible()
  },
}

/** 1★ and 5★ draw the same Google card; only the low rating is offered the private note. */
export const OneStarAndFiveStarPair: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole(
        'heading',
        { name: 'Every guest gets the same Google card' },
        WAIT,
      ),
    ).toBeVisible()
    const low = within(await pagePhone(canvas, '1★ Poor'))
    const high = within(await pagePhone(canvas, '5★ Excellent'))
    await expect(low.getByText('Share your experience on Google')).toBeVisible()
    await expect(high.getByText('Share your experience on Google')).toBeVisible()
    await expect(low.getByRole('button', { name: 'Write a private note' })).toBeVisible()
    await expect(high.queryByRole('button', { name: 'Write a private note' })).toBeNull()
  },
}

/** "Show" brings a change's language into the phones. */
export const ShowSwitchesLanguage: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await pagePhone(canvas, '1★ Poor')
    await userEvent.click(
      canvas.getByRole('button', {
        name: /Show on the page: Welcome · reworded the Spanish/,
      }),
    )
    await waitFor(() => expect(canvas.getByRole('radio', { name: /ES/ })).toBeChecked())
    await expect(
      canvas.getByRole('button', { name: /Show on the page: Welcome/ }),
    ).toHaveAttribute('aria-pressed', 'true')
  },
}

/** The publish button hands the decision to the route. */
export const PublishChanges: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Publish changes' }))
    await expect(args.onPublish).toHaveBeenCalledTimes(1)
  },
}

export const Publishing: Story = {
  args: { isPublishing: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Publishing…' }),
    ).toBeDisabled()
  },
}

/** A blocked check says what to do, who can do it and where; the button waits. */
export const BlockedByAMissingCode: Story = {
  args: { review: REVIEW_BLOCKED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('No working code')).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Open Share' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Publish changes' })).toBeDisabled()
    await expect(canvas.getByText('Fix 1 thing first')).toBeVisible()
  },
}

export const NothingToPublish: Story = {
  args: { review: REVIEW_NOTHING_TO_PUBLISH },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Nothing has changed since version 5.')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Publish changes' })).toBeDisabled()
    await expect(canvas.getByText('Nothing to publish')).toBeVisible()
  },
}

/** A portal that is not live has no change list; publishing makes it public. */
export const FirstPublication: Story = {
  args: {
    review: REVIEW_FIRST_PUBLICATION,
    portal: { ...REVIEW_PORTAL, publicationState: 'draft' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { level: 2, name: 'What guests will see' }),
    ).toBeVisible()
    await expect(canvas.getByText(/Nothing is public yet/)).toBeVisible()
    await expect(canvas.getByText('Publishes as version 1')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Publish portal' })).toBeEnabled()
    // A page that is not live offers nothing to turn off.
    await expect(
      canvas.queryByRole('button', { name: /disable public page/i }),
    ).toBeNull()
  },
}

/** A live page can still be turned off, as the interim page offered. */
export const LiveCanBeDisabled: Story = {
  args: { review: REVIEW_ALL_CLEAR },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: /disable public page/i }),
    ).toBeVisible()
  },
}

/** Passed checks fold into one line that opens to the list. */
export const PassedChecksOpen: Story = {
  args: { review: REVIEW_ALL_CLEAR },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByText('The address works')).toBeNull()
    const toggle = canvas.getByRole('button', { name: 'Show passed checks' })
    await userEvent.click(toggle)
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText('The address works')).toBeVisible()
  },
}

/** "Try as guest" swaps the pair for one phone that answers clicks and records nothing. */
export const TryAsGuest: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await pagePhone(canvas, '1★ Poor')
    await userEvent.click(canvas.getByRole('button', { name: 'Try as guest' }))
    await expect(
      await canvas.findByRole('region', { name: 'Guest page you can try' }, WAIT),
    ).toBeVisible()
    await expect(canvas.getByText(/Nothing is saved or counted/)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Stop trying' }))
    await pagePhone(canvas, '1★ Poor')
  },
}

/** Choosing a state under "See every guest state" shows that one page. */
export const EveryGuestState: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await pagePhone(canvas, '1★ Poor')
    await userEvent.click(canvas.getByRole('button', { name: /See every guest state/ }))
    await userEvent.click(
      await canvas.findByRole('button', { name: 'After the private note is sent' }, WAIT),
    )
    await expect(
      await canvas.findByText('Draft · Done · English', undefined, WAIT),
    ).toBeVisible()
    await userEvent.click(
      canvas.getByRole('button', { name: /Back to the 1★ and 5★ pair/ }),
    )
    await pagePhone(canvas, '5★ Excellent')
  },
}

/** One language: no switch, as the guest page shows no chip. */
export const OneLanguage: Story = {
  args: {
    getPortalPreview: previewReader({ draft: PREVIEW_DRAFT_ONE_LANGUAGE }),
    review: { ...REVIEW_ALL_CLEAR, languages: REVIEW_ALL_CLEAR.languages.slice(0, 1) },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await pagePhone(canvas, '1★ Poor')
    await expect(
      canvas.queryByRole('radiogroup', { name: 'Preview language' }),
    ).toBeNull()
  },
}

export const PreviewFailure: Story = {
  args: { getPortalPreview: previewReader({ fail: true }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText('The preview couldn’t be loaded', undefined, WAIT),
    ).toBeVisible()
    // The lists beside it are unaffected.
    await expect(canvas.getByText('Publishes as version 6')).toBeVisible()
  },
}
