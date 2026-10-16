// The Google rating goal wizard, "Your Google goal" (rounds 3 and 4, E2 on a
// desktop and E4 on a phone), on the four Properties the owner approved, the
// edges at 4.6 to 4.9 and while Google lags behind the cache, dark and light.
// The Storybook Vitest project compiles no Tailwind, so nothing here claims a
// pixel; the plays prove what each screen says (the goal, when, what it needs,
// the likely range, the status line, the pace and the average) and what is
// sent. The interactions are in rating-goal-wizard-setup.stories.tsx, a change
// and the frames in rating-goal-wizard-change.stories.tsx.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor } from 'storybook/test'
import {
  aimsFor,
  clearMocks,
  Harness,
  numeral,
  openWizard,
  read,
  setMock,
  statusLine,
  type Dialog,
} from './rating-goal-wizard.stories.harness'
import {
  CATCHING_UP,
  EDGE_46,
  EDGE_47,
  EDGE_48,
  EDGE_49,
  OLIVE_TREE,
  SEAVIEW,
  TAVOLA,
  setupViewOf,
} from './rating-goal-setup.stories.fixtures'
import { FIXTURE_PROPERTY_ID } from './rating-goal.stories.fixtures'

const meta: Meta<typeof Harness> = {
  title: 'Goals/RatingGoalWizard',
  component: Harness,
  args: { intent: { kind: 'climb' } },
  beforeEach: clearMocks,
}

export default meta
type Story = StoryObj<typeof meta>

/** What the top of the screen says: the goal, when, and what it needs. */
async function says(
  dialog: Dialog,
  screen: Readonly<{ goal: string; when: string; sub: string; status: string }>,
) {
  await expect(numeral(dialog)).toHaveAttribute('aria-valuenow', screen.goal)
  await expect(dialog.getByText(screen.when)).toBeVisible()
  await expect(dialog.getByText(screen.sub, { exact: false })).toBeVisible()
  await expect(statusLine()).toBe(screen.status)
}

/** The quiet hotel: 3.9 from 261, opened on 4.1 at 1 a day, its best year's 4.5★. */
export const Harborline: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openWizard(canvasElement)
    await expect(dialog.getByText('Harborline Suites')).toBeVisible()
    await waitFor(() => expect(numeral(dialog)).toHaveFocus())
    await says(dialog, {
      goal: '4.1',
      when: 'in about 3 months',
      sub: 'new reviews at 1 a day · likely 9 weeks to 4 months',
      status: 'Recommended · 4.2 possible in about 6 months',
    })
    await expect(numeral(dialog)).toHaveAccessibleName('Goal on Google')
    await expect(numeral(dialog)).toHaveAttribute(
      'aria-valuetext',
      'Goal 4.1: 81 new reviews, in about 3 months at 1 a day',
    )
    await expect(dialog.getByText('your best year, 2024')).toBeVisible()
    await expect(
      dialog.getByText('About 30 a month, up from about 2 a month now.'),
    ).toBeVisible()
    await expect(dialog.getByRole('slider', { name: 'New reviews' })).toHaveAttribute(
      'aria-valuetext',
      '1 a day, recommended',
    )
    await aimsFor(dialog, 41, 45, 70)
    await expect(await dialog.findByText('4.1 on Google')).toBeVisible()
    await expect(
      dialog.getByText('In about 3 months, likely 9 weeks to 4 months.'),
    ).toBeVisible()
  },
}

/** The small B&B: 4.2 from 60, opened on 4.4 halfway to five stars. */
export const OliveTree: Story = {
  args: { propertyName: 'Olive Tree B&B', setup: read(setupViewOf(OLIVE_TREE)) },
  play: async ({ canvasElement }) => {
    const dialog = await openWizard(canvasElement)
    await says(dialog, {
      goal: '4.4',
      when: 'in about 6 weeks',
      sub: 'new reviews at 1 a day · likely 4 weeks to 2 months',
      status: 'Recommended · 4.5 possible in about 4 months',
    })
    await expect(dialog.getByText('halfway between your 4.2 and 5')).toBeVisible()
    await aimsFor(dialog, 44, 46, 70)
  },
}

/** The busy hotel: 4.2 from 640, its busiest month 1.5 a day, 2 a day suggested. */
export const Seaview: Story = {
  args: { propertyName: 'Seaview Hotel', setup: read(setupViewOf(SEAVIEW)) },
  play: async ({ canvasElement }) => {
    const dialog = await openWizard(canvasElement)
    await says(dialog, {
      goal: '4.4',
      when: 'in about 4 months',
      sub: 'new reviews at 2 a day · likely 3–6 months',
      status: 'Recommended · 4.5 possible in about 9 months',
    })
    await expect(dialog.getByText('your best month, August')).toBeVisible()
    await aimsFor(dialog, 44, 47, 140)
  },
}

/** The busy restaurant: 4.5 from 2,100, 7 a day, May's 4.8★. */
export const Tavola: Story = {
  args: { propertyName: 'Tavola', setup: read(setupViewOf(TAVOLA)) },
  play: async ({ canvasElement }) => {
    const dialog = await openWizard(canvasElement)
    await says(dialog, {
      goal: '4.6',
      when: 'in about 5 weeks',
      sub: 'new reviews at 7 a day · likely 3–10 weeks',
      status: 'Recommended · 4.7 possible in about 9 months',
    })
    await aimsFor(dialog, 46, 48, 490)
  },
}

