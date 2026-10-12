// GoalStartField: when a new goal starts. The Storybook Vitest project compiles no
// Tailwind, so the plays pin behaviour and wiring: the two months and their words,
// which one is chosen by default on which day, the month key a choice submits, and
// that the month so far is said only for the month it belongs to.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { GoalStartField } from './goal-start-field'
import { goalStartChoice, goalStartLabels, offeredStartMonth } from './goal-start-view'

const ZONE = 'Europe/Sofia'

function StartChoice({ now, legend }: Readonly<{ now: Date; legend?: string }>) {
  const choice = goalStartChoice(now, ZONE)
  const labels = goalStartLabels(choice, ZONE, now)
  const [picked, setPicked] = useState<string | null>(null)
  const startMonth = offeredStartMonth(choice, picked)
  return (
    <div className="max-w-sm space-y-3">
      <GoalStartField
        options={[
          { monthKey: choice.current.monthKey, label: labels.current },
          { monthKey: choice.next.monthKey, label: labels.next },
        ]}
        value={startMonth}
        onValueChange={setPicked}
        soFar={startMonth === choice.current.monthKey ? 'So far this month: 412' : null}
        legend={legend}
      />
      <p>
        Submits <output aria-label="Start month">{startMonth}</output>
      </p>
    </div>
  )
}

const meta: Meta<typeof StartChoice> = {
  title: 'Goals/GoalStartField',
  component: StartChoice,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof StartChoice>

/** Up to the 20th a goal counts for the month it is set in, and says what that month holds. */
export const StartsThisMonthByDefault: Story = {
  args: { now: new Date('2026-10-11T09:00:00.000Z') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const group = within(
      canvas.getByRole('group', { name: 'When does this goal start?' }),
    )
    const thisMonth = group.getByRole('radio', {
      name: 'This month — counts everything since Oct 1',
    })
    const nextMonth = group.getByRole('radio', { name: 'Next month — starts Nov 1' })
    await expect(thisMonth).toBeChecked()
    await expect(nextMonth).not.toBeChecked()
    await expect(group.getByText('So far this month: 412')).toBeVisible()
    await expect(canvas.getByLabelText('Start month')).toHaveTextContent('2026-10')

    // The other month is one click away, and the choice submits the month itself.
    await userEvent.click(nextMonth)
    await expect(nextMonth).toBeChecked()
    await expect(thisMonth).not.toBeChecked()
    await expect(canvas.getByLabelText('Start month')).toHaveTextContent('2026-11')
    // The month so far belongs to this month only.
    expect(group.queryByText('So far this month: 412')).toBeNull()
  },
}

/** From the 21st the default is the next month; this month stays a choice. */
export const StartsNextMonthAfterThe20th: Story = {
  args: { now: new Date('2026-10-21T09:00:00.000Z') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const thisMonth = canvas.getByRole('radio', {
      name: 'This month — counts everything since Oct 1',
    })
    await expect(
      canvas.getByRole('radio', { name: 'Next month — starts Nov 1' }),
    ).toBeChecked()
    await expect(canvas.getByLabelText('Start month')).toHaveTextContent('2026-11')
    expect(canvas.queryByText('So far this month: 412')).toBeNull()

    await userEvent.click(thisMonth)
    await expect(thisMonth).toBeChecked()
    await expect(canvas.getByLabelText('Start month')).toHaveTextContent('2026-10')
    await expect(canvas.getByText('So far this month: 412')).toBeVisible()
  },
}

/** A start in the next year prints its year. */
export const NextMonthIsNextYear: Story = {
  args: { now: new Date('2026-12-11T09:00:00.000Z') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('radio', { name: 'This month — counts everything since Dec 1' }),
    ).toBeChecked()
    await expect(
      canvas.getByRole('radio', { name: 'Next month — starts Jan 1, 2027' }),
    ).toBeInTheDocument()
  },
}

/** The table that sets several goals asks about all of them. */
export const AsksAboutSeveralGoals: Story = {
  args: {
    now: new Date('2026-10-11T09:00:00.000Z'),
    legend: 'When do these goals start?',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const group = within(
      canvas.getByRole('group', { name: 'When do these goals start?' }),
    )
    await expect(
      group.getByRole('radio', { name: 'This month — counts everything since Oct 1' }),
    ).toBeChecked()
    expect(canvas.queryByRole('group', { name: 'When does this goal start?' })).toBeNull()
  },
}
