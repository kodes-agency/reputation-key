// The Monthly portal goal card once its number is ready, and the goal it sets
// (PLAN PG-09): Use for November and for the rest of October, scans first,
// "How we worked this out", a Use on its way, a refusal, and the scheduled
// goal (and its "Change", PLAN PG-14, drawn only for someone who may change
// it), each at 320 and 1440 px and the ready card on the light theme too. The
// running goal is `portal-goal-card-running.stories.tsx`. The Storybook Vitest
// project compiles no Tailwind, so the plays assert words, roles and what Use
// sends.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { toast } from 'sonner'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { PortalGoalCardView } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { withPermissions } from '../../../.storybook/AuthedRouterDecorator'
import { ToasterDecorator } from '../../../.storybook/ToasterDecorator'
import type { PortalGoalCommands } from './portal-goal-card-ready'
import { PortalGoalSection } from './portal-goal-section'
import {
  CARD_READY,
  CARD_READY_OCTOBER,
  CARD_SCANS_ONLY,
  CARD_SCHEDULED,
  SEAVIEW,
} from './portal-goal.stories.fixtures'

const setMock = fn<PortalGoalCommands['setMonthlyPortalGoalFn']>(async () => ({
  programId: 'program-monthly',
}))
const onSetMock = fn<PortalGoalCommands['onSet']>(async () => undefined)

const read = (data: PortalGoalCardView) => ({
  data,
  failed: false,
  retrying: false,
  retry: fn(),
})

const meta: Meta<typeof PortalGoalSection> = {
  title: 'Goals/PortalGoalCardUse',
  component: PortalGoalSection,
  parameters: { layout: 'padded' },
  args: {
    propertyId: SEAVIEW.propertyId,
    card: read(CARD_READY),
    canCreatePortal: true,
    commands: { setMonthlyPortalGoalFn: setMock, onSet: onSetMock },
  },
  decorators: [ToasterDecorator],
  beforeEach: () => {
    // Sonner's store outlives a story; a Toaster that mounts replays what still shows.
    toast.dismiss()
    setMock.mockClear()
    onSetMock.mockClear()
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

const ASK_EVERY_GUEST =
  'Ask every guest, not only happy ones. Low and high ratings count the same.'
const TITLE_ID = 'portal-goal-title'

/** A toast in the page, once it has faded in. */
async function expectToast(text: string) {
  const shown = await within(document.body).findByText(text)
  await waitFor(() => expect(shown).toBeVisible())
}

async function expectReadyNovember(canvas: Canvas) {
  await expect(
    canvas.getByRole('heading', { level: 3, name: 'Monthly portal goal' }),
  ).toBeVisible()
  await expect(
    canvas.getByText('How many private ratings your portals bring in each month.'),
  ).toBeVisible()
  await expect(canvas.getByText('Recommended for November')).toBeVisible()
  await expect(canvas.getByText('40', { exact: true })).toBeVisible()
  await expect(
    canvas.getByText(
      'A bit above your usual: about 34 a month, from the last 2 weeks at 2 portals.',
      { exact: false },
    ),
  ).toBeVisible()
  await expect(
    canvas.getByText(
      'Spa is new. Its ratings count from day one, and it joins the number once it has 2 weeks.',
    ),
  ).toBeVisible()
  await expect(canvas.getByText(ASK_EVERY_GUEST)).toBeVisible()
  // November is offered, so nothing counts yet: no "Counts from".
  await expect(canvas.queryByText(/Counts from/u)).toBeNull()
}

/** Use 40 sets November in one tap, says so, reads the card again and takes the focus to its title. */
export const Ready: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expectReadyNovember(canvas)
    await userEvent.click(canvas.getByRole('button', { name: 'Use 40' }))
    await expect(setMock).toHaveBeenCalledOnce()
    await expect(setMock).toHaveBeenCalledWith({
      data: {
        propertyId: SEAVIEW.propertyId,
        metric: 'portal_rating_count',
        targetValue: 40,
        startMonth: '2026-11',
        targetSource: 'recommended',
      },
    })
    await expectToast('November goal set: 40 private ratings')
    await waitFor(() => expect(onSetMock).toHaveBeenCalledOnce())
    await waitFor(() => expect(document.activeElement).toHaveAttribute('id', TITLE_ID))
  },
}

export const ReadyOnANarrowPhone: Story = {
  play: async ({ canvasElement }) => expectReadyNovember(within(canvasElement)),
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

export const ReadyOnAPhone: Story = {
  ...ReadyOnANarrowPhone,
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
}

export const ReadyOnATablet: Story = {
  ...ReadyOnANarrowPhone,
  parameters: { viewport: { defaultViewport: 'tablet' } },
}

export const ReadyOnADesktop: Story = {
  ...ReadyOnANarrowPhone,
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
}

export const ReadyLight: Story = {
  ...ReadyOnANarrowPhone,
  parameters: { theme: 'light' },
}

/** On or before the 20th, this month: it counts from Oct 1 with what already counts. */
export const ReadyOctober: Story = {
  args: { card: read(CARD_READY_OCTOBER) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Recommended for October')).toBeVisible()
    await expect(canvas.getByText('Counts from Oct 1 · 12 already count.')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Use 24' }))
    await expect(setMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ targetValue: 24, startMonth: '2026-10' }),
    })
    await expectToast('October goal set: 24 private ratings')
  },
}

