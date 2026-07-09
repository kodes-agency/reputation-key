import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { Button } from './button'
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from './breadcrumb'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from './select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip'

const meta: Meta = {
  title: 'UI/Inputs Nav',
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj

export const SelectPopper: Story = {
  render: () => (
    <Select>
      <SelectTrigger size="sm" aria-label="Select a fruit" className="w-[180px]">
        <SelectValue placeholder="Select a fruit" />
      </SelectTrigger>
      <SelectContent position="popper" className="w-[180px]">
        <SelectGroup>
          <SelectLabel>Fruits</SelectLabel>
          <SelectItem value="apple">Apple</SelectItem>
          <SelectItem value="banana">Banana</SelectItem>
          <SelectItem value="cherry">Cherry</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
}

export const SelectItemAligned: Story = {
  render: () => (
    <Select>
      <SelectTrigger aria-label="Select a fruit" className="w-[180px]">
        <SelectValue placeholder="Select a fruit" />
      </SelectTrigger>
      <SelectContent position="item-aligned">
        <SelectItem value="apple">Apple</SelectItem>
        <SelectItem value="banana">Banana</SelectItem>
        <SelectItem value="cherry">Cherry</SelectItem>
      </SelectContent>
    </Select>
  ),
}
export const SelectControlled: Story = {
  render: () => {
    const [value, setValue] = useState('')
    return (
      <div className="flex flex-col gap-3">
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger aria-label="Select a fruit" className="w-[180px]">
            <SelectValue placeholder="Select a fruit" />
          </SelectTrigger>
          <SelectContent position="popper" className="w-[180px]">
            <SelectItem value="apple">Apple</SelectItem>
            <SelectItem value="banana">Banana</SelectItem>
            <SelectItem value="cherry">Cherry</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground" data-testid="selected-value">
          Selected: {value || 'none'}
        </p>
      </div>
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('combobox', { name: /select a fruit/i })
    await userEvent.click(trigger)
    // Select content is portaled to the document body by Radix.
    const option = await within(canvasElement.ownerDocument.body).findByRole('option', {
      name: /^banana$/i,
    })
    await userEvent.click(option)
    await expect(await canvas.findByText(/selected: banana/i)).toBeInTheDocument()
  },
}

export const SelectDisabled: Story = {
  render: () => (
    <Select disabled defaultValue="apple">
      <SelectTrigger aria-label="Select a fruit" className="w-[180px]">
        <SelectValue placeholder="Select a fruit" />
      </SelectTrigger>
      <SelectContent position="popper" className="w-[180px]">
        <SelectItem value="apple">Apple</SelectItem>
        <SelectItem value="banana">Banana</SelectItem>
      </SelectContent>
    </Select>
  ),
}

export const TabsLine: Story = {
  render: () => (
    <Tabs defaultValue="account" className="w-[400px]">
      <TabsList variant="line">
        <TabsTrigger value="account">Account</TabsTrigger>
        <TabsTrigger value="password">Password</TabsTrigger>
        <TabsTrigger value="team">Team</TabsTrigger>
      </TabsList>
      <TabsContent value="account">Account settings panel.</TabsContent>
      <TabsContent value="password">Password settings panel.</TabsContent>
      <TabsContent value="team">Team settings panel.</TabsContent>
    </Tabs>
  ),
}

export const TabsDefault: Story = {
  render: () => (
    <Tabs defaultValue="overview" className="w-[400px]">
      <TabsList variant="default">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="analytics">Analytics</TabsTrigger>
        <TabsTrigger value="reports">Reports</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">Overview panel.</TabsContent>
      <TabsContent value="analytics">Analytics panel.</TabsContent>
      <TabsContent value="reports">Reports panel.</TabsContent>
    </Tabs>
  ),
}
export const TabsVertical: Story = {
  render: () => (
    <Tabs orientation="vertical" defaultValue="account" className="w-[400px]">
      <TabsList variant="default">
        <TabsTrigger value="account">Account</TabsTrigger>
        <TabsTrigger value="password">Password</TabsTrigger>
        <TabsTrigger value="team" disabled>
          Team (locked)
        </TabsTrigger>
      </TabsList>
      <TabsContent value="account">Account settings panel.</TabsContent>
      <TabsContent value="password">Password settings panel.</TabsContent>
      <TabsContent value="team">Team settings panel.</TabsContent>
    </Tabs>
  ),
}

export const TabsInteractive: Story = {
  render: () => (
    <Tabs defaultValue="overview" className="w-[400px]">
      <TabsList variant="default">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="analytics">Analytics</TabsTrigger>
        <TabsTrigger value="reports">Reports</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">Overview panel content.</TabsContent>
      <TabsContent value="analytics">Analytics panel content.</TabsContent>
      <TabsContent value="reports">Reports panel content.</TabsContent>
    </Tabs>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('tab', { name: /analytics/i }))
    await expect(canvas.getByRole('tabpanel')).toHaveTextContent(/analytics panel/i)
  },
}

export const TooltipSides: Story = {
  render: () => (
    <TooltipProvider delayDuration={0}>
      <div className="flex flex-col items-center gap-8">
        {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
          <Tooltip key={side} defaultOpen>
            <TooltipTrigger asChild>
              <Button variant="outline" className="w-24 capitalize">
                {side}
              </Button>
            </TooltipTrigger>
            <TooltipContent side={side}>Tooltip on {side}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  ),
}

export const BreadcrumbDemo: Story = {
  render: () => (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <a href="#">Home</a>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <a href="#">Properties</a>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbEllipsis />
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Acme Hotel</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
}
