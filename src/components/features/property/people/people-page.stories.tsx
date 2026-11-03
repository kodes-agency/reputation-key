import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { PeoplePage } from './people-page'
import {
  StaffManagerStory,
  STAFF_STORY_MEMBERS,
  STAFF_VIEWPORTS,
} from '../../../../../.storybook/staff-manager-fixtures'
function Scene({
  count = 6,
  notJoined = false,
}: Readonly<{ count?: number; notJoined?: boolean }>) {
  const members = STAFF_STORY_MEMBERS.slice(0, count).filter(
    (person) => !notJoined || person.access !== 'active',
  )
  return (
    <StaffManagerStory members={members}>
      <PeoplePage propertyId="prop-1" propertyName="Harbor Hotel" />
    </StaffManagerStory>
  )
}
const meta = {
  title: 'Property/Staff page',
  component: Scene,
  parameters: { layout: 'fullscreen', viewport: { viewports: STAFF_VIEWPORTS } },
  args: { count: 6 },
} satisfies Meta<typeof Scene>
export default meta
type Story = StoryObj<typeof meta>
export const Populated: Story = {
  play: async ({ canvasElement }) => {
    const ui = within(canvasElement)
    await expect(ui.getByRole('heading', { name: 'Staff', level: 1 })).toBeVisible()
    await expect(ui.getByText("6 people, 2 haven't joined yet")).toBeVisible()
    await userEvent.click(ui.getByRole('radio', { name: 'Not joined (2)' }))
    await expect(ui.queryByText('Ana Jones')).toBeNull()
    await expect(ui.getByText('Zoe Park')).toBeVisible()
  },
}
export const FifteenPeople: Story = { args: { count: 15 } }
export const NotJoined: Story = { args: { notJoined: true } }
export const Empty: Story = {
  args: { count: 0 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('No staff yet')).toBeVisible()
  },
}
export const Narrow320: Story = {
  globals: { viewport: { value: 'narrow', isRotated: false } },
}
export const Phone375: Story = {
  globals: { viewport: { value: 'phone', isRotated: false } },
}
export const Tablet768: Story = {
  globals: { viewport: { value: 'tablet', isRotated: false } },
}
export const Desktop1440: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
}

export const LongNames320: Story = {
  render: () => (
    <StaffManagerStory
      members={[
        {
          ...STAFF_STORY_MEMBERS[0]!,
          displayName: 'Alexandria ' + 'Montgomery '.repeat(8),
          email: 'alexandria.long.address.for.the.property@example.com',
        },
      ]}
    >
      <PeoplePage propertyId="prop-1" propertyName="Harbor Hotel" />
    </StaffManagerStory>
  ),
  globals: { viewport: { value: 'narrow', isRotated: false } },
}
