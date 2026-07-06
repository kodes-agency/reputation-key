import type { Meta, StoryObj } from '@storybook/react'
import { expect, fireEvent, within } from 'storybook/test'
import { Bar, BarChart } from 'recharts'
import { Inbox, LayoutDashboard, Settings } from 'lucide-react'
import {
  ColorPicker,
  ColorPickerAlphaSlider,
  ColorPickerArea,
  ColorPickerContent,
  ColorPickerEyeDropper,
  ColorPickerFormatSelect,
  ColorPickerHueSlider,
  ColorPickerInput,
  ColorPickerSwatch,
  ColorPickerTrigger,
} from './color-picker'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from './chart'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarProvider,
  SidebarTrigger,
} from './sidebar'

const meta: Meta = {
  title: 'UI/Complex',
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj

// Mirrors portal-settings/theme-preset-selector.tsx: trigger+swatch, area, hue,
// alpha, format select, eye dropper, hex input — opened by default so the
// popover content renders statically without a click.
export const ColorPickerDefault: Story = {
  render: () => (
    <ColorPicker defaultValue="#6366f1" defaultOpen>
      <div className="flex items-center gap-2">
        <ColorPickerTrigger>
          <ColorPickerSwatch />
        </ColorPickerTrigger>
        <ColorPickerInput withoutAlpha />
      </div>
      <ColorPickerContent className="w-[260px]">
        <ColorPickerArea />
        <ColorPickerHueSlider />
        <ColorPickerAlphaSlider />
        <div className="flex items-center gap-2">
          <ColorPickerInput withoutAlpha />
          <ColorPickerFormatSelect />
          <ColorPickerEyeDropper />
        </div>
      </ColorPickerContent>
    </ColorPicker>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The trigger-row hex input lives in the canvas (popover content is portaled
    // to the body, so this is the deterministic one to target).
    const hexInput = canvas.getByRole('textbox', { name: /hex color value/i })
    const swatch = canvas.getByRole('img')

    await expect(swatch).toHaveAttribute('aria-label', expect.stringContaining('#6366f1'))

    // Controlled input: intermediate partial hex strings are rejected by
    // parseColorString, so set the value atomically via change event.
    await fireEvent.change(hexInput, { target: { value: '#ff0000' } })

    await expect(swatch).toHaveAttribute('aria-label', expect.stringContaining('#ff0000'))
  },
}

const ratingConfig = {
  count: { label: 'Reviews', color: 'var(--chart-1)' },
} satisfies ChartConfig

const ratingData = [
  { stars: '5★', count: 24 },
  { stars: '4★', count: 18 },
  { stars: '3★', count: 9 },
  { stars: '2★', count: 5 },
  { stars: '1★', count: 3 },
]

// Mirrors portal-analytics-charts.tsx: ChartContainer wraps a recharts BarChart,
// fill resolves via the config-driven var(--color-<key>) token.
export const ChartBar: Story = {
  render: () => (
    <ChartContainer config={ratingConfig} className="min-h-[200px] w-[420px]">
      <BarChart data={ratingData} margin={{ left: 0, right: 0 }}>
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  ),
}

// Sidebar scaffold (SidebarProvider > Sidebar + SidebarInset) shared across the
// three meaningful variant/collapsible combinations below.
function renderSidebar(
  variant?: 'sidebar' | 'floating' | 'inset',
  collapsible?: 'offcanvas' | 'icon' | 'none',
) {
  return (
    <SidebarProvider>
      <Sidebar variant={variant} collapsible={collapsible}>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" tooltip="Rep Key">
                <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  R
                </div>
                <span>Rep Key</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive tooltip="Dashboard">
                  <LayoutDashboard />
                  <span>Dashboard</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Inbox">
                  <Inbox />
                  <span>Inbox</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Settings">
                  <Settings />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-16 items-center gap-3 border-b px-6">
          <SidebarTrigger />
          <h1 className="text-lg font-semibold">Dashboard</h1>
        </header>
        <main className="p-6">
          <p className="text-muted-foreground">Sidebar inset content area.</p>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

// Default sidebar: `variant="sidebar"` (in-flow, bordered) + `collapsible="offcanvas"`
// (slides fully off-canvas on mobile). This is the component's default shape.
export const SidebarDefault: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => renderSidebar('sidebar', 'offcanvas'),
}

// Inset variant: the SidebarInset content gets margin + rounded card styling,
// framed separately from the sidebar rail.
export const SidebarInsetVariant: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => renderSidebar('inset', 'icon'),
}

// Floating + collapsible=icon sidebar: rounded, bordered rail that collapses to
// an icon-only strip.
export const SidebarFloating: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => renderSidebar('floating', 'icon'),
}
