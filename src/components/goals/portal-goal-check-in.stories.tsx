// The Monthly portal goal's month-start check-in on its card (PLAN PG-15; copy
// deck K-1…K-11): Dec 1 with November still read, Use 45 (sent once, as the
// change now, recommended) and Keep 40 (then gone), "Other number", "How we
// worked this out", November closed met and not met, December at the
// recommended number already (one line), nothing counted, a refusal, someone
// who may not change the goal, and Dec 8 (folded away). At 320, 390, 820 and
// 1440 px and on the light theme. The Storybook Vitest project compiles no
// Tailwind, so the plays assert words, roles, what is sent, where the focus
// goes, and the classes that wrap the buttons and keep them touch-sized.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { toast } from 'sonner'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { PortalGoalCardView } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import { ToasterDecorator } from '../../../.storybook/ToasterDecorator'
import type { PortalGoalCheckInCommands } from './portal-goal-check-in'
import {
  CARD_CHECK_IN,
  CARD_CHECK_IN_ANSWERED,
  CARD_CHECK_IN_CLOSED_MET,
  CARD_CHECK_IN_CLOSED_NOT_MET,
  CARD_CHECK_IN_NOTHING,
  CARD_CHECK_IN_SAME,
  CARD_DAY_8,
} from './portal-goal-check-in.stories.fixtures'
import type { PortalGoalCommands } from './portal-goal-card-ready'
import { PortalGoalSection } from './portal-goal-section'
import { SEAVIEW } from './portal-goal.stories.fixtures'
import { expectAnsweredOnTheCard } from './portal-goal.stories.play'

const changeNowMock = fn<PortalGoalCheckInCommands['changeMonthlyPortalGoalNowFn']>(
  async () => ({ changed: true }),
)
const keepMock = fn<PortalGoalCheckInCommands['keepMonthlyPortalGoalFn']>(async () => ({
  month: '2026-12',
}))
const onSetMock = fn<PortalGoalCommands['onSet']>(async () => undefined)
const openSheetMock = fn<NonNullable<PortalGoalCommands['openSheet']>>()

const read = (data: PortalGoalCardView) => ({
  data,
  failed: false,
  retrying: false,
  retry: fn(),
})

const commands = (checkIn: Partial<PortalGoalCheckInCommands> = {}) => ({
  setMonthlyPortalGoalFn: fn(),
  onSet: onSetMock,
  openSheet: openSheetMock,
  checkIn: {
    changeMonthlyPortalGoalNowFn: changeNowMock,
    keepMonthlyPortalGoalFn: keepMock,
    ...checkIn,
  },
})

const meta: Meta<typeof PortalGoalSection> = {
  title: 'Goals/PortalGoalCheckIn',
  component: PortalGoalSection,
  parameters: { layout: 'padded' },
  args: {
    propertyId: SEAVIEW.propertyId,
    card: read(CARD_CHECK_IN),
    canCreatePortal: true,
    commands: commands(),
  },
  decorators: [ToasterDecorator],
  beforeEach: () => {
    // Sonner's store outlives a story; a Toaster that mounts replays what still shows.
    toast.dismiss()
    changeNowMock.mockClear()
    keepMock.mockClear()
    onSetMock.mockClear()
    openSheetMock.mockClear()
  },
  // As wide as the Goals page draws the section.
  render: (args) => (
    <div className="max-w-5xl">
      <PortalGoalSection {...args} />
    </div>
  ),
}

export default meta
type Story = StoryObj<typeof meta>
type Canvas = ReturnType<typeof within>

const FOOT = 'Nothing changes unless you choose. December counts against 40 until then.'

/** A toast in the page, once it has faded in. */
async function expectToast(text: string) {
  const shown = await within(document.body).findByText(text)
  await waitFor(() => expect(shown).toBeVisible())
}

/** The check-in's region, named for the month: never the Google goal's "Last week". */
const regionOf = (canvas: Canvas) =>
  within(canvas.getByRole('region', { name: 'For December' }))

async function expectCheckIn(canvas: Canvas) {
  await expect(
    canvas.getByRole('heading', { level: 3, name: 'Monthly portal goal' }),
  ).toBeVisible()
  await expect(
    canvas.getByText('November: 36 of 40 so far. Final figure on Dec 2.'),
  ).toBeVisible()
  await expect(
    canvas.getByRole('heading', { level: 4, name: 'For December' }),
  ).toBeVisible()
  const region = regionOf(canvas)
  await expect(region.getByRole('button', { name: 'Use 45' })).toBeVisible()
  await expect(
    region.getByText('Recommended · a bit above your usual of about 38', {
      exact: false,
    }),
  ).toBeVisible()
  await expect(region.getByRole('button', { name: 'Keep 40' })).toBeVisible()
  await expect(region.getByRole('button', { name: 'Other number' })).toBeVisible()
  await expect(region.getByText(FOOT)).toBeVisible()
  await expect(canvas.queryByRole('region', { name: 'Last week' })).toBeNull()
  // It takes the card's body: December's bar waits until it is answered.
  await expect(canvas.queryByRole('progressbar')).toBeNull()
  await expect(canvas.getByRole('link', { name: 'View details' })).toHaveAttribute(
    'href',
    '/properties/p1/goals/portals',
  )
}