/** Scans but no private ratings: one sentence, and Use counts scans. */
export const ScansOnly: Story = {
  args: { card: read(CARD_SCANS_ONLY) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('How many scans your portals get each month.'),
    ).toBeVisible()
    await expect(
      canvas.getByText(
        'Your portals had 23 scans but no private ratings in the last 2 weeks. Start by counting scans: 55 scans in November.',
        { exact: false },
      ),
    ).toBeVisible()
    // The ask-every-guest line is about ratings.
    await expect(canvas.queryByText(ASK_EVERY_GUEST)).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Use 55 scans' }))
    await expect(setMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ metric: 'qualified_scans', targetValue: 55 }),
    })
    await expectToast('November goal set: 55 scans')
  },
}

export const ScansOnlyOnANarrowPhone: Story = {
  args: { card: read(CARD_SCANS_ONLY) },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Use 55 scans' }),
    ).toBeVisible()
  },
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

/** The sums behind the number open on request, and Escape hands the focus back. */
export const HowWeWorkedThisOut: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'How we worked this out' })
    await userEvent.click(trigger)
    const popover = await within(document.body).findByRole('dialog', {
      name: 'How we worked this out',
    })
    const sums = within(popover)
    await expect(
      sums.getByText(
        'Reception and Restaurant brought in 16 private ratings in the 14 days to Oct 22.',
      ),
    ).toBeVisible()
    await expect(
      sums.getByText(
        'At that pace, a 30-day month gets about 34: your usual. The recommendation is a bit more, rounded up: 40.',
      ),
    ).toBeVisible()
    await expect(sums.getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      'Reception · 11 in 14 days',
      'Restaurant · 5 in 14 days',
      'Spa · live 8 days, joins once it has 2 weeks',
    ])
    await expect(
      sums.getByText(
        'Low and high ratings count the same. Withdrawn ratings don’t count. Months follow Sofia time.',
      ),
    ).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(popover).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  },
}

export const HowWeWorkedThisOutOnANarrowPhone: Story = {
  ...HowWeWorkedThisOut,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

/** While the set is on its way the button is busy, and a double click sends once. */
export const UsePending: Story = {
  args: {
    commands: {
      setMonthlyPortalGoalFn: fn(() => new Promise<never>(() => undefined)),
      onSet: onSetMock,
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.dblClick(canvas.getByRole('button', { name: 'Use 40' }))
    const busy = await canvas.findByRole('button', { name: 'Saving…' })
    await expect(busy).toBeDisabled()
    await expect(busy).toHaveAttribute('aria-busy', 'true')
    await expect(args.commands.setMonthlyPortalGoalFn).toHaveBeenCalledOnce()
  },
}

/** A goal set a moment ago elsewhere: the refusal says so, and the card is read again. */
export const UseRefusedAGoalWasSet: Story = {
  args: {
    commands: {
      setMonthlyPortalGoalFn: fn(async () => {
        throw new ServerFunctionError(
          'GoalProgramError',
          'subject_has_goal',
          'subject_has_goal',
          409,
        )
      }),
      onSet: onSetMock,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Use 40' }))
    await expectToast('A monthly portal goal was set a moment ago. Here is the latest.')
    await waitFor(() => expect(onSetMock).toHaveBeenCalledOnce())
  },
}

async function expectScheduled(canvas: Canvas) {
  await expect(
    canvas.getByRole('heading', { level: 3, name: 'Monthly portal goal' }),
  ).toBeVisible()
  await expect(canvas.getByText('November · 40 private ratings')).toBeVisible()
  await expect(canvas.getByText('Starts on Nov 1 · October so far: 12')).toBeVisible()
  // Nothing to use, and no figure of the month yet; its page is a click away.
  await expect(canvas.queryByRole('button')).toBeNull()
  await expect(canvas.queryByText(/to go/u)).toBeNull()
  await expect(canvas.getByRole('link', { name: 'View details' })).toHaveAttribute(
    'href',
    '/properties/p1/goals/portals',
  )
}

/** Set for November on Oct 23: its month and number, the day it starts, October so far. */
export const Scheduled: Story = {
  args: { card: read(CARD_SCHEDULED) },
  play: async ({ canvasElement }) => expectScheduled(within(canvasElement)),
}

/** Where the page draws the sheet, "Change" changes the goal from its first month. */
export const ScheduledChange: Story = {
  args: {
    card: read(CARD_SCHEDULED),
    commands: { setMonthlyPortalGoalFn: setMock, onSet: onSetMock, openSheet: fn() },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Change' }))
    await expect(args.commands.openSheet).toHaveBeenCalledWith({
      mode: 'change',
      measure: 'portal_rating_count',
    })
  },
}

/** Without `goal.update` (a restricted reader) the scheduled card draws no "Change". */
export const ScheduledChangeNotAllowed: Story = {
  args: {
    card: read(CARD_SCHEDULED),
    commands: { setMonthlyPortalGoalFn: setMock, onSet: onSetMock, openSheet: fn() },
  },
  decorators: [withPermissions(['goal.read', 'portal.read', 'property.read'])],
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('November · 40 private ratings')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Change' })).toBeNull()
    await expect(args.commands.openSheet).not.toHaveBeenCalled()
  },
}

export const ScheduledOnANarrowPhone: Story = {
  ...Scheduled,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

export const ScheduledOnADesktop: Story = {
  ...Scheduled,
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
}