/** 4.6 with nothing to go on: the next step up, its slow end open. */
export const NextStepUpFrom46: Story = {
  args: { setup: read(setupViewOf(EDGE_46)) },
  play: async ({ canvasElement }) => {
    const dialog = await openWizard(canvasElement)
    await says(dialog, {
      goal: '4.7',
      when: 'in about 5 months',
      sub: 'new reviews at 1 a day · likely 3 months or more',
      status: 'Recommended · the next step up from 4.6',
    })
  },
}

/** X1 at 4.7: Keep first, and Raise it anyway opens the climb at a typed 4.9★. */
export const KeepFirstAt47: Story = {
  args: { intent: { kind: 'keep', targetTenths: 47 }, setup: read(setupViewOf(EDGE_47)) },
  play: async ({ canvasElement }) => {
    const dialog = await openWizard(canvasElement, 'Keep 4.7 on Google')
    await expect(
      dialog.getByText(
        '4.8 needs new reviews averaging 4.9★ or more, so we suggest keeping 4.7.',
        {
          exact: false,
        },
      ),
    ).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'Raise it anyway' }))
    await waitFor(() =>
      expect(dialog.getByRole('heading', { name: 'Your Google goal' })).toHaveFocus(),
    )
    await expect(numeral(dialog)).toHaveAttribute('aria-valuenow', '4.8')
    await expect(
      dialog.getByRole('textbox', { name: 'New reviews planned at' }),
    ).toHaveValue('4.9')
    await expect(dialog.queryByRole('button', { name: 'Back to automatic' })).toBeNull()
    await aimsFor(dialog, 48, 49, 70)
  },
}

/** X1 at 4.8: Keep first; raising it plans 5.0★ for 4.9. */
export const KeepFirstAt48: Story = {
  args: { intent: { kind: 'keep', targetTenths: 48 }, setup: read(setupViewOf(EDGE_48)) },
  play: async ({ canvasElement }) => {
    const dialog = await openWizard(canvasElement, 'Keep 4.8 on Google')
    await expect(
      dialog.getByText(
        '4.9 needs every new review to be 5★, so we suggest keeping 4.8.',
        {
          exact: false,
        },
      ),
    ).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'Start watching' }))
    await waitFor(() =>
      expect(setMock).toHaveBeenCalledWith({
        data: {
          propertyId: FIXTURE_PROPERTY_ID,
          mode: 'keep',
          targetTenths: 48,
          qualityTenths: null,
          paceTenthsPerWeek: null,
        },
      }),
    )
  },
}

/** 4.9: nothing higher, so Keep with no way to raise it. */
export const KeepAt49: Story = {
  args: { intent: { kind: 'keep', targetTenths: 49 }, setup: read(setupViewOf(EDGE_49)) },
  play: async ({ canvasElement }) => {
    const dialog = await openWizard(canvasElement, 'Keep 4.9 on Google')
    await expect(dialog.queryByRole('button', { name: 'Raise it anyway' })).toBeNull()
    await userEvent.click(dialog.getByRole('button', { name: 'Start watching' }))
    await expect(await dialog.findByText('Keeping 4.9 on Google')).toBeVisible()
    await expect(dialog.getByText('You can end it at any time.')).toBeVisible()
  },
}

/** Google lags behind a cache that has earned every tenth: no goal yet. */
export const GoogleCatchingUp: Story = {
  args: { setup: read(setupViewOf(CATCHING_UP)) },
  play: async ({ canvasElement }) => {
    const dialog = await openWizard(canvasElement)
    await expect(
      dialog.getByText(
        'Google should show 4.9 soon. Its number can take up to two weeks to catch up; set your goal once it does.',
      ),
    ).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Not now' })).toBeVisible()
    await expect(dialog.queryByRole('spinbutton')).toBeNull()
  },
}

/** On a phone the same screen fills it as a sheet (E4). */
export const PhoneFullScreen: Story = {
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
  play: async ({ canvasElement }) => {
    const dialog = await openWizard(canvasElement)
    await expect(document.body.querySelector('[data-wizard-frame]')).toHaveAttribute(
      'data-wizard-frame',
      'sheet',
    )
    await expect(numeral(dialog)).toHaveAttribute('aria-valuenow', '4.1')
    // E4 drops the footer's counting line; the two explanations stay.
    await expect(dialog.queryByText(/^We count new Google reviews/u)).toBeNull()
    await expect(
      dialog.getByRole('button', { name: 'How we worked this out' }),
    ).toBeVisible()
  },
}

export const PhoneLight: Story = {
  parameters: { viewport: { defaultViewport: 'mobileStaff' }, theme: 'light' },
  play: async ({ canvasElement }) => {
    await openWizard(canvasElement)
  },
}

export const DesktopDialog: Story = {
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
  play: async ({ canvasElement }) => {
    const dialog = await openWizard(canvasElement)
    await expect(document.body.querySelector('[data-wizard-frame]')).toHaveAttribute(
      'data-wizard-frame',
      'dialog',
    )
    await expect(
      dialog.getByText('We count new Google reviews every week, Monday to Sunday.'),
    ).toBeVisible()
  },
}

export const DesktopLight: Story = {
  parameters: { viewport: { defaultViewport: 'desktopManager' }, theme: 'light' },
  play: async ({ canvasElement }) => {
    await openWizard(canvasElement)
  },
}
