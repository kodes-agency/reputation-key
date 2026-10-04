// Which properties an invited member starts with: the chosen ones as removable
// chips, the rest behind the app's one in-form property chooser (PropertyPicker),
// which gains a search field from eight properties and has none below. Dark is
// the default theme; the light variant renders the same field on the light
// surface (axe runs on both).
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { PropertyAssignmentSelector } from './property-assignment-selector'

const FEW = [
  { id: 'p-1', name: 'Sunset Apartments' },
  { id: 'p-2', name: 'Harbor View' },
  { id: 'p-3', name: 'Rila Grand Hotel' },
]

const MANY = [
  ...FEW,
  { id: 'p-4', name: 'Café Plaza' },
  { id: 'p-5', name: 'Harborline Suites' },
  { id: 'p-6', name: 'Stara Zagora Inn' },
  { id: 'p-7', name: 'Forma Kitchen' },
  { id: 'p-8', name: 'Avela Resort' },
  { id: 'p-9', name: 'Pirin Lodge' },
]

function Harness({
  properties,
  initial = [],
}: Readonly<{
  properties: ReadonlyArray<{ id: string; name: string }>
  initial?: ReadonlyArray<string>
}>) {
  const [ids, setIds] = useState<ReadonlyArray<string>>(initial)
  return (
    <div className="w-80">
      <PropertyAssignmentSelector
        field={{ state: { value: [...ids] } }}
        properties={properties}
        onToggleProperty={(id) => setIds((current) => [...current, id])}
        onRemoveProperty={(id) =>
          setIds((current) => current.filter((item) => item !== id))
        }
      />
    </div>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Identity/MemberDirectory/PropertyAssignmentSelector',
  component: Harness,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: { properties: FEW },
}

export default meta
type Story = StoryObj<typeof Harness>

const body = () => within(document.body)

/** A short list needs no search: the picker opens on the rows and chosen ones become chips. */
export const ShortList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('button', { name: /^Remove / })).toBeNull()
    await userEvent.click(canvas.getByRole('combobox', { name: 'Add a property' }))
    expect(body().queryByPlaceholderText('Search properties')).toBeNull()
    await userEvent.click(await body().findByRole('option', { name: 'Harbor View' }))
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Remove Harbor View' })).toBeVisible(),
    )
    // The chosen property leaves the list it was chosen from.
    await userEvent.click(canvas.getByRole('combobox', { name: 'Add a property' }))
    expect(body().queryByRole('option', { name: 'Harbor View' })).toBeNull()
  },
}

/** From eight properties the same picker gets a search field that finds through accents. */
export const LongListHasSearch: Story = {
  args: { properties: MANY },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('combobox', { name: 'Add a property' }))
    await userEvent.type(await body().findByPlaceholderText('Search properties'), 'cafe')
    expect(await body().findByRole('option', { name: 'Café Plaza' })).toBeVisible()
    expect(body().queryByRole('option', { name: 'Harbor View' })).toBeNull()
  },
}

/** A chip is one button; pressing it takes the property back out. */
export const RemovesAChip: Story = {
  args: { initial: ['p-1', 'p-3'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', { name: 'Remove Sunset Apartments' }),
    )
    expect(canvas.queryByRole('button', { name: 'Remove Sunset Apartments' })).toBeNull()
    expect(canvas.getByRole('button', { name: 'Remove Rila Grand Hotel' })).toBeVisible()
  },
}

/** Every property chosen: nothing is left to add, so no picker is drawn. */
export const AllChosen: Story = {
  args: { initial: ['p-1', 'p-2', 'p-3'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('combobox')).toBeNull()
    expect(canvas.getAllByRole('button', { name: /^Remove / })).toHaveLength(3)
  },
}

/** An organisation with no properties yet says so, and the member can be assigned later. */
export const NoProperties: Story = {
  args: { properties: [] },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByText(/No properties yet/)).toBeVisible()
  },
}

export const ShortListLight: Story = {
  args: { initial: ['p-2'] },
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    expect(
      within(canvasElement).getByRole('button', { name: 'Remove Harbor View' }),
    ).toBeVisible()
  },
}
