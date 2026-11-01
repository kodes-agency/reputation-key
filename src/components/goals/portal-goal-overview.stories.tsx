// The Monthly portal goal on the Property Overview (PLAN PG-16; copy deck
// O-1…O-6): the number ready to use in one line ("See it", "Not now", which
// hides it), the running month as the Goals page's card draws it (what is left, the
// ruler, and each Portal's count in name order), the month-start check-in as the
// strip above that card, and nothing for a goal that has not started. At 320,
// 390, 820 and 1440 px and on the light theme. The Storybook Vitest project
// compiles no Tailwind, so the plays assert words, roles, links and what is
// sent.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { toast } from 'sonner'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { PortalGoalCardView } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { ToasterDecorator } from '../../../.storybook/ToasterDecorator'
import type { PortalGoalCheckInCommands } from './portal-goal-check-in'
import { CARD_CHECK_IN } from './portal-goal-check-in.stories.fixtures'
import { PortalGoalOverview } from './portal-goal-overview'
import { overviewPortalGoalView } from './portal-goal-overview-view'
import { CARD_RUNNING } from './portal-goal-running.stories.fixtures'
import {
  expectRunningCardUnderTheStrip,
  headlineOf,
  portalRows,
} from './portal-goal.stories.play'
import { CARD_READY, CARD_SCHEDULED, SEAVIEW } from './portal-goal.stories.fixtures'

const notNowMock = fn<(month: string) => void>()
const changeNowMock = fn<PortalGoalCheckInCommands['changeMonthlyPortalGoalNowFn']>(
  async () => ({ changed: true }),
)
const keepMock = fn<PortalGoalCheckInCommands['keepMonthlyPortalGoalFn']>(async () => ({
  month: '2026-12',
}))
const onAnsweredMock = fn(async () => undefined)
const openSheetMock = fn()

/**
 * The slot as the Overview's host draws it for a manager: the view worked out
 * from the card's read, and "Not now" hiding the prompt at once.
 */
function Slot({ card }: Readonly<{ card: PortalGoalCardView }>) {
  const [putOff, setPutOff] = useState(false)
  const view = putOff
    ? ({ kind: 'nothing' } as const)
    : overviewPortalGoalView({ card, canSet: true, canChange: true })
  return (
    <div className="max-w-5xl">
      <PortalGoalOverview
        view={view}
        propertyId={SEAVIEW.propertyId}
        onNotNow={(month) => {
          notNowMock(month)
          setPutOff(true)
        }}
        notNowPending={false}
        checkIn={{
          commands: {
            changeMonthlyPortalGoalNowFn: changeNowMock,
            keepMonthlyPortalGoalFn: keepMock,
          },
          onAnswered: onAnsweredMock,
        }}
        openSheet={openSheetMock}
      />
    </div>
  )
}

const meta: Meta<typeof Slot> = {
  title: 'Goals/PortalGoalOverview',
  component: Slot,
  parameters: { layout: 'padded' },
  args: { card: CARD_RUNNING },
  decorators: [ToasterDecorator],
  beforeEach: () => {
    toast.dismiss()
    notNowMock.mockClear()
    changeNowMock.mockClear()
    keepMock.mockClear()
    onAnsweredMock.mockClear()
    openSheetMock.mockClear()
  },
}

export default meta
type Story = StoryObj<typeof meta>

/** The slot's title: the goal's name, a level-2 heading, whichever card draws under it. */
const expectTitle = (canvas: ReturnType<typeof within>) =>
  expect(
    canvas.getByRole('heading', { level: 2, name: 'Monthly portal goal' }),
  ).toBeVisible()

const PROMPT = 'Your monthly portal goal for November is ready: 40 private ratings.'

/** O-1: one line, "See it" to the Goals page's card, and "Not now", which hides it. */
export const Ready: Story = {
  args: { card: CARD_READY },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const prompt = canvas.getByRole('region', { name: 'Monthly portal goal' })
    await expect(within(prompt).getByText(PROMPT)).toBeVisible()
    const seeIt = within(prompt).getByRole('link', { name: 'See it' })
    const href = new URL(seeIt.getAttribute('href') ?? '', 'http://localhost')
    await expect(href.pathname).toBe(`/properties/${SEAVIEW.propertyId}/goals`)
    await expect(href.hash).toBe('#portal-goals')

    await userEvent.click(within(prompt).getByRole('button', { name: 'Not now' }))

    await expect(notNowMock).toHaveBeenCalledOnce()
    await expect(notNowMock).toHaveBeenCalledWith('2026-11')
    await waitFor(() => expect(canvas.queryByText(PROMPT)).toBeNull())
  },
}

