// The Portal goals section as a link from another page lands on it (PLAN
// PG-11). The Google rating goal's done screen ("See your portal goal") may
// lead here from the Overview, and the page it left is gone by the time this
// one is drawn, so the link asks for the focus in the address's state and the
// section's title takes it once the section is drawn.
// Any other way to `#portal-goals` (an address typed or bookmarked) leaves the
// focus where it was; a notice about the goal and its old address open
// `/goals/portals` instead. The Storybook Vitest project compiles no Tailwind,
// so the play asserts roles and the focus.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { Button } from '#/components/ui/button'
import { PortalGoalSection } from './portal-goal-section'
import { SEAVIEW } from './portal-goal.stories.fixtures'

type SectionProps = Parameters<typeof PortalGoalSection>[0]

/**
 * A page that draws the section only at `#portal-goals`, so each arrival draws
 * it afresh, as the Goals page is drawn after the page a link left.
 */
function Arrivals(props: SectionProps) {
  const navigate = useNavigate()
  const hash = useRouterState({ select: (state) => state.location.hash })
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Button onClick={() => void navigate({ to: '.', hash: 'elsewhere' })}>
          Leave
        </Button>
        <Button onClick={() => void navigate({ to: '.', hash: 'portal-goals' })}>
          Arrive from a notice
        </Button>
        <Button
          onClick={() =>
            void navigate({
              to: '.',
              hash: 'portal-goals',
              state: { focusPortalGoals: true },
            })
          }
        >
          Arrive asking for the focus
        </Button>
      </div>
      {hash === 'portal-goals' ? <PortalGoalSection {...props} /> : null}
    </div>
  )
}

const meta: Meta<typeof PortalGoalSection> = {
  title: 'Goals/PortalGoalSection',
  component: PortalGoalSection,
  parameters: { layout: 'padded' },
  args: {
    propertyId: SEAVIEW.propertyId,
    card: null,
    canCreatePortal: true,
    commands: { setMonthlyPortalGoalFn: fn(), onSet: fn() },
  },
  render: (args) => <Arrivals {...args} />,
}

export default meta
type Story = StoryObj<typeof meta>

/** The section's title, once the section is drawn. */
const title = (canvasElement: HTMLElement) =>
  within(canvasElement).findByRole('heading', { level: 2, name: 'Portal goals' })

/** Waits until the section has gone with the page. */
async function leave(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByRole('button', { name: 'Leave' }))
  await waitFor(() =>
    expect(
      within(canvasElement).queryByRole('heading', { name: 'Portal goals' }),
    ).toBeNull(),
  )
}

export const ArrivingTakesTheFocusWhenAsked: Story = {
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const fromNotice = canvas.getByRole('button', { name: 'Arrive from a notice' })
    await userEvent.click(fromNotice)
    await title(canvasElement)
    // The section is drawn and its effects have run by the next frame.
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await expect(fromNotice).toHaveFocus()

    await leave(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', { name: 'Arrive asking for the focus' }),
    )
    const landed = await title(canvasElement)
    await waitFor(() => expect(landed).toHaveFocus())
  },
}

/** The same on a staff phone, in the light theme. */
export const ArrivingOnAPhone: Story = {
  parameters: { viewport: { defaultViewport: 'mobileStaff' }, theme: 'light' },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Arrive asking for the focus' }),
    )
    const landed = await title(canvasElement)
    await waitFor(() => expect(landed).toHaveFocus())
  },
}
