// The Results tab's three ways of not showing figures: its first read still on
// the way, a read that failed, and a read the reader may not make. The figures
// themselves are Portal/Analytics/Results. The read is injected, so each story
// scripts what the server function answers.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import type { PortalGoalLineView } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { PortalGoalResultsLine } from '#/components/goals/portal-goal-results-line'
import { PortalAnalyticsTab } from './portal-analytics-tab'
import { RESULTS_HEALTHY } from './portal-results-stories-data'

type Read = React.ComponentProps<typeof PortalAnalyticsTab>['getPortalAnalytics']

const asRead = (read: () => Promise<unknown>) => fn(read) as unknown as Read

const PROPERTY_ID = '22222222-2222-4222-8222-222222222222'

/** The Monthly portal goal's line as the route hands it in, for Reception. */
const goalLineOf = (line: PortalGoalLineView) => (
  <PortalGoalResultsLine line={line} portalName="Reception" propertyId={PROPERTY_ID} />
)

/** Stands in for the utilities layer, which this runner does not compile: a link in a sentence stays underlined (axe link-in-text-block). */
const UTILITY_LAYER = `@layer utilities {
  .underline { text-decoration-line: underline; }
}`

const withUtilityLayer = (Story: () => React.ReactNode) => (
  <>
    <style>{UTILITY_LAYER}</style>
    <Story />
  </>
)

const meta = {
  title: 'Portal/Analytics/Results tab',
  component: PortalAnalyticsTab,
  // The tab asks who may open the Inbox, which needs the signed-in route's context.
  decorators: [AuthedRouterDecorator],
  parameters: { layout: 'padded', theme: 'light' },
  args: {
    portalId: '11111111-1111-4111-8111-111111111111',
    propertyId: PROPERTY_ID,
    getPortalAnalytics: asRead(async () => RESULTS_HEALTHY),
  },
} satisfies Meta<typeof PortalAnalyticsTab>

export default meta
type Story = StoryObj<typeof meta>

/** The first read is on the way: the strip keeps its five names, not a line of text. */
export const Loading: Story = {
  args: { getPortalAnalytics: asRead(() => new Promise(() => undefined)) },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('Loading results…')
    await expect(canvas.getByText('Are guests using it?')).toBeVisible()
    await expect(canvas.queryByText(/couldn.t be loaded/i)).toBeNull()
  },
}

/** A failed read says so and offers Try again, which reads once more and shows the figures. */
export const FailedThenRecovers: Story = {
  args: {
    getPortalAnalytics: (() => {
      let calls = 0
      return asRead(async () => {
        calls += 1
        if (calls === 1) throw new Error('Reporting is down')
        return RESULTS_HEALTHY
      })
    })(),
  },
  play: async ({ canvas, args }) => {
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'Results couldn’t be loaded.',
    )
    // The server's own words never reach the reader.
    await expect(canvas.queryByText(/Reporting is down/)).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    await waitFor(() =>
      expect(canvas.getByText('Are guests using it?')).toBeInTheDocument(),
    )
    await expect(args.getPortalAnalytics).toHaveBeenCalledTimes(2)
  },
}

/**
 * Try again stays on screen, its button busy, while the second read is pending: a
 * refetch after a failure keeps the query in its error state, so without the
 * flag the button would look dead and could be pressed again.
 */
export const RetryReadsWithTheButtonBusy: Story = {
  args: {
    getPortalAnalytics: (() => {
      let calls = 0
      let settle: (figures: unknown) => void = () => undefined
      const second = new Promise<unknown>((resolve) => {
        settle = resolve
      })
      return Object.assign(
        asRead(async () => {
          calls += 1
          if (calls === 1) throw new Error('Reporting is down')
          return second
        }),
        { settle: () => settle(RESULTS_HEALTHY) },
      )
    })(),
  },
  play: async ({ canvas, args }) => {
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'Results couldn’t be loaded.',
    )
    const button = canvas.getByRole('button', { name: 'Try again' })
    await userEvent.click(button)
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'))
    await expect(button).toHaveTextContent('Trying again…')
    // A second press while it reads asks nothing more of the server.
    await userEvent.click(button)
    await expect(args.getPortalAnalytics).toHaveBeenCalledTimes(2)
    ;(args.getPortalAnalytics as unknown as { settle: () => void }).settle()
    await waitFor(() =>
      expect(canvas.getByText('Are guests using it?')).toBeInTheDocument(),
    )
  },
}