/** G4, Dec 1: Use 45 changes December now, as recommended, says so, and the title takes the focus. */
export const CheckIn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expectCheckIn(canvas)
    await userEvent.click(regionOf(canvas).getByRole('button', { name: 'Use 45' }))
    await expect(changeNowMock).toHaveBeenCalledOnce()
    await expect(changeNowMock).toHaveBeenCalledWith({
      data: {
        propertyId: SEAVIEW.propertyId,
        programId: 'program-monthly',
        month: '2026-12',
        targetValue: 45,
        expectedTarget: 40,
        expectedVersion: 1,
        expectedFollowingMonth: '2027-01',
        targetSource: 'recommended',
      },
    })
    await expect(keepMock).not.toHaveBeenCalled()
    await expectAnsweredOnTheCard('December goal: 45 private ratings', onSetMock)
  },
}

/** At 320 px the buttons wrap, and each can be tapped. */
export const CheckIn320: Story = {
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expectCheckIn(canvas)
    const region = regionOf(canvas)
    for (const name of ['Use 45', 'Keep 40', 'Other number']) {
      const button = region.getByRole('button', { name })
      await expect(button.className).toContain('max-md:min-h-(--control-touch)')
      await expect(button.parentElement?.className).toContain('flex-wrap')
    }
  },
}

export const CheckInOnAPhone: Story = {
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
  play: async ({ canvasElement }) => expectCheckIn(within(canvasElement)),
}

export const CheckInOnATablet: Story = {
  ...CheckInOnAPhone,
  parameters: { viewport: { defaultViewport: 'tablet' } },
}

export const CheckInOnADesktop: Story = {
  ...CheckInOnAPhone,
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
}

export const CheckInLight: Story = {
  ...CheckInOnAPhone,
  parameters: { theme: 'light' },
}

/** K-10: the sums behind 45, for a whole 31-day December. */
export const CheckInHowWeWorkedThisOut: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = regionOf(canvas).getByRole('button', {
      name: 'How we worked this out',
    })
    await userEvent.click(trigger)
    const popover = within(
      await within(document.body).findByRole('dialog', {
        name: 'How we worked this out',
      }),
    )
    await expect(
      popover.getByText(
        'Reception, Restaurant and Spa brought in 34 private ratings in the 4 weeks to Nov 30.',
      ),
    ).toBeVisible()
    await expect(
      popover.getByText(
        'At that pace, a 31-day month gets about 38: your usual. The recommendation is a bit more, rounded up: 45.',
      ),
    ).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
  },
}

/** The Goals page's section, read again once answered: Keep's card has no check-in then. */
function AnsweringSection(args: Meta<typeof PortalGoalSection>['args']) {
  const [card, setCard] = useState<PortalGoalCardView>(CARD_CHECK_IN)
  if (!args?.commands || !args.propertyId) return null
  return (
    <div className="max-w-5xl">
      <PortalGoalSection
        propertyId={args.propertyId}
        canCreatePortal
        card={read(card)}
        commands={{
          ...args.commands,
          onSet: async () => {
            await onSetMock()
            setCard(CARD_CHECK_IN_ANSWERED)
          },
        }}
      />
    </div>
  )
}

/** Keep 40: December keeps its number, the check-in is gone, and the title takes the focus. */
export const CheckInKeep: Story = {
  render: (args) => <AnsweringSection {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(regionOf(canvas).getByRole('button', { name: 'Keep 40' }))
    await expect(keepMock).toHaveBeenCalledOnce()
    await expect(keepMock).toHaveBeenCalledWith({
      data: {
        propertyId: SEAVIEW.propertyId,
        programId: 'program-monthly',
        month: '2026-12',
      },
    })
    await expect(changeNowMock).not.toHaveBeenCalled()
    await expectAnsweredOnTheCard('December stays at 40', onSetMock)
    await waitFor(() =>
      expect(canvas.queryByRole('region', { name: 'For December' })).toBeNull(),
    )
    // The running month is back: December's bar, from its first day.
    await expect(
      canvas.getByRole('progressbar', { name: 'Private ratings in December' }),
    ).toBeVisible()
  },
}

/** "Other number" opens the change sheet on the goal, on December now. */
export const CheckInOtherNumber: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(regionOf(canvas).getByRole('button', { name: 'Other number' }))
    await expect(openSheetMock).toHaveBeenCalledWith({
      mode: 'change',
      measure: 'portal_rating_count',
    })
    await expect(changeNowMock).not.toHaveBeenCalled()
    await expect(keepMock).not.toHaveBeenCalled()
  },
}