/** O-2: the running month as the Goals page's card says it, and View details. */
export const Running: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expectTitle(canvas)
    await expect(canvas.getByText('Below pace', { exact: true })).toBeVisible()
    await expect(headlineOf(canvas, '17 private ratings to 40')).toBeVisible()
    await expect(
      canvas.getByText('9 days left in November. About 2 a day gets you there.'),
    ).toBeVisible()
    await expect(
      canvas.getByRole('img', {
        name: '23 of 40 private ratings so far. A steady month would be at about 29 by today.',
      }),
    ).toBeVisible()
    await expect(canvas.queryByText(/on pace/iu)).toBeNull()
    // Name order, never by count (P-1), in a narrow slot as in a wide one.
    await expect(portalRows(canvas)).toEqual([
      ['Reception', '3'],
      ['Restaurant', '0'],
      ['Spa', '20'],
    ])
    const details = canvas.getByRole('link', { name: 'View details' })
    await expect(details).toHaveAttribute(
      'href',
      `/properties/${SEAVIEW.propertyId}/goals/portals`,
    )
  },
}

/** O-3…O-6: on Dec 1 the check-in, the strip above the card; Keep is sent once. */
export const CheckIn: Story = {
  args: { card: CARD_CHECK_IN },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expectTitle(canvas)
    await expect(
      canvas.getByText('November: 36 of 40 so far. Final figure on Dec 2.'),
    ).toBeVisible()
    const strip = canvas.getByRole('region', { name: 'For December' })
    // Not a heading, and right above the slot's card, which stays: December's first day.
    await expect(canvas.queryByRole('heading', { name: 'For December' })).toBeNull()
    const card = canvasElement.querySelector('[data-slot="portal-goal-overview"]')
    await expect(card).not.toBeNull()
    await expect(card?.previousElementSibling).toBe(strip)
    await expect(card).not.toContainElement(strip)
    await expectRunningCardUnderTheStrip(canvas)

    const region = within(strip)
    await expect(region.getByRole('button', { name: 'Use 45' })).toBeVisible()
    await expect(region.getByRole('button', { name: 'Other number' })).toBeVisible()
    await expect(
      region.getByText(
        'Nothing changes unless you choose. December counts against 40 until then.',
      ),
    ).toBeVisible()

    await userEvent.click(region.getByRole('button', { name: 'Keep 40' }))

    await waitFor(() => expect(onAnsweredMock).toHaveBeenCalledOnce())
    await expect(keepMock).toHaveBeenCalledOnce()
    await expect(keepMock).toHaveBeenCalledWith({
      data: {
        propertyId: SEAVIEW.propertyId,
        programId: 'program-monthly',
        month: '2026-12',
      },
    })
    await expect(changeNowMock).not.toHaveBeenCalled()
  },
}

/** A goal that has not started: the Overview says nothing of it. */
export const Scheduled: Story = {
  args: { card: CARD_SCHEDULED },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-slot^="portal-goal"]')).toBeNull()
  },
}

/** No room is lost sideways on a 320 px phone. */
const fitsTheWidth: Story['play'] = async ({ canvasElement }) => {
  const page = canvasElement.ownerDocument.documentElement
  await expect(page.scrollWidth).toBeLessThanOrEqual(page.clientWidth)
}

export const Phone320: Story = {
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  play: async (context) => {
    await Running.play?.(context)
    await fitsTheWidth(context)
  },
}

export const ReadyPhone320: Story = {
  ...Ready,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  play: async (context) => {
    await fitsTheWidth(context)
    await Ready.play?.(context)
  },
}

export const RunningOnAPhone: Story = {
  ...Running,
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
}

export const RunningOnATablet: Story = {
  ...Running,
  parameters: { viewport: { defaultViewport: 'tablet' } },
}

export const RunningOnADesktop: Story = {
  ...Running,
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
}

export const RunningLight: Story = {
  ...Running,
  parameters: { theme: 'light' },
}
