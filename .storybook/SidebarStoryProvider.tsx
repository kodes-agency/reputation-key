// A `SidebarProvider` that owns its open state, as the app shell does, for the
// stories that mount a sidebar or a surface that lays itself out beside one.
import { useState, type ComponentProps } from 'react'
import { SidebarProvider } from '#/components/ui/sidebar'

type SidebarStoryProviderProps = Omit<
  ComponentProps<typeof SidebarProvider>,
  'open' | 'onOpenChange'
> & { initiallyOpen?: boolean }

export function SidebarStoryProvider({
  initiallyOpen = true,
  ...props
}: SidebarStoryProviderProps) {
  const [open, setOpen] = useState(initiallyOpen)
  return <SidebarProvider open={open} onOpenChange={setOpen} {...props} />
}