/** While Use is on its way, both answers wait, and a double click sends once. */
export const CheckInPending: Story = {
  args: {
    commands: commands({
      changeMonthlyPortalGoalNowFn: fn(() => new Promise<never>(() => undefined)),
    }),
  },
  play: async ({ canvasElement, args }) => {
    const region = regionOf(within(canvasElement))
    await userEvent.dblClick(region.getByRole('button', { name: 'Use 45' }))
    const busy = await region.findByRole('button', { name: 'Saving…' })
    await expect(busy).toHaveAttribute('aria-busy', 'true')
    await expect(region.getByRole('button', { name: 'Keep 40' })).toBeDisabled()
    await expect(
      args.commands?.checkIn?.changeMonthlyPortalGoalNowFn,
    ).toHaveBeenCalledOnce()
  },
}

/** Pressed after the 7th in a tab left open: it has closed, and the card is read again. */
export const CheckInRefusedClosed: Story = {
  args: {
    commands: commands({
      keepMonthlyPortalGoalFn: fn(async () => {
        throw new ServerFunctionError(
          'GoalProgramError',
          'check_in_closed',
          'check_in_closed',
          409,
        )
      }),
    }),
  },
  play: async ({ canvasElement }) => {
    const region = regionOf(within(canvasElement))
    await userEvent.click(region.getByRole('button', { name: 'Keep 40' }))
    await expectToast('This month’s check-in has closed.')
    await waitFor(() => expect(onSetMock).toHaveBeenCalledOnce())
  },
}

/**
 * Dec 3: November closed and met, with a check; December still asks, for the
 * rest of it on top of what counts (W-5), as the change sheet offers it.
 */
export const CheckInClosedMet: Story = {
  args: { card: read(CARD_CHECK_IN_CLOSED_MET) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('November met: 41 of 40')).toBeVisible()
    const region = regionOf(canvas)
    await expect(region.getByRole('button', { name: 'Use 45' })).toBeVisible()
    await userEvent.click(region.getByRole('button', { name: 'How we worked this out' }))
    const popover = within(
      await within(document.body).findByRole('dialog', {
        name: 'How we worked this out',
      }),
    )
    await expect(
      popover.getByText(
        '3 already count this month. At your usual, the 29 days left add about 35. A bit more, rounded up: 45.',
      ),
    ).toBeVisible()
  },
}

/** Dec 3: November closed, not met: neutral, never red. */
export const CheckInClosedNotMet: Story = {
  args: { card: read(CARD_CHECK_IN_CLOSED_NOT_MET) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('November: 36 of 40 · not met')).toBeVisible()
    await expect(regionOf(canvas).getByRole('button', { name: 'Keep 40' })).toBeVisible()
  },
}

/** December at 45 already: one line under the running card, and "Change". */
export const CheckInSameLine: Story = {
  args: { card: read(CARD_CHECK_IN_SAME) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('December stays at 45. It is still the recommended number.'),
    ).toBeVisible()
    // December's progress stays: no region, no choice.
    await expect(
      canvas.getByRole('progressbar', { name: 'Private ratings in December' }),
    ).toBeVisible()
    await expect(canvas.queryByRole('region', { name: 'For December' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /Use|Keep/u })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Change' }))
    await expect(openSheetMock).toHaveBeenCalledWith({
      mode: 'change',
      measure: 'portal_rating_count',
    })
  },
}

/** No private ratings in the 4 weeks: no number to use; Keep 40 and another number stay. */
export const CheckInNothingCounted: Story = {
  args: { card: read(CARD_CHECK_IN_NOTHING) },
  play: async ({ canvasElement }) => {
    const region = regionOf(within(canvasElement))
    await expect(
      region.getByText(
        'No recommendation this month: no private ratings in the last 4 weeks.',
      ),
    ).toBeVisible()
    await expect(region.queryByRole('button', { name: /^Use/u })).toBeNull()
    await expect(region.getByRole('button', { name: 'Keep 40' })).toBeVisible()
    await expect(region.getByRole('button', { name: 'Other number' })).toBeVisible()
    await expect(region.getByText(FOOT)).toBeVisible()
  },
}

/** Without `goal.update` (a Member) nothing is asked: the running card shows. */
export const CheckInNotAllowed: Story = {
  decorators: [withRole('Member')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('region', { name: 'For December' })).toBeNull()
    await expect(
      canvas.getByRole('progressbar', { name: 'Private ratings in December' }),
    ).toBeVisible()
  },
}

/** Dec 8: the check-in has folded away, and December keeps 40. */
export const Day8Hidden: Story = {
  args: { card: read(CARD_DAY_8) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('region', { name: 'For December' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /Keep|Use/u })).toBeNull()
    await expect(canvas.getByText('9 of 40')).toBeVisible()
  },
}
