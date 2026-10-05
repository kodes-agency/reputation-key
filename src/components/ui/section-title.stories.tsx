// Section titles under a page's one h1. Dark is the default theme; the light variants
// render the same outline on the light surface (axe runs on both). The Storybook Vitest
// project compiles no Tailwind, so the plays pin the outline (which level each title is
// and in what order), not the sizes.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card'
import { SectionTitle } from './section-title'

const meta: Meta<typeof SectionTitle> = {
  title: 'Patterns/Section title',
  component: SectionTitle,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof SectionTitle>

const levels = (canvasElement: HTMLElement) =>
  within(canvasElement)
    .getAllByRole('heading')
    .map((heading) => [Number(heading.tagName.slice(1)), heading.textContent])

/** A settings page: the page's h1, a Card titled as an h2, a section that is not a Card. */
export const Outline: Story = {
  render: () => (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Quiet hours</CardTitle>
          <CardDescription>Email waits until quiet hours are over.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <SectionTitle level={3}>Your quiet hours</SectionTitle>
          <p className="text-sm text-muted-foreground">22:00 to 07:00</p>
          <SectionTitle level={3}>Harborline Suites</SectionTitle>
          <p className="text-sm text-muted-foreground">Follows your quiet hours</p>
        </CardContent>
      </Card>
      <section className="flex flex-col gap-2">
        <SectionTitle>Members</SectionTitle>
        <p className="text-sm text-muted-foreground">Everyone with access.</p>
        <SectionTitle>Pending invitations</SectionTitle>
        <p className="text-sm text-muted-foreground">Two people have not joined yet.</p>
      </section>
    </div>
  ),
  play: ({ canvasElement }) => {
    expect(levels(canvasElement)).toEqual([
      [1, 'Notifications'],
      [2, 'Quiet hours'],
      [3, 'Your quiet hours'],
      [3, 'Harborline Suites'],
      [2, 'Members'],
      [2, 'Pending invitations'],
    ])
  },
}

export const OutlineLight: Story = { ...Outline, parameters: { theme: 'light' } }

/** A Card whose title is not a section (a tile) stays a div and is not in the outline. */
export const CardTitleStaysADiv: Story = {
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle>Goal results matrix</CardTitle>
      </CardHeader>
    </Card>
  ),
  play: ({ canvasElement }) => {
    expect(within(canvasElement).queryByRole('heading')).not.toBeInTheDocument()
    expect(within(canvasElement).getByText('Goal results matrix').tagName).toBe('DIV')
  },
}