/** A deliberately dark capability is not a failure: friendly copy, and nothing to retry. */
export const NotSwitchedOn: Story = {
  args: {
    getPortalAnalytics: asRead(async () => {
      throw Object.assign(new Error('org_not_allowlisted'), {
        code: 'org_not_allowlisted',
      })
    }),
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Results aren’t available yet')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Try again' })).toBeNull()
    await expect(canvas.queryByText(/org_not_allowlisted/)).toBeNull()
  },
}

export const FailedLight: Story = {
  args: {
    getPortalAnalytics: asRead(async () => {
      throw new Error('Reporting is down')
    }),
  },
  parameters: { theme: 'light' },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: 'Try again' })).toBeVisible()
  },
}

/** The figures are drawn: the toolbar's range control is on screen. */
const figuresDrawn = async (canvas: ReturnType<typeof within>) =>
  waitFor(() => expect(canvas.queryByRole('status')).toBeNull())

const above = (a: Node, b: Node) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

/** R-1: November, what Reception brought in toward the monthly goal, above the figures. */
export const WithPortalGoalLine: Story = {
  decorators: [withUtilityLayer],
  args: {
    goalLine: goalLineOf({
      month: '2026-11',
      monthlyGoal: { measure: 'portal_rating_count', count: 13 },
      ownGoal: null,
    }),
  },
  play: async ({ canvas }) => {
    await figuresDrawn(canvas)
    const line = canvas.getByText(
      'November · Reception’s 13 private ratings count toward the monthly portal goal.',
    )
    await expect(line).toBeVisible()
    await expect(above(line, canvas.getByText('Are guests using it?'))).toBe(true)
    await expect(canvas.getByRole('link', { name: 'Open goal' })).toHaveAttribute(
      'href',
      `/properties/${PROPERTY_ID}/goals/portals`,
    )
  },
}

/** R-2: Reception's own goal, its month so far against its number, and the way to it. */
export const WithOwnGoal: Story = {
  decorators: [withUtilityLayer],
  args: {
    goalLine: goalLineOf({
      month: '2026-11',
      monthlyGoal: { measure: 'portal_rating_count', count: 13 },
      ownGoal: {
        programId: 'program-reception',
        measure: 'portal_rating_count',
        value: 14,
        target: 20,
      },
    }),
  },
  play: async ({ canvas }) => {
    await figuresDrawn(canvas)
    await expect(
      canvas.getByText('November goal: 14 of 20 private ratings · 6 to go'),
    ).toBeVisible()
    await expect(canvas.queryByText(/count toward the monthly portal goal/)).toBeNull()
    await expect(canvas.getByRole('link', { name: 'Open goal' })).toHaveAttribute(
      'href',
      `/properties/${PROPERTY_ID}/goals/program-reception`,
    )
  },
}

export const WithPortalGoalLinePhone320: Story = {
  ...WithPortalGoalLine,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

export const WithOwnGoalLight: Story = {
  ...WithOwnGoal,
  parameters: { theme: 'light' },
}

/**
 * While the line is read the tab keeps its loading state, figures or not, so a
 * line that arrives never pushes the figures down.
 */
export const HoldsWhileTheLineIsRead: Story = {
  args: { goalLinePending: true },
  play: async ({ canvas, args }) => {
    await waitFor(() => expect(args.getPortalAnalytics).toHaveBeenCalled())
    await expect(canvas.getByRole('status')).toHaveTextContent('Loading results…')
  },
}

export const CheckIn: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Are guests using it?')).toBeVisible()
    await expect(canvas.getByText('Mostly. 4.4★ from 118 ratings')).toBeVisible()
  },
}
export const CheckInDark: Story = { ...CheckIn, parameters: { theme: 'dark' } }
